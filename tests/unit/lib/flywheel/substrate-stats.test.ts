import { describe, expect, it } from 'vitest';

import {
  bugRateStatus,
  computeSubstrateStats,
  p0Status,
  severityOf,
  trendOf,
  type MergedPr,
  type SubstrateIssue,
} from '../../../../src/lib/flywheel/substrate-stats.js';

const NOW = new Date('2026-09-23T00:00:00.000Z');
const DAY = 24 * 60 * 60 * 1000;
const daysAgo = (n: number) => new Date(NOW.getTime() - n * DAY).toISOString();

function issue(n: number, createdDaysAgo: number, labels: string[] = []): SubstrateIssue {
  return { number: n, title: `bug ${n}`, createdAt: daysAgo(createdDaysAgo), closedAt: null, labels: ['substrate-improvement', ...labels] };
}

function prs(count: number, mergedDaysAgo: number): MergedPr[] {
  return Array.from({ length: count }, (_, i) => ({ number: 1000 + mergedDaysAgo * 100 + i, mergedAt: daysAgo(mergedDaysAgo) }));
}

async function stats(issues: SubstrateIssue[], merged: MergedPr[], windowDays = 30) {
  return computeSubstrateStats({
    projectPath: '/repos/overdeck',
    windowDays,
    now: () => NOW,
    listSubstrateIssues: async () => issues,
    listMergedPrs: async () => merged,
  });
}

describe('computeSubstrateStats (PAN-3964 FR-4)', () => {
  it('applies the c1 thresholds (green < 0.1, yellow < 0.3, red otherwise)', () => {
    expect(bugRateStatus(0.05)).toBe('green');
    expect(bugRateStatus(0.1)).toBe('yellow');
    expect(bugRateStatus(0.29)).toBe('yellow');
    expect(bugRateStatus(0.3)).toBe('red');
  });

  it('applies the c2 thresholds (green 0, yellow ≤ 2, red otherwise)', () => {
    expect(p0Status(0)).toBe('green');
    expect(p0Status(2)).toBe('yellow');
    expect(p0Status(3)).toBe('red');
  });

  it('trend is flat within 10 % of the larger value', () => {
    expect(trendOf(1, 1)).toBe('flat');
    expect(trendOf(0.95, 1)).toBe('flat');
    expect(trendOf(2, 1)).toBe('up');
    expect(trendOf(1, 2)).toBe('down');
    expect(trendOf(0, 0)).toBe('flat');
  });

  it('reads severity from P0/P1/P2 labels, else unknown', () => {
    expect(severityOf(['P0'])).toBe('P0');
    expect(severityOf(['bug', 'p1'])).toBe('P1');
    expect(severityOf(['bug'])).toBe('unknown');
  });

  it('computes c1 and c2 for the window and their trend against the preceding window', async () => {
    const result = await stats(
      [issue(1, 2, ['P0']), issue(2, 10), issue(3, 20, ['P1']), issue(4, 40), issue(5, 45, ['P0']), issue(6, 50), issue(7, 55)],
      [...prs(20, 5), ...prs(10, 35)],
    );
    expect(result.window).toEqual({ days: 30, since: daysAgo(30), until: NOW.toISOString() });
    expect(result.criteria.c1_bugRate).toEqual({
      value: 3 / 20, count: 3, denominator: 20, status: 'yellow', trend: 'down', dataSufficient: true,
    });
    expect(result.criteria.c2_p0Bugs).toEqual({ value: 1, status: 'yellow', trend: 'flat', dataSufficient: true });
    expect(result.bugs.map((b) => [b.number, b.severity])).toEqual([[1, 'P0'], [2, 'unknown'], [3, 'P1']]);
  });

  it('trend up when the current window is worse', async () => {
    const result = await stats([issue(1, 1), issue(2, 2), issue(3, 3), issue(4, 40)], [...prs(10, 5), ...prs(10, 35)]);
    expect(result.criteria.c1_bugRate.trend).toBe('up');
  });

  it('marks dataSufficient false under 5 merged PRs', async () => {
    const result = await stats([issue(1, 1)], prs(4, 1));
    expect(result.criteria.c1_bugRate.dataSufficient).toBe(false);
    expect(result.criteria.c2_p0Bugs.dataSufficient).toBe(false);
    expect(result.criteria.c1_bugRate.value).toBe(0.25);
  });

  it('reports an undefined rate as null with insufficient_data when nothing merged', async () => {
    const result = await stats([issue(1, 1)], []);
    expect(result.criteria.c1_bugRate).toMatchObject({ value: null, count: 1, denominator: 0, status: 'insufficient_data', dataSufficient: false });
  });

  it('honours a 7-day window', async () => {
    const result = await stats([issue(1, 3), issue(2, 9)], [...prs(6, 2), ...prs(6, 10)], 7);
    expect(result.window.days).toBe(7);
    expect(result.criteria.c1_bugRate.count).toBe(1);
    expect(result.criteria.c1_bugRate.denominator).toBe(6);
  });
});
