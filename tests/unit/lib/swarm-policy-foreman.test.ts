import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Effect } from 'effect';

const policy = vi.hoisted(() => ({ mode: 'off' as 'off' | 'auto' | 'always', autoAdvance: true }));

vi.mock('../../../src/lib/config-yaml.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/lib/config-yaml.js')>(),
  loadConfigSync: () => ({ config: { swarm: { mode: policy.mode, maxSlots: 3, autoAdvance: policy.autoAdvance } } }),
}));
vi.mock('../../../src/lib/projects.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/lib/projects.js')>(),
  getProjectSync: vi.fn(),
  resolveProjectFromIssueSync: vi.fn(() => undefined),
}));
vi.mock('../../../src/lib/pan-dir/record.js', async importOriginal => ({
  ...await importOriginal<typeof import('../../../src/lib/pan-dir/record.js')>(),
  readIssueRecordSync: vi.fn(),
}));

import { resolveAutomaticSwarmPolicy } from '../../../src/lib/swarm-policy.js';
import { swarmJanitorPass, type CoordinateSwarmSlotsDeps } from '../../../src/lib/cloister/deacon-swarm.js';

describe('foreman-based automatic swarm policy', () => {
  beforeEach(() => {
    policy.mode = 'off';
    policy.autoAdvance = true;
  });

  it('returns foreman spawn and wave-pacing decisions', () => {
    policy.mode = 'auto';
    policy.autoAdvance = false;
    expect(resolveAutomaticSwarmPolicy('PAN-3680', true)).toMatchObject({
      spawnForeman: true,
      requireSwarmReadiness: false,
      advanceWavesWithoutConfirmation: false,
      reason: 'eligible',
    });

    policy.mode = 'always';
    expect(resolveAutomaticSwarmPolicy('PAN-3680', false)).toMatchObject({
      spawnForeman: false,
      requireSwarmReadiness: true,
      reason: 'not-ready',
    });
  });

  it('lets the janitor spawn a foreman for auto eligibility without spawning slots', async () => {
    policy.mode = 'auto';
    const ensureSwarmForeman = vi.fn(async () => ['[swarm] spawned foreman agent-pan-3680 for PAN-3680']);
    const spawnRun = vi.fn();
    const deps = janitorDeps({ ensureSwarmForeman, spawnRun });

    await swarmJanitorPass(deps);

    expect(ensureSwarmForeman).toHaveBeenCalledOnce();
    expect(spawnRun).not.toHaveBeenCalled();
  });

  it('prevents janitor foreman spawn in off mode while leaving manual policy bypass explicit', async () => {
    policy.mode = 'off';
    const ensureSwarmForeman = vi.fn(async () => []);

    await swarmJanitorPass(janitorDeps({ ensureSwarmForeman }));

    expect(ensureSwarmForeman).not.toHaveBeenCalled();
    expect(resolveAutomaticSwarmPolicy('PAN-3680', false, true).spawnForeman).toBe(true);
  });
});

function janitorDeps(overrides: Record<string, unknown> = {}): CoordinateSwarmSlotsDeps {
  const item = {
    id: 'wi-1', title: 'Independent work', status: 'pending' as const,
    metadata: { readiness: 'ready' as const, files_scope: ['src/a.ts'], files_scope_confidence: 'high' as const, verify_commands: ['npm test'], expected_outputs: ['passes'] },
  };
  return {
    listFeatureWorkspaces: vi.fn(() => [{ issueId: 'PAN-3680', workspacePath: '/repo/workspaces/feature-pan-3680', projectPath: '/repo' }]),
    findSpecByIssue: vi.fn(() => Effect.succeed({ document: { plan: { items: [item], edges: [] } } })),
    reconcileSlotState: vi.fn(async () => ({ issueId: 'PAN-3680', merged: [], inFlight: [], pending: [], branches: [], agents: [] })),
    listSessionNames: vi.fn(async () => []),
    listSlotAssignments: vi.fn(() => []),
    readSwarmHold: vi.fn(() => undefined),
    workResumeSlotsAvailable: vi.fn(() => 1),
    clearSlotAssignment: vi.fn(async () => undefined),
    runGitCommand: vi.fn(async () => ({ stdout: '' })),
    slotWorktreeExists: vi.fn(() => false),
    resolveAutomaticSwarmPolicy,
    ...overrides,
  } as unknown as CoordinateSwarmSlotsDeps;
}
