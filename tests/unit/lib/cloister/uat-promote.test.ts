/**
 * Tests for batch promotion (PAN-1737) — merge-what-you-tested semantics,
 * stale-base rejection, exactly-once post-merge fan-out. All deps faked.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  promoteUatGeneration,
  buildPromoteMergeMessage,
  type UatPromoteDeps,
} from '../../../../src/lib/cloister/uat-promote.js';
import type { UatGeneration, UatGenerationStatus } from '../../../../src/lib/database/uat-generations-db.js';

const MAIN = 'main-sha-1';
const PROJ = '/proj';

function gen(name: string, status: UatGenerationStatus = 'ready', overrides: Partial<UatGeneration> = {}): UatGeneration {
  return {
    name, worktreePath: `/proj/workspaces/${name.replace(/\//g, '-')}`, projectRoot: PROJ,
    baseSha: MAIN, status,
    members: [
      { issueId: 'PAN-1', title: 'First', branch: 'feature/pan-1', headSha: 'h1', mergeOrder: 1 },
      { issueId: 'PAN-2', title: 'Second', branch: 'feature/pan-2', headSha: 'h2', mergeOrder: 2 },
    ],
    heldOut: [], resolutions: [], stackStartedAt: null,
    createdAt: '2026-06-10T00:00:00.000Z', updatedAt: '',
    ...overrides,
  };
}

function makeDeps(rows: UatGeneration[], options: { mainSha?: string; failMerge?: boolean; mainChangedFiles?: string[]; batchChangedFiles?: string[] } = {}): UatPromoteDeps & {
  map: Map<string, UatGeneration>;
  merges: Array<{ branch: string; message: string }>;
  teardowns: string[];
  fired: string[];
} {
  const map = new Map(rows.map((g) => [g.name, g]));
  const merges: Array<{ branch: string; message: string }> = [];
  const teardowns: string[] = [];
  const fired: string[] = [];
  return {
    map, merges, teardowns, fired,
    git: {
      fetchMain: async () => options.mainSha ?? MAIN,
      mergeIntoMain: async (branch, message) => {
        if (options.failMerge) throw new Error('push rejected (non-fast-forward)');
        merges.push({ branch, message });
        return 'merge-sha-xyz';
      },
      changedFilesSince: async () => options.mainChangedFiles ?? [],
      batchChangedFiles: async () => options.batchChangedFiles ?? ['src/feature-a.ts', 'src/feature-b.ts'],
    },
    store: {
      get: (name) => map.get(name) ?? null,
      insert: () => { throw new Error('unused'); },
      update: (name, patch) => {
        const existing = map.get(name);
        if (!existing) throw new Error(`not found: ${name}`);
        map.set(name, { ...existing, ...patch } as UatGeneration);
      },
      listNames: () => [...map.keys()],
      listChain: (root, statuses) =>
        [...map.values()]
          .filter((g) => g.projectRoot === root)
          .filter((g) => !statuses || statuses.includes(g.status))
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    },
    teardownStack: async (g) => { teardowns.push(g.name); },
    firePostMerge: (issueId) => { fired.push(issueId); return true; },
    log: () => {},
  };
}

describe('promoteUatGeneration — success', () => {
  it('merges the batch, flips to promoted, tears down its stack, fires post-merge once per member', async () => {
    const deps = makeDeps([gen('uat/pan-otter-0610')]);

    const result = await promoteUatGeneration('uat/pan-otter-0610', PROJ, deps);

    expect(result).toMatchObject({
      success: true,
      mergeSha: 'merge-sha-xyz',
      members: ['PAN-1', 'PAN-2'],
      postMergeStarted: ['PAN-1', 'PAN-2'],
    });
    expect(deps.merges).toHaveLength(1);
    expect(deps.merges[0]!.branch).toBe('uat/pan-otter-0610');
    expect(deps.merges[0]!.message).toMatch(/^Merge UAT batch uat\/pan-otter-0610 \(PAN-1, PAN-2\)/);
    expect(deps.map.get('uat/pan-otter-0610')!.status).toBe('promoted');
    expect(deps.teardowns).toContain('uat/pan-otter-0610');
    expect(deps.fired).toEqual(['PAN-1', 'PAN-2']);
  });

  it('invalidates every other live generation (main moved) and tears their stacks down', async () => {
    const deps = makeDeps([
      gen('uat/pan-newest-0610', 'ready', { createdAt: '2026-06-10T03:00:00.000Z' }),
      gen('uat/pan-older-0610', 'superseded', { createdAt: '2026-06-10T02:00:00.000Z', stackStartedAt: '2026-06-10T02:30:00.000Z' }),
      gen('uat/pan-dead-0610', 'invalidated', { createdAt: '2026-06-10T01:00:00.000Z' }),
    ]);

    const result = await promoteUatGeneration('uat/pan-older-0610', PROJ, deps);

    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.invalidated).toEqual(['uat/pan-newest-0610']);
    expect(deps.map.get('uat/pan-newest-0610')!.status).toBe('invalidated');
    expect(deps.map.get('uat/pan-older-0610')!.status).toBe('promoted');
    // already-invalidated rows untouched
    expect(deps.map.get('uat/pan-dead-0610')!.status).toBe('invalidated');
    expect(deps.teardowns).toEqual(expect.arrayContaining(['uat/pan-older-0610', 'uat/pan-newest-0610']));
  });

  it('promoting an older superseded generation works while its base still matches', async () => {
    const deps = makeDeps([gen('uat/pan-sea-monkey-0610', 'superseded')]);
    const result = await promoteUatGeneration('uat/pan-sea-monkey-0610', PROJ, deps);
    expect(result.success).toBe(true);
  });

  it('reports members whose post-merge was already in flight', async () => {
    const deps = makeDeps([gen('uat/pan-x-0610')]);
    deps.firePostMerge = (issueId) => issueId !== 'PAN-2';
    const result = await promoteUatGeneration('uat/pan-x-0610', PROJ, deps);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.postMergeStarted).toEqual(['PAN-1']);
  });

  it('notes conflict resolutions in the merge message', () => {
    const g = gen('uat/pan-res-0610', 'ready', {
      resolutions: [{ issueIds: ['PAN-2', 'PAN-1'], files: ['x.ts'], commitSha: 'c1' }],
    });
    const message = buildPromoteMergeMessage(g);
    expect(message).toMatch(/^Merge UAT batch/);
    expect(message).toContain('uat-assembly conflict resolution');
    expect(message).toContain('PAN-2 <-> PAN-1');
  });
});

describe('promoteUatGeneration — rejections (no git mutation)', () => {
  it('rejects a moved base ONLY when main\'s new commits overlap the batch files', async () => {
    const deps = makeDeps([gen('uat/pan-stale-0610')], {
      mainSha: 'newer-main-sha',
      mainChangedFiles: ['src/feature-a.ts', 'docs/unrelated.md'],
      batchChangedFiles: ['src/feature-a.ts', 'src/feature-b.ts'],
    });

    const result = await promoteUatGeneration('uat/pan-stale-0610', PROJ, deps);

    expect(result).toMatchObject({ success: false, reason: 'stale-base' });
    if (result.success) return;
    expect(result.message).toContain('src/feature-a.ts');
    expect(result.message).toContain('reassembles automatically');
    expect(deps.merges).toHaveLength(0);
    expect(deps.fired).toEqual([]);
    expect(deps.map.get('uat/pan-stale-0610')!.status).toBe('ready');
  });

  it('proceeds on a moved base when main\'s new commits are disjoint from the batch', async () => {
    // First live run (2026-06-10): the flywheel lands strike commits on main
    // continuously; requiring exact base equality made ready batches almost
    // never promotable. Disjoint movement is safe — the tested member files
    // are untouched and the no-ff merge still hard-fails on real conflicts.
    const deps = makeDeps([gen('uat/pan-moved-0610')], {
      mainSha: 'newer-main-sha',
      mainChangedFiles: ['docs/flywheel-tick.md', '.pan/specs/x.vbrief.json'],
      batchChangedFiles: ['src/feature-a.ts', 'src/feature-b.ts'],
    });

    const result = await promoteUatGeneration('uat/pan-moved-0610', PROJ, deps);

    expect(result.success).toBe(true);
    expect(deps.merges).toHaveLength(1);
    expect(deps.map.get('uat/pan-moved-0610')!.status).toBe('promoted');
  });

  it('rejects unknown names and non-promotable statuses', async () => {
    const deps = makeDeps([
      gen('uat/pan-building-0610', 'assembling'),
      gen('uat/pan-done-0610', 'promoted'),
    ]);

    expect((await promoteUatGeneration('uat/pan-ghost-0610', PROJ, deps))).toMatchObject({ success: false, reason: 'not-found' });
    expect((await promoteUatGeneration('uat/pan-building-0610', PROJ, deps))).toMatchObject({ success: false, reason: 'wrong-status' });
    expect((await promoteUatGeneration('uat/pan-done-0610', PROJ, deps))).toMatchObject({ success: false, reason: 'wrong-status' });
    expect(deps.merges).toHaveLength(0);
  });

  it('surfaces merge/push failure without flipping status or firing post-merge', async () => {
    const deps = makeDeps([gen('uat/pan-race-0610')], { failMerge: true });

    const result = await promoteUatGeneration('uat/pan-race-0610', PROJ, deps);

    expect(result).toMatchObject({ success: false, reason: 'merge-failed' });
    expect(deps.map.get('uat/pan-race-0610')!.status).toBe('ready');
    expect(deps.fired).toEqual([]);
    expect(deps.teardowns).toEqual([]);
  });
});
