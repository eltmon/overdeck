/**
 * Pi Coding Agent → chat panel adapter (PAN-1067).
 *
 * Pi conversations write their own JSONL session files (different schema from
 * Claude Code). The chat panel needs ChatMessage[] objects in the same shape
 * as Claude-side `parseConversationMessages` returns. This module is the
 * adapter — it reads a Pi v3 JSONL file and emits the matching ParseResult.
 *
 * Scope: chat panel display only. Cost aggregation for the conversation list
 * is still handled by `parsePiSession` in src/lib/cost-parsers/pi-parser.ts.
 *
 * Differences from Claude format:
 *   - Pi has top-level `type: 'session'|'message'|'model_change'|...` entries.
 *   - Pi messages live at `entry.message.content[]`, where content blocks are
 *     `{type:'text',text}`, `{type:'thinking',thinking}`, or tool variants.
 *   - Pi includes inline usage on assistant messages — we use `cost.total`
 *     directly instead of recalculating.
 *   - Pi entries form a tree via parentId. For interactive conversations the
 *     tree is effectively linear (no forks during TUI use), so we just walk
 *     by timestamp.
 */

import { readFile, stat } from 'node:fs/promises';
import type { ChatMessage, CompactBoundary, WorkLogEntry } from '@panctl/contracts';
import type { ParseResult } from './conversation-service.js';

interface PiUsage {
  input?: number;
  output?: number;
  cacheRead?: number;
  cacheWrite?: number;
  totalTokens?: number;
  cost?: {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
    total?: number;
  };
}

interface PiContentBlock {
  type?: string;
  text?: string;
  thinking?: string;
  [k: string]: unknown;
}

interface PiMessageEntry extends PiEntry {
  type: 'message';
  message: {
    role: 'user' | 'assistant' | 'toolResult';
    content?: PiContentBlock[] | string;
    model?: string;
    provider?: string;
    usage?: PiUsage;
  };
}

interface PiEntry {
  type: string;
  id?: string;
  parentId?: string | null;
  timestamp?: string;
  [k: string]: unknown;
}

function isMessageEntry(entry: PiEntry): entry is PiMessageEntry {
  return entry.type === 'message' && typeof (entry as PiMessageEntry).message === 'object';
}

/**
 * Flatten a Pi content array (or string) into plain text. Skips thinking
 * blocks — they are surfaced via the work log, not as message body.
 */
function extractText(content: PiContentBlock[] | string | undefined): string {
  if (!content) return '';
  if (typeof content === 'string') return content;
  return content
    .filter((block) => block.type === 'text' && typeof block.text === 'string')
    .map((block) => block.text as string)
    .join('\n')
    .trim();
}

function extractThinking(content: PiContentBlock[] | string | undefined): string[] {
  if (!content || typeof content === 'string') return [];
  const out: string[] = [];
  for (const block of content) {
    if (block.type === 'thinking' && typeof block.thinking === 'string' && block.thinking.trim()) {
      out.push(block.thinking.trim());
    }
  }
  return out;
}

/**
 * Heuristic file-recency check. Same threshold conversation-service uses
 * for Claude streaming detection.
 */
const STREAMING_RECENT_MS = 5_000;

/**
 * Parse a Pi v3 JSONL session file into the ParseResult shape consumed by
 * the chat panel. The output mirrors what `parseConversationMessages` would
 * return for a Claude session, with empty stubs for features Pi doesn't
 * surface yet (compact boundaries, file-edit grouping, plan-tool tracking).
 */
export async function parsePiConversationMessages(sessionFile: string): Promise<ParseResult> {
  const fileStats = await stat(sessionFile);
  const raw = await readFile(sessionFile, 'utf-8');

  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  const compactBoundaries: CompactBoundary[] = [];
  let totalCost = 0;
  let sequence = 0;

  for (const line of lines) {
    let entry: PiEntry;
    try {
      entry = JSON.parse(line) as PiEntry;
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;

    if (entry.type === 'compaction_start' || entry.type === 'session_before_compact' || entry.type === 'session_compact') {
      compactBoundaries.push({
        id: typeof entry.id === 'string' ? entry.id : `compact-${compactBoundaries.length}`,
        timestamp: typeof entry.timestamp === 'string' ? entry.timestamp : new Date().toISOString(),
        trigger: entry.type,
      });
      continue;
    }

    if (!isMessageEntry(entry)) continue;

    const role = entry.message.role;
    const createdAt = entry.timestamp ?? new Date().toISOString();
    const text = extractText(entry.message.content);

    if (role === 'toolResult') {
      // Pi surfaces tool results as their own message entries. The chat
      // panel renders them inside the work log rather than as standalone
      // user/assistant turns. Emit one work-log entry per tool result with
      // the raw text so the UI can show it under the originating turn.
      if (text) {
        sequence += 1;
        workLog.push({
          id: entry.id ?? `tool-result-${sequence}`,
          createdAt,
          label: 'Tool result',
          result: text,
          tone: 'tool',
          sequence,
        });
      }
      continue;
    }

    if (role === 'user' || role === 'assistant') {
      // Thinking blocks (if any) precede the message text in the work log so
      // the chat panel can show them as collapsed reasoning under that turn.
      for (const thinking of extractThinking(entry.message.content)) {
        sequence += 1;
        workLog.push({
          id: `${entry.id}:thinking:${sequence}`,
          createdAt,
          label: 'Thinking',
          detail: thinking,
          tone: 'thinking',
          sequence,
        });
      }

      if (!text) {
        // Skip empty assistant turns (e.g. pure-thinking responses). The
        // thinking is already in the work log.
        continue;
      }
      sequence += 1;
      messages.push({
        id: entry.id ?? `message-${sequence}`,
        role,
        text,
        createdAt,
        completedAt: createdAt,
        streaming: false,
        sequence,
      });

      // Inline cost accounting — Pi reports its own per-call cost.
      const total = entry.message.usage?.cost?.total;
      if (typeof total === 'number' && Number.isFinite(total)) {
        totalCost += total;
      }
    }
  }

  // Streaming heuristic: most recent assistant message has no completedAt OR
  // the file was modified within the streaming window. Pi v3 doesn't emit a
  // separate streaming-completion event, so the file-mtime fallback is the
  // best signal we have.
  const lastAssistant = [...messages].reverse().find((m) => m.role === 'assistant');
  const streaming = !!lastAssistant && Date.now() - fileStats.mtimeMs < STREAMING_RECENT_MS && lastAssistant.streaming === true;

  return {
    messages,
    workLog,
    byteOffset: fileStats.size,
    streaming,
    totalCost,
    pendingToolUse: new Map(),
    unresolvedResults: new Map(),
    lastSequence: sequence,
    mtimeMs: fileStats.mtimeMs,
    planToolUseIds: new Set(),
    compactBoundaries,
    fileEditsByAssistantId: new Map(),
  };
}
