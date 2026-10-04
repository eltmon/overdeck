import { describe, expect, it } from 'vitest';

import { formatEffortRollup, formatIssueCostAggregate } from '../../../src/cli/commands/cost.js';
import type { IssueAggregate } from '../../../src/lib/database/cost-events-db.js';
import type { EffortRollup } from '../../../src/lib/overdeck/cost-sync.js';

describe('cost command formatting', () => {
  it('shows synthesis and per-reviewer review stages for an issue aggregate', () => {
    const aggregate: IssueAggregate = {
      issueId: 'PAN-1059',
      totalCost: 0.1234,
      inputTokens: 1000,
      outputTokens: 500,
      cacheReadTokens: 250,
      cacheWriteTokens: 125,
      lastUpdated: '2026-05-11T21:45:00Z',
      budgetWarning: false,
      models: {
        'claude-opus-4-7': { cost: 0.08, calls: 1, tokens: 1000 },
        'claude-sonnet-4-6': { cost: 0.0434, calls: 2, tokens: 875 },
      },
      stages: {
        review: { cost: 0.05, calls: 1, tokens: 900 },
        'review.security': { cost: 0.02, calls: 1, tokens: 300 },
        'review.correctness': { cost: 0.03, calls: 2, tokens: 675 },
        work: { cost: 0.0234, calls: 1, tokens: 100 },
      },
    };

    const output = formatIssueCostAggregate('pan-1059', aggregate).join('\n');

    expect(output).toContain('Costs for PAN-1059');
    expect(output).toContain('By Review Role');
    expect(output).toContain('synthesis: $0.0500 (1 call)');
    expect(output).toContain('security: $0.0200 (1 call)');
    expect(output).toContain('correctness: $0.0300 (2 calls)');
    expect(output).not.toContain('work: $0.0234');
  });

  it('formatEffortRollup prints one line per bucket', () => {
    const rows: EffortRollup[] = [
      { effort: 'high', totalCost: 0.12, calls: 3, totalTokens: 1500 },
      { effort: 'unrecorded', totalCost: 0.04, calls: 1, totalTokens: 200 },
    ];

    const lines = formatEffortRollup(rows, 'PAN-1');

    expect(lines[0]).toContain('Costs by effort for PAN-1');
    expect(lines.some((line) => line.includes('high'))).toBe(true);
    expect(lines.some((line) => line.includes('unrecorded'))).toBe(true);
    expect(formatEffortRollup([])).toEqual(['No cost events found.']);
  });
});
