import { describe, expect, it } from 'vitest';

import {
  BATCH_CI_RETRY_MS,
  NO_BATCH_CI_PREFIX,
  projectBatchCiPausedUntil,
  projectLacksBatchCi,
} from '../../../../src/lib/cloister/merge-route.js';
import type { UatGeneration } from '../../../../src/lib/overdeck/merge-types.js';

const NOW = Date.parse('2026-11-14T12:00:00.000Z');
const HOUR = 60 * 60 * 1000;

function generation(updatedMsAgo: number, reason: string): UatGeneration {
  const at = new Date(NOW - updatedMsAgo).toISOString();
  return {
    name: `uat/pan-train-${updatedMsAgo}`,
    worktreePath: '/wt',
    projectRoot: '/repo',
    baseSha: 'abc',
    status: 'invalidated',
    members: [],
    heldOut: [{ issueId: 'PAN-1', reason } as UatGeneration['heldOut'][number]],
    resolutions: [],
    stackStartedAt: null,
    createdAt: at,
    updatedAt: at,
  };
}

function deps(gens: UatGeneration[]) {
  return { listInvalidated: () => gens, now: () => NOW };
}

describe('projectBatchCiPausedUntil (PAN-5283 WI-6)', () => {
  it('projectBatchCiPausedUntil returns the end of the retry window', () => {
    const gens = [
      generation(2 * HOUR, `${NO_BATCH_CI_PREFIX} appeared for uat/pan-train`),
      generation(5 * HOUR, `${NO_BATCH_CI_PREFIX} appeared for uat/pan-train`),
      generation(HOUR, 'combined CI failed on PAN-1'),
    ];
    expect(projectBatchCiPausedUntil('/repo', deps(gens))).toBe(new Date(NOW - 2 * HOUR + BATCH_CI_RETRY_MS).toISOString());
    expect(projectLacksBatchCi('/repo', deps(gens))).toBe(true);
  });

  it('projectBatchCiPausedUntil is null outside the window', () => {
    const gens = [generation(25 * HOUR, `${NO_BATCH_CI_PREFIX} appeared`), generation(48 * HOUR, `${NO_BATCH_CI_PREFIX} appeared`)];
    expect(projectBatchCiPausedUntil('/repo', deps(gens))).toBeNull();
    expect(projectLacksBatchCi('/repo', deps(gens))).toBe(false);
    expect(projectBatchCiPausedUntil(undefined, deps(gens))).toBeNull();
    expect(projectBatchCiPausedUntil('/repo', { listInvalidated: () => { throw new Error('db'); }, now: () => NOW })).toBeNull();
  });
});
