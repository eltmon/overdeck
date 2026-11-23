/**
 * PAN-5623 WI-6: the spawn gate starts a stack a memory reclaim stopped before
 * it reads stack health, and reads health from the fresh listing the restore
 * returns. Review and plan spawns never touch the stack.
 */
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { Effect } from 'effect';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  restoreReclaimedStackForSpawn: vi.fn(),
  getWorkspaceStackHealth: vi.fn(),
  resolveIssueStackDiskHold: vi.fn(),
  rebuildWorkspaceStack: vi.fn(),
}));

vi.mock('../../workspace/stack-restore.js', () => ({
  restoreReclaimedStackForSpawn: mocks.restoreReclaimedStackForSpawn,
}));

vi.mock('../../workspace/stack-health.js', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../../workspace/stack-health.js')>()),
  getWorkspaceStackHealth: mocks.getWorkspaceStackHealth,
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

const HEALTHY = { healthy: true, reasons: [], lastObserved: '2026-11-23T00:00:00.000Z' };
const UNHEALTHY = { healthy: false, reasons: ['myn-feature-min-1144-api-1 service exited (0)'], lastObserved: '2026-11-23T00:00:00.000Z' };
const FRESH = [{ id: 'id-api', name: 'myn-feature-min-1144-api-1', status: 'Up 1 second', state: 'running' }];

let workspace: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), 'spawn-gate-restore-'));
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  for (const mock of Object.values(mocks)) mock.mockReset();
  mocks.getWorkspaceStackHealth.mockReturnValue(Effect.succeed(HEALTHY));
  mocks.resolveIssueStackDiskHold.mockResolvedValue(null);
  mocks.rebuildWorkspaceStack.mockReturnValue(Effect.succeed({ success: true }));
});

afterEach(() => {
  vi.restoreAllMocks();
  rmSync(workspace, { recursive: true, force: true });
});

describe('spawn gate restores a reclaimed stack first (PAN-5623)', () => {
  it('passes the fresh listing from the restore to the health read', async () => {
    mocks.restoreReclaimedStackForSpawn.mockResolvedValue(FRESH);

    await assertWorkspaceStackHealthyForSpawn('MIN-1144', 'work', false, workspace);

    expect(mocks.restoreReclaimedStackForSpawn).toHaveBeenCalledExactlyOnceWith('MIN-1144', workspace);
    expect(mocks.getWorkspaceStackHealth).toHaveBeenCalledWith('MIN-1144', { workspacePath: workspace, containers: FRESH });
    expect(mocks.restoreReclaimedStackForSpawn.mock.invocationCallOrder[0])
      .toBeLessThan(mocks.getWorkspaceStackHealth.mock.invocationCallOrder[0]!);
  });

  it('reads health without a listing when the restore started nothing', async () => {
    mocks.restoreReclaimedStackForSpawn.mockResolvedValue(undefined);

    await assertWorkspaceStackHealthyForSpawn('MIN-1145', 'test', false, workspace);

    expect(mocks.restoreReclaimedStackForSpawn).toHaveBeenCalledOnce();
    expect(mocks.getWorkspaceStackHealth).toHaveBeenCalledWith('MIN-1145', { workspacePath: workspace });
    expect(Object.keys(mocks.getWorkspaceStackHealth.mock.calls[0]![1] as object)).toEqual(['workspacePath']);
  });

  it.each([['review'], ['plan']] as const)('never restores for a %s spawn', async (role) => {
    await assertWorkspaceStackHealthyForSpawn('MIN-1146', role, false, workspace);
    expect(mocks.restoreReclaimedStackForSpawn).not.toHaveBeenCalled();
  });

  it('continues to the existing rebuild path when the restore could not start the stack', async () => {
    mocks.restoreReclaimedStackForSpawn.mockResolvedValue(undefined);
    mocks.getWorkspaceStackHealth.mockReturnValue(Effect.succeed(UNHEALTHY));

    await assertWorkspaceStackHealthyForSpawn('MIN-1147', 'work', false, workspace);

    expect(mocks.rebuildWorkspaceStack).toHaveBeenCalledOnce();
  });
});
