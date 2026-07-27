/**
 * A null (unavailable) ready set must leave a LIVE generation completely alone
 * (PAN-3093 cycle 4).
 *
 * The reconciler treats an EMPTY ready set as authoritative: every live member
 * has departed, so the generation is invalidated and its stack torn down. When
 * the ready set could not be computed — a member repo's ref refresh failed —
 * reporting empty would destroy the current testable batch over a transient
 * transport or auth blip. `null` means "do nothing this tick".
 *
 * Kept out of uat-reconciler.test.ts, which an acceptance criterion requires to
 * stay unmodified.
 */

import { describe, it, expect } from 'vitest';
import { reconcileUatGenerations } from '../../../../src/lib/cloister/uat-reconciler.js';
import type { UatReconcilerDeps } from '../../../../src/lib/cloister/uat-reconciler.js';
import type { UatGeneration } from '../../../../src/lib/overdeck/merge-sync.js';

const PROJECT = '/proj-unavailable';
const LIVE: UatGeneration = {
  name: 'uat/min-otter-0727',
  worktreePath: `${PROJECT}/workspaces/uat-min-otter-0727`,
  projectRoot: PROJECT,
  baseSha: 'fe@aaa1111 api@bbb2222',
  status: 'ready',
  members: [
    { issueId: 'MIN-901', title: 'One', branch: 'feature/min-901', headSha: 'fe@a api@b', mergeOrder: 1 },
  ],
  heldOut: [],
  resolutions: [],
  stackStartedAt: '2026-07-27T10:00:00.000Z',
  cleanedAt: null,
  createdAt: '2026-07-27T00:00:00.000Z',
  updatedAt: '2026-07-27T00:00:00.000Z',
};

function makeDeps(readySet: UatReconcilerDeps['getReadySet'] extends () => Promise<infer R> ? R : never) {
  const rows = new Map<string, UatGeneration>([[LIVE.name, LIVE]]);
  const patches: Array<[string, unknown]> = [];
  const teardowns: string[] = [];
  const assembled: unknown[] = [];

  const deps: UatReconcilerDeps & {
    patches: typeof patches; teardowns: typeof teardowns; assembled: typeof assembled;
  } = {
    patches, teardowns, assembled,
    isEnabled: () => true,
    getReadySet: async () => readySet,
    getMainHeadSha: async () => 'fe@aaa1111 api@bbb2222',
    getBranchHeadSha: async () => 'fe@a api@b',
    store: {
      insert: () => {},
      update: (name, patch) => { patches.push([name, patch]); },
      listNames: () => [...rows.keys()],
      listChain: (root, statuses) =>
        [...rows.values()].filter((g) => g.projectRoot === root && (!statuses || statuses.includes(g.status))),
    },
    assemble: async (features) => { assembled.push(features); return LIVE; },
    teardownStack: async (g) => { teardowns.push(g.name); },
    cleanup: async () => {},
  };
  return deps;
}

describe('reconciler with an unavailable ready set', () => {
  it('leaves a live generation untouched — no status update, no teardown, no assembly', async () => {
    const deps = makeDeps(null);

    const result = await reconcileUatGenerations(PROJECT, deps);

    expect(result.action).toBe('no-queue');
    expect(deps.patches).toEqual([]);
    expect(deps.teardowns).toEqual([]);
    expect(deps.assembled).toEqual([]);
    expect(result.invalidated).toEqual([]);
  });

  it('by contrast, a verified-empty ready set DOES invalidate the live generation', async () => {
    // This is the behaviour that makes conflating the two dangerous, and the
    // reason an outage must report null rather than [].
    const deps = makeDeps([]);

    const result = await reconcileUatGenerations(PROJECT, deps);

    expect(result.invalidated).toContain(LIVE.name);
    expect(deps.patches.some(([name, patch]) =>
      name === LIVE.name && (patch as { status?: string }).status === 'invalidated')).toBe(true);
    expect(deps.teardowns).toContain(LIVE.name);
  });
});
