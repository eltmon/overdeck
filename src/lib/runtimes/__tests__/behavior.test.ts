import { describe, expect, it } from 'vitest';

import {
  CLAUDE_CODE_BEHAVIOR,
  getHarnessBehavior,
  getRuntimeBehavior,
} from '../behavior.js';

describe('harness native command capabilities', () => {
  it('publishes the verified Claude Code native command list', () => {
    expect(CLAUDE_CODE_BEHAVIOR.nativeCommands).toEqual([
      expect.objectContaining({ name: '/model', insert: '/model ' }),
      expect.objectContaining({ name: '/context', insert: '/context ' }),
      expect.objectContaining({ name: '/effort', insert: '/effort ' }),
      expect.objectContaining({ name: '/cancel', insert: '/cancel' }),
    ]);
  });

  it.each(['codex', 'ohmypi', 'acp'] as const)(
    'hides unverified native commands for %s',
    harness => {
      expect(getRuntimeBehavior(harness).nativeCommands).toEqual([]);
    },
  );

  it('normalizes the legacy pi name to the ohmypi capability list', () => {
    expect(getHarnessBehavior('pi').nativeCommands).toEqual([]);
    expect(getHarnessBehavior('pi')).toBe(getHarnessBehavior('ohmypi'));
  });
});
