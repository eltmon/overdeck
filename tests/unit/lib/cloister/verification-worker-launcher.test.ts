import { describe, expect, it } from 'vitest';

import { buildVerificationWorkerLaunch } from '../../../../src/lib/cloister/verification-worker-launcher.js';

describe('verification worker launcher', () => {
  it('uses an independent systemd user scope on Linux outside tests', () => {
    const launch = buildVerificationWorkerLaunch(
      'PAN-3814',
      '123-456',
      '/overdeck/dist/verification-worker.js',
      '{"request":true}',
      {},
      'linux',
    );

    expect(launch.command).toBe('systemd-run');
    expect(launch.systemdUnit).toBe('overdeck-verification-pan-3814-123-456');
    expect(launch.args).toEqual([
      '--user',
      '--scope',
      '--unit', 'overdeck-verification-pan-3814-123-456',
      '--collect',
      '--quiet',
      '--same-dir',
      process.execPath,
      '/overdeck/dist/verification-worker.js',
      '{"request":true}',
    ]);
  });

  it('uses direct detached execution on non-Linux platforms and ordinary unit tests', () => {
    expect(buildVerificationWorkerLaunch('PAN-1', 'run', '/worker.js', '{}', {}, 'darwin'))
      .toEqual({ command: process.execPath, args: ['/worker.js', '{}'] });
    expect(buildVerificationWorkerLaunch('PAN-1', 'run', '/worker.js', '{}', { VITEST: 'true' }, 'linux'))
      .toEqual({ command: process.execPath, args: ['/worker.js', '{}'] });
  });

  it('allows the systemd lifecycle integration to opt in under Vitest', () => {
    const launch = buildVerificationWorkerLaunch(
      'PAN-3814',
      'run',
      '/worker.js',
      '{}',
      { VITEST: 'true', OVERDECK_VERIFICATION_SYSTEMD_SCOPE: '1' },
      'linux',
    );

    expect(launch.command).toBe('systemd-run');
    expect(launch.args).toContain('--scope');
  });
});
