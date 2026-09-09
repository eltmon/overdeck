import { describe, expect, it, vi } from 'vitest';
const { costs } = vi.hoisted(() => ({ costs: vi.fn() }));
vi.mock('../../../../lib/overdeck/cost-sync.js', () => ({ getCostsByIssueSync: costs }));
import { getCostsByIssueSnapshot } from '../dashboard-cost-snapshot.js';

describe('cost snapshot response no-loss audit', () => {
  it('preserves every field, all token classes, raw model calls, mapped breakdowns and ordering', () => {
    const base = { inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4,
      models: { model: { cost: 2, tokens: 10, calls: 3 } },
      stages: { work: { cost: 2, tokens: 10, calls: 3 } },
      providers: { openai: 2 }, budgetWarning: true, lastUpdated: '2026-09-09T00:00:00.000Z' };
    costs.mockReturnValue({ 'PAN-1': { ...base, totalCost: 2 }, 'PAN-2': { ...base, totalCost: 8 } });
    expect(getCostsByIssueSnapshot()).toEqual({ status: 'live', eventCount: 2, issues: [8, 2].map((totalCost, i) => ({
      issueId: i === 0 ? 'PAN-2' : 'PAN-1', totalCost, tokenCount: 10,
      inputTokens: 1, outputTokens: 2, cacheReadTokens: 3, cacheWriteTokens: 4,
      models: base.models, byModel: { model: { cost: 2, tokens: 10 } },
      byStage: { work: { cost: 2, tokens: 10 } }, budgetWarning: true, lastUpdated: base.lastUpdated,
    })) });
  });
  it('preserves the empty snapshot', () => {
    costs.mockReturnValue({});
    expect(getCostsByIssueSnapshot()).toEqual({ status: 'live', eventCount: 0, issues: [] });
  });
});
