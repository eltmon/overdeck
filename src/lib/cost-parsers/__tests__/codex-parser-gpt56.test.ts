import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { getPricingSync } from '../../cost.js';
import { parseCodexSessionSync } from '../codex-parser.js';

const GPT56_FIXTURE = join(__dirname, 'fixtures', 'rollout-gpt56sol-nested.jsonl');

describe('parseCodexSessionSync gpt-5.6-sol nested rollout fixture', () => {
  it('reads model, thread id, latest cumulative usage, and cached-input priced cost', () => {
    const result = parseCodexSessionSync(GPT56_FIXTURE);
    expect(result).not.toBeNull();
    expect(result!.model).toBe('gpt-5.6-sol');
    expect(result!.sessionId).toBe('019f337a-5eb4-74f1-bd39-78c79a3f7589');
    expect(result!.usage.inputTokens).toBe(18000);
    expect(result!.usage.cacheReadTokens).toBe(6000);
    expect(result!.usage.outputTokens).toBe(1500);

    const pricing = getPricingSync('openai', 'gpt-5.6-sol')!;
    const expectedCost =
      ((18000 - 6000) / 1000) * pricing.inputPer1k +
      (6000 / 1000) * (pricing.cacheReadPer1k ?? 0) +
      (1500 / 1000) * pricing.outputPer1k;
    expect(result!.cost).toBeCloseTo(expectedCost, 8);
    expect(result!.cost).toBeGreaterThan(0);
  });
});
