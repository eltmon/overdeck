/** PAN-4651 WI-2 (D-4651-8): capability tags follow the probe exit codes and operator config. */
import { describe, expect, it, vi } from 'vitest';

import {
  type CapabilityDeps,
  detectMachineProfile,
  peerMachineFacts,
} from '../machine-capabilities.js';
import { DEFAULT_MACHINE_CONFIG, type MachineConfig, parseMachineConfig } from '../machine-config.js';

function deps(options: { platform?: NodeJS.Platform; ok?: string[]; config?: MachineConfig } = {}) {
  const ok = new Set(options.ok ?? []);
  const warn = vi.fn();
  const execFile = vi.fn(async (file: string, args: readonly string[]) => {
    if (!ok.has(file)) throw Object.assign(new Error(`spawn ${file} ENOENT`), { code: 'ENOENT', args });
  });
  const value: CapabilityDeps = {
    platform: options.platform ?? 'linux',
    execFile,
    readConfig: async () => options.config ?? DEFAULT_MACHINE_CONFIG,
    warn,
  };
  return { value, warn, execFile };
}

describe('machine capability tags (D-4651-8)', () => {
  it('docker info exiting 0 adds docker; a missing binary adds nothing', async () => {
    expect((await detectMachineProfile(deps({ ok: ['docker'] }).value)).tags).toEqual(['docker', 'linux']);
    expect((await detectMachineProfile(deps().value)).tags).toEqual(['linux']);
  });

  it('probes with timeouts: docker 10 s, nvidia-smi 5 s, xcrun 10 s', async () => {
    const d = deps({ platform: 'darwin', ok: ['nvidia-smi', 'xcrun'] });
    expect((await detectMachineProfile(d.value)).tags).toEqual(['gpu', 'ios-sim', 'macos']);
    expect(d.execFile).toHaveBeenCalledWith('docker', ['info'], { timeout: 10_000 });
    expect(d.execFile).toHaveBeenCalledWith('nvidia-smi', ['-L'], { timeout: 5_000 });
    expect(d.execFile).toHaveBeenCalledWith('xcrun', ['simctl', 'list', 'devices'], { timeout: 10_000 });
  });

  it('only probes xcrun on macOS', async () => {
    const d = deps({ platform: 'linux', ok: ['xcrun'] });
    expect((await detectMachineProfile(d.value)).tags).toEqual(['linux']);
    expect(d.execFile).not.toHaveBeenCalledWith('xcrun', expect.anything(), expect.anything());
  });

  it('appends operator tags, lower-cased and sorted, and drops an invalid one with one warning', async () => {
    const d = deps({ platform: 'win32', config: { tags: ['Payments', 'big disk', 'linux', '-bad'], placement: 'on-request' } });
    const profile = await detectMachineProfile(d.value);
    expect(profile).toEqual({ tags: ['linux', 'payments', 'windows'], placement: 'on-request' });
    expect(d.warn).toHaveBeenCalledTimes(1);
    expect(d.warn.mock.calls[0]?.[0]).toContain('"big disk"');
  });

  it('reads anywhere.machine from a config document', () => {
    expect(parseMachineConfig({ anywhere: { machine: { tags: ['gpu-a100', 3], placement: 'on-request' } } }))
      .toEqual({ tags: ['gpu-a100'], placement: 'on-request' });
    expect(parseMachineConfig({ anywhere: { machine: { placement: 'sometimes' } } })).toEqual({ tags: [], placement: 'auto' });
    expect(parseMachineConfig(null)).toEqual(DEFAULT_MACHINE_CONFIG);
  });

  it('a peer heartbeat without the fields reads as no load, no tags and auto', () => {
    expect(peerMachineFacts({})).toEqual({ load: null, tags: [], placement: 'auto' });
    expect(peerMachineFacts({ load: { cpuSaturated: 'yes' }, tags: 'docker', placement: 'later' })).toEqual({ load: null, tags: [], placement: 'auto' });
  });
});
