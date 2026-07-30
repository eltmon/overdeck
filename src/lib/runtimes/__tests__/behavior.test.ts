import { describe, expect, it } from 'vitest';
import { KIMI_CODE_BEHAVIOR } from '@overdeck/contracts';

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

describe('kimi-code behavior matrix entry', () => {
  it('registers KIMI_CODE_BEHAVIOR for both lookup functions', () => {
    expect(getRuntimeBehavior('kimi-code')).toBe(KIMI_CODE_BEHAVIOR);
    expect(getHarnessBehavior('kimi-code')).toBe(KIMI_CODE_BEHAVIOR);
  });

  it('carries the native-Kimi discriminants', () => {
    expect(KIMI_CODE_BEHAVIOR.transcriptKind).toBe('kimi-wire-jsonl');
    expect(KIMI_CODE_BEHAVIOR.deliveryKind).toBe('pty-supervisor');
    expect(KIMI_CODE_BEHAVIOR.readinessKind).toBe('kimi-session-signal');
    expect(KIMI_CODE_BEHAVIOR.sessionIdSource).toBe('kimi-session-newest');
    expect(KIMI_CODE_BEHAVIOR.executableName).toBe('kimi');
    expect(KIMI_CODE_BEHAVIOR.processNames).toEqual(['kimi']);
    expect(KIMI_CODE_BEHAVIOR.supportsPtySupervisor).toBe(true);
    expect(KIMI_CODE_BEHAVIOR.readyTimeoutSeconds).toBe(60);
  });
});
