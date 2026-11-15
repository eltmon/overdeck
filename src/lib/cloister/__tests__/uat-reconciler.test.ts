/**
 * PAN-4753 WI-3: every invalidation the reconciler writes carries a
 * status reason, and a member that merged on its own says so.
 * The broader reconciler suite lives in tests/unit/lib/cloister/uat-reconciler.test.ts.
 */
import { describe, expect, it } from 'vitest';

import { reconcileUatGenerations, type UatReconcilerDeps } from '../uat-reconciler.js';
import type { ReadyFeature } from '../uat-generation-engine.js';
import type { UatGeneration } from '../../overdeck/merge-types.js';

const MAIN = 'main-sha';
let seq = 0;

function batch(projectRoot: string): UatGeneration {
  return {
    name: `uat/pan-reason-${++seq}`,
    worktreePath: `${projectRoot}/w`,
    projectRoot,
    baseSha: MAIN,
    status: 'ready',
    members: [
      { issueId: 'PAN-1', title: 'One', branch: 'feature/pan-1', headSha: 'h1', mergeOrder: 1 },
      { issueId: 'PAN-2', title: 'Two', branch: 'feature/pan-2', headSha: 'h2', mergeOrder: 2 },
    ],
    heldOut: [],
    resolutions: [],
    stackStartedAt: null,
    createdAt: '2026-11-14T10:00:00.000Z',
    updatedAt: '2026-11-14T10:00:00.000Z',
  };
}

function deps(projectRoot: string, gen: UatGeneration, options: {
  ready: ReadyFeature[];
  heads?: Record<string, string>;
  mergedIssueIds?: UatReconcilerDeps['mergedIssueIds'];
}): UatReconcilerDeps & { rows: Map<string, UatGeneration> } {
  const rows = new Map([[gen.name, gen]]);
  return {
    rows,
    isEnabled: () => true,
    getReadySet: async () => options.ready,
    getMainHeadSha: async () => MAIN,
    getBranchHeadSha: async (branch) => options.heads?.[branch] ?? (branch === 'feature/pan-1' ? 'h1' : 'h2'),
    store: {
      insert: () => {},
      update: (name, patch) => { rows.set(name, { ...rows.get(name)!, ...patch }); },
      listNames: () => [...rows.keys()],
      listChain: (root, statuses) => [...rows.values()]
        .filter((g) => g.projectRoot === root && (!statuses || statuses.includes(g.status))),
    },
    // A second ready feature keeps the reconciler from assembling a new batch mid-test.
    assemble: async () => { throw new Error('not under test'); },
    teardownStack: async () => {},
    cleanup: async () => {},
    ...(options.mergedIssueIds ? { mergedIssueIds: options.mergedIssueIds } : {}),
    now: () => Date.parse('2026-11-14T10:05:00.000Z'),
  };
}

const PAN_2: ReadyFeature = { issueId: 'PAN-2', title: 'Two', branch: 'feature/pan-2' };

describe('reconciler status reason (PAN-4753 WI-3)', () => {
  it('names a member that merged on its own, outside the batch', async () => {
    const root = `/proj-reason-${++seq}`;
    const gen = batch(root);
    const d = deps(root, gen, { ready: [PAN_2], mergedIssueIds: async () => new Set(['PAN-1']) });

    await reconcileUatGenerations(root, d);

    expect(d.rows.get(gen.name)).toMatchObject({
      status: 'invalidated',
      statusReason: 'PAN-1 was merged on its own, outside the batch',
    });
  });

  it('says a member that lost readiness is no longer ready to merge', async () => {
    const root = `/proj-reason-${++seq}`;
    const gen = batch(root);
    const d = deps(root, gen, { ready: [PAN_2], mergedIssueIds: async () => new Set() });

    await reconcileUatGenerations(root, d);

    expect(d.rows.get(gen.name)?.statusReason).toBe('PAN-1 is no longer ready to merge');
  });

  it('falls back to "no longer ready" when the merged read fails or is not wired', async () => {
    const root = `/proj-reason-${++seq}`;
    const gen = batch(root);
    const d = deps(root, gen, { ready: [PAN_2], mergedIssueIds: async () => { throw new Error('rate limited'); } });

    await reconcileUatGenerations(root, d);

    expect(d.rows.get(gen.name)?.statusReason).toBe('PAN-1 is no longer ready to merge');
  });

  it('says a member whose branch moved gained commits', async () => {
    const root = `/proj-reason-${++seq}`;
    const gen = batch(root);
    const d = deps(root, gen, {
      ready: [{ issueId: 'PAN-1', title: 'One', branch: 'feature/pan-1' }, PAN_2],
      heads: { 'feature/pan-1': 'h1-new' },
    });
    d.assemble = async (features) => ({ ...batch(root), members: features.map((f, i) => ({ ...f, headSha: 'x', mergeOrder: i + 1 })) });

    await reconcileUatGenerations(root, d);

    expect(d.rows.get(gen.name)?.statusReason).toBe('PAN-1 branch gained commits');
  });

  it('reads merged ids only while a live batch exists', async () => {
    const root = `/proj-reason-${++seq}`;
    const gen = { ...batch(root), status: 'promoted' as const };
    let reads = 0;
    const d = deps(root, gen, { ready: [], mergedIssueIds: async () => { reads += 1; return new Set(); } });

    await reconcileUatGenerations(root, d);

    expect(reads).toBe(0);
  });
});
