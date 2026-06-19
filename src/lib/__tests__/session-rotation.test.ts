import { describe, it, expect } from 'vitest';

import { ALLOW_SESSION_ROTATION_ON_RESUME, sessionRotationRefused } from '../session-rotation.js';

describe('session rotation policy (PAN-1980)', () => {
  it('rotation is disabled by default', () => {
    expect(ALLOW_SESSION_ROTATION_ON_RESUME).toBe(false);
  });

  it('refuses a compact-recovery respawn — it would rotate to a new transcript', () => {
    expect(sessionRotationRefused({ compactSeed: true, driftReasons: [] })).toBe(true);
  });

  it('refuses a model/harness-drift resume', () => {
    expect(sessionRotationRefused({ compactSeed: false, driftReasons: ['model a→b'] })).toBe(true);
  });

  it('does NOT refuse a normal resume (no compaction, no drift) — it re-attaches to the saved session', () => {
    expect(sessionRotationRefused({ compactSeed: false, driftReasons: [] })).toBe(false);
  });
});
