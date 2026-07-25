import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

// Mock child_process so `which docker` and `docker network ls` are scripted per test.
const execSyncMock = vi.fn<(cmd: string, opts?: unknown) => string>();
const execMock = vi.fn<(cmd: string, opts?: unknown) => Promise<{ stdout: string; stderr: string }>>();

vi.mock('child_process', async () => {
  const actual = await vi.importActual<typeof import('child_process')>('child_process');
  return {
    ...actual,
    execSync: (cmd: string, opts?: unknown) => execSyncMock(cmd, opts),
    exec: (cmd: string, opts: unknown, callback?: unknown) => {
      // Normalize the callback-style exec API to our mock promise.
      const cb = typeof opts === 'function' ? opts : callback;
      execMock(cmd, typeof opts === 'function' ? undefined : opts)
        .then((result) => (cb as any)?.(null, result))
        .catch((err) => (cb as any)?.(err));
      return { on: vi.fn() };
    },
  };
});

// Mock fs.promises.readFile for /etc/docker/daemon.json.
const readFileMock = vi.fn<(path: string, encoding: string) => Promise<string>>();
vi.mock('fs', async () => {
  const actual = await vi.importActual<typeof import('fs')>('fs');
  return {
    ...actual,
    promises: {
      ...actual.promises,
      readFile: (path: string, encoding: string) => readFileMock(path, encoding),
    },
  };
});

import { checkDockerBridgeNetworkPool } from '../doctor.js';

/** 10.200.0.0/16 carved at size 24 → 2^(24-16) = 256 slots. */
const WIDE_POOLS = JSON.stringify({ 'default-address-pools': [{ base: '10.200.0.0/16', size: 24 }] });

describe('doctor checkDockerBridgeNetworkPool (PAN-2510, PAN-3053)', () => {
  beforeEach(() => {
    execSyncMock.mockReset();
    execMock.mockReset();
    readFileMock.mockReset();

    // Docker is on PATH by default.
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which docker')) return '/usr/bin/docker\n';
      throw new Error(`unexpected execSync: ${cmd}`);
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('returns an empty array when docker is not installed', async () => {
    execSyncMock.mockImplementation((cmd: string) => {
      if (cmd.startsWith('which docker')) throw new Error('not found');
      throw new Error(`unexpected execSync: ${cmd}`);
    });

    const results = await checkDockerBridgeNetworkPool();

    expect(results).toEqual([]);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('asks docker for every bridge network rather than filtering by name', async () => {
    execMock.mockResolvedValue({ stdout: 'bridge\n', stderr: '' });
    readFileMock.mockResolvedValue(WIDE_POOLS);

    await checkDockerBridgeNetworkPool();

    expect(execMock).toHaveBeenCalledWith(
      expect.stringContaining('--filter driver=bridge'),
      undefined,
    );
  });

  it('warns on the host-wide bridge count, not the overdeck-named subset', async () => {
    // PAN-3053 regression: only 12 of these carry the `overdeck-feature-*_devnet`
    // name the old check filtered on, so it reported 12 against a threshold of
    // 26 — healthy — while the host sat 5 slots from total exhaustion.
    const networks = [
      'bridge',
      'overdeck',
      'panopticon',
      'myn-main_devnet',
      ...Array.from({ length: 10 }, (_, i) => `myn-feature-min-${800 + i}_devnet`),
      ...Array.from({ length: 12 }, (_, i) => `overdeck-feature-pan-${1000 + i}_devnet`),
    ];
    expect(networks).toHaveLength(26);

    execMock.mockResolvedValue({ stdout: networks.join('\n'), stderr: '' });
    readFileMock.mockRejectedValue(new Error('ENOENT')); // no daemon.json → default ~31 limit

    const results = await checkDockerBridgeNetworkPool();

    const warning = results.find((r) => r.name === 'Docker bridge network pool');
    expect(warning?.status).toBe('warn');
    expect(warning?.message).toContain('26 of ~31');
    expect(warning?.message).toContain('5 left');
    // The per-prefix breakdown survives as diagnostic detail.
    expect(warning?.message).toContain('overdeck-feature-* 12');
    expect(warning?.message).toContain('myn-feature-* 10');
    expect(warning?.message).toContain('other 4');
  });

  it('reports an error once the pool is fully consumed', async () => {
    const networks = Array.from({ length: 31 }, (_, i) => `myn-feature-min-${800 + i}_devnet`);
    execMock.mockResolvedValue({ stdout: networks.join('\n'), stderr: '' });
    readFileMock.mockRejectedValue(new Error('ENOENT'));

    const results = await checkDockerBridgeNetworkPool();

    const check = results.find((r) => r.name === 'Docker bridge network pool');
    expect(check?.status).toBe('error');
    expect(check?.message).toContain('31 bridge networks');
    expect(check?.message).toContain('cannot be created');
    expect(check?.fix).toContain('default-address-pools');
  });

  it('derives the limit from default-address-pools instead of false-alarming at 26', async () => {
    const networks = Array.from({ length: 40 }, (_, i) => `overdeck-feature-pan-${1000 + i}_devnet`);
    execMock.mockResolvedValue({ stdout: networks.join('\n'), stderr: '' });
    readFileMock.mockResolvedValue(WIDE_POOLS);

    const results = await checkDockerBridgeNetworkPool();

    expect(results).toHaveLength(1);
    expect(results[0].status).toBe('ok');
    expect(results[0].message).toContain('40 of ~256');
  });

  it('warns when daemon.json lacks default-address-pools', async () => {
    execMock.mockResolvedValue({ stdout: 'overdeck-feature-pan-1234_devnet\n', stderr: '' });
    readFileMock.mockResolvedValue(JSON.stringify({}));

    const results = await checkDockerBridgeNetworkPool();

    const warning = results.find((r) => r.name === 'Docker default-address-pools');
    expect(warning?.status).toBe('warn');
    expect(warning?.message).toContain('/etc/docker/daemon.json');
    expect(warning?.fix).toContain('default-address-pools');
  });

  it('returns ok when few networks exist and default-address-pools is configured', async () => {
    execMock.mockResolvedValue({ stdout: 'overdeck-feature-pan-1234_devnet\n', stderr: '' });
    readFileMock.mockResolvedValue(WIDE_POOLS);

    const results = await checkDockerBridgeNetworkPool();

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Docker bridge network pool');
    expect(results[0].status).toBe('ok');
    expect(results[0].message).toContain('1 of ~256');
  });

  it('treats a missing daemon.json as absent default-address-pools', async () => {
    execMock.mockResolvedValue({ stdout: '', stderr: '' });
    readFileMock.mockRejectedValue(new Error('ENOENT'));

    const results = await checkDockerBridgeNetworkPool();

    const warning = results.find((r) => r.name === 'Docker default-address-pools');
    expect(warning?.status).toBe('warn');
  });

  it('does not use execSync for docker network or daemon.json reads', async () => {
    execMock.mockResolvedValue({ stdout: '', stderr: '' });
    readFileMock.mockResolvedValue(JSON.stringify({ 'default-address-pools': [] }));

    await checkDockerBridgeNetworkPool();

    const syncDockerCalls = execSyncMock.mock.calls.filter((call) =>
      String(call[0]).includes('docker network') || String(call[0]).includes('daemon.json'),
    );
    expect(syncDockerCalls).toEqual([]);
  });
});
