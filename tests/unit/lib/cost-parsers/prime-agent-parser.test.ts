import { describe, expect, it } from 'vitest';
import { mapPrimeAgentSessionStats, parsePrimeAgentSessionContent } from '../../../../src/lib/cost-parsers/prime-agent-parser.js';

describe('Prime Agent cost parser', () => {
  it('maps complete session statistics', () => {
    expect(mapPrimeAgentSessionStats({
      tokens: { input: 800, output: 200, cacheRead: 100, cacheWrite: 50, total: 1_150 },
      cost: 0.12,
      contextWindow: 4_000,
      contextUsed: 1_000,
    })).toEqual({ input: 800, output: 200, cacheRead: 100, cacheWrite: 50, total: 1_150, cost: 0.12, contextWindow: 4_000, contextPercent: 25 });
  });

  it('does not invent omitted fields', () => {
    expect(mapPrimeAgentSessionStats({ tokens: { output: 12 } })).toEqual({ output: 12 });
  });

  it('accepts cache-token variants and durable assistant usage', () => {
    const parsed = parsePrimeAgentSessionContent([
      JSON.stringify({ type: 'assistant', usage: { inputTokens: 20, outputTokens: 5, cache_read: 8 } }),
      JSON.stringify({ type: 'assistant', usage: { input: 10, output: 2, cacheWriteTokens: 3, cost: 0.01 } }),
    ].join('\n'));
    expect(parsed).toEqual({ input: 30, output: 7, cacheRead: 8, cacheWrite: 3, cost: 0.01 });
  });
});
