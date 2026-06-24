import * as fs from 'fs';
import { debug } from './logger';
import { SessionState } from './state';

// --- Types ---

export type MsgContent = string | Array<Record<string, unknown>> | null;
export type Msg = Record<string, unknown>;

export interface Turn {
  userMsg: Msg;
  assistantMsgs: Msg[];
  toolResultsById: Record<string, unknown>;
}

// --- Message field accessors ---

export function getContent(msg: Msg): MsgContent {
  if (typeof msg !== 'object' || msg === null) return null;
  const inner = msg.message;
  if (typeof inner === 'object' && inner !== null) {
    return (inner as Record<string, unknown>).content as MsgContent ?? null;
  }
  return (msg.content as MsgContent) ?? null;
}

export function getRole(msg: Msg): string | null {
  const t = msg.type as string | undefined;
  if (t === 'user' || t === 'assistant') return t;
  const m = msg.message as Record<string, unknown> | undefined;
  if (m && typeof m === 'object') {
    const r = m.role as string | undefined;
    if (r === 'user' || r === 'assistant') return r;
  }
  return null;
}

export function getModel(msg: Msg): string {
  const m = msg.message as Record<string, unknown> | undefined;
  if (m && typeof m === 'object') return String(m.model ?? 'claude');
  return 'claude';
}

export function getMessageId(msg: Msg): string | null {
  const m = msg.message as Record<string, unknown> | undefined;
  if (m && typeof m === 'object') {
    const mid = m.id;
    if (typeof mid === 'string' && mid) return mid;
  }
  return null;
}

export function extractText(content: MsgContent): string {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) {
    const parts: string[] = [];
    for (const x of content) {
      if (typeof x === 'object' && x !== null && (x as Msg).type === 'text') {
        parts.push(String((x as Msg).text ?? ''));
      } else if (typeof x === 'string') {
        parts.push(x);
      }
    }
    return parts.filter(Boolean).join('\n');
  }
  return '';
}

function isToolResult(msg: Msg): boolean {
  if (getRole(msg) !== 'user') return false;
  const content = getContent(msg);
  if (Array.isArray(content)) {
    return content.some(
      (x) => typeof x === 'object' && x !== null && (x as Msg).type === 'tool_result',
    );
  }
  return false;
}

function iterToolResults(content: MsgContent): Msg[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (x) => typeof x === 'object' && x !== null && (x as Msg).type === 'tool_result',
  ) as Msg[];
}

export function iterToolUses(content: MsgContent): Msg[] {
  if (!Array.isArray(content)) return [];
  return content.filter(
    (x) => typeof x === 'object' && x !== null && (x as Msg).type === 'tool_use',
  ) as Msg[];
}

// --- Incremental JSONL reader ---

export function readNewJsonl(
  transcriptPath: string,
  ss: SessionState,
): [Msg[], SessionState] {
  if (!fs.existsSync(transcriptPath)) return [[], ss];

  let chunk: Buffer;
  let newOffset: number;
  try {
    const fd = fs.openSync(transcriptPath, 'r');
    try {
      const stat = fs.fstatSync(fd);
      if (ss.offset >= stat.size) return [[], ss];
      chunk = Buffer.allocUnsafe(stat.size - ss.offset);
      fs.readSync(fd, chunk, 0, chunk.length, ss.offset);
      newOffset = stat.size;
    } finally {
      fs.closeSync(fd);
    }
  } catch (e) {
    debug(`readNewJsonl failed: ${e}`);
    return [[], ss];
  }

  const text = chunk.toString('utf8');
  const combined = ss.buffer + text;
  const lines = combined.split('\n');

  ss.buffer = lines[lines.length - 1];
  ss.offset = newOffset;

  const msgs: Msg[] = [];
  for (const line of lines.slice(0, -1)) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      msgs.push(JSON.parse(trimmed) as Msg);
    } catch {
      // skip malformed line
    }
  }

  return [msgs, ss];
}

// --- Turn assembly ---

export function buildTurns(messages: Msg[]): Turn[] {
  const turns: Turn[] = [];

  let currentUser: Msg | null = null;
  let assistantOrder: string[] = [];
  let assistantLatest: Record<string, Msg> = {};
  let toolResultsById: Record<string, unknown> = {};

  function flushTurn(): void {
    if (!currentUser || assistantOrder.length === 0) return;
    const assistants = assistantOrder
      .filter((mid) => mid in assistantLatest)
      .map((mid) => assistantLatest[mid]);
    if (assistants.length === 0) return;
    turns.push({
      userMsg: currentUser,
      assistantMsgs: assistants,
      toolResultsById: { ...toolResultsById },
    });
  }

  for (const msg of messages) {
    const role = getRole(msg);

    if (isToolResult(msg)) {
      for (const tr of iterToolResults(getContent(msg))) {
        const tid = String((tr as Msg).tool_use_id ?? '');
        if (tid) toolResultsById[tid] = (tr as Msg).content;
      }
      continue;
    }

    if (role === 'user') {
      flushTurn();
      currentUser = msg;
      assistantOrder = [];
      assistantLatest = {};
      toolResultsById = {};
      continue;
    }

    if (role === 'assistant') {
      if (!currentUser) continue;
      const mid = getMessageId(msg) ?? `noid:${assistantOrder.length}`;
      if (!(mid in assistantLatest)) assistantOrder.push(mid);
      assistantLatest[mid] = msg;
    }
  }

  flushTurn();
  return turns;
}
