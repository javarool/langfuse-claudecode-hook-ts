import * as fs from 'fs';
import * as path from 'path';
import * as crypto from 'crypto';
import { STATE_DIR, debug } from './logger';

const STATE_FILE = path.join(STATE_DIR, 'langfuse_state.json');
const LOCK_FILE = path.join(STATE_DIR, 'langfuse_state.lock');

// --- Types ---

export interface SessionState {
  offset: number;
  buffer: string;
  turnCount: number;
}

interface SessionStateData {
  offset: number;
  buffer: string;
  turn_count: number;
  updated?: string;
}

export interface GlobalState {
  [key: string]: SessionStateData;
}

// --- File lock ---

function sleepMs(ms: number): void {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

export function acquireLock(timeoutMs = 2000): boolean {
  fs.mkdirSync(STATE_DIR, { recursive: true });
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      fs.writeFileSync(LOCK_FILE, String(process.pid), { flag: 'wx' });
      return true;
    } catch {
      sleepMs(50);
    }
  }
  return false;
}

export function releaseLock(): void {
  try {
    fs.unlinkSync(LOCK_FILE);
  } catch {
    // ignore
  }
}

// --- State persistence ---

export function loadState(): GlobalState {
  try {
    if (!fs.existsSync(STATE_FILE)) return {};
    return JSON.parse(fs.readFileSync(STATE_FILE, 'utf8')) as GlobalState;
  } catch {
    return {};
  }
}

export function saveState(state: GlobalState): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const tmp = STATE_FILE + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(state, null, 2), 'utf8');
    fs.renameSync(tmp, STATE_FILE);
  } catch (e) {
    debug(`saveState failed: ${e}`);
  }
}

export function stateKey(sessionId: string, transcriptPath: string): string {
  return crypto
    .createHash('sha256')
    .update(`${sessionId}::${transcriptPath}`)
    .digest('hex');
}

// --- Session state ---

export function loadSessionState(globalState: GlobalState, key: string): SessionState {
  const s = globalState[key] ?? {};
  return {
    offset: Number(s.offset ?? 0),
    buffer: String(s.buffer ?? ''),
    turnCount: Number(s.turn_count ?? 0),
  };
}

export function writeSessionState(
  globalState: GlobalState,
  key: string,
  ss: SessionState,
): void {
  globalState[key] = {
    offset: ss.offset,
    buffer: ss.buffer,
    turn_count: ss.turnCount,
    updated: new Date().toISOString(),
  };
}
