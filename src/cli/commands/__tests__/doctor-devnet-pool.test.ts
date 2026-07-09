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

import { checkDevnetNetworkPool } from '../doctor.js';

describe('doctor checkDevnetNetworkPool (PAN-2510)', () => {
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

    const results = await checkDevnetNetworkPool();

    expect(results).toEqual([]);
    expect(execMock).not.toHaveBeenCalled();
  });

  it('warns when the devnet count is within 5 of the ~31 default pool limit', async () => {
    const networks = Array.from({ length: 28 }, (_, i) => `overdeck-feature-pan-${1000 + i}_devnet`);
    execMock.mockResolvedValue({ stdout: networks.join('\n'), stderr: '' });
    readFileMock.mockResolvedValue(JSON.stringify({ 'default-address-pools': [{ base: '10.200.0.0/16', size: 24 }] }));

    const results = await checkDevnetNetworkPool();

    const warning = results.find((r) => r.name === 'Docker devnet pool');
    expect(warning).toBeDefined();
    expect(warning?.status).toBe('warn');
    expect(warning?.message).toContain('28');
    expect(warning?.message).toContain('~31');
    expect(warning?.fix).toContain('default-address-pools');
  });

  it('warns when daemon.json lacks default-address-pools', async () => {
    execMock.mockResolvedValue({ stdout: 'overdeck-feature-pan-1234_devnet\n', stderr: '' });
    readFileMock.mockResolvedValue(JSON.stringify({}));

    const results = await checkDevnetNetworkPool();

    const warning = results.find((r) => r.name === 'Docker default-address-pools');
    expect(warning).toBeDefined();
    expect(warning?.status).toBe('warn');
    expect(warning?.message).toContain('/etc/docker/daemon.json');
    expect(warning?.fix).toContain('default-address-pools');
  });

  it('returns ok when few networks exist and default-address-pools is configured', async () => {
    execMock.mockResolvedValue({ stdout: 'overdeck-feature-pan-1234_devnet\n', stderr: '' });
    readFileMock.mockResolvedValue(JSON.stringify({ 'default-address-pools': [{ base: '10.200.0.0/16', size: 24 }] }));

    const results = await checkDevnetNetworkPool();

    expect(results).toHaveLength(1);
    expect(results[0].name).toBe('Docker devnet pool');
    expect(results[0].status).toBe('ok');
    expect(results[0].message).toContain('1 devnet networks');
  });

  it('treats a missing daemon.json as absent default-address-pools', async () => {
    execMock.mockResolvedValue({ stdout: '', stderr: '' });
    readFileMock.mockRejectedValue(new Error('ENOENT'));

    const results = await checkDevnetNetworkPool();

    const warning = results.find((r) => r.name === 'Docker default-address-pools');
    expect(warning?.status).toBe('warn');
  });

  it('ignores non-overdeck networks when counting devnets', async () => {
    execMock.mockResolvedValue({
      stdout: ['bridge', 'host', 'overdeck-feature-pan-1234_devnet', 'some-custom_devnet'].join('\n'),
      stderr: '',
    });
    readFileMock.mockResolvedValue(JSON.stringify({ 'default-address-pools': [{ base: '10.200.0.0/16', size: 24 }] }));

    const results = await checkDevnetNetworkPool();

    const ok = results.find((r) => r.status === 'ok');
    expect(ok?.message).toContain('1 devnet networks');
  });

  it('does not use execSync for docker network or daemon.json reads', async () => {
    execMock.mockResolvedValue({ stdout: '', stderr: '' });
    readFileMock.mockResolvedValue(JSON.stringify({ 'default-address-pools': [] }));

    await checkDevnetNetworkPool();

    const syncDockerCalls = execSyncMock.mock.calls.filter((call) =>
      String(call[0]).includes('docker network') || String(call[0]).includes('daemon.json'),
    );
    expect(syncDockerCalls).toEqual([]);
  });
});
