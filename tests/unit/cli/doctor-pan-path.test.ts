/**
 * PAN-2630 (WI-5): `pan doctor` reports whether `pan` resolves on PATH —
 * warn (not error) when it doesn't, since agents get it from the launcher's
 * own shim regardless.
 */
import { describe, expect, it } from 'vitest';

import { checkPanOnPath } from '../../../src/cli/commands/doctor-pan-path.js';

describe('checkPanOnPath', () => {
  it('reports ok with "(Overdeck shim)" when pan resolves inside the shim dir', () => {
    const result = checkPanOnPath({
      pathEnv: '/h/cli-bin:/usr/bin',
      shimDir: '/h/cli-bin',
      find: () => '/h/cli-bin/pan',
    });

    expect(result.status).toBe('ok');
    expect(result.message).toBe('/h/cli-bin/pan (Overdeck shim)');
  });

  it('reports ok with the resolved path when pan resolves elsewhere', () => {
    const result = checkPanOnPath({
      pathEnv: '/usr/local/bin:/h/cli-bin',
      shimDir: '/h/cli-bin',
      find: () => '/usr/local/bin/pan',
    });

    expect(result.status).toBe('ok');
    expect(result.message).toBe('/usr/local/bin/pan');
  });

  it('reports warn with the three remedies when pan is missing', () => {
    const result = checkPanOnPath({
      pathEnv: '/usr/bin',
      shimDir: '/h/cli-bin',
      find: () => null,
    });

    expect(result.status).toBe('warn');
    expect(result.message).toContain('/h/cli-bin');
    expect(result.fix).toContain('npm install -g @overdeck/core');
    expect(result.fix).toContain('npm link');
    expect(result.fix).toContain('export PATH="/h/cli-bin:$PATH"');
  });
});
