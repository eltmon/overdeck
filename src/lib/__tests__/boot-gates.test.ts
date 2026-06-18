import { describe, expect, it } from 'vitest';

import {
  applyBootGateEnv,
  DEACON_GATE_SOURCE_ENV,
  RESUME_GATE_SOURCE_ENV,
  resolveBootGates,
} from '../boot-gates.js';

describe('boot gate env resolution', () => {
  it('lets --deacon override inherited OVERDECK_DISABLE_DEACON', () => {
    const env = applyBootGateEnv({
      OVERDECK_DISABLE_DEACON: '1',
    }, { deacon: true });

    expect(env.OVERDECK_DISABLE_DEACON).toBeUndefined();
    expect(env[DEACON_GATE_SOURCE_ENV]).toBe('flag');
    expect(resolveBootGates({}, env).deacon).toEqual({ enabled: true, source: 'flag' });
  });

  it('lets --resume override inherited OVERDECK_NO_RESUME', () => {
    const env = applyBootGateEnv({
      OVERDECK_NO_RESUME: '1',
    }, { resume: true });

    expect(env.OVERDECK_NO_RESUME).toBeUndefined();
    expect(env[RESUME_GATE_SOURCE_ENV]).toBe('flag');
    expect(resolveBootGates({}, env).resume).toEqual({ enabled: true, source: 'flag' });
  });

  it('preserves inherited gates when no flag is provided', () => {
    const env = applyBootGateEnv({
      OVERDECK_DISABLE_DEACON: 'true',
      OVERDECK_NO_RESUME: 'yes',
    });

    expect(env.OVERDECK_DISABLE_DEACON).toBe('1');
    expect(env.OVERDECK_NO_RESUME).toBe('1');
    expect(resolveBootGates({}, env)).toEqual({
      deacon: { enabled: false, source: 'env' },
      resume: { enabled: false, source: 'env' },
    });
  });

  it('defaults agent auto-resume to OFF when nothing opts in (PAN-1963)', () => {
    // No flag, no env → resume is off by default (deacon unaffected, stays on).
    expect(resolveBootGates({}, {})).toEqual({
      deacon: { enabled: true, source: 'default' },
      resume: { enabled: false, source: 'default' },
    });
    const env = applyBootGateEnv({});
    expect(env.OVERDECK_NO_RESUME).toBe('1');
    expect(env[RESUME_GATE_SOURCE_ENV]).toBe('default');
  });

  it('opts back into auto-resume via --resume', () => {
    expect(resolveBootGates({ resume: true }, {}).resume).toEqual({ enabled: true, source: 'flag' });
    const env = applyBootGateEnv({}, { resume: true });
    expect(env.OVERDECK_NO_RESUME).toBeUndefined();
  });

  it('opts back into auto-resume via OVERDECK_RESUME', () => {
    expect(resolveBootGates({}, { OVERDECK_RESUME: '1' }).resume).toEqual({ enabled: true, source: 'env' });
    const env = applyBootGateEnv({ OVERDECK_RESUME: '1' });
    expect(env.OVERDECK_NO_RESUME).toBeUndefined();
  });
});
