import * as crypto from 'crypto';
import Langfuse from 'langfuse';
import { MAX_CHARS, debug } from './logger';
import {
  Turn,
  getContent,
  extractText,
  getModel,
  iterToolUses,
  MsgContent,
} from './transcript';

// --- Truncation ---

export interface TruncInfo {
  truncated: boolean;
  orig_len: number;
  kept_len?: number;
  sha256?: string;
}

export function truncateText(
  s: string | null | undefined,
  maxChars = MAX_CHARS,
): [string, TruncInfo] {
  if (s == null) return ['', { truncated: false, orig_len: 0 }];
  const origLen = s.length;
  if (origLen <= maxChars) return [s, { truncated: false, orig_len: origLen }];
  const head = s.slice(0, maxChars);
  return [
    head,
    {
      truncated: true,
      orig_len: origLen,
      kept_len: head.length,
      sha256: crypto.createHash('sha256').update(s, 'utf8').digest('hex'),
    },
  ];
}

// --- Tool call extraction ---

interface ToolCall {
  id: string;
  name: string;
  input: unknown;
  output: string | null;
  outputMeta: TruncInfo | null;
}

function buildToolCalls(assistantMsgs: Turn['assistantMsgs']): ToolCall[] {
  const calls: ToolCall[] = [];
  for (const am of assistantMsgs) {
    for (const tu of iterToolUses(getContent(am) as MsgContent)) {
      const inp = tu.input;
      calls.push({
        id: String(tu.id ?? ''),
        name: String(tu.name ?? 'unknown'),
        input:
          typeof inp === 'object' ||
          typeof inp === 'string' ||
          typeof inp === 'number' ||
          typeof inp === 'boolean'
            ? inp
            : {},
        output: null,
        outputMeta: null,
      });
    }
  }
  return calls;
}

// --- Emit ---

export function emitTurn(
  langfuse: Langfuse,
  sessionId: string,
  turnNum: number,
  turn: Turn,
  transcriptPath: string,
  hostMeta: Record<string, string>,
): void {
  const [userText, userTextMeta] = truncateText(extractText(getContent(turn.userMsg)));
  const [assistantText, assistantTextMeta] = truncateText(
    extractText(getContent(turn.assistantMsgs[turn.assistantMsgs.length - 1])),
  );

  const model = getModel(turn.assistantMsgs[0]);
  const toolCalls = buildToolCalls(turn.assistantMsgs);

  for (const tc of toolCalls) {
    if (tc.id && tc.id in turn.toolResultsById) {
      const raw = turn.toolResultsById[tc.id];
      const str = typeof raw === 'string' ? raw : JSON.stringify(raw);
      const [out, meta] = truncateText(str);
      tc.output = out;
      tc.outputMeta = meta;
    }
  }

  const userId = process.env.CC_LANGFUSE_USER_ID;
  const traceName = `Claude Code - Turn ${turnNum}`;
  const traceMeta = {
    source: 'claude-code',
    session_id: sessionId,
    turn_number: turnNum,
    transcript_path: transcriptPath,
    user_text: userTextMeta,
    ...hostMeta,
  };

  try {
    const trace = langfuse.trace({
      name: traceName,
      sessionId,
      ...(userId ? { userId } : {}),
      input: { role: 'user', content: userText },
      metadata: traceMeta,
      tags: ['claude-code'],
    });

    const span = trace.span({
      name: traceName,
      input: { role: 'user', content: userText },
      metadata: traceMeta,
    });

    span
      .generation({
        name: 'Claude Response',
        model,
        input: { role: 'user', content: userText },
        output: { role: 'assistant', content: assistantText },
        metadata: { assistant_text: assistantTextMeta, tool_count: toolCalls.length },
      })
      .end();

    for (const tc of toolCalls) {
      let inputVal: unknown = tc.input;
      let inputMeta: TruncInfo | null = null;
      if (typeof inputVal === 'string') {
        const [trunc, meta] = truncateText(inputVal);
        inputVal = trunc;
        inputMeta = meta;
      }
      span
        .span({
          name: `Tool: ${tc.name}`,
          input: inputVal,
          metadata: {
            tool_name: tc.name,
            tool_id: tc.id,
            input_meta: inputMeta,
            output_meta: tc.outputMeta,
          },
        })
        .end({ output: tc.output ?? undefined });
    }

    const assistantOutput = { role: 'assistant', content: assistantText };
    span.end({ output: assistantOutput });
    trace.update({ output: assistantOutput });
  } catch (e) {
    debug(`emitTurn inner error: ${e}`);
  }
}
