import { afterEach, describe, expect, it, vi } from 'vitest';

import { getPricingSync } from '../../cost.js';
import { calculateExtractionCost, type ExtractionUsage } from '../providers/types.js';

describe('memory extraction pricing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('prices cliproxy gpt-5.4-mini from the shared pricing table', () => {
    const usage = { input: 7818, output: 181 };
    const cost = calculateExtractionCost('cliproxy', 'gpt-5.4-mini', usage);

    expect(cost.usd).toBeGreaterThan(0);
    expect(cost.usd).toBe(expectedCost('openai', 'gpt-5.4-mini', usage));
  });

  it('prices default cliproxy gpt-4.1-nano from the shared pricing table', () => {
    const usage = { input: 10, output: 4 };
    const cost = calculateExtractionCost('cliproxy', 'gpt-4.1-nano', usage);

    expect(cost.usd).toBeGreaterThan(0);
    expect(cost.usd).toBe(expectedCost('openai', 'gpt-4.1-nano', usage));
  });

  it('prices Anthropic Haiku from the shared pricing table', () => {
    const usage = { input: 2000, cacheRead: 500, cacheWrite: 100, output: 300 };
    const cost = calculateExtractionCost('anthropic', 'claude-haiku-4-5', usage);

    expect(cost.usd).toBe(expectedCost('anthropic', 'claude-haiku-4-5', usage));
  });

  it('records zero and warns once for an unpriced provider/model pair', () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    expect(calculateExtractionCost('cliproxy', 'missing-extraction-model', { input: 100, output: 50 })).toEqual({ usd: 0 });
    expect(calculateExtractionCost('cliproxy', 'missing-extraction-model', { input: 100, output: 50 })).toEqual({ usd: 0 });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('missing-extraction-model');
  });
});

function expectedCost(provider: 'anthropic' | 'openai', model: string, usage: ExtractionUsage): number {
  const pricing = getPricingSync(provider, model);
  if (!pricing) throw new Error(`Missing pricing for ${provider}/${model}`);
  return (
    (usage.input / 1_000) * pricing.inputPer1k +
    ((usage.cacheRead ?? 0) / 1_000) * (pricing.cacheReadPer1k ?? 0) +
    ((usage.cacheWrite ?? 0) / 1_000) * (pricing.cacheWrite5mPer1k ?? 0) +
    (usage.output / 1_000) * pricing.outputPer1k
  );
}
