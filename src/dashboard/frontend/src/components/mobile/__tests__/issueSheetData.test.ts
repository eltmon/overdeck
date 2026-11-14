import type { DerivedIssueState, DerivedPrState, DirectoryEntry } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';

import type { Agent } from '../../../types';
import type { IssueCheckRunsResponse } from '../../CommandDeck/ZoneCOverviewTabs/queries';
import {
  checksText,
  DIRECTORY_STATE_LABELS,
  eventLine,
  formatEventTime,
  headlineCost,
  isCheckRunsResponse,
  isIssueCostData,
  isLiveDirectoryResponse,
  pickIssueAgent,
  prStateLabel,
  shouldCollapseDescription,
  stageCostLine,
} from '../issueSheetData';

function derivedPr(overrides: Partial<DerivedPrState>): DerivedPrState {
  return {
    url: 'https://example.com/pr/1',
    number: 1,
    reviewState: 'none',
    checks: 'pending',
    mergeable: true,
    ...overrides,
  };
}

function checkRunsResponse(overrides: Partial<IssueCheckRunsResponse>): IssueCheckRunsResponse {
  return {
    issueId: 'PAN-1',
    pr: null,
    checkRuns: [],
    summary: { total: 0, passed: 0, failed: 0, running: 0, skipped: 0, pending: 0, cancelled: 0 },
    ...overrides,
  };
}

function directoryEntry(overrides: Partial<DirectoryEntry>): DirectoryEntry {
  return {
    id: overrides.id ?? 'a1',
    kind: 'agent',
    label: 'a1',
    location: 'local',
    projectKey: 'pan',
    issueId: 'PAN-1',
    issueTitle: null,
    parentId: null,
    role: 'work',
    harness: 'claude-code',
    model: 'opus',
    state: 'working',
    startedAt: '2026-01-01T00:00:00.000Z',
    lastActivityAt: '2026-01-01T00:00:00.000Z',
    costUsd: null,
    source: 'overdeck',
    transcript: null,
    ...overrides,
  };
}

function storeAgent(overrides: Partial<Agent>): Agent {
  return {
    id: overrides.id ?? 'agent-1',
    issueId: 'PAN-1',
    runtime: 'claude-code',
    model: 'opus',
    status: 'stopped',
    startedAt: '2026-01-01T00:00:00.000Z',
    consecutiveFailures: 0,
    killCount: 0,
    ...overrides,
  };
}

describe('formatEventTime', () => {
  it('shows a time for the same local calendar day as now', () => {
    const now = new Date('2026-11-13T23:00:00.000Z');
    const at = '2026-11-13T19:43:00.000Z';
    expect(formatEventTime(at, now)).toBe(new Date(at).toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' }));
  });

  it('shows a date and time for another day', () => {
    const now = new Date('2026-11-14T23:00:00.000Z');
    const at = '2026-11-13T19:43:00.000Z';
    expect(formatEventTime(at, now)).toBe(
      new Date(at).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' }),
    );
  });

  it('returns null for an unparsable at', () => {
    expect(formatEventTime('not-a-date', new Date())).toBeNull();
  });
});

describe('eventLine', () => {
  const now = new Date('2026-11-13T23:00:00.000Z');

  it('names the PR number for merge.completed with a known PR', () => {
    const line = eventLine({ kind: 'merge.completed', at: '2026-11-13T19:43:00.000Z' }, 12, now);
    expect(line).toContain('Merged PR #12 at');
  });

  it('gives the plain label for stopped with no at', () => {
    expect(eventLine({ kind: 'stopped', at: null }, null, now)).toBe('Agent stopped responding');
  });

  it('gives the plain label for merge.completed with no known PR', () => {
    expect(eventLine({ kind: 'merge.completed', at: null }, null, now)).toBe('Merged');
  });

  it('omits the time suffix when at cannot be parsed', () => {
    expect(eventLine({ kind: 'merge.failed', at: 'nope' }, null, now)).toBe('Merge failed');
  });
});

describe('isLiveDirectoryResponse', () => {
  it('accepts an object with an entries array and rejects everything else', () => {
    expect(isLiveDirectoryResponse({ entries: [] })).toBe(true);
    expect(isLiveDirectoryResponse({ entries: 'nope' })).toBe(false);
    expect(isLiveDirectoryResponse(null)).toBe(false);
    expect(isLiveDirectoryResponse([])).toBe(false);
  });
});

describe('pickIssueAgent', () => {
  const NOW_MS = Date.parse('2026-01-02T00:00:00.000Z');

  it('picks the latest of two live entries', () => {
    const older = directoryEntry({ id: 'a1', lastActivityAt: '2026-01-01T00:00:00.000Z' });
    const newer = directoryEntry({ id: 'a2', lastActivityAt: '2026-01-01T12:00:00.000Z' });
    const picked = pickIssueAgent('PAN-1', [older, newer], [], NOW_MS);
    expect(picked).toMatchObject({ lastActivityAt: newer.lastActivityAt, more: 1 });
  });

  it('labels an idle entry "Idle"', () => {
    const picked = pickIssueAgent('PAN-1', [directoryEntry({ state: 'idle' })], [], NOW_MS);
    expect(picked?.status).toBe(DIRECTORY_STATE_LABELS.idle);
  });

  it('falls back to the store "Stopped" when the directory answered with no entry for the issue', () => {
    const picked = pickIssueAgent('PAN-1', [directoryEntry({ issueId: 'PAN-2' })], [storeAgent({})], NOW_MS);
    expect(picked).toMatchObject({ status: 'Stopped' });
  });

  it('gives "Live" for a null directory and a store agent with hasLivePane true', () => {
    const picked = pickIssueAgent('PAN-1', null, [storeAgent({ hasLivePane: true })], NOW_MS);
    expect(picked?.status).toBe('Live');
  });

  it('returns null when no agent is known anywhere', () => {
    expect(pickIssueAgent('PAN-1', [], [], NOW_MS)).toBeNull();
    expect(pickIssueAgent('PAN-1', null, [], NOW_MS)).toBeNull();
  });

  it('ignores conversation entries', () => {
    const picked = pickIssueAgent('PAN-1', [directoryEntry({ kind: 'conversation' })], [], NOW_MS);
    expect(picked).toBeNull();
  });
});

function costData(overrides: Partial<import('../../CommandDeck/ZoneCOverviewTabs/queries').IssueCostData>) {
  return {
    issueId: 'PAN-1',
    totalCost: 0,
    totalTokens: 0,
    sessions: [],
    byModel: {},
    ...overrides,
  };
}

describe('isIssueCostData', () => {
  it('accepts a numeric totalCost and rejects an issue row', () => {
    expect(isIssueCostData(costData({ totalCost: 1.5 }))).toBe(true);
    expect(isIssueCostData({ identifier: 'PAN-1', title: 'x' })).toBe(false);
    expect(isIssueCostData(null)).toBe(false);
  });
});

describe('headlineCost', () => {
  it('prefers resolvedTotalCost over totalCost', () => {
    expect(headlineCost(costData({ totalCost: 3.5, resolvedTotalCost: 4.25 }))).toBe(4.25);
  });

  it('falls back to totalCost when resolvedTotalCost is absent', () => {
    expect(headlineCost(costData({ totalCost: 3.5 }))).toBe(3.5);
  });
});

describe('stageCostLine', () => {
  it('sorts by cost descending and skips zero-cost stages', () => {
    const line = stageCostLine({
      work: { cost: 3, tokens: 1 },
      review: { cost: 1.25, tokens: 1 },
      plan: { cost: 0, tokens: 1 },
    });
    expect(line).toBe('work $3.00 · review $1.25');
  });

  it('caps at 4 stages and adds "+N more"', () => {
    const line = stageCostLine({
      a: { cost: 5, tokens: 1 },
      b: { cost: 4, tokens: 1 },
      c: { cost: 3, tokens: 1 },
      d: { cost: 2, tokens: 1 },
      e: { cost: 1, tokens: 1 },
    });
    expect(line).toBe('a $5.00 · b $4.00 · c $3.00 · d $2.00 · +1 more');
  });

  it('returns null with no byStage or no non-zero stage', () => {
    expect(stageCostLine(undefined)).toBeNull();
    expect(stageCostLine({ work: { cost: 0, tokens: 1 } })).toBeNull();
  });
});

describe('isCheckRunsResponse', () => {
  it('accepts a numeric summary and rejects everything else', () => {
    expect(isCheckRunsResponse(checkRunsResponse({}))).toBe(true);
    expect(isCheckRunsResponse({ summary: { total: '5' } })).toBe(false);
    expect(isCheckRunsResponse(null)).toBe(false);
  });
});

describe('prStateLabel', () => {
  it('returns null with no derived state or no pr', () => {
    expect(prStateLabel(undefined)).toBeNull();
    expect(prStateLabel({ issueId: 'PAN-1', state: 'working' } satisfies DerivedIssueState)).toBeNull();
  });

  it('gives "Merged" when pr.merged is true, regardless of derived.state', () => {
    const derived: DerivedIssueState = { issueId: 'PAN-1', state: 'ready', pr: derivedPr({ merged: true }) };
    expect(prStateLabel(derived)).toBe('Merged');
  });

  it('gives "Merged" when derived.state is merged', () => {
    const derived: DerivedIssueState = { issueId: 'PAN-1', state: 'merged', pr: derivedPr({}) };
    expect(prStateLabel(derived)).toBe('Merged');
  });

  it('gives "Closed" when derived.state is closed', () => {
    const derived: DerivedIssueState = { issueId: 'PAN-1', state: 'closed', pr: derivedPr({}) };
    expect(prStateLabel(derived)).toBe('Closed');
  });

  it('gives "Open" for any other state with a pr', () => {
    const derived: DerivedIssueState = { issueId: 'PAN-1', state: 'in-review', pr: derivedPr({}) };
    expect(prStateLabel(derived)).toBe('Open');
  });
});

describe('checksText', () => {
  it('shows counts and links to the checks page when check-runs is valid', () => {
    const result = checksText(
      checkRunsResponse({ summary: { total: 5, passed: 4, failed: 1, running: 0, skipped: 0, pending: 0, cancelled: 0 } }),
      derivedPr({ url: 'https://example.com/pr/9' }),
    );
    expect(result).toEqual({ text: '4 passed · 1 failed · 0 running', href: 'https://example.com/pr/9/checks' });
  });

  it('falls back to the check-runs pr url when derivedPr is absent', () => {
    const result = checksText(
      checkRunsResponse({
        pr: { number: 9, url: 'https://example.com/pr/9', headRefName: 'x', headRefOid: 'a', mergeable: null, statusCheckRollup: [] },
        summary: { total: 1, passed: 1, failed: 0, running: 0, skipped: 0, pending: 0, cancelled: 0 },
      }),
      undefined,
    );
    expect(result.href).toBe('https://example.com/pr/9/checks');
  });

  it('shows "No checks reported" when total is 0', () => {
    expect(checksText(checkRunsResponse({}), derivedPr({}))).toEqual({ text: 'No checks reported', href: null });
  });

  it.each([
    ['green', 'Checks passed'],
    ['red', 'Checks failed'],
    ['pending', 'Checks running'],
  ] as const)('falls back to derivedPr.checks %s -> %s when check-runs is null', (checks, text) => {
    expect(checksText(null, derivedPr({ checks }))).toEqual({ text, href: null });
  });

  it('shows "Checks not available" with neither source', () => {
    expect(checksText(null, undefined)).toEqual({ text: 'Checks not available', href: null });
  });
});

describe('shouldCollapseDescription', () => {
  it('stays expanded at 4 lines and 280 characters', () => {
    expect(shouldCollapseDescription('a\nb\nc\nd')).toBe(false);
    expect(shouldCollapseDescription('x'.repeat(280))).toBe(false);
  });

  it('collapses at 5 lines or 281 characters', () => {
    expect(shouldCollapseDescription('a\nb\nc\nd\ne')).toBe(true);
    expect(shouldCollapseDescription('x'.repeat(281))).toBe(true);
  });
});
