import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// The default reviewer-busy check reads the reviewer's state and liveness.
const reviewer = vi.hoisted(() => ({ runId: undefined as string | undefined, alive: true }));
vi.mock('../../../../lib/agents/agent-state-read.js', () => ({
  getAgentState: () => (reviewer.runId ? { reviewRunId: reviewer.runId } : null),
}));
vi.mock('../../../../lib/agents/liveness.js', () => ({ isAlive: async () => ({ alive: reviewer.alive }) }));

import type { PipelineJournalEntry } from '../../../../lib/cloister/pipeline-journal.js';
import type { PrFacts } from '../../../../lib/cloister/pr-facts.js';
import type { GhPrRow } from '../../../../lib/overdeck/pr-listing.js';
import {
  dispatchStrikeReviews,
  runStrikeReviewTick,
  startStrikeReview,
  STRIKE_REVIEW_RETRY_MS,
  STRIKE_REVIEW_STALL_MS,
  STRIKE_REVIEWS_PER_TICK,
  strikeReviewRequestAnswer,
  type StrikeReviewDeps,
} from '../strike-review.js';

const WORKSPACE = '/repos/overdeck/workspaces/feature-pan-9-strike';
const HEAD = 'a1b2c3d4e5f60718293a4b5c6d7e8f9012345678';

function prFacts(overrides: Partial<PrFacts> = {}): PrFacts {
  return {
    issueId: 'PAN-9', forge: 'github', url: 'https://github.com/eltmon/overdeck/pull/9', number: 9,
    exists: true, open: true, merged: false, closed: false, draft: false, headSha: HEAD, headBranch: 'strike/pan-9',
    reviewDecision: null, approved: false, changesRequested: false, mergeable: true, mergeableState: 'clean',
    checks: 'green', testChecks: 'green', testJobSucceeded: true, uatVerdict: null,
    ...overrides,
  } as PrFacts;
}

/** A strike-only issue whose journal lives in memory. */
function world(options: Omit<Partial<StrikeReviewDeps>, 'facts'> & { facts?: PrFacts; head?: string | null } = {}) {
  const { facts, head, ...overrides } = options;
  const journal: PipelineJournalEntry[] = [];
  const dispatch = vi.fn(async () => ({ success: true, message: 'dispatched' }));
  const deps: StrikeReviewDeps = {
    target: () => ({ kind: 'strike', workspacePath: WORKSPACE, branch: 'strike/pan-9' }),
    facts: async () => facts ?? prFacts(),
    workspaceHead: async () => (head !== undefined ? head : HEAD),
    journal: () => journal,
    append: (_path, entry) => { journal.push({ at: new Date().toISOString(), ...entry }); },
    reviewerBusy: async () => false,
    dispatch,
    ...overrides,
  };
  return { deps, journal, dispatch };
}

describe('startStrikeReview (PAN-4753 WI-5)', () => {
  it('dispatches one quick review per head with the strike workspace and branch', async () => {
    const { deps, journal, dispatch } = world();
    await expect(startStrikeReview('pan-9', {}, deps)).resolves.toEqual({ started: true, headSha: HEAD });
    expect(dispatch).toHaveBeenCalledWith({
      issueId: 'PAN-9', workspace: WORKSPACE, branch: 'strike/pan-9', prUrl: 'https://github.com/eltmon/overdeck/pull/9',
    });
    expect(journal[0]).toMatchObject({ type: 'review.requested', source: 'strike-review', data: { headSha: HEAD, kind: 'strike' } });

    await expect(startStrikeReview('PAN-9', {}, deps)).resolves.toEqual({ started: false, reason: 'already-reviewed-at-head' });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('dispatches again for a new head', async () => {
    const { deps, journal, dispatch } = world();
    await startStrikeReview('PAN-9', {}, deps);
    const next = 'ffff000011112222333344445555666677778888';
    const moved = { ...deps, facts: async () => prFacts({ headSha: next }), workspaceHead: async () => next };
    await expect(startStrikeReview('PAN-9', {}, moved)).resolves.toEqual({ started: true, headSha: next });
    expect(dispatch).toHaveBeenCalledTimes(2);
    expect(journal.filter((entry) => entry.type === 'review.requested')).toHaveLength(2);
  });

  it('retries a failed dispatch at this head after the backoff, not on every tick', async () => {
    let clock = Date.now();
    const { deps, journal, dispatch } = world({ now: () => clock });
    dispatch.mockResolvedValueOnce({ success: false, message: 'Review dispatch deferred: merge conflict' });
    await expect(startStrikeReview('PAN-9', {}, deps)).resolves.toMatchObject({ started: false, reason: 'dispatch-failed' });
    expect(journal.map((entry) => entry.type)).toEqual(['review.dispatch-failed']);
    await expect(startStrikeReview('PAN-9', {}, deps)).resolves.toEqual({ started: false, reason: 'retry-later' });
    expect(dispatch).toHaveBeenCalledTimes(1);
    clock += STRIKE_REVIEW_RETRY_MS + 1;
    await expect(startStrikeReview('PAN-9', {}, deps)).resolves.toEqual({ started: true, headSha: HEAD });
  });

  it('asks again after the stall window when the reviewer of this head is gone', async () => {
    let clock = Date.now();
    let busy = true;
    const { deps, dispatch } = world({ now: () => clock, reviewerBusy: async () => busy });
    deps.reviewerBusy = async () => false;
    await startStrikeReview('PAN-9', {}, deps);
    deps.reviewerBusy = async () => busy;
    clock += STRIKE_REVIEW_STALL_MS + 1;
    await expect(startStrikeReview('PAN-9', {}, deps)).resolves.toEqual({ started: false, reason: 'review-in-flight' });
    busy = false;
    await expect(startStrikeReview('PAN-9', {}, deps)).resolves.toEqual({ started: true, headSha: HEAD });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('answers from the journal at the listed head without reading the forge', async () => {
    const facts = vi.fn(async () => prFacts());
    const { deps, journal } = world();
    deps.facts = facts;
    journal.push({ at: new Date().toISOString(), type: 'review.verdict', issueId: 'PAN-9', data: { verdict: 'APPROVED', headSha: HEAD.slice(0, 8) } });
    await expect(startStrikeReview('PAN-9', { listedHead: HEAD }, deps)).resolves.toEqual({ started: false, reason: 'already-reviewed-at-head' });
    expect(facts).not.toHaveBeenCalled();
  });

  it('treats a verdict journaled at this head as reviewed', async () => {
    const { deps, journal, dispatch } = world();
    journal.push({ at: '2026-11-14T00:00:00Z', type: 'review.verdict', issueId: 'PAN-9', data: { verdict: 'CHANGES_REQUESTED', headSha: HEAD.slice(0, 8) } });
    await expect(startStrikeReview('PAN-9', {}, deps)).resolves.toEqual({ started: false, reason: 'already-reviewed-at-head' });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it.each([
    ['not a strike', { target: () => ({ kind: 'feature' as const, workspacePath: '/w', branch: 'feature/pan-9' }) }, 'not-strike'],
    ['no open PR', { facts: prFacts({ exists: false, open: false, headSha: null }) }, 'no-pr'],
    ['a draft', { facts: prFacts({ draft: true }) }, 'draft'],
    ['checks pending', { facts: prFacts({ checks: 'pending' }) }, 'checks-not-green'],
    ['a workspace at another commit', { head: 'deadbeefdeadbeefdeadbeefdeadbeefdeadbeef' }, 'workspace-head-mismatch'],
    ['an approval proven at head', { facts: prFacts({ approved: true, approvedAtHead: true }) }, 'already-reviewed-at-head'],
    ['a live reviewer on this head', { reviewerBusy: async () => true }, 'review-in-flight'],
    ['a feature PR the strike lookup fell back to', { facts: prFacts({ headBranch: 'feature/pan-9' }) }, 'no-pr'],
  ])('skips %s', async (_label, overrides, reason) => {
    const { deps, dispatch } = world(overrides as Parameters<typeof world>[0]);
    await expect(startStrikeReview('PAN-9', {}, deps)).resolves.toMatchObject({ started: false, reason });
    expect(dispatch).not.toHaveBeenCalled();
  });

  it('force dispatches over an earlier review at the same head and a live reviewer', async () => {
    const { deps, dispatch } = world({ reviewerBusy: async () => true });
    deps.journal = () => [{ at: '2026-11-14T00:00:00Z', type: 'review.requested', issueId: 'PAN-9', data: { headSha: HEAD } }];
    await expect(startStrikeReview('PAN-9', { force: true }, deps)).resolves.toEqual({ started: true, headSha: HEAD });
    expect(dispatch).toHaveBeenCalledTimes(1);
    // The operator asked, so the verdict may block an approved head.
    expect(dispatch.mock.calls[0]![0]).toMatchObject({ operatorRequested: true });
  });

  it('marks a non-forced dispatch as not operator-requested', async () => {
    const { deps, dispatch } = world();
    await startStrikeReview('PAN-9', {}, deps);
    expect(dispatch.mock.calls[0]![0]).not.toHaveProperty('operatorRequested');
  });

  it('journals nothing for a dispatch that never answers, so a later call retries', async () => {
    const { deps, journal, dispatch } = world();
    dispatch.mockImplementationOnce(() => new Promise(() => {}));
    void startStrikeReview('PAN-9', {}, deps);
    await vi.waitFor(() => expect(dispatch).toHaveBeenCalledTimes(1));
    expect(journal).toEqual([]);
    await expect(startStrikeReview('PAN-9', {}, deps)).resolves.toEqual({ started: true, headSha: HEAD });
    expect(dispatch).toHaveBeenCalledTimes(2);
  });

  it('never dispatches from a pass the tick abandoned', async () => {
    const { deps, journal, dispatch } = world();
    await expect(startStrikeReview('PAN-9', { isCurrent: () => false }, deps)).resolves.toEqual({ started: false, reason: 'pass-abandoned' });
    expect(dispatch).not.toHaveBeenCalled();
    expect(journal).toEqual([]);
  });
});

describe('the default reviewer-busy check', () => {
  afterEach(() => { reviewer.runId = undefined; reviewer.alive = true; });

  it('holds only a live reviewer whose run is for this head', async () => {
    const { deps, dispatch } = world();
    delete deps.reviewerBusy;
    reviewer.runId = `agent-pan-9-review-${HEAD.slice(0, 8)}`;
    await expect(startStrikeReview('PAN-9', {}, deps)).resolves.toEqual({ started: false, reason: 'review-in-flight' });
    reviewer.alive = false;
    await expect(startStrikeReview('PAN-9', {}, deps)).resolves.toEqual({ started: true, headSha: HEAD });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });

  it('replaces a warm reviewer left from an older head', async () => {
    const { deps, dispatch } = world();
    delete deps.reviewerBusy;
    reviewer.runId = 'agent-pan-9-review-0ld0ld00';
    await expect(startStrikeReview('PAN-9', {}, deps)).resolves.toEqual({ started: true, headSha: HEAD });
    expect(dispatch).toHaveBeenCalledTimes(1);
  });
});

describe('strikeReviewRequestAnswer (FR-10)', () => {
  it('answers null for an issue whose review target is not a strike', async () => {
    const { deps } = world({ target: () => null });
    await expect(strikeReviewRequestAnswer('PAN-9', {}, deps)).resolves.toBeNull();
  });

  it('maps the outcome to a status', async () => {
    const { deps } = world();
    await expect(strikeReviewRequestAnswer('PAN-9', {}, deps)).resolves.toMatchObject({ status: 202, body: { success: true } });
    await expect(strikeReviewRequestAnswer('PAN-9', {}, deps)).resolves.toMatchObject({ status: 200, body: { success: true } });
    await expect(strikeReviewRequestAnswer('PAN-9', {}, world({ facts: prFacts({ exists: false, open: false, headSha: null }) }).deps))
      .resolves.toMatchObject({ status: 404 });
    await expect(strikeReviewRequestAnswer('PAN-9', {}, world({ facts: prFacts({ checks: 'red' }) }).deps))
      .resolves.toMatchObject({ status: 409 });
    const failing = world();
    failing.dispatch.mockResolvedValueOnce({ success: false, message: 'spawn failed' });
    await expect(strikeReviewRequestAnswer('PAN-9', {}, failing.deps)).resolves.toMatchObject({ status: 500 });
  });
});

function strikeRow(number: number, overrides: Partial<GhPrRow> = {}): GhPrRow {
  return {
    number, state: 'OPEN', headRefName: `strike/pan-${number}`, isDraft: false,
    statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'SUCCESS' }],
    ...overrides,
  };
}

describe('dispatchStrikeReviews', () => {
  const project = { key: 'overdeck', config: { name: 'Overdeck', path: '/repos/overdeck' } };

  it('passes the listed head, and skips a conflicting strike PR', async () => {
    const start = vi.fn(async () => ({ started: false as const, reason: 'already-reviewed-at-head' as const }));
    await dispatchStrikeReviews({
      listProjects: () => [project], forgeOf: () => 'github', start, env: {}, log: () => {},
      listPullRequests: async () => [strikeRow(1, { headRefOid: 'abc' }), strikeRow(2, { mergeable: 'CONFLICTING' })],
    });
    expect(start.mock.calls).toEqual([['PAN-1', 'abc']]);
  });

  it('starts at most STRIKE_REVIEWS_PER_TICK reviews, oldest PR first, skipping drafts, red checks and feature PRs', async () => {
    const start = vi.fn(async (issueId: string) => ({ started: true as const, headSha: `${issueId}-head` }));
    const rows = [
      strikeRow(30), strikeRow(10), strikeRow(20),
      strikeRow(5, { isDraft: true }),
      strikeRow(6, { statusCheckRollup: [{ status: 'COMPLETED', conclusion: 'FAILURE' }] }),
      strikeRow(7, { headRefName: 'feature/pan-7' }),
    ];
    await dispatchStrikeReviews({
      listProjects: () => [project], forgeOf: () => 'github', listPullRequests: async () => rows, start, env: {}, log: () => {},
    });
    expect(STRIKE_REVIEWS_PER_TICK).toBe(2);
    expect(start.mock.calls.map(([id]) => id)).toEqual(['PAN-10', 'PAN-20']);
  });

  it('skips GitLab projects and honors the auto-merge kill switch', async () => {
    const start = vi.fn();
    const listPullRequests = vi.fn(async () => [strikeRow(1)]);
    await dispatchStrikeReviews({ listProjects: () => [project], forgeOf: () => 'gitlab', listPullRequests, start, env: {}, log: () => {} });
    await dispatchStrikeReviews({ listProjects: () => [project], forgeOf: () => 'github', listPullRequests, start, env: { OVERDECK_DISABLE_AUTO_MERGE: '1' }, log: () => {} });
    expect(listPullRequests).not.toHaveBeenCalled();
    expect(start).not.toHaveBeenCalled();
  });

  it('keeps going when one issue throws', async () => {
    const start = vi.fn(async (issueId: string) => {
      if (issueId === 'PAN-1') throw new Error('boom');
      return { started: true as const, headSha: 'h' };
    });
    await dispatchStrikeReviews({
      listProjects: () => [project], forgeOf: () => 'github', listPullRequests: async () => [strikeRow(1), strikeRow(2)], start, env: {}, log: () => {},
    });
    expect(start).toHaveBeenCalledTimes(2);
  });
});

describe('runStrikeReviewTick', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('is single-flight, and abandons a pass that outlives the timeout', async () => {
    let release!: () => void;
    const listPullRequests = vi.fn(() => new Promise<readonly GhPrRow[]>((resolve) => { release = () => resolve([]); }));
    const deps = {
      listProjects: () => [{ key: 'overdeck', config: { name: 'Overdeck', path: '/repos/overdeck' } }],
      forgeOf: () => 'github' as const, listPullRequests, env: {}, log: () => {},
    };
    const first = runStrikeReviewTick(deps, 1_000);
    const second = runStrikeReviewTick(deps, 1_000);
    expect(second).toBe(first);
    await vi.advanceTimersByTimeAsync(0);
    expect(listPullRequests).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(1_000);
    await first;
    const third = runStrikeReviewTick(deps, 1_000);
    expect(third).not.toBe(first);
    release();
    await vi.advanceTimersByTimeAsync(1_000);
    await third;
  });
});
