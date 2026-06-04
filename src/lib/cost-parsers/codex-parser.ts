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
  input?: number;
  cached_input?: number;
  output?: number;
  reasoning_output?: number;
  total?: number;
}

interface CodexTokenCountRecord {
  type: 'token_count';
  timestamp?: string;
  info?: {
    total_token_usage?: CodexTokenUsageFields;
    last_token_usage?: CodexTokenUsageFields;
  };
}

interface CodexTaskStartedRecord {
  type: 'task_started';
  model?: string;
  thread_id?: string;
  timestamp?: string;
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

  let model = 'codex-4o';
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

    const type = entry['type'];

    if (type === 'task_started') {
      const r = entry as unknown as CodexTaskStartedRecord;
      if (r.model) model = r.model;
      if (r.thread_id) threadId = r.thread_id;
      if (r.timestamp) startTime = r.timestamp;
    } else if (type === 'agent_message') {
      messageCount++;
      const ts = typeof entry['timestamp'] === 'string' ? (entry['timestamp'] as string) : '';
      if (ts) endTime = ts;
    } else if (type === 'token_count') {
      const r = entry as unknown as CodexTokenCountRecord;
      const usage = r.info?.total_token_usage;
      if (usage) {
        totalInput = usage.input ?? totalInput;
        totalCachedInput = usage.cached_input ?? totalCachedInput;
        totalOutput = usage.output ?? totalOutput;
        hasUsage = true;
        const ts = typeof entry['timestamp'] === 'string' ? (entry['timestamp'] as string) : '';
        if (ts) endTime = ts;
      }
    }
  }

  if (!hasUsage && messageCount === 0) return null;

  const pricing = getPricingSync('openai', model);
  const inputCost = (totalInput / 1000) * (pricing?.inputPer1k ?? 0);
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
