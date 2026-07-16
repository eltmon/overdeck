import { describe, expect, it, vi } from 'vitest';

import { activeStrikeMerge, mergeCompletionStatus, normalMergeEligibility, validateStrikeMergeRequest, type StrikeMergeRequest } from '../../../../../src/dashboard/server/routes/workspaces/merge-strike.js';
import type { ReviewStatus } from '../../../../../src/lib/review-status.js';

const markerHead = 'a'.repeat(40);
const projectPath = '/repo';
const workspacePath = '/repo/workspaces/feature-pan-2702-strike';
const request: StrikeMergeRequest = {
  kind: 'strike', markerHead, workspacePath,
  branchName: 'strike/pan-2702', recoveryTarget: 'strike-pan-2702',
};

function status(overrides: Partial<ReviewStatus> = {}): ReviewStatus {
  return {
    issueId: 'PAN-2702', reviewStatus: 'pending', testStatus: 'pending', readyForMerge: false,
    updatedAt: '2026-07-16T00:00:00.000Z', strikeLandingState: 'ready', strikeReadyHead: markerHead,
    ...overrides,
  };
}

function git(remoteHead = markerHead) {
  return vi.fn(async (args: string[]) => {
    const command = args.join(' ');
    if (command === 'rev-parse --show-toplevel') return workspacePath;
    if (command === 'branch --show-current') return 'strike/pan-2702';
    if (command === 'fetch origin strike/pan-2702') return '';
    if (command === 'rev-parse origin/strike/pan-2702') return remoteHead;
    throw new Error(`unexpected git command: ${command}`);
  });
}

describe('strike merge-door eligibility', () => {
  it('clears a queued strike marker at canonical merge completion', () => {
    expect(mergeCompletionStatus(request)).toEqual({ strikeLandingState: 'landed', strikeReadyHead: undefined, strikeReadyAt: undefined });
    expect(mergeCompletionStatus({ kind: 'normal' })).toEqual({});
  });

  it('rejects duplicate active strike pipelines at the merge door', () => {
    expect(activeStrikeMerge('PAN-2702')).toBe(true);
    expect(activeStrikeMerge(null, { type: 'merge', status: 'running' })).toBe(true);
    expect(activeStrikeMerge(null, { type: 'merge', status: 'completed' })).toBe(false);
  });
  it('accepts the authenticated durable marker without normal review/test readiness', async () => {
    await expect(validateStrikeMergeRequest('PAN-2702', request, status(), { projectPath, git: git() })).resolves.toBeNull();
  });

  it('rejects a stale marker before merge work starts and names both HEADs', async () => {
    const newHead = 'b'.repeat(40);
    const result = await validateStrikeMergeRequest('PAN-2702', request, status(), { projectPath, git: git(newHead) });
    expect(result).toContain(markerHead);
    expect(result).toContain(newHead);
  });

  it.each([
    ['wrong workspace', { ...request, workspacePath: '/repo/workspaces/feature-pan-2702' }],
    ['wrong branch', { ...request, branchName: 'feature/pan-2702' }],
    ['wrong recovery target', { ...request, recoveryTarget: 'agent-pan-2702' }],
  ])('rejects %s identity', async (_label, invalidRequest) => {
    await expect(validateStrikeMergeRequest('PAN-2702', invalidRequest as StrikeMergeRequest, status(), { projectPath, git: git() })).resolves.toMatch(/identity/);
  });

  it('rejects non-ready durable landing state', async () => {
    await expect(validateStrikeMergeRequest('PAN-2702', request, status({ strikeLandingState: 'needs_you' }), { projectPath, git: git() })).resolves.toMatch(/landing state/);
  });
});

describe('normal merge-door no-loss matrix', () => {
  it.each([
    ['missing status', null, false, 'Cannot merge: review and tests have not passed yet'],
    ['review pending', status({ readyForMerge: false, reviewStatus: 'pending' }), false, 'Cannot merge: review and tests have not passed yet'],
    ['test pending', status({ readyForMerge: false, reviewStatus: 'passed', testStatus: 'pending' }), false, 'Cannot merge: review and tests have not passed yet'],
    ['active merge', status({ readyForMerge: true, mergeStatus: 'merging' }), true, 'Merge already in progress'],
    ['already merged', status({ readyForMerge: true, mergeStatus: 'merged' }), false, 'Already merged'],
  ])('preserves %s rejection', (_label, reviewStatus, activelyMerging, error) => {
    expect(normalMergeEligibility(reviewStatus, activelyMerging)).toMatchObject({ success: false, statusCode: 400, error });
  });

  it.each([
    ['ready', status({ readyForMerge: true })],
    ['queued', status({ readyForMerge: true, mergeStatus: 'queued' })],
    ['stale merging', status({ readyForMerge: true, mergeStatus: 'merging' })],
  ])('preserves %s eligibility', (_label, reviewStatus) => {
    expect(normalMergeEligibility(reviewStatus, false)).toBeNull();
  });
});
