import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

export const STATE_DIR = path.join(os.homedir(), '.claude', 'state');
export const LOG_FILE = path.join(STATE_DIR, 'langfuse_hook.log');
export const DEBUG = process.env.CC_LANGFUSE_DEBUG?.toLowerCase() === 'true';
export const MAX_CHARS = parseInt(process.env.CC_LANGFUSE_MAX_CHARS ?? '20000', 10);

function log(level: string, message: string): void {
  try {
    fs.mkdirSync(STATE_DIR, { recursive: true });
    const ts = new Date().toISOString().replace('T', ' ').slice(0, 19);
    fs.appendFileSync(LOG_FILE, `${ts} [${level}] ${message}\n`, 'utf8');
  } catch {
    // never block
  }
}

export function debug(msg: string): void {
  if (DEBUG) log('DEBUG', msg);
}

export function info(msg: string): void {
  log('INFO', msg);
}

export function warn(msg: string): void {
  log('WARN', msg);
}
