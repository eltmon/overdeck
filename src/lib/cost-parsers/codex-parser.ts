/**
 * Codex CLI rollout JSONL parser (PAN-1574).
 *
 * Codex sessions (D-7 external store) live at:
 *   $CODEX_HOME/sessions/YYYY/MM/DD/rollout-<uuid>-<threadId>.jsonl
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
  // Subscription Codex conversations are GPT-5.x; fall back to gpt-5.5 pricing
  // when the rollout carried no model so cost stays non-zero.
  if (!model) model = 'gpt-5.5';

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
