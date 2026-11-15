/**
 * PAN-4753 WI-8: the merge policy write's label math and cache refresh.
 * The route's HTTP behavior is in `routes/__tests__/merge-train-lanes.test.ts`.
 */
import { describe, expect, it, vi } from 'vitest';
import { Effect, Layer } from 'effect';

import { IssueLifecycle } from '../issue-lifecycle.js';
import { labelsAfterPolicy, writeIssueMergePolicy, type MergePolicyWriteDeps } from '../merge-policy-write.js';

const lifecycle = Layer.succeed(IssueLifecycle, {
  transitionTo: () => Effect.void,
  addLabel: () => Effect.void,
  removeLabel: () => Effect.void,
  close: () => Effect.void,
});

function deps(overrides: Partial<MergePolicyWriteDeps> = {}): MergePolicyWriteDeps {
  return {
    resolveProject: () => ({ projectKey: 'overdeck', config: { name: 'overdeck', path: '/repo', github_repo: 'eltmon/overdeck' } }),
    isGitHubIssue: () => true,
    cachedLabels: () => null,
    patchCachedLabels: vi.fn(),
    invalidateBoard: vi.fn(),
    globalRequireUat: () => false,
    trainOn: () => true,
    droppedFromBatch: () => false,
    ...overrides,
  };
}

const run = (policy: 'auto' | 'hold' | 'default', d: MergePolicyWriteDeps) =>
  Effect.runPromise(writeIssueMergePolicy('PAN-9', policy, d).pipe(Effect.provide(lifecycle)));

describe('labelsAfterPolicy', () => {
  it('swaps one grant label for the other and keeps every other label', () => {
    expect(labelsAfterPolicy(['bug', 'hold-for-uat'], 'auto')).toEqual(['bug', 'auto-merge']);
    expect(labelsAfterPolicy(['auto-merge', 'bug'], 'hold')).toEqual(['bug', 'hold-for-uat']);
    expect(labelsAfterPolicy(['auto-merge', 'hold-for-uat', 'bug'], 'default')).toEqual(['bug']);
    expect(labelsAfterPolicy(['auto-merge'], 'auto')).toEqual(['auto-merge']);
  });
});

describe('writeIssueMergePolicy cache refresh', () => {
  it('patches a cached tracker row with the new labels and reports refreshed', async () => {
    const d = deps({ cachedLabels: () => ['bug', 'auto-merge'] });
    const result = await run('hold', d);
    expect(d.patchCachedLabels).toHaveBeenCalledWith('PAN-9', ['bug', 'hold-for-uat']);
    expect(d.invalidateBoard).toHaveBeenCalled();
    expect(result).toEqual({
      status: 200,
      body: { issueId: 'PAN-9', policy: 'hold', effectivePolicy: 'hold', route: 'batch', refreshed: true },
    });
  });

  it('leaves an uncached issue to the tracker poll and reports refreshed false', async () => {
    const d = deps();
    const result = await run('auto', d);
    expect(d.patchCachedLabels).not.toHaveBeenCalled();
    expect(result.body).toMatchObject({ refreshed: false, effectivePolicy: 'auto' });
  });

  it('routes an urgent Auto issue per-PR, and any issue per-PR with the train off', async () => {
    expect((await run('auto', deps({ cachedLabels: () => ['urgent'] }))).body['route']).toBe('per-pr');
    expect((await run('auto', deps({ trainOn: () => false }))).body['route']).toBe('per-pr');
    // A UAT hold always wins, even for an urgent issue.
    expect((await run('hold', deps({ cachedLabels: () => ['urgent'] }))).body['route']).toBe('batch');
  });
});
