import { describe, expect, it, vi } from 'vitest';

import {
  ensureHerdr,
  isHerdrSetupSkipped,
  type EnsureHerdrDeps,
  type EnsureHerdrRunReport,
} from '../../../../src/lib/herdr-setup/ensure.js';
import { parseHerdrStatus, type HerdrExec, type HerdrStatus } from '../../../../src/lib/herdr-setup/status.js';
import type { HerdrAvailability } from '../../../../src/lib/terminal-backends/select.js';
import { STATUS_NOT_RUNNING_JSON, STATUS_RUNNING_JSON } from './fixtures.js';

const BINARY = '/home/op/.local/bin/herdr';
const SOCKET = '/home/op/.config/herdr/sessions/overdeck/herdr.sock';

const RUNNING = parseHerdrStatus(STATUS_RUNNING_JSON) as HerdrStatus;
const NOT_RUNNING = parseHerdrStatus(STATUS_NOT_RUNNING_JSON) as HerdrStatus;

function probe(binary: string | null, session = 'overdeck'): HerdrAvailability {
  return {
    binary,
    session,
    socket: SOCKET,
    socketExists: binary !== null,
    available: binary !== null,
  };
}

interface Harness {
  deps: EnsureHerdrDeps;
  spies: {
    exec: ReturnType<typeof vi.fn<HerdrExec>>;
    installBinary: ReturnType<typeof vi.fn>;
    updateBinary: ReturnType<typeof vi.fn>;
    ensureChannel: ReturnType<typeof vi.fn>;
    ensureConfig: ReturnType<typeof vi.fn>;
    ensureServer: ReturnType<typeof vi.fn>;
    ensureIntegrations: ReturnType<typeof vi.fn>;
  };
}

function harness(options: {
  binary?: string | null;
  version?: string;
  latest?: string | null;
  serverRunning?: boolean;
  policy?: 'herdr' | 'tmux';
  configChanged?: boolean;
  integrationsInstalled?: string[];
  session?: string;
} = {}): Harness {
  const binaryPresent = options.binary !== null;
  const spies = {
    // Any real subprocess would go through here — the orchestrator must not
    // reach it when every step is injected.
    exec: vi.fn<HerdrExec>(async () => ({ stdout: '', stderr: '', exitCode: 0 })),
    installBinary: vi.fn(async () => ({ binary: BINARY })),
    updateBinary: vi.fn(async () => {}),
    ensureChannel: vi.fn(async () => 'stable' as const),
    ensureConfig: vi.fn(async () => ({ changed: options.configChanged ?? false, path: '/home/op/.config/herdr/config.toml' })),
    ensureServer: vi.fn(async () => ({
      running: true,
      managedBy: 'already-running' as const,
      unit: 'overdeck-herdr.service',
    })),
    ensureIntegrations: vi.fn(async () => ({
      installed: options.integrationsInstalled ?? [],
      already: [],
      skipped: [],
    })),
  };
  const deps: EnsureHerdrDeps = {
    env: {},
    home: '/home/op',
    exec: spies.exec,
    selection: async () => ({
      backend: options.policy ?? 'herdr',
      source: options.policy === 'tmux' ? 'config' : 'default',
      diagnostic: options.policy === 'tmux' ? "terminal.backend is set to 'tmux' in config.yaml." : 'default',
    }),
    probe: async () => probe(binaryPresent ? (options.binary ?? BINARY) : null, options.session),
    fetchLatest: async () => (options.latest === undefined ? '0.9.1' : options.latest),
    installBinary: spies.installBinary,
    updateBinary: spies.updateBinary,
    readVersion: async () => options.version ?? '0.9.1',
    readStatus: async () => ((options.serverRunning ?? true) ? RUNNING : NOT_RUNNING),
    ensureChannel: spies.ensureChannel,
    ensureConfig: spies.ensureConfig,
    configDisablesResume: async () => false,
    ensureServer: spies.ensureServer,
    ensureIntegrations: spies.ensureIntegrations,
  };
  return { deps, spies };
}

async function run(mode: 'install' | 'sync' | 'up', h: Harness): Promise<EnsureHerdrRunReport> {
  const report = await ensureHerdr({ mode, deps: h.deps });
  if (isHerdrSetupSkipped(report)) throw new Error(`unexpectedly skipped: ${report.skipped}`);
  return report;
}

describe('ensureHerdr — D10 skip conditions', () => {
  it('(a) skips under an explicit tmux policy and touches nothing', async () => {
    const h = harness({ policy: 'tmux' });
    const report = await ensureHerdr({ mode: 'install', deps: h.deps });
    expect(isHerdrSetupSkipped(report) && report.skipped).toContain('terminal backend is tmux');
    expect(h.spies.installBinary).not.toHaveBeenCalled();
    expect(h.spies.ensureServer).not.toHaveBeenCalled();
  });

  it('skips on --skip-herdr, CI and Vitest', async () => {
    const h = harness();
    expect(await ensureHerdr({ mode: 'install', skip: true, deps: h.deps })).toEqual({
      skipped: 'Herdr setup skipped (--skip-herdr)',
    });
    expect(await ensureHerdr({ mode: 'sync', deps: { ...h.deps, env: { CI: 'true' } } }))
      .toEqual({ skipped: 'Herdr setup skipped: running under CI' });
    expect(await ensureHerdr({ mode: 'up', deps: { ...h.deps, env: { VITEST: 'true' } } }))
      .toEqual({ skipped: 'Herdr setup skipped: running under Vitest' });
    expect(h.spies.ensureServer).not.toHaveBeenCalled();
  });
});

describe('ensureHerdr — install / sync / up (PAN-3956 W8)', () => {
  it('(b) installs an absent binary, then runs every other step', async () => {
    const h = harness({ binary: null, integrationsInstalled: ['pi', 'omp'] });
    const report = await run('install', h);
    expect(h.spies.installBinary).toHaveBeenCalledTimes(1);
    expect(report.binary).toMatchObject({ path: BINARY, action: 'installed', version: '0.9.1' });
    expect(h.spies.ensureChannel).toHaveBeenCalled();
    expect(h.spies.ensureConfig).toHaveBeenCalledWith({ binary: BINARY, session: 'overdeck', serverRunning: true });
    expect(h.spies.ensureServer).toHaveBeenCalledWith({ binary: BINARY, session: 'overdeck', socket: SOCKET, persistentUnit: true });
    expect(report.integrations.installed).toEqual(['pi', 'omp']);
    expect(report.server).toMatchObject({ running: true, endpointCompatible: true, restartNeeded: false });
  });

  it('(c) sync with a running server and a newer manifest does not update, and warns once', async () => {
    const h = harness({ latest: '0.10.0', serverRunning: true });
    const report = await run('sync', h);
    expect(h.spies.updateBinary).not.toHaveBeenCalled();
    expect(report.binary.action).toBe('update-available');
    expect(report.warnings).toHaveLength(1);
    expect(report.warnings[0]).toContain('herdr 0.10.0 is available');
    expect(report.warnings[0]).toContain('systemctl --user restart overdeck-herdr.service');
    expect(report.warnings[0]).toContain('restarting closes every agent pane');
  });

  it('sync updates when no session server runs for this home', async () => {
    const h = harness({ latest: '0.10.0', serverRunning: false });
    const report = await run('sync', h);
    expect(h.spies.updateBinary).toHaveBeenCalledWith(BINARY);
    expect(report.binary.action).toBe('updated');
  });

  it('(d) install with a newer manifest runs `herdr update`', async () => {
    const h = harness({ latest: '0.10.0', serverRunning: true });
    const report = await run('install', h);
    expect(h.spies.updateBinary).toHaveBeenCalledWith(BINARY);
    expect(report.binary.action).toBe('updated');
  });

  it('(e) a re-run with everything present installs nothing and changes no config', async () => {
    const h = harness();
    const report = await run('sync', h);
    expect(h.spies.installBinary).not.toHaveBeenCalled();
    expect(h.spies.updateBinary).not.toHaveBeenCalled();
    expect(report.config.changed).toBe(false);
    expect(report.binary.action).toBe('present');
    expect(report.warnings).toEqual([]);
    expect(h.spies.exec).not.toHaveBeenCalled();
  });

  it('an unreachable manifest is an info warning, never a failure', async () => {
    const h = harness({ latest: null });
    const report = await run('sync', h);
    expect(report.warnings).toEqual(['Could not read https://herdr.dev/latest.json; skipped the Herdr update check.']);
    expect(report.server.running).toBe(true);
  });

  it('up never installs, updates or touches integrations — only config and the server', async () => {
    const h = harness({ latest: '0.10.0', serverRunning: false });
    const report = await run('up', h);
    expect(h.spies.updateBinary).not.toHaveBeenCalled();
    expect(h.spies.ensureChannel).not.toHaveBeenCalled();
    expect(h.spies.ensureIntegrations).not.toHaveBeenCalled();
    expect(h.spies.ensureConfig).toHaveBeenCalled();
    expect(h.spies.ensureServer).toHaveBeenCalled();
    expect(report.channel).toBe('unchecked');
  });

  it('up with no binary reports the server down and names pan install, without installing', async () => {
    const h = harness({ binary: null });
    const report = await run('up', h);
    expect(h.spies.installBinary).not.toHaveBeenCalled();
    expect(report.server.running).toBe(false);
    expect(report.server.reason).toContain('pan install');
  });

  it('warns naming both versions when the running server is not endpoint-compatible', async () => {
    const h = harness();
    const incompatible = parseHerdrStatus(
      STATUS_RUNNING_JSON.replace('"endpoint_compatible":true', '"endpoint_compatible":false')
        .replace('"running":true,"version":"0.9.1"', '"running":true,"version":"0.8.0"'),
    ) as HerdrStatus;
    const report = await run('sync', { ...h, deps: { ...h.deps, readStatus: async () => incompatible } });
    expect(report.server.endpointCompatible).toBe(false);
    expect(report.warnings.join('\n')).toMatch(/0\.8\.0.*0\.9\.1/);
  });

  it('a failing install is a server-down report, not a throw', async () => {
    const h = harness({ binary: null });
    h.spies.installBinary.mockRejectedValueOnce(new Error('curl: (6) Could not resolve host'));
    const report = await run('install', h);
    expect(report.binary.action).toBe('missing');
    expect(report.server).toEqual({ running: false, reason: 'Herdr install failed: curl: (6) Could not resolve host' });
    expect(h.spies.ensureServer).not.toHaveBeenCalled();
  });
});

describe('ensureHerdr — review of #3995 (PAN-3956)', () => {
  it('sets the stable channel before updating the binary (low: channel after update)', async () => {
    const order: string[] = [];
    const h = harness({ latest: '0.10.0', serverRunning: false });
    h.spies.ensureChannel.mockImplementation(async () => { order.push('channel'); return 'changed'; });
    h.spies.updateBinary.mockImplementation(async () => { order.push('update'); });
    await run('sync', h);
    expect(order).toEqual(['channel', 'update']);
  });

  it('never updates the shared binary from a non-default home, in sync or install (finding 6)', async () => {
    for (const mode of ['sync', 'install'] as const) {
      const h = harness({ latest: '0.10.0', serverRunning: false, session: 'overdeck-1a2b3c4d' });
      const report = await run(mode, h);
      expect(h.spies.updateBinary).not.toHaveBeenCalled();
      expect(report.binary.action).toBe('update-available');
      expect(report.warnings.join('\n')).toContain('leaves the shared herdr binary alone');
    }
  });

  it('asks for a boot-persistent unit only for the default home or on opt-in (finding 6)', async () => {
    const other = harness({ session: 'overdeck-1a2b3c4d' });
    await run('up', other);
    expect(other.spies.ensureServer).toHaveBeenCalledWith(expect.objectContaining({ persistentUnit: false }));

    const optIn = harness({ session: 'overdeck-1a2b3c4d' });
    await run('up', { ...optIn, deps: { ...optIn.deps, env: { OVERDECK_HERDR_PERSISTENT_UNIT: '1' } } });
    expect(optIn.spies.ensureServer).toHaveBeenCalledWith(expect.objectContaining({ persistentUnit: true }));
  });

  it('surfaces a failed reload-config as a warning while reporting the config as written (finding 2)', async () => {
    const h = harness();
    h.spies.ensureConfig.mockResolvedValueOnce({
      changed: true,
      path: '/home/op/.config/herdr/config.toml',
      reloadWarning: 'reload-config failed (exit 1)',
    });
    const report = await run('sync', h);
    expect(report.config).toEqual({ changed: true, path: '/home/op/.config/herdr/config.toml' });
    expect(report.warnings).toContain('reload-config failed (exit 1)');
  });

  it('does not start a server while the config cannot be made safe (finding 4)', async () => {
    const h = harness({ serverRunning: false });
    h.spies.ensureConfig.mockRejectedValueOnce(new Error('Cannot safely edit config.toml: inline table'));
    const report = await run('up', h);
    expect(h.spies.ensureServer).not.toHaveBeenCalled();
    expect(report.server.running).toBe(false);
    expect(report.server.reason).toMatch(/^not started — .*resume_agents_on_restore = false.*inline table/);
    expect(report.config.error).toContain('inline table');
    expect(report.warnings.join('\n')).toContain('Herdr config not updated: Cannot safely edit');
  });

  it('still starts the server when the config edit failed but the file already says false', async () => {
    const h = harness({ serverRunning: false });
    h.spies.ensureConfig.mockRejectedValueOnce(new Error('herdr config check rejected'));
    const report = await run('up', { ...h, deps: { ...h.deps, configDisablesResume: async () => true } });
    expect(h.spies.ensureServer).toHaveBeenCalled();
    expect(report.server.running).toBe(true);
  });

  it('leaves an already-running server reported as running when the config edit fails', async () => {
    const h = harness({ serverRunning: true });
    h.spies.ensureConfig.mockRejectedValueOnce(new Error('Cannot safely edit config.toml'));
    const report = await run('sync', h);
    expect(h.spies.ensureServer).toHaveBeenCalled();
    expect(report.server.running).toBe(true);
  });

  it('passes a unit-upkeep warning through without reporting the server down (finding 9)', async () => {
    const h = harness();
    h.spies.ensureServer.mockResolvedValueOnce({
      running: true,
      managedBy: 'already-running',
      unit: 'overdeck-herdr.service',
      warning: 'Could not refresh or enable overdeck-herdr.service: boom',
    } as never);
    const report = await run('sync', h);
    expect(report.server).toMatchObject({ running: true, managedBy: 'already-running' });
    expect(report.server).not.toHaveProperty('warning');
    expect(report.warnings).toContain('Could not refresh or enable overdeck-herdr.service: boom');
  });

  it('re-probes an unreadable status and reports "unknown", not "down", before refusing (review of #4020, 2)', async () => {
    const h = harness({ serverRunning: false });
    h.spies.ensureConfig.mockRejectedValueOnce(new Error('Cannot safely edit config.toml'));
    const readStatus = vi.fn(async () => null);
    const report = await run('up', { ...h, deps: { ...h.deps, readStatus } });
    expect(readStatus.mock.calls.length).toBeGreaterThanOrEqual(2);
    expect(h.spies.ensureServer).not.toHaveBeenCalled();
    expect(report.server).toMatchObject({ running: false, stateUnknown: true });
    expect(report.server.reason).toContain('did not answer');
    expect(report.server.hint).toContain('pan doctor');
    expect(report.server.hint).not.toContain('pan install');
  });

  it('takes the already-running path when the re-probe finds the server up', async () => {
    const h = harness({ serverRunning: false });
    h.spies.ensureConfig.mockRejectedValueOnce(new Error('Cannot safely edit config.toml'));
    let calls = 0;
    const readStatus = vi.fn(async () => (++calls === 1 ? null : RUNNING));
    const report = await run('up', { ...h, deps: { ...h.deps, readStatus } });
    expect(h.spies.ensureServer).toHaveBeenCalled();
    expect(report.server.running).toBe(true);
  });

  it('names the config fix, not pan install, when a definitely-stopped server is not started', async () => {
    const h = harness({ serverRunning: false });
    h.spies.ensureConfig.mockRejectedValueOnce(new Error('Cannot safely edit config.toml'));
    const report = await run('up', h);
    expect(report.server.stateUnknown).toBeUndefined();
    expect(report.server.hint).toMatch(/^Agent launches will fail until then\. Fix .*config\.toml/);
    expect(report.server.hint).not.toContain('pan install');
  });

  it('light sync (dashboard callers) skips the binary update and integration installs', async () => {
    const h = harness({ latest: '0.10.0', serverRunning: false });
    const report = await run('sync', { ...h, deps: { ...h.deps, env: { OVERDECK_HERDR_SYNC_LIGHT: '1' } } });
    expect(h.spies.updateBinary).not.toHaveBeenCalled();
    expect(h.spies.ensureIntegrations).not.toHaveBeenCalled();
    expect(h.spies.ensureConfig).toHaveBeenCalled();
    expect(h.spies.ensureServer).toHaveBeenCalled();
    expect(report.warnings.join('\n')).toContain('OVERDECK_HERDR_SYNC_LIGHT');
  });

  it('carries an operator HERDR_CONFIG_PATH into the unit (review of #4020, 7)', async () => {
    const h = harness();
    await run('up', { ...h, deps: { ...h.deps, env: { HERDR_CONFIG_PATH: '/etc/herdr/mine.toml' } } });
    expect(h.spies.ensureServer).toHaveBeenCalledWith(expect.objectContaining({ configPathEnv: '/etc/herdr/mine.toml' }));
    const plain = harness();
    await run('up', plain);
    expect(plain.spies.ensureServer).toHaveBeenCalledWith(expect.not.objectContaining({ configPathEnv: expect.anything() }));
  });
});
