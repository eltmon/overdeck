import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import {
  classifyInFlightSlots,
  resetSwarmLoopSafetyForTests,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';

const issueId = 'PAN-3680';
const workspacePath = '/repo/workspaces/feature-pan-3680';

const slot = { itemId: 'wi-1', slotIndex: 1, status: 'in-flight' as const, branch: 'swarm/pan-3680/slot-1', agentId: 'agent-pan-3680-slot-1' };

function deps(outputDigest: () => string): CoordinateSwarmSlotsDeps {
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

/**
 * The stall signal comes from classifyInFlightSlots (live: `pan swarm status` / `pan swarm wait`).
 * The janitor pass that forwarded it to the foreman was deleted in PAN-3958 CH-8 (no production
 * caller since PAN-3917 W5), so these tests read the signal directly.
 */
async function stallSignals(fake: CoordinateSwarmSlotsDeps): Promise<number[]> {
  const classified = await classifyInFlightSlots([slot] as never, fake, { issueId, workspacePath });
  return classified.filter(candidate => candidate.signal === 'stall-event').map(candidate => candidate.stalledForMs ?? 0);
}

describe('swarm stall events', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-14T00:00:00Z'));
    resetSwarmLoopSafetyForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.PAN_SWARM_STALL_THRESHOLD_MS;
  });

  it('signals a stall once after the no-progress threshold without writing recovery state', async () => {
    process.env.PAN_SWARM_STALL_THRESHOLD_MS = String(30 * 60_000);
    const fake = deps(() => 'unchanged output');

    expect(await stallSignals(fake)).toEqual([]);
    await vi.advanceTimersByTimeAsync(30 * 60_000 + 1);
    const stalled = await stallSignals(fake);
    expect(stalled).toHaveLength(1);
    expect(Math.floor(stalled[0]! / 60_000)).toBe(30);
    expect(await stallSignals(fake)).toEqual([]);

    expect(fake).not.toHaveProperty('recordStalledSlotRecovery');
  });

  it('signals nothing when pane output progresses before the threshold', async () => {
    process.env.PAN_SWARM_STALL_THRESHOLD_MS = String(30 * 60_000);
    let output = 'first output';
    const fake = deps(() => output);

    expect(await stallSignals(fake)).toEqual([]);
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    output = 'new output';
    expect(await stallSignals(fake)).toEqual([]);
    await vi.advanceTimersByTimeAsync(29 * 60_000);
    expect(await stallSignals(fake)).toEqual([]);
  });
});
