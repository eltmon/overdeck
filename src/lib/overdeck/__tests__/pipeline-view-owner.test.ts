import { describe, expect, it } from 'vitest';
import { deriveInFlightOwner, describeOwner } from '../pipeline-view.js';
import type { ReviewStatus } from '../../review-status-reconcile.js';

const UPDATED = '2026-09-18T08:00:00.000Z';

function status(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-3842',
    reviewStatus: 'pending',
    testStatus: 'pending',
    readyForMerge: false,
    updatedAt: UPDATED,
    ...overrides,
  } as ReviewStatus;
}

describe('deriveInFlightOwner', () => {
  it('reports no owner for an untouched pending issue', () => {
    expect(deriveInFlightOwner(status())).toBeNull();
  });

  it('reports no owner for a missing status', () => {
    expect(deriveInFlightOwner(null)).toBeNull();
    expect(deriveInFlightOwner(undefined)).toBeNull();
  });

  it('reports no owner once the issue is merged or retired', () => {
    expect(deriveInFlightOwner(status({ mergeStatus: 'merged', reviewStatus: 'reviewing' }))).toBeNull();
    expect(deriveInFlightOwner(status({ retiredAt: UPDATED, reviewStatus: 'reviewing' }))).toBeNull();
  });

  it('gives a claimed merge precedence over an in-flight review', () => {
    const owner = deriveInFlightOwner(status({ mergeStatus: 'merging', reviewStatus: 'reviewing' }));
    expect(owner).toEqual({ actor: 'merge', since: UPDATED, transition: 'merge merging' });
  });

  it.each(['queued', 'merging', 'verifying'] as const)('owns a %s merge', (mergeStatus) => {
    expect(deriveInFlightOwner(status({ mergeStatus }))?.actor).toBe('merge');
  });

  it.each(['landing', 'recovering', 'needs_you'] as const)('owns a strike that is %s', (state) => {
    expect(deriveInFlightOwner(status({ strikeLandingState: state }))?.actor).toBe('strike');
  });

  it.each(['ready', 'landed'] as const)('leaves a %s strike unowned', (state) => {
    expect(deriveInFlightOwner(status({ strikeLandingState: state }))).toBeNull();
  });

  it('owns a running verification, uat, test and review', () => {
    expect(deriveInFlightOwner(status({ verificationStatus: 'running' }))?.actor).toBe('verification');
    expect(deriveInFlightOwner(status({ uatStatus: 'testing' }))?.actor).toBe('uat');
    expect(deriveInFlightOwner(status({ testStatus: 'testing' }))?.actor).toBe('test');
    expect(deriveInFlightOwner(status({ reviewStatus: 'reviewing' }))?.actor).toBe('review');
  });

  it('dates a running review from its spawn timestamp', () => {
    const spawned = '2026-09-18T07:55:00.000Z';
    expect(deriveInFlightOwner(status({ reviewStatus: 'reviewing', reviewSpawnedAt: spawned })))
      .toEqual({ actor: 'review', since: spawned, transition: 'review convoy running' });
  });

  it('owns a dispatched convoy that has not reported a verdict', () => {
    const spawned = '2026-09-18T07:55:00.000Z';
    expect(deriveInFlightOwner(status({ reviewSpawnedAt: spawned }))).toEqual({
      actor: 'review',
      since: spawned,
      transition: 'review convoy dispatched',
    });
  });

  it('releases the convoy once a terminal verdict lands', () => {
    const spawned = '2026-09-18T07:55:00.000Z';
    expect(deriveInFlightOwner(status({ reviewSpawnedAt: spawned, reviewStatus: 'passed', readyForMerge: true })))
      .toBeNull();
  });

  it('owns dispatched conflict resolution while review is non-terminal', () => {
    const dispatched = '2026-09-18T07:50:00.000Z';
    expect(deriveInFlightOwner(status({ conflictResolutionDispatchedAt: dispatched }))).toEqual({
      actor: 'conflict-resolution',
      since: dispatched,
      transition: 'conflict resolution dispatched',
    });
  });

  // PAN-3842: the row that made checkOrphanedCompletions fire nine times.
  it('gives a stale passed review to the work agent (PAN-3842)', () => {
    const staleSince = '2026-09-18T07:30:12.785Z';
    expect(deriveInFlightOwner(status({
      reviewStatus: 'passed',
      testStatus: 'passed',
      reviewStaleSince: staleSince,
      reviewedAtCommit: 'ff31b427',
      readyForMerge: false,
    }))).toEqual({
      actor: 'work',
      since: staleSince,
      transition: 'rework after post-review commits (review stale)',
    });
  });

  it.each([
    ['review', { reviewStatus: 'failed' as const }],
    ['test', { testStatus: 'failed' as const }],
    ['verification', { verificationStatus: 'failed' as const }],
    ['uat', { uatStatus: 'failed' as const }],
  ])('gives a failed %s verdict to the work agent', (gate, overrides) => {
    expect(deriveInFlightOwner(status(overrides))).toEqual({
      actor: 'work',
      since: UPDATED,
      transition: `rework after ${gate} failed`,
    });
  });

  it('owns an unserviced pan done review request', () => {
    const requested = '2026-09-18T07:59:00.000Z';
    expect(deriveInFlightOwner(status({ reviewRequestedAt: requested }))).toEqual({
      actor: 'work',
      since: requested,
      transition: 'review requested by pan done, dispatch pending',
    });
  });

  it('releases the request once a newer convoy spawned for it', () => {
    expect(deriveInFlightOwner(status({
      reviewRequestedAt: '2026-09-18T07:00:00.000Z',
      reviewSpawnedAt: '2026-09-18T07:30:00.000Z',
      reviewStatus: 'passed',
      readyForMerge: true,
    }))).toBeNull();
  });

  it('describes an owner as a single skip line', () => {
    const owner = deriveInFlightOwner(status({ reviewStatus: 'reviewing' }))!;
    expect(describeOwner('PAN-3842', owner)).toBe(
      `PAN-3842 is owned by review since ${UPDATED} (review convoy running)`,
    );
  });
});
