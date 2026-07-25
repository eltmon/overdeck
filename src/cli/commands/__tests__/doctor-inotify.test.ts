import { describe, expect, it } from 'vitest';

import type { InotifySample } from '../../../lib/system-health/inotify.js';
import { checkInotify } from '../doctor-inotify.js';

function sample(overrides: Partial<InotifySample> = {}): InotifySample {
  return {
    watchesUsed: 100_000,
    watchesMax: 1_048_576,
    instancesUsed: 80,
    instancesMax: 8_192,
    topConsumers: [
      { pid: 46738, watches: 156_936, command: 'node ./node_modules/.bin/vite --host 0.0.0.0' },
    ],
    ...overrides,
  };
}

describe('checkInotify', () => {
  it('returns nothing on non-Linux platforms', async () => {
    const results = await checkInotify({ platform: 'darwin' });
    expect(results).toEqual([]);
  });

  it('reports ok usage and ok persistence when healthy and persisted', async () => {
    const results = await checkInotify({
      platform: 'linux',
      sample: async () => sample(),
      readPersistedLimit: async () => 1_048_576,
    });
    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ name: 'inotify watch budget', status: 'ok' });
    expect(results[1]).toMatchObject({ name: 'inotify limit persistence', status: 'ok' });
  });

  it('warns above the warning band and names top consumers', async () => {
    const results = await checkInotify({
      platform: 'linux',
      sample: async () => sample({ watchesUsed: 850_000 }),
      readPersistedLimit: async () => 1_048_576,
    });
    expect(results[0]).toMatchObject({ name: 'inotify watch budget', status: 'warn' });
    expect(results[0]!.message).toContain('81%');
    expect(results[0]!.message).toContain('vite');
    expect(results[0]!.fix).toContain('sudo tee /etc/sysctl.d/99-inotify.conf');
  });

  it('errors above the critical band', async () => {
    const results = await checkInotify({
      platform: 'linux',
      sample: async () => sample({ watchesUsed: 957_119 }),
      readPersistedLimit: async () => 1_048_576,
    });
    expect(results[0]).toMatchObject({ name: 'inotify watch budget', status: 'error' });
    expect(results[0]!.message).toContain('will fail with ENOSPC');
  });

  it('warns when the live limit is not persisted', async () => {
    const results = await checkInotify({
      platform: 'linux',
      sample: async () => sample(),
      readPersistedLimit: async () => null,
    });
    expect(results[1]).toMatchObject({ name: 'inotify limit persistence', status: 'warn' });
    expect(results[1]!.message).toContain('not persisted');
  });

  it('warns when the persisted limit is lower than the live limit', async () => {
    const results = await checkInotify({
      platform: 'linux',
      sample: async () => sample(),
      readPersistedLimit: async () => 65_536,
    });
    expect(results[1]).toMatchObject({ name: 'inotify limit persistence', status: 'warn' });
    expect(results[1]!.message).toContain('a reboot lowers it');
  });

  it('degrades to a warning when /proc cannot be scanned', async () => {
    const results = await checkInotify({
      platform: 'linux',
      sample: async () => null,
      readPersistedLimit: async () => null,
    });
    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'inotify watch budget', status: 'warn' });
  });
});
