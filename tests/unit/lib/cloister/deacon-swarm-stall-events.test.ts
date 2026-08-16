import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import {
  resetSwarmLoopSafetyForTests,
  swarmJanitorPass,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';

const issueId = 'PAN-3680';
const workspacePath = '/repo/workspaces/feature-pan-3680';

function deps(outputDigest: () => string): CoordinateSwarmSlotsDeps {
  const slot = { itemId: 'wi-1', slotIndex: 1, status: 'in-flight' as const, branch: 'swarm/pan-3680/slot-1', agentId: 'agent-pan-3680-slot-1' };
  return {
    listFeatureWorkspaces: vi.fn(() => [{ issueId, workspacePath, projectPath: '/repo' }]),
    findSpecByIssue: vi.fn(() => Effect.succeed({ document: { plan: { items: [], edges: [] } } })),
    reconcileSlotState: vi.fn(async () => ({ issueId, merged: [], inFlight: [slot], pending: [], branches: [], agents: [] })),
    listSessionNames: vi.fn(async () => ['agent-pan-3680', slot.agentId]),
    isPaneDead: vi.fn(async () => false),
    getPaneExitStatus: vi.fn(async () => null),
    getAgentRuntimeState: vi.fn(async () => null),
    getPaneOutputDigest: vi.fn(async () => outputDigest()),
    getBranchTipCommitTime: vi.fn(async () => 1),
    readSlotCompletion: vi.fn(() => undefined),
    clearCompletionObservation: vi.fn(async () => undefined),
    listSlotAssignments: vi.fn(() => [{ slotIndex: 1 }]),
    readSwarmHold: vi.fn(() => undefined),
    clearSlotAssignment: vi.fn(async () => undefined),
    runGitCommand: vi.fn(async () => ({ stdout: '' })),
    slotWorktreeExists: vi.fn(() => false),
    sendStallEvent: vi.fn(async () => undefined),
  } as unknown as CoordinateSwarmSlotsDeps;
}

describe('swarm janitor stall events', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T00:00:00Z'));
    resetSwarmLoopSafetyForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PAN_SWARM_STALL_THRESHOLD_MS;
  });

  it('sends one foreman event after the no-progress threshold without writing recovery state', async () => {
    process.env.PAN_SWARM_STALL_THRESHOLD_MS = String(30 * 60_000);
    const fake = deps(() => 'unchanged output');

    await swarmJanitorPass(fake);
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);
    const actions = await swarmJanitorPass(fake);
    await swarmJanitorPass(fake);

    expect(fake.sendStallEvent).toHaveBeenCalledOnce();
    expect(fake.sendStallEvent).toHaveBeenCalledWith('agent-pan-3680', '[swarm-event] slot 1 stalled (no progress 30m)');
    expect(actions).toContain('[swarm-janitor] notified PAN-3680 foreman that slot 1 stalled');
    expect(fake).not.toHaveProperty('recordStalledSlotRecovery');
  });

  it('sends no event when pane output progresses before the threshold', async () => {
    process.env.PAN_SWARM_STALL_THRESHOLD_MS = String(30 * 60_000);
    let output = 'first output';
    const fake = deps(() => output);

    await swarmJanitorPass(fake);
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    output = 'new output';
    await swarmJanitorPass(fake);
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    await swarmJanitorPass(fake);

    expect(fake.sendStallEvent).not.toHaveBeenCalled();
  });
});
