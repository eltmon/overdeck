/**
 * OpenAI Codex → chat panel adapter (PAN-1520).
 *
 * Codex conversations write a "rollout" JSONL under the per-agent
 * $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<uuid>-<threadId>.jsonl. The schema
 * is OpenAI's, not Claude Code's, so the Claude parser (and even the Pi parser,
 * which the path also happens to match) find zero message entries and the chat
 * panel renders blank. This module is the adapter — it reads a Codex rollout
 * and emits the same {@link ParseResult} shape the chat panel already consumes.
 *
 * Scope: chat panel display only.
 *
 * Codex rollout shape (cli ≥ 0.137.0):
 *   - `type: 'session_meta' | 'turn_context'` — metadata, ignored for display.
 *   - `type: 'event_msg'` with `payload.type`:
 *       - `user_message`  — the user's prompt (clean text in `payload.message`)
 *       - `agent_message` — the assistant's visible reply (`payload.message`)
 *       - `token_count`   — cumulative usage in `payload.info.total_token_usage`
 *   - `type: 'response_item'` with `payload.type`:
 *       - `function_call` / `custom_tool_call`        — tool invocation
 *       - `function_call_output` / `custom_tool_call_output` — tool result
 *       - `message`   — the model's raw turn incl. injected AGENTS.md context;
 *                       skipped (user/assistant text comes from event_msg).
 *       - `reasoning` — chain-of-thought; Codex encrypts it, so it is skipped.
 */

import { readFile, stat } from 'node:fs/promises';
import type { ChatMessage, CompactBoundary, WorkLogEntry } from '@panctl/contracts';
import type { ParseResult } from './conversation-service.js';
import { parseCodexSessionSync } from '../../../lib/cost-parsers/codex-parser.js';

interface CodexTokenUsage {
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

interface CodexPayload {
  type?: string;
  message?: string;
  name?: string;
  call_id?: string;
  arguments?: string;
  input?: unknown;
  output?: unknown;
  info?: { total_token_usage?: CodexTokenUsage };
  [k: string]: unknown;
}

interface CodexEntry {
  type?: string;
  timestamp?: string;
  payload?: CodexPayload;
  [k: string]: unknown;
}

/** Flatten a Codex tool output (usually a string) into display text. */
function extractToolOutput(output: unknown): string {
  if (typeof output === 'string') return output.trim();
  if (output && typeof output === 'object') {
    const obj = output as Record<string, unknown>;
    if (typeof obj['output'] === 'string') return (obj['output'] as string).trim();
    if (typeof obj['content'] === 'string') return (obj['content'] as string).trim();
    try {
      return JSON.stringify(output);
    } catch {
      return '';
    }
  }
  return '';
}

/**
 * Pull the shell command out of an `exec_command` tool call's JSON arguments so
 * it renders in the work log's command slot. Returns undefined for other tools.
 */
function extractCommand(name: string, args: string): string | undefined {
  if (name !== 'exec_command' && name !== 'shell') return undefined;
  try {
    const parsed = JSON.parse(args) as Record<string, unknown>;
    const cmd = parsed['cmd'] ?? parsed['command'];
    if (typeof cmd === 'string') return cmd;
    if (Array.isArray(cmd)) return cmd.join(' ');
  } catch {
    // arguments weren't JSON — fall through
  }
  return undefined;
}

/**
 * Parse a Codex rollout JSONL into the ParseResult shape the chat panel
 * consumes. Always a full read (rollouts are small enough); incremental-parse
 * state fields are returned as empty stubs, matching the Pi adapter.
 */
export async function parseCodexConversationMessages(sessionFile: string): Promise<ParseResult> {
  const fileStats = await stat(sessionFile);
  const raw = await readFile(sessionFile, 'utf-8');

  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  const messages: ChatMessage[] = [];
  const workLog: WorkLogEntry[] = [];
  const compactBoundaries: CompactBoundary[] = [];
  // Matches function_call → function_call_output by call_id within this parse.
  const toolCallsByCallId = new Map<string, WorkLogEntry>();
  let totalTokens = 0;
  let sequence = 0;

  for (const line of lines) {
    let entry: CodexEntry;
    try {
      entry = JSON.parse(line) as CodexEntry;
    } catch {
      continue;
    }
    if (!entry || typeof entry !== 'object') continue;
    const payload = entry.payload;
    if (!payload || typeof payload !== 'object') continue;
    const createdAt = entry.timestamp ?? new Date().toISOString();
    const ptype = payload.type;

    if (entry.type === 'event_msg') {
      if (ptype === 'user_message' || ptype === 'agent_message') {
        const text = typeof payload.message === 'string' ? payload.message.trim() : '';
        if (!text) continue;
        sequence += 1;
        messages.push({
          id: `codex-${ptype === 'user_message' ? 'user' : 'agent'}-${sequence}`,
          role: ptype === 'user_message' ? 'user' : 'assistant',
          text,
          createdAt,
          completedAt: createdAt,
          streaming: false,
          sequence,
        });
      } else if (ptype === 'token_count') {
        // Cumulative usage — the latest token_count carries the running total.
        const usage = payload.info?.total_token_usage;
        if (usage) {
          totalTokens = typeof usage.total_tokens === 'number'
            ? usage.total_tokens
            : (usage.input_tokens ?? 0) + (usage.output_tokens ?? 0);
        }
      }
      continue;
    }

    if (entry.type === 'response_item') {
      if (ptype === 'function_call' || ptype === 'custom_tool_call') {
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
        const name = typeof payload.name === 'string' ? payload.name : 'tool';
        const args = typeof payload.arguments === 'string'
          ? payload.arguments
          : payload.input != null ? JSON.stringify(payload.input) : '';
        const command = extractCommand(name, args);
        sequence += 1;
        const wl: WorkLogEntry = {
          id: callId || `codex-tool-${sequence}`,
          createdAt,
          label: command ? 'Shell' : name,
          tone: 'tool',
          sequence,
          ...(command ? { command } : args ? { detail: args } : {}),
        };
        workLog.push(wl);
        if (callId) toolCallsByCallId.set(callId, wl);
      } else if (ptype === 'function_call_output' || ptype === 'custom_tool_call_output') {
        const callId = typeof payload.call_id === 'string' ? payload.call_id : '';
        const output = extractToolOutput(payload.output);
        const wl = callId ? toolCallsByCallId.get(callId) : undefined;
        if (wl) {
          if (output) wl.result = output;
          if (callId) toolCallsByCallId.delete(callId);
        } else if (output) {
          // Output with no matching call (truncated/rotated) — stand-alone entry.
          sequence += 1;
          workLog.push({
            id: callId || `codex-tool-out-${sequence}`,
            createdAt,
            label: 'Tool result',
            result: output,
            tone: 'tool',
            sequence,
          });
        }
      }
      // response_item 'message' (injected context) and 'reasoning' (encrypted)
      // carry nothing user-visible — intentionally skipped.
      continue;
    }
  }

  // Codex turns are written as complete agent_message events (not streamed
  // token-by-token into the rollout), so there is no partial-turn state to
  // surface — the chat panel never shows a stuck typing indicator.
  const streaming = false;

  // Cost is derived by the canonical Codex cost parser (single source of truth
  // for rollout pricing) so the conversation list shows real spend rather than
  // $0. token_count already gave us the cumulative throughput above.
  const usage = parseCodexSessionSync(sessionFile);
  const totalCost = usage?.cost_v2 ?? usage?.cost ?? 0;

  return {
    messages,
    workLog,
    byteOffset: fileStats.size,
    streaming,
    totalCost,
    totalTokens,
    pendingToolUse: new Map(),
    unresolvedResults: new Map(),
    lastSequence: sequence,
    mtimeMs: fileStats.mtimeMs,
    planToolUseIds: new Set(),
    compactBoundaries,
    fileEditsByAssistantId: new Map(),
  };
}
