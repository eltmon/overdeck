import { randomUUID } from 'crypto';
import type { MemoryIdentity } from '@overdeck/contracts';
import { getPricingSync, type AIProvider } from '../../cost.js';
import { insertCostEventSync } from '../../overdeck/cost-sync.js';
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
  const pricingProvider = extractionProviderToAiProvider(provider);
  const pricing = getPricingSync(pricingProvider, model);
  if (!pricing) {
    warnUnpricedExtractionModel(provider, model);
    return { usd: 0 };
  }
  const usd =
    (usage.input / 1_000) * pricing.inputPer1k +
    ((usage.cacheRead ?? 0) / 1_000) * (pricing.cacheReadPer1k ?? 0) +
    ((usage.cacheWrite ?? 0) / 1_000) * (pricing.cacheWrite5mPer1k ?? 0) +
    (usage.output / 1_000) * pricing.outputPer1k;
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
    // Cost events require an issueId; a null issueId (main/scratch workspace
    // turn, PRD D-6) falls back to workspaceId until cost tracking widens too.
    issueId: input.identity.issueId ?? input.identity.workspaceId,
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

  insertCostEventSync(event);
}

function extractionProviderToAiProvider(provider: string): AIProvider {
  if (provider === 'anthropic') return 'anthropic';
  if (provider === 'cliproxy' || provider === 'openai') return 'openai';
  if (provider === 'google') return 'google';
  return 'custom';
}

const warnedUnpricedExtractionModels = new Set<string>();

function warnUnpricedExtractionModel(provider: string, model: string): void {
  const key = `${provider}/${model}`;
  if (warnedUnpricedExtractionModels.has(key)) return;
  warnedUnpricedExtractionModels.add(key);
  console.warn(`[memory] unpriced extraction model ${key}; recording $0 cost`);
}
