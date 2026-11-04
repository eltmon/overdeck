/**
 * PAN-4961 WI-10: `pan start` spawns in-process, so the work-start disk hold
 * must also live in assertWorkspaceStackHealthyForSpawn. A hold refuses a work
 * spawn with the disk-low text, lets advancing roles fall back to the host,
 * and counts no rebuild attempt, so the next call rebuilds at once.
 */
import { Effect } from 'effect';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  resolveIssueStackDiskHold: vi.fn(),
  rebuildWorkspaceStack: vi.fn(),
}));

vi.mock('../../workspace/stack-health.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../workspace/stack-health.js')>()),
  getWorkspaceStackHealth: vi.fn(() => Effect.succeed({
    healthy: false,
    reasons: ['overdeck-feature-pan-1-init init exited non-zero (1)'],
    lastObserved: '2026-11-03T00:00:00.000Z',
  })),
}));

vi.mock('../../workspace/disk-cost.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../workspace/disk-cost.js')>()),
  resolveIssueStackDiskHold: mocks.resolveIssueStackDiskHold,
}));

vi.mock('../../workspace/rebuild-stack.js', () => ({
  rebuildWorkspaceStack: mocks.rebuildWorkspaceStack,
}));

vi.mock('../../cloister/pr-facts.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../cloister/pr-facts.js')>()),
  getPrFacts: vi.fn(async () => ({ changesRequested: false })),
}));

vi.mock('../../activity-logger.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../activity-logger.js')>()),
  emitActivityEntry: vi.fn(),
}));

import { assertWorkspaceStackHealthyForSpawn } from '../spawn-prep.js';

const HOLD = 'Disk low — new workspace starts are held: 11.0 GiB free on the filesystem holding /w, 0.0 GiB reserved by 0 in-flight workspace setup(s), this step needs 2.0 GiB, and the safety floor is 10.0 GiB. Free disk space (see /resources) and retry.';

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  mocks.resolveIssueStackDiskHold.mockReset();
  mocks.rebuildWorkspaceStack.mockReset();
  mocks.rebuildWorkspaceStack.mockReturnValue(Effect.succeed({ success: true }));
});

describe('assertWorkspaceStackHealthyForSpawn disk hold (PAN-4961)', () => {
  it('cli-start-disk-hold.ac1: a held work spawn throws the disk-low text and never rebuilds', async () => {
    mocks.resolveIssueStackDiskHold.mockResolvedValue(HOLD);

    await expect(assertWorkspaceStackHealthyForSpawn('PAN-4961', 'work')).rejects.toThrow(HOLD);
    expect(mocks.rebuildWorkspaceStack).not.toHaveBeenCalled();
  });

  it('cli-start-disk-hold.ac2: a held review spawn falls back to the host without rebuilding', async () => {
    mocks.resolveIssueStackDiskHold.mockResolvedValue(HOLD);

    await expect(assertWorkspaceStackHealthyForSpawn('PAN-4962', 'review')).resolves.toBeUndefined();
    expect(mocks.rebuildWorkspaceStack).not.toHaveBeenCalled();
  });

  it('cli-start-disk-hold.ac3: once the hold clears, the next work spawn rebuilds at once', async () => {
    mocks.resolveIssueStackDiskHold.mockResolvedValueOnce(HOLD).mockResolvedValue(null);

    await expect(assertWorkspaceStackHealthyForSpawn('PAN-4963', 'work')).rejects.toThrow(HOLD);
    await expect(assertWorkspaceStackHealthyForSpawn('PAN-4963', 'work')).resolves.toBeUndefined();

    expect(mocks.rebuildWorkspaceStack).toHaveBeenCalledTimes(1);
  });
});
