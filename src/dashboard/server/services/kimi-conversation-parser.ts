/**
 * Native Kimi Code CLI wire.jsonl → chat panel adapter (PAN-1837 wi8b).
 *
 * Kimi's wire protocol is an event stream, not a message-per-line JSONL like
 * Claude Code's or Codex's rollout schema — see kimi-parser.ts and
 * tests/fixtures/kimi/README.md for the full shape. For chat-panel display:
 *
 *   - `turn.prompt`              — the user's prompt for a turn.
 *   - `context.append_loop_event` wraps a per-step `event`:
 *       - `content.part` with `part.type === 'text'` — the assistant's
 *         visible reply for that step ('think' parts are hidden reasoning,
 *         intentionally skipped — Kimi does not expose it any more plainly
 *         than Codex's encrypted reasoning).
 *       - `tool.call` / `tool.result` — matched by toolCallId, same shape as
 *         Codex's function_call/function_call_output matching by call_id.
 *
 * v1 renders only the `main` agent's wire (out of scope: sub-agent
 * transcripts under `agents/agent-0/...`, per the PRD).
 */

import { readFile, stat } from 'node:fs/promises';
import type { ChatMessage, CompactBoundary, WorkLogEntry } from '@overdeck/contracts';
import type { ParseResult } from './conversation/types.js';
import { parseKimiSessionSync } from '../../../lib/cost-parsers/kimi-parser.js';

interface KimiLoopEvent {
  type?: string;
  turnId?: string;
  toolCallId?: string;
  name?: string;
  args?: unknown;
  result?: { output?: unknown; [k: string]: unknown };
  part?: { type?: string; text?: string; think?: string };
  [k: string]: unknown;
}

interface KimiWireEntry {
  type?: string;
  time?: number;
  input?: Array<{ type?: string; text?: string }>;
  event?: KimiLoopEvent;
  [k: string]: unknown;
}

function extractPromptText(input: KimiWireEntry['input']): string {
  if (!Array.isArray(input)) return '';
  return input
    .filter((part) => part?.type === 'text' && typeof part.text === 'string')
    .map((part) => part.text!.trim())
    .filter(Boolean)
    .join('\n\n');
}

function extractToolOutput(result: KimiLoopEvent['result']): string {
  if (!result) return '';
  if (typeof result.output === 'string') return result.output.trim();
  try {
    return JSON.stringify(result);
  } catch {
    return '';
  }
}

/**
 * Parse a native Kimi Code CLI wire.jsonl into the ParseResult shape the
 * chat panel already consumes. Always a full read (same tradeoff as the
 * Codex adapter); incremental-parse state fields are empty stubs.
 */
export async function parseKimiConversationMessages(sessionFile: string): Promise<ParseResult> {
  const fileStats = await stat(sessionFile);
  const raw = await readFile(sessionFile, 'utf-8');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);

  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  const compactBoundaries: CompactBoundary[] = [];
  const toolCallsByCallId = new Map<string, WorkLogEntry>();
  let sequence = 0;
  let lastAssistantCompletedAt: string | undefined;

  for (const line of lines) {
    let entry: KimiWireEntry;
    try {
      entry = JSON.parse(line) as KimiWireEntry;
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const createdAt = typeof entry.time === 'number' ? new Date(entry.time).toISOString() : new Date().toISOString();

    if (entry.type === 'turn.prompt') {
      const text = extractPromptText(entry.input);
      if (!text) continue;
      sequence += 1;
      messages.push({
        id: `kimi-user-${sequence}`,
        role: 'user',
        text,
        createdAt,
        completedAt: createdAt,
        streaming: false,
        sequence,
      });
      continue;
    }

    if (entry.type !== 'context.append_loop_event' || !entry.event) continue;
    const event = entry.event;

    if (event.type === 'content.part' && event.part?.type === 'text') {
      const text = event.part.text?.trim();
      if (!text) continue;
      sequence += 1;
      messages.push({
        id: `kimi-assistant-${sequence}`,
        role: 'assistant',
        text,
        turnId: event.turnId,
        createdAt,
        completedAt: createdAt,
        streaming: false,
        sequence,
      });
      lastAssistantCompletedAt = createdAt;
      continue;
    }

    if (event.type === 'tool.call') {
      const callId = event.toolCallId ?? '';
      const name = event.name ?? 'tool';
      sequence += 1;
      const wl: WorkLogEntry = {
        id: callId || `kimi-tool-${sequence}`,
        createdAt,
        label: name,
        tone: 'tool',
        sequence,
        ...(event.args !== undefined ? { toolInput: event.args as Record<string, unknown> } : {}),
      };
      workLog.push(wl);
      if (callId) toolCallsByCallId.set(callId, wl);
      continue;
    }

    if (event.type === 'tool.result') {
      const callId = event.toolCallId ?? '';
      const output = extractToolOutput(event.result);
      const wl = callId ? toolCallsByCallId.get(callId) : undefined;
      if (wl) {
        if (output) (wl as { result?: string }).result = output;
        if (callId) toolCallsByCallId.delete(callId);
      } else if (output) {
        sequence += 1;
        workLog.push({
          id: callId || `kimi-tool-out-${sequence}`,
          createdAt,
          label: 'Tool result',
          result: output,
          tone: 'tool',
          sequence,
        });
      }
      continue;
    }
  }

  // Kimi's wire.jsonl for a live session is appended-to incrementally, but a
  // fully-parsed reply is only ever recorded once its content.part text
  // event lands — there is no partial-text state to surface mid-generation,
  // same reasoning as the Codex adapter.
  const streaming = false;

  // Cost/tokens come from the canonical Kimi parser (single source of truth
  // for wire.jsonl usage.record accounting) rather than being re-derived here.
  const usage = parseKimiSessionSync(sessionFile);
  const totalCost = usage?.cost_v2 ?? usage?.cost ?? 0;
  const totalTokens = usage
    ? usage.usage.inputTokens + usage.usage.outputTokens + (usage.usage.cacheReadTokens ?? 0) + (usage.usage.cacheWriteTokens ?? 0)
    : 0;

  return {
    messages,
    workLog,
    byteOffset: fileStats.size,
    streaming,
    lastTurnCompletedAt: lastAssistantCompletedAt,
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
