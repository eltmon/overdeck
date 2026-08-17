import { Effect } from 'effect';
import { describe, expect, it, vi } from 'vitest';
import {
  swarmFreezeCommand,
  swarmRecoverCommand,
  swarmResumeCommand,
  type SwarmCommandDeps,
  type SwarmHoldCommandDeps,
} from '../../../../src/cli/commands/swarm.js';
import type { PanIssueSwarmRecord } from '../../../../src/lib/pan-dir/record.js';

function holdDeps(initial?: NonNullable<PanIssueSwarmRecord['hold']>): SwarmHoldCommandDeps {
  let hold = initial;
  return {
    getIssueWorkspacePath: vi.fn(() => '/repo/workspaces/feature-pan-3680'),
    readSwarmHold: vi.fn(() => hold),
    writeSwarmHold: vi.fn(async (_workspace, _issue, next) => { hold = next; }),
    clearSwarmHold: vi.fn(async () => { hold = undefined; }),
    appendOperatorInterventionEvent: vi.fn(async () => undefined),
    now: () => '2026-08-13T12:00:00.000Z',
    console: { log: vi.fn(), error: vi.fn() },
  };
}

describe('pan swarm durable hold and intervention gates', () => {
  it('freeze writes swarm.hold through the record door and resume clears it without touching deaconIgnored', async () => {
    const deps = holdDeps();

    await swarmFreezeCommand('pan-3680', { reason: 'inspect semantic drift' }, deps);

    expect(deps.writeSwarmHold).toHaveBeenCalledWith('/repo/workspaces/feature-pan-3680', 'PAN-3680', {
      reason: 'inspect semantic drift',
      setBy: 'pan swarm freeze',
      at: '2026-08-13T12:00:00.000Z',
    });
    expect(deps).not.toHaveProperty('setDeaconIgnored');

    await swarmResumeCommand('PAN-3680', deps);
    expect(deps.clearSwarmHold).toHaveBeenCalledWith('/repo/workspaces/feature-pan-3680', 'PAN-3680');
  });

  it('refuses a fourth same-class recovery without --operator and records no intervention', async () => {
    const recoverFailedMergeSlot = vi.fn(async () => ['recovered']);
    const writeSwarmIntervention = vi.fn(async () => 4);
    const deps = {
      resolveProjectFromIssueSync: vi.fn(() => ({ projectName: 'overdeck', projectPath: '/repo' })),
      findSpecByIssue: vi.fn(() => Effect.succeed({
        path: '/repo/spec.json', filename: 'spec.json', issueId: 'PAN-3680', status: 'active',
        document: { status: 'active', xBRIEFInfo: { version: '0.8' }, plan: { id: 'PAN-3680', title: 'test', status: 'active', items: [], edges: [] } },
      })),
      analyzeSwarmReadiness: vi.fn(),
      ensureWorkspace: vi.fn(async () => '/repo/workspaces/feature-pan-3680'),
      coordinateSwarmSlots: vi.fn(async () => []),
      getFailedMergeBlock: vi.fn(() => ({ issueId: 'PAN-3680', itemId: 'wi-1', slotIndex: 2, note: 'conflict' })),
      getFailedMergeBlocks: vi.fn(() => []),
      recoverFailedMergeSlot,
      resolveSwarmPolicy: vi.fn(),
      writeSwarmPolicyMode: vi.fn(),
      readSwarmHold: vi.fn(() => undefined),
      readSwarmInterventionCount: vi.fn(() => 3),
      writeSwarmIntervention,
      console: { log: vi.fn(), error: vi.fn() },
    } as unknown as SwarmCommandDeps;

    const result = await swarmRecoverCommand('PAN-3680', '2', { action: 'retry' }, deps);

    expect(result.ok).toBe(false);
    expect(recoverFailedMergeSlot).not.toHaveBeenCalled();
    expect(writeSwarmIntervention).not.toHaveBeenCalled();
  });
});
