/**
 * oh-my-pi (omp) → chat panel adapter (PAN-1989).
 *
 * omp conversations write their own JSONL session files (different schema from
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
 *     Tool calls are `{type:'toolCall', id, name, arguments}` blocks inside an
 *     assistant turn; their results arrive as separate `role:'toolResult'
 *     messages carrying `toolCallId` + `toolName`. We join the two by id so
 *     each work-log entry carries the tool name + structured arguments.
 *   - Pi tool names are lowercase (`bash`, `read`, `edit`, …) and use `path`
 *     (not Claude's `file_path`); the per-tool renderers handle both shapes.
 *   - Pi includes inline usage on assistant messages — we use `cost.total`
 *     directly instead of recalculating.
 *   - Pi entries form a tree via parentId. For interactive conversations the
 *     tree is effectively linear (no forks during TUI use), so we just walk
 *     by timestamp.
 */

import { readFile, stat } from 'node:fs/promises';
import type { ChatMessage, CompactBoundary, WorkLogEntry } from '@overdeck/contracts';
import type { ParseResult } from './conversation-service.js';
import { summarizeToolInputForWorkLog } from './format-tool-input.js';

export function isOhmypiSessionFile(sessionFile: string): boolean {
  const normalized = sessionFile.replace(/\\/g, '/');
  // Conversations write their transcript into the agent's `sessions/` subdir.
  if (/\/\.overdeck\/agents\/[^/]+\/sessions\//.test(normalized)) return true;
  // Work agents (PAN-1908) write the transcript directly into the agent-dir
  // root as `<iso-timestamp>_<session-id>.jsonl`. Match the timestamped name so
  // sibling non-transcripts (cost-events.jsonl, activity.jsonl) don't qualify,
  // and codex rollouts (under codex-home/sessions/) keep their own detector.
  return /\/\.overdeck\/agents\/[^/]+\/\d{4}-\d{2}-\d{2}T[^/]*\.jsonl$/.test(normalized);
}

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
    /** toolResult only: id of the originating toolCall block. */
    toolCallId?: string;
    /** toolResult only: name of the tool that produced this result. */
    toolName?: string;
    /** toolResult only: true when the tool call failed. */
    isError?: boolean;
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

interface PiToolCall {
  id?: string;
  name: string;
  arguments?: Record<string, unknown>;
}

/**
 * Pull `toolCall` content blocks out of an assistant message. Unlike Claude's
 * `tool_use`, Pi emits these inline in the assistant turn as
 * `{type:'toolCall', id, name, arguments}`. The result entry that completes
 * the call arrives later as a separate `toolResult` message carrying only the
 * `toolCallId` + `toolName` (not the arguments), so we capture the arguments
 * here and join them by id at result time.
 */
function extractToolCalls(content: PiContentBlock[] | string | undefined): PiToolCall[] {
  if (!content || typeof content === 'string') return [];
  const out: PiToolCall[] = [];
  for (const block of content) {
    if (block.type !== 'toolCall') continue;
    const name = typeof block.name === 'string' ? block.name : 'tool';
    const rawArgs = block.arguments;
    const argumentsDict =
      rawArgs && typeof rawArgs === 'object' && !Array.isArray(rawArgs)
        ? (rawArgs as Record<string, unknown>)
        : undefined;
    const id = typeof block.id === 'string' ? block.id : undefined;
    out.push({ id, name, arguments: argumentsDict });
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
export async function parseOhmypiConversationMessages(sessionFile: string): Promise<ParseResult> {
  const fileStats = await stat(sessionFile);
  const raw = await readFile(sessionFile, 'utf-8');

  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  const compactBoundaries: CompactBoundary[] = [];
  let totalCost = 0;
  let totalTokens = 0;
  let sequence = 0;
  // toolCallId → {name, arguments}. Populated from assistant `toolCall`
  // blocks and joined into the later `toolResult` work-log entry so the UI
  // gets the tool name + structured input (bash command, file path, …).
  const pendingToolCalls = new Map<string, { name: string; arguments: Record<string, unknown> | undefined }>();

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
      // Pi surfaces tool results as their own message entries. Join each
      // result with its originating toolCall (by toolCallId) so the work-log
      // entry carries the tool name + structured arguments — letting the
      // frontend render per-tool (bash command block, read/edit file chip)
      // exactly like a Claude tool_use entry. The result text is still shown
      // expanded under the call.
      const toolCallId = typeof entry.message.toolCallId === 'string' ? entry.message.toolCallId : undefined;
      const toolName = typeof entry.message.toolName === 'string' ? entry.message.toolName : undefined;
      const pending = toolCallId ? pendingToolCalls.get(toolCallId) : undefined;
      if (toolCallId && pending) pendingToolCalls.delete(toolCallId);
      const resolvedName = toolName ?? pending?.name;
      const input = pending?.arguments;
      if (text) {
        sequence += 1;
        const isError = entry.message.isError === true;
        workLog.push({
          id: entry.id ?? `tool-result-${sequence}`,
          createdAt,
          label: resolvedName ?? 'Tool result',
          toolTitle: resolvedName,
          toolInput: input,
          detail: summarizeToolInputForWorkLog(resolvedName, input),
          result: text,
          tone: isError ? 'error' : 'tool',
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

      // Record toolCall blocks (assistant turns) keyed by id so the later
      // toolResult entry can join the tool name + arguments. We do not push a
      // work-log entry here — the result-driven entry above, or the orphan
      // flush after the loop, owns that (mirrors Claude's pendingToolUse).
      for (const call of extractToolCalls(entry.message.content)) {
        if (call.id) {
          pendingToolCalls.set(call.id, { name: call.name, arguments: call.arguments });
        }
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

      // Token throughput — prefer Pi's own total, else sum the categories.
      const u = entry.message.usage;
      if (u) {
        totalTokens += typeof u.totalTokens === 'number'
          ? u.totalTokens
          : (u.input ?? 0) + (u.output ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
      }
    }
  }

  // Flush toolCall blocks that never received a result (agent still running,
  // or the result line was dropped). Mirrors Claude's pendingToolUse flush so
  // an in-flight call's command / file path is visible before it returns.
  const orphanCreatedAt = new Date(fileStats.mtimeMs).toISOString();
  for (const [id, call] of pendingToolCalls) {
    sequence += 1;
    workLog.push({
      id: `tool-call-${id}`,
      createdAt: orphanCreatedAt,
      label: call.name,
      toolTitle: call.name,
      toolInput: call.arguments,
      detail: summarizeToolInputForWorkLog(call.name, call.arguments),
      tone: 'tool',
      sequence,
    });
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
    totalTokens,
    latestAssistantUsage: null,
    contextBoundaryOffset: 0,
    contextActiveBytes: fileStats.size,
    pendingToolUse: new Map(),
    unresolvedResults: new Map(),
    lastSequence: sequence,
    mtimeMs: fileStats.mtimeMs,
    planToolUseIds: new Set(),
    compactBoundaries,
    fileEditsByAssistantId: new Map(),
  };
}
