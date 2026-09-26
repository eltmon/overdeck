/**
 * deacon-lite's seventh recovery routine (PAN-4221).
 *
 * A dashboard restart while a detached verification worker runs kills the
 * push-and-dispatch continuation, leaving `verification.passed` as the
 * journal's permanent tail. These cases pin down the nine conditions that
 * gate re-requesting the review through the guarded route, and the age /
 * cooldown / attempt-cap constants that stop it from thrashing.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  liveAgentInventory: vi.fn(),
  listWorkspaces: vi.fn(),
  getIssuePause: vi.fn(),
  isVerificationWorkerActive: vi.fn(),
  readPrimaryHead8: vi.fn(),
  resolveReviewMode: vi.fn(),
  requestReviewThroughRoute: vi.fn(),
  notifyPipeline: vi.fn(),
  emitActivityEntry: vi.fn(),
}));

vi.mock('../../terminal-backends/inventory.js', () => ({ liveAgentInventory: mocks.liveAgentInventory }));
vi.mock('../../workspaces/resolver.js', () => ({ listWorkspaces: mocks.listWorkspaces }));
vi.mock('../../agents/agent-state.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../agents/agent-state.js')>()),
  getIssuePause: mocks.getIssuePause,
}));
vi.mock('../verification-worker-supervisor.js', () => ({ isVerificationWorkerActive: mocks.isVerificationWorkerActive }));
vi.mock('../verified-head.js', () => ({ readPrimaryHead8: mocks.readPrimaryHead8 }));
vi.mock('../review-agent.js', () => ({ resolveReviewMode: mocks.resolveReviewMode }));
vi.mock('../review-request-route.js', () => ({ requestReviewThroughRoute: mocks.requestReviewThroughRoute }));
vi.mock('../../pipeline-notifier.js', () => ({ notifyPipeline: mocks.notifyPipeline }));
vi.mock('../../activity-logger.js', () => ({ emitActivityEntry: mocks.emitActivityEntry }));

const { appendPipelineEntry } = await import('../pipeline-journal.js');
const {
  recoverUndispatchedReviews,
  __resetUndispatchedReviewStateForTests,
  UNDISPATCHED_REVIEW_ATTEMPT_CAP,
} = await import('../undispatched-review-recovery.js');

const NOW = Date.parse('2026-09-26T12:00:00.000Z');
const MINUTE = 60_000;
const HEAD = 'abc12345';

let workspace: string;

function journal(entries: Array<{ type: string; minutesAgo: number; source?: string; data?: Record<string, unknown> }>): void {
  for (const { type, minutesAgo, source, data } of entries) {
    vi.setSystemTime(NOW - minutesAgo * MINUTE);
    appendPipelineEntry(workspace, { type: type as never, issueId: 'PAN-4221', source, data });
  }
  vi.setSystemTime(NOW);
}

function passedTail(minutesAgo = 10, overrides: { source?: string; head?: string } = {}) {
  journal([{
    type: 'verification.passed',
    minutesAgo,
    source: overrides.source ?? 'request-review',
    data: { head: overrides.head ?? HEAD },
  }]);
}

function oneWorkspace() {
  return [{ id: 'ws1', issueId: 'PAN-4221', path: workspace }];
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.useFakeTimers();
  vi.setSystemTime(NOW);
  __resetUndispatchedReviewStateForTests();
  workspace = mkdtempSync(join(tmpdir(), 'deacon-lite-undispatched-'));
  mocks.liveAgentInventory.mockResolvedValue({ backend: 'herdr', panes: [] });
  mocks.listWorkspaces.mockReturnValue(oneWorkspace());
  mocks.getIssuePause.mockReturnValue({ status: 'unpaused' });
  mocks.isVerificationWorkerActive.mockReturnValue(false);
  mocks.readPrimaryHead8.mockResolvedValue(HEAD);
  mocks.resolveReviewMode.mockReturnValue('quick');
  mocks.requestReviewThroughRoute.mockResolvedValue({ requested: true });
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

afterEach(() => {
  vi.useRealTimers();
  rmSync(workspace, { recursive: true, force: true });
});

describe('recoverUndispatchedReviews', () => {
  it('re-requests review for an aged, undispatched request-review pass exactly once across two ticks a minute apart', async () => {
    passedTail(10);

    const first = await recoverUndispatchedReviews(NOW);
    expect(first).toHaveLength(1);
    expect(mocks.requestReviewThroughRoute).toHaveBeenCalledWith('PAN-4221', {
      message: expect.any(String),
      source: 'deacon-lite',
    });

    const second = await recoverUndispatchedReviews(NOW + MINUTE);
    expect(second).toEqual([]);
    expect(mocks.requestReviewThroughRoute).toHaveBeenCalledTimes(1);
  });

  it('never calls the route for a verification.failed tail', async () => {
    journal([{ type: 'verification.failed', minutesAgo: 10, source: 'request-review', data: { head: HEAD } }]);

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });

  it('never calls the route for a verification.passed tail sourced from merge-verify', async () => {
    passedTail(10, { source: 'merge-verify' });

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });

  it('never calls the route for a verification.passed tail sourced from review', async () => {
    passedTail(10, { source: 'review' });

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });

  it('never calls the route while the agent-<issue>-review parent pane is live', async () => {
    passedTail(10);
    mocks.liveAgentInventory.mockResolvedValue({ backend: 'herdr', panes: [{ agentId: 'agent-pan-4221-review' }] });

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });

  it('never calls the route while a sub-reviewer lane pane is live', async () => {
    passedTail(10);
    mocks.liveAgentInventory.mockResolvedValue({ backend: 'herdr', panes: [{ agentId: 'agent-pan-4221-review-security' }] });

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });

  it('never calls the route while a verification worker is active', async () => {
    passedTail(10);
    mocks.isVerificationWorkerActive.mockReturnValue(true);

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });

  it('never calls the route when the primary head no longer matches the stamped head', async () => {
    passedTail(10);
    mocks.readPrimaryHead8.mockResolvedValue('deadbeef');

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });

  it('never calls the route when data.head is missing', async () => {
    journal([{ type: 'verification.passed', minutesAgo: 10, source: 'request-review', data: {} }]);

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });

  it('never calls the route for a tail younger than 5 minutes', async () => {
    passedTail(3);

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });

  it('never calls the route while the issue is paused', async () => {
    passedTail(10);
    mocks.getIssuePause.mockReturnValue({ status: 'paused', agentId: 'work', pausedAt: NOW });

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });

  it('never calls the route when review mode is none', async () => {
    passedTail(10);
    mocks.resolveReviewMode.mockReturnValue('none');

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });

  it('honours the one-hour cooldown even when the route refuses, then fires again past the hour', async () => {
    passedTail(10);
    mocks.requestReviewThroughRoute.mockResolvedValue({ requested: false, reason: 'declined' });

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).toHaveBeenCalledTimes(1);

    expect(await recoverUndispatchedReviews(NOW + 30 * MINUTE)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).toHaveBeenCalledTimes(1);

    mocks.requestReviewThroughRoute.mockResolvedValue({ requested: true });
    expect(await recoverUndispatchedReviews(NOW + 61 * MINUTE)).toHaveLength(1);
    expect(mocks.requestReviewThroughRoute).toHaveBeenCalledTimes(2);
  });

  it('stops at the attempt cap and warns/emits exactly once across two ticks', async () => {
    const entries: Array<{ type: string; minutesAgo: number; source?: string; data?: Record<string, unknown> }> = [];
    for (let i = UNDISPATCHED_REVIEW_ATTEMPT_CAP; i >= 1; i--) {
      entries.push({ type: 'review.requested', minutesAgo: 20 + i, source: 'deacon-lite' });
    }
    entries.push({ type: 'verification.passed', minutesAgo: 10, source: 'request-review', data: { head: HEAD } });
    journal(entries);

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
    expect(mocks.emitActivityEntry).toHaveBeenCalledTimes(1);

    expect(await recoverUndispatchedReviews(NOW + MINUTE)).toEqual([]);
    expect(mocks.emitActivityEntry).toHaveBeenCalledTimes(1);
  });

  it('resets the attempt count after a review.requested from another source', async () => {
    journal([
      { type: 'review.requested', minutesAgo: 200, source: 'deacon-lite' },
      { type: 'review.requested', minutesAgo: 190, source: 'deacon-lite' },
      { type: 'review.requested', minutesAgo: 180, source: 'deacon-lite' },
      { type: 'review.requested', minutesAgo: 100, source: 'pan-review-request' },
      { type: 'verification.passed', minutesAgo: 10, source: 'request-review', data: { head: HEAD } },
    ]);

    expect(await recoverUndispatchedReviews(NOW)).toHaveLength(1);
    expect(mocks.requestReviewThroughRoute).toHaveBeenCalledTimes(1);
  });

  it('returns no action when the agent inventory is unreadable', async () => {
    passedTail(10);
    mocks.liveAgentInventory.mockResolvedValue(null);

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });

  it('leaves a fresh review.requested tail alone', async () => {
    journal([{ type: 'review.requested', minutesAgo: 10, source: 'request-review' }]);

    expect(await recoverUndispatchedReviews(NOW)).toEqual([]);
    expect(mocks.requestReviewThroughRoute).not.toHaveBeenCalled();
  });
});
