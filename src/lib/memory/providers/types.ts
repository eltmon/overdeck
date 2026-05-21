import { randomUUID } from 'crypto';
import type { MemoryIdentity } from '@panctl/contracts';
import { insertCostEvent } from '../../database/cost-events-db.js';
import type { CostEvent } from '../../costs/events.js';

export interface ExtractionUsage {
  input: number;
  output: number;
  cacheRead?: number;
  cacheWrite?: number;
}

export interface ExtractionCost {
  usd: number;
}

export interface ExtractionProviderOptions {
  model?: string;
  temperature?: number;
  maxTokens?: number;
  signal?: AbortSignal;
  identity?: MemoryIdentity;
}

export interface ExtractionProviderResult<T> {
  data: T;
  usage: ExtractionUsage;
  cost: ExtractionCost;
  model: string;
  provider: string;
  requestId?: string;
}

export interface ExtractionProvider {
  name: string;
  defaultModel: string;
  extract<T>(prompt: string, jsonSchema: unknown, options?: ExtractionProviderOptions): Promise<ExtractionProviderResult<T>>;
}

export interface ExtractionProviderTarget {
  provider: string;
  model: string;
}

export interface ExtractionProviderSelection {
  provider: string;
  model: string;
  fallbackChain: ExtractionProviderTarget[];
  source: 'env' | 'settings' | 'default';
}

export interface MemoryProviderSettings {
  provider?: string;
  model?: string;
  perDayCostCapUsd?: number;
  fallbackChain?: ExtractionProviderTarget[];
}

export interface MemorySettingsFile {
  memory?: {
    extraction?: MemoryProviderSettings;
  };
}

export function parseJsonPayload<T>(text: string): T {
  const trimmed = text.trim();
  const fenced = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  const payload = fenced?.[1] ?? trimmed;
  return JSON.parse(payload) as T;
}

export function buildJsonExtractionPrompt(prompt: string, jsonSchema: unknown): string {
  return [
    prompt,
    '',
    'Return only JSON matching this schema:',
    JSON.stringify(jsonSchema),
  ].join('\n');
}

export function calculateExtractionCost(provider: string, model: string, usage: ExtractionUsage): ExtractionCost {
  const pricing = getPricing(provider, model);
  const usd =
    (usage.input / 1_000_000) * pricing.inputPerMillion +
    ((usage.cacheRead ?? 0) / 1_000_000) * pricing.cacheReadPerMillion +
    ((usage.cacheWrite ?? 0) / 1_000_000) * pricing.cacheWritePerMillion +
    (usage.output / 1_000_000) * pricing.outputPerMillion;
  return { usd };
}

export function recordExtractionCost(input: {
  provider: string;
  model: string;
  usage: ExtractionUsage;
  cost: ExtractionCost;
  identity?: MemoryIdentity;
  requestId?: string;
}): void {
  if (!input.identity) return;

  const event: CostEvent = {
    ts: new Date().toISOString(),
    type: 'cost',
    agentId: input.identity.sessionId,
    issueId: input.identity.issueId,
    sessionType: 'memory-extraction',
    source: 'memory-extraction',
    provider: input.provider,
    model: input.model,
    input: input.usage.input,
    output: input.usage.output,
    cacheRead: input.usage.cacheRead ?? 0,
    cacheWrite: input.usage.cacheWrite ?? 0,
    cost: input.cost.usd,
    requestId: input.requestId ?? `memory-extraction-${randomUUID()}`,
    sessionId: input.identity.sessionId,
  };

  insertCostEvent(event);
}

function getPricing(provider: string, model: string): {
  inputPerMillion: number;
  outputPerMillion: number;
  cacheReadPerMillion: number;
  cacheWritePerMillion: number;
} {
  if (provider === 'anthropic' && model.includes('haiku')) {
    return { inputPerMillion: 0.8, outputPerMillion: 4, cacheReadPerMillion: 0.08, cacheWritePerMillion: 1 };
  }
  if (provider === 'cliproxy' && model === 'gpt-4.1-nano') {
    return { inputPerMillion: 0.1, outputPerMillion: 0.4, cacheReadPerMillion: 0, cacheWritePerMillion: 0 };
  }
  return { inputPerMillion: 0, outputPerMillion: 0, cacheReadPerMillion: 0, cacheWritePerMillion: 0 };
}
