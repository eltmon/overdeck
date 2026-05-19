import type { MemoryIdentity } from '@panctl/contracts';
import { queryCostEvents } from '../../database/cost-events-db.js';
import { updateMemoryHealth } from '../health.js';
import {
  getExtractionProvider,
  resolveExtractionProviderSelection,
} from './registry.js';
import type {
  ExtractionProviderOptions,
  ExtractionProviderResult,
  ExtractionProviderSelection,
  MemoryProviderSettings,
} from './types.js';

const DEFAULT_DAILY_CAP_USD = 5;

export type MemoryExtractionPolicyResult<T> =
  | { status: 'extracted'; result: ExtractionProviderResult<T>; provider: string }
  | { status: 'skipped'; reason: 'cost-cap' }
  | { status: 'dropped'; reason: 'extraction-failed'; error: unknown };

export interface MemoryExtractionPolicyOptions extends ExtractionProviderOptions {
  identity: MemoryIdentity;
  settings?: MemoryProviderSettings | null;
  perDayCostCapUsd?: number;
}

export interface MemoryExtractionPolicyDeps {
  selection?: ExtractionProviderSelection;
  getDailySpendUsd?: (identity: MemoryIdentity) => number | Promise<number>;
  recordHealth?: (identity: MemoryIdentity, input: { status: 'healthy' | 'degraded' | 'failing'; reason?: string; success?: boolean }) => Promise<void>;
}

export async function extractWithProviderPolicy<T>(
  prompt: string,
  jsonSchema: unknown,
  options: MemoryExtractionPolicyOptions,
  deps: MemoryExtractionPolicyDeps = {},
): Promise<MemoryExtractionPolicyResult<T>> {
  const selection = deps.selection ?? await resolveExtractionProviderSelection(options.settings ?? null);
  const cap = options.perDayCostCapUsd ?? options.settings?.perDayCostCapUsd ?? DEFAULT_DAILY_CAP_USD;
  const spend = await (deps.getDailySpendUsd ?? getTodayMemoryExtractionSpendUsd)(options.identity);
  const recordHealth = deps.recordHealth ?? updateMemoryHealth;

  if (cap > 0 && spend >= cap) {
    await recordHealth(options.identity, { status: 'degraded', reason: 'cost-cap', success: false });
    return { status: 'skipped', reason: 'cost-cap' };
  }

  const attempts = [
    { provider: selection.provider, model: selection.model },
    ...selection.fallbackChain,
  ].slice(0, 2);
  let lastError: unknown;

  for (const attempt of attempts) {
    try {
      const provider = getExtractionProvider(attempt.provider);
      const result = await provider.extract<T>(prompt, jsonSchema, { ...options, model: attempt.model });
      await recordHealth(options.identity, { status: 'healthy', success: true });
      return { status: 'extracted', result, provider: attempt.provider };
    } catch (error) {
      lastError = error;
    }
  }

  await recordHealth(options.identity, { status: 'failing', reason: 'extraction-failed', success: false });
  return { status: 'dropped', reason: 'extraction-failed', error: lastError };
}

export function getTodayMemoryExtractionSpendUsd(identity: Pick<MemoryIdentity, 'issueId'>): number {
  const events = queryCostEvents({ issueId: identity.issueId, startTs: startOfLocalDayIso() });
  return events
    .filter((event) => event.source === 'memory-extraction')
    .reduce((sum, event) => sum + event.cost, 0);
}

function startOfLocalDayIso(): string {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
}
