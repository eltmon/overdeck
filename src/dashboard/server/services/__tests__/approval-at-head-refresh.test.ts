/**
 * PAN-4597: the approval refresher keeps an approved, green, mergeable PR
 * `ready` past the merge gate answer's TTL, without a forge read on the
 * request path and without re-asking the gate every tick.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GATE_ANSWER_REFRESH_AFTER_MS,
  GATE_ANSWER_TTL_MS,
  cachedApprovalAtHead,
  recordApprovalAtHead,
  resetApprovalAtHeadCache,
} from '../../../../lib/cloister/approval-at-head.js';
import { loadIssueStatesForProject, prFromGhRow, type GhPrRow, type LoadedPr } from '../../../../lib/overdeck/derived-issue-state.js';
import { resetApprovalAtHeadRefresh, runApprovalAtHeadRefreshTick } from '../approval-at-head-refresh.js';

const PROJECT = '/nonexistent/pan-4597-project';
const HEAD = 'fe54b029'.padEnd(40, '0');

function row(overrides: Partial<GhPrRow> = {}): GhPrRow {
  return {
    number: 4587,
    url: 'https://github.com/eltmon/overdeck/pull/4587',
    state: 'OPEN',
    mergeable: 'MERGEABLE',
    reviewDecision: 'APPROVED',
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    headRefName: 'feature/pan-4583',
    headRefOid: HEAD,
    isDraft: false,
    ...overrides,
  };
}

function openPrs(rows: GhPrRow[]): Array<{ issueId: string; pr: LoadedPr }> {
  return rows.map((r) => ({ issueId: r.headRefName!.replace('feature/', '').toUpperCase(), pr: prFromGhRow(r)! }));
}

/** A gate that approves at the head, recording its answer as the real gate does. */
function approvingGate(head = HEAD) {
  return vi.fn(async (issueId: string) => {
    recordApprovalAtHead({
      issueId, headSha: head, open: true, draft: false, exists: true,
      forge: 'github', approved: true, approvedAtHead: true, changesRequested: false,
    });
  });
}

async function derivedState(rows: GhPrRow[]): Promise<string | undefined> {
  const states = await loadIssueStatesForProject(PROJECT, ['PAN-4583'], {
    listPullRequests: async () => rows,
    panes: [],
    readWorkStart: () => null,
  });
  return states.get('PAN-4583')?.state;
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-24T08:20:00.000Z'));
  resetApprovalAtHeadCache();
  resetApprovalAtHeadRefresh();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('approval-at-head refresher (PAN-4597)', () => {
  it('without a refresh, the gate answer expires and the PR decays to in-review (the bug)', async () => {
    const rows = [row()];
    await approvingGate()('PAN-4583');
    expect(await derivedState(rows)).toBe('ready');

    vi.advanceTimersByTime(GATE_ANSWER_TTL_MS + 1_000);
    expect(await derivedState(rows)).toBe('in-review');
  });

  it('keeps the PR ready past GATE_ANSWER_TTL_MS when the tick runs', async () => {
    const rows = [row()];
    const evaluateGate = approvingGate();
    const deps = { listProjectPaths: () => [PROJECT], listOpenPullRequests: async () => openPrs(rows), evaluateGate };

    // First tick: no answer yet, so the gate runs and the PR derives ready.
    expect(await runApprovalAtHeadRefreshTick(deps)).toEqual(['PAN-4583']);
    expect(await derivedState(rows)).toBe('ready');

    // Ticks every minute, as the reconciler runs them.
    for (let minute = 1; minute <= 12; minute += 1) {
      vi.advanceTimersByTime(60_000);
      await runApprovalAtHeadRefreshTick(deps);
      expect(await derivedState(rows), `minute ${minute}`).toBe('ready');
    }
    // Past the first answer's TTL, refreshed roughly once per refresh window.
    expect(12 * 60_000).toBeGreaterThan(GATE_ANSWER_TTL_MS);
    expect(evaluateGate.mock.calls.length).toBeLessThanOrEqual(1 + Math.ceil((12 * 60_000) / GATE_ANSWER_REFRESH_AFTER_MS));
    expect(evaluateGate.mock.calls.length).toBeGreaterThan(1);
  });

  it('asks the gate once per head inside the refresh window, and at once for a new head', async () => {
    let rows = [row()];
    const evaluateGate = approvingGate();
    const deps = { listProjectPaths: () => [PROJECT], listOpenPullRequests: async () => openPrs(rows), evaluateGate };

    await runApprovalAtHeadRefreshTick(deps);
    vi.advanceTimersByTime(60_000);
    expect(await runApprovalAtHeadRefreshTick(deps)).toEqual([]);
    expect(evaluateGate).toHaveBeenCalledTimes(1);

    // A push moves the head: the old answer no longer applies, so the gate runs now.
    const newHead = 'abc12345'.padEnd(40, '0');
    rows = [row({ headRefOid: newHead })];
    evaluateGate.mockImplementation(approvingGate(newHead));
    expect(await runApprovalAtHeadRefreshTick(deps)).toEqual(['PAN-4583']);
    expect(cachedApprovalAtHead('PAN-4583', newHead)).toBe(true);
  });

  it('does not re-ask every tick when the gate records nothing (a failing read)', async () => {
    const rows = [row()];
    const evaluateGate = vi.fn(async () => undefined);
    const deps = { listProjectPaths: () => [PROJECT], listOpenPullRequests: async () => openPrs(rows), evaluateGate };

    await runApprovalAtHeadRefreshTick(deps);
    vi.advanceTimersByTime(60_000);
    await runApprovalAtHeadRefreshTick(deps);
    expect(evaluateGate).toHaveBeenCalledTimes(1);
    vi.advanceTimersByTime(GATE_ANSWER_REFRESH_AFTER_MS);
    await runApprovalAtHeadRefreshTick(deps);
    expect(evaluateGate).toHaveBeenCalledTimes(2);
  });

  it('only PRs the forge reports approved, green and mergeable are candidates', async () => {
    const rows = [
      row({ headRefName: 'feature/pan-1', reviewDecision: 'REVIEW_REQUIRED' }),
      row({ headRefName: 'feature/pan-2', statusCheckRollup: [{ status: 'IN_PROGRESS', conclusion: null }] }),
      row({ headRefName: 'feature/pan-3', mergeable: 'CONFLICTING' }),
      row({ headRefName: 'feature/pan-4', reviewDecision: 'CHANGES_REQUESTED' }),
      row({ headRefName: 'feature/pan-5' }),
    ];
    const evaluateGate = vi.fn(async () => undefined);
    const refreshed = await runApprovalAtHeadRefreshTick({
      listProjectPaths: () => [PROJECT], listOpenPullRequests: async () => openPrs(rows), evaluateGate,
    });
    expect(refreshed).toEqual(['PAN-5']);
  });

  it('a failed listing or gate is logged and the pass continues', async () => {
    const log = vi.fn();
    const evaluateGate = vi.fn(async (issueId: string) => {
      if (issueId === 'PAN-1') throw new Error('gh exploded');
    });
    const refreshed = await runApprovalAtHeadRefreshTick({
      listProjectPaths: () => ['/broken', PROJECT],
      listOpenPullRequests: async (path) => {
        if (path === '/broken') throw new Error('listing failed');
        return openPrs([row({ headRefName: 'feature/pan-1' }), row({ headRefName: 'feature/pan-2' })]);
      },
      evaluateGate,
      log,
    });
    expect(refreshed).toEqual(['PAN-2']);
    expect(log.mock.calls.map(([m]) => m).join('\n')).toMatch(/listing for \/broken failed[\s\S]*gate for PAN-1 failed/);
  });
});
