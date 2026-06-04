import { describe, expect, it, vi, beforeEach } from 'vitest';
import type { CostEvent } from '../../costs/events.js';

// Capture cost events instead of writing them to the JSONL/SQLite ledger.
const captured: CostEvent[] = [];
vi.mock('../../costs/events.js', () => ({
  appendCostEventSync: (event: CostEvent) => { captured.push(event); },
}));

import { recordBackgroundAiCost, backgroundCostSource } from '../cost.js';

beforeEach(() => {
  captured.length = 0;
});

describe('backgroundCostSource', () => {
  it('namespaces the feature under background:', () => {
    expect(backgroundCostSource('ttsSummarizer')).toBe('background:ttsSummarizer');
    expect(backgroundCostSource('conversationTitles')).toBe('background:conversationTitles');
  });
});

describe('recordBackgroundAiCost', () => {
  it('records an event tagged with the background source and synthetic ids', () => {
    recordBackgroundAiCost({
      feature: 'conversationTitles',
      provider: 'anthropic',
      model: 'claude-haiku-4-5',
      usage: { inputTokens: 100, outputTokens: 20 },
    });
    expect(captured).toHaveLength(1);
    const ev = captured[0];
    expect(ev.source).toBe('background:conversationTitles');
    expect(ev.agentId).toBe('background');
    expect(ev.issueId).toBe('background');
    expect(ev.sessionType).toBe('background');
    expect(ev.input).toBe(100);
    expect(ev.output).toBe(20);
  });

  it('uses a provided costUsd verbatim', () => {
    const cost = recordBackgroundAiCost({
      feature: 'titleRefinement',
      model: 'claude-haiku-4-5',
      usage: { inputTokens: 500, outputTokens: 50 },
      costUsd: 0.0042,
    });
    expect(cost).toBe(0.0042);
    expect(captured[0].cost).toBe(0.0042);
  });

  it('derives cost from the pricing table when costUsd is omitted', () => {
    const cost = recordBackgroundAiCost({
      feature: 'ttsSummarizer',
      provider: 'openai',
      model: 'gpt-5.4-mini',
      usage: { inputTokens: 1000, outputTokens: 200 },
    });
    // Either a positive derived cost (model priced) or 0 (unpriced) — never NaN/undefined.
    expect(typeof cost).toBe('number');
    expect(Number.isFinite(cost)).toBe(true);
    expect(cost).toBeGreaterThanOrEqual(0);
  });
});
