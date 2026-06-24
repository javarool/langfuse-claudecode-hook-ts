/**
 * Claude Code -> Langfuse hook (TypeScript)
 *
 * Sends Claude Code conversation turns to Langfuse as traces with spans,
 * generations, and tool observations. Runs on the "Stop" hook (after each
 * assistant turn) and reads the JSONL transcript incrementally.
 *
 * Setup
 * =====
 *
 * 1. Build: npm install && npm run build
 *
 * 2. Register the hook in ~/.claude/settings.json:
 *
 *     {
 *       "hooks": {
 *         "Stop": [{ "hooks": [{ "type": "command",
 *           "command": "node /path/to/langfuse-claudecode-hook-ts/dist/index.js" }] }]
 *       }
 *     }
 *
 * 3. Add credentials in .claude/settings.local.json (gitignored):
 *
 *     {
 *       "env": {
 *         "TRACE_TO_LANGFUSE": "true",
 *         "LANGFUSE_PUBLIC_KEY": "pk-lf-...",
 *         "LANGFUSE_SECRET_KEY": "sk-lf-...",
 *         "LANGFUSE_BASE_URL": "https://cloud.langfuse.com",
 *         "CC_LANGFUSE_USER_ID": "user@example.com",
 *         "CC_LANGFUSE_ENVIRONMENT": "my-project"
 *       }
 *     }
 *
 * Environment variables
 * =====================
 * Required:
 *   TRACE_TO_LANGFUSE       Set to "true" to enable tracing.
 *   LANGFUSE_PUBLIC_KEY     Langfuse project public key.
 *   LANGFUSE_SECRET_KEY     Langfuse project secret key.
 *
 * Optional:
 *   LANGFUSE_BASE_URL       Langfuse host (default: https://cloud.langfuse.com).
 *   CC_LANGFUSE_USER_ID     User ID attached to all traces (e.g. email).
 *   CC_LANGFUSE_ENVIRONMENT Environment name for Langfuse (e.g. project name).
 *   CC_LANGFUSE_DEBUG       Set to "true" for verbose logging.
 *   CC_LANGFUSE_MAX_CHARS   Max characters before truncation (default: 20000).
 */

import * as fs from 'fs';
import * as os from 'os';
import * as https from 'https';
import Langfuse from 'langfuse';

import { debug, info } from './logger';
import {
  acquireLock,
  releaseLock,
  loadState,
  saveState,
  stateKey,
  loadSessionState,
  writeSessionState,
} from './state';
import { readNewJsonl, buildTurns } from './transcript';
import { emitTurn } from './emitter';

// --- Payload helpers ---

function readHookPayload(): Record<string, unknown> {
  try {
    const data = fs.readFileSync(0, 'utf8');
    if (!data.trim()) return {};
    return JSON.parse(data) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function extractSessionAndTranscript(payload: Record<string, unknown>): {
  sessionId: string | null;
  transcriptPath: string | null;
} {
  const sessionId =
    (payload.sessionId as string | undefined) ||
    (payload.session_id as string | undefined) ||
    ((payload.session as Record<string, unknown> | undefined)?.id as string | undefined) ||
    null;

  const raw =
    (payload.transcriptPath as string | undefined) ||
    (payload.transcript_path as string | undefined) ||
    ((payload.transcript as Record<string, unknown> | undefined)?.path as string | undefined) ||
    null;

  let transcriptPath: string | null = null;
  if (raw) {
    try {
      transcriptPath = require('path').resolve(raw.replace(/^~/, os.homedir()));
    } catch {
      transcriptPath = null;
    }
  }

  return { sessionId, transcriptPath };
}

// --- Public IP ---

function getPublicIp(): Promise<string> {
  return new Promise((resolve) => {
    const req = https.get('https://api.ipify.org', { timeout: 2000 }, (res) => {
      let data = '';
      res.on('data', (chunk: string) => (data += chunk));
      res.on('end', () => resolve(data.trim()));
    });
    req.on('error', () => resolve('unknown'));
    req.on('timeout', () => {
      req.destroy();
      resolve('unknown');
    });
  });
}

// --- Main ---

async function main(): Promise<number> {
  const start = Date.now();
  debug('Hook started');

  if (process.env.TRACE_TO_LANGFUSE?.toLowerCase() !== 'true') return 0;

  const publicKey =
    process.env.CC_LANGFUSE_PUBLIC_KEY || process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey =
    process.env.CC_LANGFUSE_SECRET_KEY || process.env.LANGFUSE_SECRET_KEY;
  const host =
    process.env.CC_LANGFUSE_BASE_URL ||
    process.env.LANGFUSE_BASE_URL ||
    'https://cloud.langfuse.com';
  const environment = process.env.CC_LANGFUSE_ENVIRONMENT;

  if (!publicKey || !secretKey) return 0;

  const publicIp = await getPublicIp();
  const hostMeta: Record<string, string> = {
    host_ip: publicIp,
    host_name: os.hostname(),
    host_cwd: process.cwd(),
  };

  const payload = readHookPayload();
  const { sessionId, transcriptPath } = extractSessionAndTranscript(payload);

  if (!sessionId || !transcriptPath) {
    debug('Missing session_id or transcript_path from hook payload; exiting.');
    return 0;
  }

  if (!fs.existsSync(transcriptPath)) {
    debug(`Transcript path does not exist: ${transcriptPath}`);
    return 0;
  }

  let langfuse: Langfuse | null = null;

  try {
    langfuse = new Langfuse({
      publicKey,
      secretKey,
      baseUrl: host,
      ...(environment ? { environment } : {}),
    });
  } catch {
    return 0;
  }

  const lockAcquired = acquireLock();
  try {
    const state = loadState();
    const key = stateKey(sessionId, transcriptPath);
    let ss = loadSessionState(state, key);

    const [msgs, newSs] = readNewJsonl(transcriptPath, ss);
    ss = newSs;

    if (!msgs.length) {
      writeSessionState(state, key, ss);
      saveState(state);
      return 0;
    }

    const turns = buildTurns(msgs);
    if (!turns.length) {
      writeSessionState(state, key, ss);
      saveState(state);
      return 0;
    }

    let emitted = 0;
    for (const t of turns) {
      emitted++;
      const turnNum = ss.turnCount + emitted;
      try {
        emitTurn(langfuse, sessionId, turnNum, t, transcriptPath, hostMeta);
      } catch (e) {
        debug(`emitTurn failed: ${e}`);
      }
    }

    ss.turnCount += emitted;
    writeSessionState(state, key, ss);
    saveState(state);

    try {
      await langfuse.flush();
    } catch {
      // ignore flush errors
    }

    const dur = ((Date.now() - start) / 1000).toFixed(2);
    info(`Processed ${emitted} turns in ${dur}s (session=${sessionId})`);
    return 0;
  } catch (e) {
    debug(`Unexpected failure: ${e}`);
    return 0;
  } finally {
    if (lockAcquired) releaseLock();
    if (langfuse) {
      try {
        await langfuse.shutdown();
      } catch {
        // ignore
      }
    }
  }
}

main()
  .then((code) => process.exit(code))
  .catch(() => process.exit(0));
