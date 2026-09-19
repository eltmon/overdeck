/**
 * Promote-time ship ordering (re-pointed by PAN-3917).
 *
 * The `durable ship records` and `shipPromotedBatch` suites went with D6:
 * `ship-record.ts` and `ship-status.ts` are deleted, a ship settles as a git
 * tag plus a GitHub release, and no test may construct an issue record. What
 * remains is the promote path's own contract — one ship, then the per-member
 * post-merge fan-out.
 */
import { describe, expect, it } from 'vitest';
import {
  promoteUatGeneration,
  type UatPromoteDeps,
} from '../../../../src/lib/cloister/uat-promote.js';
import type { UatGeneration } from '../../../../src/lib/overdeck/merge-sync.js';

const PROJECT_ROOT = '/repo';
const BATCH = 'uat/pan-ship-0731';

function generation(status: UatGeneration['status'] = 'ready'): UatGeneration {
  return {
    name: BATCH,
    worktreePath: '/repo/workspaces/uat-pan-ship-0731',
    projectRoot: PROJECT_ROOT,
    baseSha: 'main-sha',
    status,
    members: [
      { issueId: 'PAN-1', title: 'One', branch: 'feature/pan-1', headSha: 'one-sha', mergeOrder: 1 },
      { issueId: 'PAN-2', title: 'Two', branch: 'feature/pan-2', headSha: 'two-sha', mergeOrder: 2 },
    ],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    createdAt: '2026-07-31T00:00:00.000Z',
    updatedAt: '2026-07-31T00:00:00.000Z',
  };
}

function promoteDeps(gen: UatGeneration, order: string[] = []): UatPromoteDeps {
  const map = new Map([[gen.name, gen]]);
  return {
    git: {
      fetchMain: async () => 'main-sha',
      mergeIntoMain: async () => 'merge-sha',
      changedFilesSince: async () => [],
      batchChangedFiles: async () => [],
    },
    store: {
      get: name => map.get(name) ?? null,
      insert: () => { throw new Error('unused'); },
      update: (name, patch) => {
        const current = map.get(name);
        if (current) map.set(name, { ...current, ...patch } as UatGeneration);
      },
      listNames: () => [...map.keys()],
      listChain: () => [...map.values()].filter(row => row.status === 'ready' || row.status === 'superseded'),
    },
    teardownStack: async () => {},
    firePostMerge: issueId => { order.push(`post:${issueId}`); return true; },
    memberEligibility: () => ({ eligible: true }),
    runShip: async () => { order.push('ship'); },
    log: () => {},
  };
}

describe('promote ship ordering', () => {
  // PAN-3917: the promoted batch no longer stamps a verification verdict of its
  // own — the members' PRs carry their checks. Ship still runs once, ahead of
  // the per-member post-merge fan-out.
  it('runs ship once before the member post-merge fan-out', async () => {
    const order: string[] = [];
    const deps = promoteDeps(generation(), order);

    const result = await promoteUatGeneration(BATCH, PROJECT_ROOT, deps, { shipVersion: '1.2.3' });

    expect(result.success).toBe(true);
    expect(order).toEqual(['ship', 'post:PAN-1', 'post:PAN-2']);
    expect(deps.store.get(BATCH)?.repos?.[0]).toMatchObject({
      repoPath: PROJECT_ROOT,
      mergeSha: 'merge-sha',
      targetBranch: 'main',
    });
  });

  it('keeps promotion successful when ship throws and fans out every member', async () => {
    const logs: string[] = [];
    const deps = promoteDeps(generation());
    deps.runShip = async () => { throw new Error('push rejected'); };
    deps.log = message => { logs.push(message); };

    const result = await promoteUatGeneration(BATCH, PROJECT_ROOT, deps, { shipVersion: '1.2.3' });

    expect(result).toMatchObject({
      success: true,
      postMergeStarted: ['PAN-1', 'PAN-2'],
    });
    expect(logs).toContain(`[uat-promote] ${BATCH}: version ship settlement failed after merge: push rejected`);
  });
});
