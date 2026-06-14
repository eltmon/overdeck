import { describe, expect, it } from 'vitest';

import {
  applyBootGateEnv,
  DEACON_GATE_SOURCE_ENV,
  RESUME_GATE_SOURCE_ENV,
  resolveBootGates,
} from '../boot-gates.js';

describe('boot gate env resolution', () => {
  it('lets --deacon override inherited PANOPTICON_DISABLE_DEACON', () => {
    const env = applyBootGateEnv({
      PANOPTICON_DISABLE_DEACON: '1',
    }, { deacon: true });

    expect(env.PANOPTICON_DISABLE_DEACON).toBeUndefined();
    expect(env[DEACON_GATE_SOURCE_ENV]).toBe('flag');
    expect(resolveBootGates({}, env).deacon).toEqual({ enabled: true, source: 'flag' });
  });

  it('lets --resume override inherited PANOPTICON_NO_RESUME', () => {
    const env = applyBootGateEnv({
      PANOPTICON_NO_RESUME: '1',
    }, { resume: true });

    expect(env.PANOPTICON_NO_RESUME).toBeUndefined();
    expect(env[RESUME_GATE_SOURCE_ENV]).toBe('flag');
    expect(resolveBootGates({}, env).resume).toEqual({ enabled: true, source: 'flag' });
  });

  it('preserves inherited gates when no flag is provided', () => {
    const env = applyBootGateEnv({
      PANOPTICON_DISABLE_DEACON: 'true',
      PANOPTICON_NO_RESUME: 'yes',
    });

    expect(env.PANOPTICON_DISABLE_DEACON).toBe('1');
    expect(env.PANOPTICON_NO_RESUME).toBe('1');
    expect(resolveBootGates({}, env)).toEqual({
      deacon: { enabled: false, source: 'env' },
      resume: { enabled: false, source: 'env' },
    });
  });
});
