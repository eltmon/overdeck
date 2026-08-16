import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';
import {
  resetForemanRespawnFailuresForTests,
  swarmJanitorPass,
  type CoordinateSwarmSlotsDeps,
} from '../../../../src/lib/cloister/deacon-swarm.js';

const issueId = 'PAN-3680';
const workspacePath = '/repo/workspaces/feature-pan-3680';

function deps(overrides: Partial<CoordinateSwarmSlotsDeps> = {}): CoordinateSwarmSlotsDeps {
  return {
    listFeatureWorkspaces: vi.fn(() => [{ issueId, workspacePath, projectPath: '/repo' }]),
    findSpecByIssue: vi.fn(() => Effect.succeed({ document: { plan: { items: [], edges: [] } } })),
    reconcileSlotState: vi.fn(async () => ({ issueId, merged: [], inFlight: [], pending: [], branches: [], agents: [] })),
    listSessionNames: vi.fn(async () => ['agent-pan-3680-slot-1']),
    listSlotAssignments: vi.fn(() => [{ slotIndex: 1 }]),
    clearSlotAssignment: vi.fn(async () => undefined),
    runGitCommand: vi.fn(async () => ({ stdout: '' })),
    slotWorktreeExists: vi.fn(() => false),
    readSwarmHold: vi.fn(() => undefined),
    workResumeSlotsAvailable: vi.fn(() => 1),
    ensureSwarmForeman: vi.fn(async () => ['[swarm] spawned foreman agent-pan-3680 for PAN-3680']),
    writeSwarmHold: vi.fn(async () => undefined),
    emitActivityEntry: vi.fn(),
    resolveAutomaticSwarmPolicy: vi.fn(() => ({
      policy: { mode: 'auto', maxSlots: 3, autoAdvance: true, source: { mode: 'test', maxSlots: 'test', autoAdvance: 'test' } },
      spawnForeman: false,
      requireSwarmReadiness: false,
      advanceWavesWithoutConfirmation: true,
      reason: 'not-ready',
    })),
    ...overrides,
  } as unknown as CoordinateSwarmSlotsDeps;
}

describe('swarm foreman liveness', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    resetForemanRespawnFailuresForTests();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('respawns one missing foreman for an active unheld swarm with the resume protocol', async () => {
    const fake = deps();

    const actions = await swarmJanitorPass(fake);

    expect(fake.ensureSwarmForeman).toHaveBeenCalledOnce();
    expect(fake.ensureSwarmForeman).toHaveBeenCalledWith(issueId, workspacePath, {
      startedBy: 'deacon:swarm-janitor',
      prompt: expect.stringContaining('read .pan/continue.json'),
    });
    expect(actions).toContain('[swarm] spawned foreman agent-pan-3680 for PAN-3680');
  });

  it.each([
    ['a live foreman', { listSessionNames: vi.fn(async () => ['agent-pan-3680', 'agent-pan-3680-slot-1']) }],
    ['a swarm hold', { readSwarmHold: vi.fn(() => ({ reason: 'operator hold', setBy: 'test', at: 'now' })) }],
  ])('does not spawn while %s exists', async (_label, overrides) => {
    const fake = deps(overrides as Partial<CoordinateSwarmSlotsDeps>);

    await swarmJanitorPass(fake);

    expect(fake.ensureSwarmForeman).not.toHaveBeenCalled();
  });

  it('freezes and reports the issue after three consecutive respawn failures', async () => {
    let hold: ReturnType<NonNullable<CoordinateSwarmSlotsDeps['readSwarmHold']>>;
    const writeSwarmHold = vi.fn(async (_workspace, _issue, value) => { hold = value; });
    const ensureSwarmForeman = vi.fn(async () => { throw new Error('spawn failed'); });
    const fake = deps({
      ensureSwarmForeman,
      readSwarmHold: vi.fn(() => hold),
      writeSwarmHold,
    });

    await swarmJanitorPass(fake);
    await swarmJanitorPass(fake);
    const actions = await swarmJanitorPass(fake);
    await swarmJanitorPass(fake);

    expect(ensureSwarmForeman).toHaveBeenCalledTimes(3);
    expect(writeSwarmHold).toHaveBeenCalledOnce();
    expect(fake.emitActivityEntry).toHaveBeenCalledWith(expect.objectContaining({
      level: 'error',
      issueId,
      message: expect.stringContaining('3 consecutive foreman respawn failures'),
    }));
    expect(actions).toContain('[swarm-janitor] PAN-3680 swarm halted after 3 consecutive foreman respawn failures; operator action is required.');
  });

  it('defers respawn when the resource governor has no work capacity', async () => {
    const fake = deps({ workResumeSlotsAvailable: vi.fn(() => 0) });

    const actions = await swarmJanitorPass(fake);

    expect(fake.ensureSwarmForeman).not.toHaveBeenCalled();
    expect(actions).toContain('[swarm-janitor] deferred foreman respawn for PAN-3680: resource governor');
  });
});
