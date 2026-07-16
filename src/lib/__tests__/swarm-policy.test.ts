import { describe, expect, it } from 'vitest';
import { resolveSwarmPolicyLayers } from '../swarm-policy.js';

describe('resolveSwarmPolicyLayers', () => {
  it('defaults automatic swarming off', () => {
    expect(resolveSwarmPolicyLayers()).toMatchObject({ mode: 'off', maxSlots: 3, autoAdvance: true });
  });
  it('resolves fields independently with cli > issue > project > global', () => {
    expect(resolveSwarmPolicyLayers({ mode: 'auto', maxSlots: 2, autoAdvance: false }, { mode: 'off', maxSlots: 4 }, { mode: 'always' }, { maxSlots: 1 }))
      .toEqual({ mode: 'always', maxSlots: 1, autoAdvance: false, source: { mode: 'issue', maxSlots: 'cli', autoAdvance: 'global' } });
  });
});
