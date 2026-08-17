import { describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import { swarmJanitorPass, type CoordinateSwarmSlotsDeps } from '../../../../src/lib/cloister/deacon-swarm.js';

describe('Deacon swarm janitor', () => {
  it('enumerates and garbage-collects without dispatch, merge, or recovery', async () => {
    const spawnRun = vi.fn();
    const verifyAndMergeSlot = vi.fn();
    const deps = {
      listFeatureWorkspaces: vi.fn(() => [{ issueId: 'PAN-3680', workspacePath: '/repo/workspaces/feature-pan-3680', projectPath: '/repo' }]),
      findSpecByIssue: vi.fn(() => Effect.succeed({ document: { plan: { items: [], edges: [] } } })),
      reconcileSlotState: vi.fn(async () => ({ issueId: 'PAN-3680', merged: [], inFlight: [], pending: [], branches: [], agents: [] })),
      spawnRun,
      verifyAndMergeSlot,
      listSessionNames: vi.fn(async () => []),
      clearSlotAssignment: vi.fn(async () => undefined),
      runGitCommand: vi.fn(async () => ({ stdout: '' })),
      slotWorktreeExists: vi.fn(() => false),
    } as unknown as CoordinateSwarmSlotsDeps;

    const actions = await swarmJanitorPass(deps);

    expect(actions).toEqual(['[swarm-janitor] enumerated PAN-3680']);
    expect(spawnRun).not.toHaveBeenCalled();
    expect(verifyAndMergeSlot).not.toHaveBeenCalled();
  });
});
