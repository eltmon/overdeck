import { createHash } from 'node:crypto';
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LINUX_INSTALL_COMMAND } from '../../../../src/lib/tailscale/installer.js';
import {
  SOCKET_WAIT_MS,
  USERSPACE_UNIT,
  installUserspaceTailscale,
  renderTailscaledUnit,
  restartUserspaceDaemon,
  tarballArch,
  type UserspaceDeps,
} from '../../../../src/lib/tailscale/userspace.js';

const FILE = 'tailscale_1.104.4_amd64.tgz';
const TARBALL = Buffer.from('fake tarball bytes');
const SHA = createHash('sha256').update(TARBALL).digest('hex');

function fakeFetch(overrides: { sha?: string; indexStatus?: number } = {}) {
  return vi.fn(async (url: string | URL | Request) => {
    const href = String(url);
    if (href.endsWith('/?mode=json')) {
      return new Response(JSON.stringify({ TarballsVersion: '1.104.4', Tarballs: { amd64: FILE } }), { status: overrides.indexStatus ?? 200 });
    }
    if (href.endsWith(`${FILE}.sha256`)) return new Response(`${overrides.sha ?? SHA}\n`);
    if (href.endsWith(FILE)) return new Response(TARBALL);
    return new Response('not found', { status: 404 });
  }) as unknown as typeof fetch & ReturnType<typeof vi.fn>;
}

/** Writes the two binaries where `tar -xzf` would. */
async function fakeExtract(_tarball: string, destDir: string): Promise<void> {
  const dir = join(destDir, FILE.replace(/\.tgz$/, ''));
  await mkdir(dir, { recursive: true });
  await writeFile(join(dir, 'tailscale'), 'cli');
  await writeFile(join(dir, 'tailscaled'), 'daemon');
}

let home: string;

beforeEach(async () => {
  home = await mkdtemp(join(tmpdir(), 'pan-1254-userspace-'));
});

afterEach(async () => {
  vi.useRealTimers();
  await rm(home, { recursive: true, force: true });
});

function deps(overrides: Partial<UserspaceDeps> = {}): UserspaceDeps {
  return {
    overdeckHome: home,
    arch: 'x64',
    systemdAvailable: async () => true,
    fetch: fakeFetch(),
    extract: fakeExtract,
    installUnit: vi.fn(async () => undefined),
    enableUnitNow: vi.fn(async () => undefined),
    socketExists: async () => true,
    ...overrides,
  };
}

describe('renderTailscaledUnit', () => {
  it('renders the D-10 unit', () => {
    const text = renderTailscaledUnit('/h');
    expect(text).toContain('ExecStart=/h/tailscale/bin/tailscaled --tun=userspace-networking --statedir=/h/tailscale/state --socket=/h/tailscale/tailscaled.sock --outbound-http-proxy-listen=127.0.0.1:1055');
    expect(text).toContain('WantedBy=default.target');
    expect(text).toMatchInlineSnapshot(`
      "[Unit]
      Description=Overdeck userspace Tailscale
      After=network-online.target

      [Service]
      ExecStart=/h/tailscale/bin/tailscaled --tun=userspace-networking --statedir=/h/tailscale/state --socket=/h/tailscale/tailscaled.sock --outbound-http-proxy-listen=127.0.0.1:1055
      Restart=on-failure
      RestartSec=5

      [Install]
      WantedBy=default.target
      "
    `);
  });
});

describe('tarballArch', () => {
  it('maps Node architectures to tarball keys', () => {
    expect(tarballArch('x64')).toBe('amd64');
    expect(tarballArch('arm64')).toBe('arm64');
    expect(tarballArch('arm')).toBe('arm');
    expect(tarballArch('ia32')).toBe('386');
    expect(tarballArch('s390x')).toBeNull();
  });
});

describe('installUserspaceTailscale', () => {
  it('installs both binaries, the unit, and starts it', async () => {
    const d = deps();
    expect(await installUserspaceTailscale(d)).toEqual({ ok: true });
    const bin = join(home, 'tailscale', 'bin');
    expect((await readdir(bin)).sort()).toEqual(['tailscale', 'tailscaled']);
    expect((await stat(join(bin, 'tailscaled'))).mode & 0o777).toBe(0o755);
    expect((await stat(join(home, 'tailscale'))).mode & 0o777).toBe(0o700);
    expect(await readFile(join(bin, 'tailscale'), 'utf8')).toBe('cli');
    expect((await readdir(join(home, 'tailscale'))).filter((name) => name.startsWith('.download-'))).toEqual([]);
    expect(d.installUnit).toHaveBeenCalledWith(USERSPACE_UNIT, renderTailscaledUnit(home));
    expect(d.enableUnitNow).toHaveBeenCalledWith(USERSPACE_UNIT);
  });

  it('returns no-systemd and downloads nothing when systemd user units are unavailable', async () => {
    const fetchMock = fakeFetch();
    const result = await installUserspaceTailscale(deps({ systemdAvailable: async () => false, fetch: fetchMock }));
    expect(result).toMatchObject({ ok: false, reason: 'no-systemd', fallbackCommand: LINUX_INSTALL_COMMAND });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns unsupported-arch for an architecture with no tarball', async () => {
    expect(await installUserspaceTailscale(deps({ arch: 's390x' }))).toMatchObject({ ok: false, reason: 'unsupported-arch' });
  });

  it('returns download-failed when the package index fails', async () => {
    expect(await installUserspaceTailscale(deps({ fetch: fakeFetch({ indexStatus: 503 }) }))).toMatchObject({
      ok: false,
      reason: 'download-failed',
      fallbackCommand: LINUX_INSTALL_COMMAND,
    });
  });

  it('returns checksum-mismatch and writes no binary', async () => {
    const result = await installUserspaceTailscale(deps({ fetch: fakeFetch({ sha: 'f'.repeat(64) }) }));
    expect(result).toMatchObject({ ok: false, reason: 'checksum-mismatch' });
    await expect(readdir(join(home, 'tailscale', 'bin'))).rejects.toThrow();
  });

  it('returns unit-failed when systemd refuses the unit', async () => {
    const result = await installUserspaceTailscale(deps({ enableUnitNow: async () => { throw new Error('Failed to enable'); } }));
    expect(result).toMatchObject({ ok: false, reason: 'unit-failed' });
  });

  it('returns daemon-timeout when the socket never appears within 10 s', async () => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    let firstPoll!: () => void;
    const polled = new Promise<void>((resolve) => { firstPoll = resolve; });
    const socketExists = vi.fn(async () => {
      firstPoll();
      return false;
    });
    let settled = false;
    const pending = installUserspaceTailscale(deps({ socketExists })).finally(() => { settled = true; });
    // The download and file writes are real I/O; wait for the socket wait to begin.
    await polled;
    await vi.advanceTimersByTimeAsync(SOCKET_WAIT_MS - 250);
    expect(settled).toBe(false);
    await vi.advanceTimersByTimeAsync(250);
    expect(await pending).toMatchObject({ ok: false, reason: 'daemon-timeout' });
  });
});

describe('restartUserspaceDaemon', () => {
  it('restarts the unit and waits for the socket', async () => {
    const restartUnit = vi.fn(async () => undefined);
    expect(await restartUserspaceDaemon({ overdeckHome: home, restartUnit, socketExists: async () => true })).toEqual({ ok: true });
    expect(restartUnit).toHaveBeenCalledWith(USERSPACE_UNIT);
  });

  it('returns unit-failed when systemctl fails', async () => {
    const result = await restartUserspaceDaemon({ overdeckHome: home, restartUnit: async () => { throw new Error('not loaded'); } });
    expect(result).toMatchObject({ ok: false, reason: 'unit-failed', fallbackCommand: LINUX_INSTALL_COMMAND });
  });
});
