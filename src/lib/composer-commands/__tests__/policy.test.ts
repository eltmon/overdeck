import { COMPOSER_COMMAND_MANIFEST, type ComposerCommandPolicy } from '@overdeck/contracts';
import { describe, expect, it } from 'vitest';
import {
  assertPolicyOverlayIntegrity,
  COMPOSER_COMMAND_POLICIES,
  resolvePolicy,
} from '../policy.js';

const EXPECTED_POLICIES: ReadonlyArray<{
  path: string[];
  policy: ComposerCommandPolicy;
}> = [
  { path: ['start'], policy: { mode: 'detached', safety: 'safe' } },
  { path: ['plan'], policy: { mode: 'detached', safety: 'safe' } },
  { path: ['show'], policy: { mode: 'captured', safety: 'safe' } },
  { path: ['status'], policy: { mode: 'captured', safety: 'safe' } },
  { path: ['tell'], policy: { mode: 'captured', safety: 'safe' } },
  { path: ['handoff'], policy: { mode: 'ui', safety: 'dialog', uiAction: 'handoff' } },
  { path: ['fork'], policy: { mode: 'ui', safety: 'dialog', uiAction: 'fork' } },
];

describe('composer command policy', () => {
  it('resolves the registered execution and safety policies', () => {
    for (const expected of EXPECTED_POLICIES) {
      expect(resolvePolicy(expected.path)).toEqual(expected.policy);
    }
    expect(Object.keys(COMPOSER_COMMAND_POLICIES)).toHaveLength(EXPECTED_POLICIES.length);
  });

  it('defaults unregistered manifest commands to terminal-only', () => {
    expect(resolvePolicy(['doctor'])).toEqual({
      mode: 'terminal-only',
      safety: 'safe',
    });
  });

  it('requires every overlay key to match exactly one manifest entry', () => {
    expect(() => assertPolicyOverlayIntegrity()).not.toThrow();
    expect(() => assertPolicyOverlayIntegrity({
      missing: { mode: 'captured', safety: 'safe' },
    })).toThrow('must match exactly one manifest entry; found 0');

    const start = COMPOSER_COMMAND_MANIFEST.find(entry => entry.path.join(' ') === 'start');
    expect(start).toBeDefined();
    expect(() => assertPolicyOverlayIntegrity({
      start: { mode: 'detached', safety: 'safe' },
    }, [start!, start!])).toThrow('must match exactly one manifest entry; found 2');
  });
});
