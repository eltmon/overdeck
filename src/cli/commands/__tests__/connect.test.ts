/**
 * PAN-4656: `pan connect`. Every side effect is a fake `ConnectDeps` member;
 * nothing live runs and no test waits on real time.
 */
import type { NetworkInterfaceInfo } from 'node:os';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { runConnect, type ConnectDeps, type ServiceOutcome } from '../connect.js';

const CREDENTIAL = `odp_${'a'.repeat(64)}`;
const EXPIRES_AT = '2026-11-01T14:10:00.000Z';
const PRIMARY = { repoRoot: '/home/alice/.overdeck/runtime/node_modules/@overdeck/core', mode: 'primary' as const };
const NPX_ROOT = '/home/alice/.npm/_npx/3f2a/node_modules/@overdeck/core';

function v4(address: string): NetworkInterfaceInfo {
  return { address, netmask: '255.255.255.0', family: 'IPv4', mac: '00:00:00:00:00:00', internal: false, cidr: `${address}/24` };
}

function fakeDeps(overrides: Partial<ConnectDeps> = {}) {
  const stdout: string[] = [];
  const stderr: string[] = [];
  const release = vi.fn(async () => undefined);
  const deps: ConnectDeps = {
    platform: 'linux',
    env: { SSH_CONNECTION: '198.51.100.4 51234 203.0.113.7 22' },
    argv: ['/usr/bin/node', '/usr/lib/node_modules/@overdeck/core/dist/cli/index.js', 'connect'],
    execPath: '/usr/bin/node',
    isTTY: false,
    packageRoot: PRIMARY.repoRoot,
    version: '1.2.3',
    overdeckHome: '/home/alice/.overdeck',
    user: 'alice',
    interfaces: () => ({ eth0: [v4('203.0.113.7')] }),
    stdout: (line) => { stdout.push(line); },
    stderr: (line) => { stderr.push(line); },
    readRuntimeVersion: vi.fn(async () => null),
    ensureDurableRuntime: vi.fn(async () => ({ root: '/home/alice/.overdeck/runtime/node_modules/@overdeck/core', installed: true })),
    reexec: vi.fn(async () => 0),
    platformConfig: () => ({
      dashboardPort: 3010,
      dashboardApiPort: 3011,
      traefikEnabled: false,
      traefikDomain: 'overdeck.localhost',
      traefikDir: '/tmp/traefik',
    }),
    primaryIdentity: () => PRIMARY,
    waitForDashboardHealth: vi.fn(async () => undefined),
    probeDashboardRepoRoot: vi.fn(async () => null),
    acquireRestartLock: vi.fn(async () => ({ release })),
    restartDashboard: vi.fn(async () => undefined),
    supervisorUnitAllowed: () => true,
    explainSystemdUserUnavailable: vi.fn(async () => 'container' as const),
    startSupervisorProcess: vi.fn(),
    requestPairingLink: vi.fn(async ({ base }: { base: string }) => ({
      ok: true as const,
      url: `${base}/#pair=${CREDENTIAL}`,
      credential: CREDENTIAL,
      expiresAt: EXPIRES_AT,
      base,
    })),
    ...overrides,
  };
  return { deps, stdout, stderr, release };
}

/** Strips ANSI colour codes so assertions read plain text. */
function plain(lines: string[]): string {
  return lines.join('\n').replace(/\u001b\[[0-9;]*m/g, '');
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('pan connect: platform and runtime', () => {
  it('exits 1 on Windows with the WSL hint', async () => {
    const { deps, stderr } = fakeDeps({ platform: 'win32' });

    await expect(runConnect({}, deps)).resolves.toBe(1);
    expect(plain(stderr)).toBe('pan connect supports Linux and macOS; on Windows, run it inside WSL.');
    expect(deps.waitForDashboardHealth).not.toHaveBeenCalled();
  });

  it('under npx, installs the runtime and re-runs connect from it with the same flags', async () => {
    const { deps, stdout } = fakeDeps({
      packageRoot: NPX_ROOT,
      argv: ['/usr/bin/node', `${NPX_ROOT}/dist/cli/index.js`, 'connect', '--label', 'vps', '--url', 'http://box:3011'],
      reexec: vi.fn(async () => 7),
    });

    await expect(runConnect({ label: 'vps', url: 'http://box:3011' }, deps)).resolves.toBe(7);
    expect(deps.ensureDurableRuntime).toHaveBeenCalledWith('/home/alice/.overdeck', '1.2.3');
    expect(deps.reexec).toHaveBeenCalledWith(
      '/usr/bin/node',
      ['/home/alice/.overdeck/runtime/node_modules/@overdeck/core/dist/cli/index.js', 'connect', '--label', 'vps', '--url', 'http://box:3011'],
      expect.objectContaining({ OVERDECK_CONNECT_REEXEC: '1', SSH_CONNECTION: '198.51.100.4 51234 203.0.113.7 22' }),
    );
    expect(stdout).toEqual(['Installing @overdeck/core@1.2.3 into /home/alice/.overdeck/runtime (one time)…']);
    expect(deps.waitForDashboardHealth).not.toHaveBeenCalled();
  });

  it('under npx with --json, keeps the install line off stdout', async () => {
    const { deps, stdout, stderr } = fakeDeps({ packageRoot: NPX_ROOT });

    await expect(runConnect({ json: true }, deps)).resolves.toBe(0);
    expect(stdout).toEqual([]);
    expect(stderr).toEqual(['Installing @overdeck/core@1.2.3 into /home/alice/.overdeck/runtime (one time)…']);
  });

  it('does not print the install line when the runtime already has the version', async () => {
    const { deps, stdout } = fakeDeps({ packageRoot: NPX_ROOT, readRuntimeVersion: vi.fn(async () => '1.2.3') });

    await runConnect({}, deps);
    expect(stdout).toEqual([]);
    expect(deps.reexec).toHaveBeenCalledOnce();
  });

  it('never re-execs when OVERDECK_CONNECT_REEXEC=1, and names the runtime pan', async () => {
    const { deps, stdout } = fakeDeps({
      packageRoot: '/home/alice/.overdeck/runtime/node_modules/@overdeck/core',
      env: { OVERDECK_CONNECT_REEXEC: '1' },
    });

    await expect(runConnect({}, deps)).resolves.toBe(0);
    expect(deps.reexec).not.toHaveBeenCalled();
    expect(deps.ensureDurableRuntime).not.toHaveBeenCalled();
    expect(plain(stdout).split('\n').at(-1)).toBe('To run pan on this machine: /home/alice/.overdeck/runtime/node_modules/.bin/pan');
  });

  it('exits 1 with the npm error when the runtime install fails', async () => {
    const { deps, stderr } = fakeDeps({
      packageRoot: NPX_ROOT,
      ensureDurableRuntime: vi.fn(async () => { throw new Error('Could not install @overdeck/core@1.2.3 into /x: E404.'); }),
    });

    await expect(runConnect({}, deps)).resolves.toBe(1);
    expect(plain(stderr)).toContain('Could not install @overdeck/core@1.2.3');
    expect(deps.reexec).not.toHaveBeenCalled();
  });
});

describe('pan connect: dashboard (FR-3, FR-9)', () => {
  it('leaves a healthy primary dashboard running', async () => {
    const { deps } = fakeDeps();

    await expect(runConnect({}, deps)).resolves.toBe(0);
    expect(deps.waitForDashboardHealth).toHaveBeenCalledWith(3011, { timeoutMs: 2_000, expectedIdentity: PRIMARY });
    expect(deps.restartDashboard).not.toHaveBeenCalled();
    expect(deps.acquireRestartLock).not.toHaveBeenCalled();
  });

  it('replaces a foreign dashboard under the restart lock and says so', async () => {
    const { deps, stdout, release } = fakeDeps({
      waitForDashboardHealth: vi.fn(async () => { throw new Error('port held by non-primary server'); }),
      probeDashboardRepoRoot: vi.fn(async () => '/home/alice/Projects/overdeck'),
    });

    await expect(runConnect({}, deps)).resolves.toBe(0);
    expect(deps.acquireRestartLock).toHaveBeenCalledWith('pan connect');
    expect(deps.restartDashboard).toHaveBeenCalledWith(expect.objectContaining({ dashboardApiPort: 3011 }), PRIMARY);
    expect(release).toHaveBeenCalledOnce();
    expect(plain(stdout).split('\n')[0]).toBe('Replaced the dashboard that was running from /home/alice/Projects/overdeck.');
  });

  it('starts a dashboard when none runs, without a replaced line', async () => {
    const { deps, stdout } = fakeDeps({
      waitForDashboardHealth: vi.fn(async () => { throw new Error('never got a response'); }),
    });

    await expect(runConnect({}, deps)).resolves.toBe(0);
    expect(deps.restartDashboard).toHaveBeenCalledOnce();
    expect(plain(stdout)).not.toContain('Replaced the dashboard');
  });

  it('exits 1 when another restart holds the lock', async () => {
    const { deps, stderr } = fakeDeps({
      waitForDashboardHealth: vi.fn(async () => { throw new Error('down'); }),
      acquireRestartLock: vi.fn(async () => null),
    });

    await expect(runConnect({}, deps)).resolves.toBe(1);
    expect(plain(stderr)).toBe('A dashboard restart is already in progress; run pan connect again in a minute.');
    expect(deps.restartDashboard).not.toHaveBeenCalled();
    expect(deps.requestPairingLink).not.toHaveBeenCalled();
  });

  it('exits 1 and names the log when the dashboard does not start, releasing the lock', async () => {
    const { deps, stderr, release } = fakeDeps({
      waitForDashboardHealth: vi.fn(async () => { throw new Error('down'); }),
      restartDashboard: vi.fn(async () => { throw new Error('health timed out after 120000ms'); }),
    });

    await expect(runConnect({}, deps)).resolves.toBe(1);
    expect(plain(stderr)).toBe(
      'Could not start the dashboard: health timed out after 120000ms. Its log is /home/alice/.overdeck/logs/dashboard.log.',
    );
    expect(release).toHaveBeenCalledOnce();
  });
});

describe('pan connect: service and link', () => {
  it('falls back to a plain process and says why (FR-7)', async () => {
    const { deps, stdout } = fakeDeps();

    await expect(runConnect({}, deps)).resolves.toBe(0);
    expect(deps.startSupervisorProcess).toHaveBeenCalledOnce();
    expect(plain(stdout)).toContain(
      'No systemd user manager is available here (this is a container), so the server runs as a plain process: '
      + 'it stops when you log out and does not start after a reboot.',
    );
  });

  it('names the OVERDECK_HOME opt-in when the unit is not allowed', async () => {
    const { deps, stdout } = fakeDeps({ supervisorUnitAllowed: () => false });

    await runConnect({}, deps);
    expect(plain(stdout)).toContain('(OVERDECK_HOME is not ~/.overdeck — set OVERDECK_SUPERVISOR_UNIT=1 to allow the user service)');
    expect(deps.explainSystemdUserUnavailable).not.toHaveBeenCalled();
  });

  it('dispatches to the Linux installer when systemd is usable', async () => {
    const outcome: ServiceOutcome = {
      manager: 'systemd', name: 'overdeck-supervisor.service', enabled: true,
      line: 'user service overdeck-supervisor.service, enabled at boot.', linger: 'on', note: 'Lingering is on for alice.',
    };
    const installLinuxService = vi.fn(async () => outcome);
    const { deps, stdout } = fakeDeps({ explainSystemdUserUnavailable: vi.fn(async () => null), installLinuxService });

    await runConnect({}, deps);
    expect(installLinuxService).toHaveBeenCalledWith(expect.objectContaining({ user: 'alice', json: false, isTTY: false }));
    expect(deps.startSupervisorProcess).not.toHaveBeenCalled();
    expect(plain(stdout).split('\n').slice(0, 2)).toEqual([
      'Overdeck server: user service overdeck-supervisor.service, enabled at boot.',
      'Lingering is on for alice.',
    ]);
  });

  it('prints the link, the paste alternative, the expiry and the reachability hint in order', async () => {
    const { deps, stdout } = fakeDeps();

    await runConnect({ label: 'vps' }, deps);
    expect(deps.requestPairingLink).toHaveBeenCalledWith({ label: 'vps', base: 'http://203.0.113.7:3011' });
    expect(plain(stdout)).toBe([
      'Overdeck server: plain process.',
      'No systemd user manager is available here (this is a container), so the server runs as a plain process: '
        + 'it stops when you log out and does not start after a reboot.',
      '',
      'Link this machine from another machine within 10 minutes, before this machine restarts:',
      '',
      `  pan machines link 'http://203.0.113.7:3011/#pair=${CREDENTIAL}'`,
      '',
      'or paste the link into Settings → Anywhere → Machines → Link a machine.',
      `Expires: ${EXPIRES_AT} (single use)`,
      'The other machine must reach 203.0.113.7:3011. If a firewall blocks it, open that port '
        + 'or set up Tailscale with `pan tailscale setup`, then run pan connect again.',
    ].join('\n'));
  });

  it('omits the reachability hint for a tailnet base and adds the Traefik note', async () => {
    const { deps, stdout } = fakeDeps({
      interfaces: () => ({ tailscale0: [v4('100.101.102.103')] }),
      platformConfig: () => ({ dashboardPort: 3010, dashboardApiPort: 3011, traefikEnabled: true, traefikDomain: 'x', traefikDir: '/t' }),
    });

    await runConnect({}, deps);
    const text = plain(stdout);
    expect(text).not.toContain('The other machine must reach');
    expect(text.split('\n').at(-1)).toBe(
      'Traefik is enabled here; after a reboot the dashboard starts but Traefik and CLIProxy wait for pan up.',
    );
  });

  it('prints the pan pair loopback warning for a loopback base', async () => {
    const { deps, stdout } = fakeDeps({ env: {}, interfaces: () => ({}) });

    await runConnect({}, deps);
    expect(plain(stdout)).toContain('This URL only works on this machine.');
    expect(plain(stdout)).not.toContain('The other machine must reach');
  });

  it('rejects a bad --url before touching the dashboard', async () => {
    const { deps, stderr } = fakeDeps();

    await expect(runConnect({ url: 'ftp://box' }, deps)).resolves.toBe(1);
    expect(plain(stderr)).toBe('--url must be an http:// or https:// address');
    expect(deps.waitForDashboardHealth).not.toHaveBeenCalled();
  });

  it('exits 1 with the pairing failure message', async () => {
    const { deps, stderr } = fakeDeps({
      requestPairingLink: vi.fn(async () => ({ ok: false as const, message: 'pan pair failed: boom' })),
    });

    await expect(runConnect({}, deps)).resolves.toBe(1);
    expect(plain(stderr)).toBe('pan pair failed: boom');
  });

  it('--json prints exactly one parseable object and nothing else on stdout', async () => {
    const { deps, stdout } = fakeDeps({
      waitForDashboardHealth: vi.fn(async () => { throw new Error('down'); }),
      probeDashboardRepoRoot: vi.fn(async () => '/srv/other'),
    });

    await expect(runConnect({ json: true }, deps)).resolves.toBe(0);
    expect(stdout).toHaveLength(1);
    expect(JSON.parse(stdout[0]!)).toEqual({
      url: `http://203.0.113.7:3011/#pair=${CREDENTIAL}`,
      credential: CREDENTIAL,
      expiresAt: EXPIRES_AT,
      base: { url: 'http://203.0.113.7:3011', kind: 'public' },
      service: { manager: 'process', name: null, enabled: false },
      linger: 'not-applicable',
      runtime: null,
      replacedRepoRoot: '/srv/other',
    });
  });
});
