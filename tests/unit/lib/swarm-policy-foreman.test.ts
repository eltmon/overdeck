import { beforeEach, describe, expect, it, vi } from 'vitest';

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


});
