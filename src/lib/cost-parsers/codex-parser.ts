/**
 * Codex CLI rollout JSONL parser (PAN-1574).
 *
 * Codex sessions (D-7 external store) live at:
 *   $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<timestamp>-<threadId>.jsonl
 *
 * Two JSONL schemas exist — rollout-file and --json stdout — with different
 * event names. This parser handles the ROLLOUT-FILE schema:
 *
 *   - task_started: the initial task. Carries model, thread_id, timestamp.
 *   - agent_message: a model turn. Content is the text response.
 *   - token_count: cumulative usage summary per turn. Carries:
 *       { info: { total_token_usage, last_token_usage } }
 *     where each usage object has { input, cached_input, output,
 *     reasoning_output, total } integer fields.
 *
 * We accumulate token_count records and keep the latest cumulative totals.
 * Costs are computed via getPriceForModel() from cost.ts.
 */

import { existsSync, readFileSync } from 'node:fs';
import type { SessionUsage } from './jsonl-parser.js';
import { getPricingSync } from '../cost.js';

interface CodexTokenUsageFields {
  // Flat (legacy) rollout field names.
  input?: number;
  cached_input?: number;
  output?: number;
  reasoning_output?: number;
  total?: number;
  // Nested (cli >= 0.137.0) rollout field names.
  input_tokens?: number;
  cached_input_tokens?: number;
  output_tokens?: number;
  reasoning_output_tokens?: number;
  total_tokens?: number;
}

/** First defined numeric value across the flat/nested field-name variants. */
function pickUsage(...candidates: (number | undefined)[]): number | undefined {
  for (const c of candidates) {
    if (typeof c === 'number') return c;
  }
  return undefined;
}

/**
 * Parse a Codex rollout JSONL file into the shared SessionUsage shape.
 * Returns null if the file cannot be read or contains no valid token_count records.
 */
export function parseCodexSessionSync(sessionFile: string): SessionUsage | null {
  if (!existsSync(sessionFile)) return null;
  let raw: string;
  try {
    raw = readFileSync(sessionFile, 'utf-8');
  } catch {
    return null;
  }

  let model = '';
  let threadId = '';
  let startTime = '';
  let endTime = '';
  let cwd: string | undefined;
  let totalInput = 0;
  let totalCachedInput = 0;
  let totalOutput = 0;
  let messageCount = 0;
  let hasUsage = false;

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    // Normalize the two rollout schemas. cli >= 0.137.0 nests the record kind
    // under `payload.type` inside event_msg/turn_context/session_meta wrappers;
    // older rollouts put the kind and its fields at the top level. `data` is
    // wherever the kind-specific fields live for this record.
    const payload = entry['payload'] && typeof entry['payload'] === 'object'
      ? (entry['payload'] as Record<string, unknown>)
      : null;
    const type = (payload?.['type'] ?? entry['type']) as string | undefined;
    const data = payload ?? entry;
    const ts = typeof entry['timestamp'] === 'string' ? (entry['timestamp'] as string) : '';

    if (type === 'session_meta') {
      // Nested schema: the thread/session id lives here, not in task_started.
      if (!threadId && typeof data['id'] === 'string') threadId = data['id'];
      if (typeof data['cwd'] === 'string' && data['cwd']) cwd = data['cwd'];
      if (!startTime && ts) startTime = ts;
    } else if (type === 'turn_context') {
      // The nested schema carries the resolved model here, not in task_started.
      if (typeof data['model'] === 'string' && data['model']) model = data['model'];
    } else if (type === 'task_started') {
      if (typeof data['model'] === 'string' && data['model']) model = data['model'];
      if (typeof data['thread_id'] === 'string') threadId = data['thread_id'];
      if (!startTime && ts) startTime = ts;
    } else if (type === 'agent_message') {
      messageCount++;
      if (ts) endTime = ts;
    } else if (type === 'token_count') {
      const info = data['info'] as { total_token_usage?: CodexTokenUsageFields } | undefined;
      const usage = info?.total_token_usage;
      if (usage) {
        totalInput = pickUsage(usage.input, usage.input_tokens) ?? totalInput;
        totalCachedInput = pickUsage(usage.cached_input, usage.cached_input_tokens) ?? totalCachedInput;
        totalOutput = pickUsage(usage.output, usage.output_tokens) ?? totalOutput;
        hasUsage = true;
        if (ts) endTime = ts;
      }
    }
  }

  if (!hasUsage && messageCount === 0) return null;
  if (!model) model = 'unknown';

  const pricing = getPricingSync('openai', model);
  // total_token_usage.input_tokens includes the cached portion, so charge only
  // the non-cached remainder at the full input rate.
  const nonCachedInput = Math.max(0, totalInput - totalCachedInput);
  const inputCost = (nonCachedInput / 1000) * (pricing?.inputPer1k ?? 0);
  const cachedCost = (totalCachedInput / 1000) * (pricing?.cacheReadPer1k ?? 0);
  const outputCost = (totalOutput / 1000) * (pricing?.outputPer1k ?? 0);
  const totalCost = inputCost + cachedCost + outputCost;

  return {
    sessionId: threadId || sessionFile,
    sessionFile,
    startTime: startTime || new Date().toISOString(),
    endTime: endTime || startTime || new Date().toISOString(),
    model,
    usage: {
      inputTokens: totalInput,
      outputTokens: totalOutput,
      cacheReadTokens: totalCachedInput,
    },
    cost: totalCost,
    cost_v2: totalCost,
    cwd,
    messageCount,
    modelBreakdown: {
      [model]: {
        cost: totalCost,
        inputTokens: totalInput,
        outputTokens: totalOutput,
        messageCount,
      },
    },
  };
}

/** Per-turn cost event for Codex rollouts. Mirrors OhmypiCostEventUsage. */
export interface CodexCostEventUsage {
  requestId: string;
  timestamp: string;
  sessionId: string;
  sessionFile: string;
  provider: string;
  model: string;
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
  cost: number;
}

interface NormalizedCodexUsage {
  input: number;
  cached_input: number;
  output: number;
  reasoning_output: number;
  total: number;
}

interface CodexTokenCountRecord {
  seq: number;
  timestamp: string;
  model: string;
  total: NormalizedCodexUsage;
  last: NormalizedCodexUsage;
}

function normalizeUsageFields(usage: CodexTokenUsageFields | undefined): NormalizedCodexUsage {
  return {
    input: pickUsage(usage?.input, usage?.input_tokens) ?? 0,
    cached_input: pickUsage(usage?.cached_input, usage?.cached_input_tokens) ?? 0,
    output: pickUsage(usage?.output, usage?.output_tokens) ?? 0,
    reasoning_output: pickUsage(usage?.reasoning_output, usage?.reasoning_output_tokens) ?? 0,
    total: pickUsage(usage?.total, usage?.total_tokens) ?? 0,
  };
}

function computeCodexEventCost(input: number, cacheRead: number, output: number, model: string): number {
  const pricing = getPricingSync('openai', model);
  const nonCachedInput = Math.max(0, input - cacheRead);
  const inputCost = (nonCachedInput / 1000) * (pricing?.inputPer1k ?? 0);
  const cachedCost = (cacheRead / 1000) * (pricing?.cacheReadPer1k ?? 0);
  const outputCost = (output / 1000) * (pricing?.outputPer1k ?? 0);
  return inputCost + cachedCost + outputCost;
}

/**
 * Parse a Codex rollout JSONL file into per-turn cost events.
 *
 * Implementation checkpoint (PAN-2388): inspected real multi-turn rollouts in
 * ~/.codex/sessions (e.g. 2026-03-19T13-24-02-...d8.jsonl). In those files
 * last_token_usage does NOT sum to total_token_usage because each turn's
 * last_token_usage includes the full conversation context. Therefore this
 * emitter uses cumulative-delta arithmetic when last_token_usage values do not
 * sum to the final total_token_usage, and falls back to last_token_usage only
 * for files where the values do sum (such as the committed test fixture).
 */
export function parseCodexSessionCostEventsSync(sessionFile: string): CodexCostEventUsage[] {
  if (!existsSync(sessionFile)) return [];
  let raw: string;
  try {
    raw = readFileSync(sessionFile, 'utf-8');
  } catch {
    return [];
  }

  let model = '';
  let threadId = '';
  const tokenCounts: CodexTokenCountRecord[] = [];

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(trimmed) as Record<string, unknown>;
    } catch {
      continue;
    }

    const payload = entry['payload'] && typeof entry['payload'] === 'object'
      ? (entry['payload'] as Record<string, unknown>)
      : null;
    const type = (payload?.['type'] ?? entry['type']) as string | undefined;
    const data = payload ?? entry;
    const ts = typeof entry['timestamp'] === 'string' ? (entry['timestamp'] as string) : '';

    if (type === 'session_meta') {
      if (!threadId && typeof data['id'] === 'string') threadId = data['id'];
    } else if (type === 'turn_context') {
      if (typeof data['model'] === 'string' && data['model']) model = data['model'];
    } else if (type === 'task_started') {
      if (typeof data['model'] === 'string' && data['model']) model = data['model'];
      if (typeof data['thread_id'] === 'string') threadId = data['thread_id'];
    } else if (type === 'token_count') {
      const info = data['info'] as { total_token_usage?: CodexTokenUsageFields; last_token_usage?: CodexTokenUsageFields } | undefined;
      if (!info) continue;
      tokenCounts.push({
        seq: tokenCounts.length,
        timestamp: ts,
        model: model || 'unknown',
        total: normalizeUsageFields(info.total_token_usage),
        last: normalizeUsageFields(info.last_token_usage),
      });
    }
  }

  if (tokenCounts.length === 0) return [];

  const finalTotal = tokenCounts[tokenCounts.length - 1]!.total;
  const sumOfLast = tokenCounts.reduce(
    (acc, r) => ({
      input: acc.input + r.last.input,
      cached_input: acc.cached_input + r.last.cached_input,
      output: acc.output + r.last.output,
      total: acc.total + r.last.total,
    }),
    { input: 0, cached_input: 0, output: 0, total: 0 },
  );

  // Use last_token_usage directly only when it sums to the final cumulative total.
  const useLastDirectly =
    Math.abs(sumOfLast.input - finalTotal.input) < 1 &&
    Math.abs(sumOfLast.cached_input - finalTotal.cached_input) < 1 &&
    Math.abs(sumOfLast.output - finalTotal.output) < 1;

  const events: CodexCostEventUsage[] = [];
  let prevTotal: NormalizedCodexUsage | null = null;

  for (const record of tokenCounts) {
    let input: number;
    let cacheRead: number;
    let output: number;

    if (useLastDirectly) {
      input = record.last.input;
      cacheRead = record.last.cached_input;
      output = record.last.output;
    } else {
      const prev = prevTotal ?? { input: 0, cached_input: 0, output: 0, total: 0, reasoning_output: 0 };
      input = Math.max(0, record.total.input - prev.input);
      cacheRead = Math.max(0, record.total.cached_input - prev.cached_input);
      output = Math.max(0, record.total.output - prev.output);
      prevTotal = record.total;
    }

    const cost = computeCodexEventCost(input, cacheRead, output, record.model);

    events.push({
      requestId: `codex:${threadId || sessionFile}:${record.seq}`,
      timestamp: record.timestamp,
      sessionId: threadId || sessionFile,
      sessionFile,
      provider: 'openai',
      model: record.model,
      input,
      output,
      cacheRead,
      cacheWrite: 0,
      cost,
    });
  }

  return events;
}
