/**
 * Kimi Code CLI native wire.jsonl parser (PAN-1837 wi8b).
 *
 * Kimi writes an event-stream wire protocol (verified against the installed
 * kimi 0.29.2 binary, wi-fixture) at
 * `<kimiHome>/sessions/<workDirKey>/<sessionId>/agents/main/wire.jsonl` — a
 * completely different shape from Claude Code's message-per-line JSONL or
 * Codex's rollout schema:
 *
 *   - `metadata`             — one line, `created_at` (epoch ms).
 *   - `turn.prompt`          — one per user-initiated turn.
 *   - `context.append_message` — `{ message: { role, content } }` for user/system turns.
 *   - `context.append_loop_event` — wraps a per-step `event`:
 *       - `step.begin` / `step.end` — step boundaries within a turn.
 *       - `content.part`     — `{ part: { type: 'think' | 'text', ... } }`.
 *       - `tool.call`        — `{ toolCallId, name, args, description }`.
 *       - `tool.result`      — `{ toolCallId, result: { output, ... } }`.
 *   - `usage.record`         — `{ model, usage: { inputOther, output,
 *     inputCacheRead, inputCacheCreation }, usageScope: 'turn' }` — one per
 *     LLM step. This is the authoritative usage source; costs are computed
 *     by summing every usage.record in the file (Kimi's own server-side
 *     context cache accounting — the reason this issue drives Kimi natively
 *     instead of through the Anthropic-compatibility shim).
 *
 * The fixture's record schema is authoritative — fields not present in it
 * (tests/fixtures/kimi/wire.jsonl, tests/fixtures/kimi/README.md) are not
 * guessed at here.
 */

import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import type { SessionUsage } from './jsonl-parser.js';
import { getPricingSync } from '../cost.js';

interface KimiUsageFields {
  inputOther?: number;
  output?: number;
  inputCacheRead?: number;
  inputCacheCreation?: number;
}

interface KimiWireEntry {
  type?: string;
  time?: number;
  created_at?: number;
  model?: string;
  usage?: KimiUsageFields;
  message?: { role?: string; content?: unknown };
  event?: { type?: string; [k: string]: unknown };
  [k: string]: unknown;
}

/** Strip Kimi's `kimi-code/<alias>` prefix so pricing lookups match bare model ids like 'k3'. */
export function bareKimiModel(model: string): string {
  const slash = model.lastIndexOf('/');
  return slash === -1 ? model : model.slice(slash + 1);
}

/** Derive the session id from the wire.jsonl path (`.../<sessionId>/agents/main/wire.jsonl`). */
function sessionIdFromPath(sessionFile: string): string {
  // dirname(sessionFile) = .../agents/main; up two more levels = the session dir.
  return basename(dirname(dirname(dirname(sessionFile))));
}

function readLines(sessionFile: string): KimiWireEntry[] {
  const raw = readFileSync(sessionFile, 'utf-8');
  const entries: KimiWireEntry[] = [];
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      entries.push(JSON.parse(trimmed) as KimiWireEntry);
    } catch {
      continue;
    }
  }
  return entries;
}

/**
 * Parse a Kimi Code CLI wire.jsonl file into the shared SessionUsage shape.
 * Returns null if the file cannot be read or contains no usage.record entries.
 */
export function parseKimiSessionSync(sessionFile: string): SessionUsage | null {
  if (!existsSync(sessionFile)) return null;
  let entries: KimiWireEntry[];
  try {
    entries = readLines(sessionFile);
  } catch {
    return null;
  }

  let model = '';
  let startTime = '';
  let endTime = '';
  let totalInput = 0;
  let totalOutput = 0;
  let totalCacheRead = 0;
  let totalCacheWrite = 0;
  let hasUsage = false;
  let messageCount = 0;

  for (const entry of entries) {
    const ts = typeof entry.time === 'number' ? new Date(entry.time).toISOString() : '';

    if (entry.type === 'metadata' && typeof entry.created_at === 'number') {
      startTime = new Date(entry.created_at).toISOString();
    } else if (entry.type === 'context.append_loop_event') {
      // Kimi's visible assistant reply is the 'text' content.part of a step
      // (as opposed to 'think', its hidden reasoning) — one per turn.
      const event = entry.event;
      if (event?.type === 'content.part') {
        const part = (event as { part?: { type?: string } }).part;
        if (part?.type === 'text') messageCount++;
      }
    } else if (entry.type === 'usage.record' && entry.usage) {
      if (typeof entry.model === 'string' && entry.model) model = entry.model;
      totalInput += entry.usage.inputOther ?? 0;
      totalOutput += entry.usage.output ?? 0;
      totalCacheRead += entry.usage.inputCacheRead ?? 0;
      totalCacheWrite += entry.usage.inputCacheCreation ?? 0;
      hasUsage = true;
      if (ts) endTime = ts;
    } else if (ts) {
      endTime = ts;
    }
  }

  if (!hasUsage) return null;
  const bareModel = model ? bareKimiModel(model) : 'unknown';

  const pricing = getPricingSync('custom', bareModel);
  const inputCost = (totalInput / 1000) * (pricing?.inputPer1k ?? 0);
  const outputCost = (totalOutput / 1000) * (pricing?.outputPer1k ?? 0);
  const cacheReadCost = (totalCacheRead / 1000) * (pricing?.cacheReadPer1k ?? 0);
  const cacheWriteCost = (totalCacheWrite / 1000) * (pricing?.cacheWrite5mPer1k ?? 0);
  const totalCost = inputCost + outputCost + cacheReadCost + cacheWriteCost;

  return {
    sessionId: sessionIdFromPath(sessionFile) || sessionFile,
    sessionFile,
    startTime: startTime || new Date().toISOString(),
    endTime: endTime || startTime || new Date().toISOString(),
    model: bareModel,
    usage: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCacheRead,
      cacheWriteTokens: totalCacheWrite,
    },
    cost: totalCost,
    cost_v2: totalCost,
    messageCount,
    modelBreakdown: {
      [bareModel]: {
        cost: totalCost,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        messageCount,
        cacheReadTokens: totalCacheRead,
        cacheWriteTokens: totalCacheWrite,
      },
    },
  };
}
