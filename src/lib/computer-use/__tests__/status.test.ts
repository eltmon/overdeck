import { describe, expect, it, vi } from 'vitest';

import type { ComputerUseProvider, ReadinessCheck, ReadinessReport } from '../platform-types.js';
import { buildStatus, type StatusDeps } from '../status.js';

const okChecks: ReadinessCheck[] = [
  { id: 'session', label: 'Desktop session', status: 'ok', detail: 'x11 · display :1' },
  { id: 'helper', label: 'Helper', status: 'ok', detail: 'Handshake ok' },
];

function provider(report: ReadinessReport): ComputerUseProvider {
  return {
    id: 'linux',
    blockedKeyPlatform: 'linux',
    resolveSession: async () => ({ ok: true, session: { label: 'x11 · display :1', env: {} } }),
    readiness: vi.fn(async () => report),
    runSetupStep: async () => ({ status: 'done' }),
    runHelper: async () => ({ ok: true }),
  };
}

const readyReport: ReadinessReport = { session: { ok: true, label: 'x11 · display :1' }, checks: okChecks, setupSteps: [] };

function deps(overrides: StatusDeps & { report?: ReadinessReport; enabled?: boolean } = {}): StatusDeps {
  const { report = readyReport, enabled = true, ...rest } = overrides;
  const linux = provider(report);
  return {
    detectPlatform: () => 'linux',
    providerFor: (id) => (id === 'linux' ? linux : null),
    readSettings: async () => ({ enabled }),
    readLease: async () => null,
    hostname: () => 'desk',
    homedir: () => '/home/op',
    access: async () => {
      throw Object.assign(new Error('missing'), { code: 'ENOENT' });
    },
    now: () => 0,
    ...rest,
  };
}

describe('buildStatus (PAN-5461 WI-3b)', () => {
  it('reports an unsupported host with no checks or steps', async () => {
    const status = await buildStatus({ probeHelper: 'if-free' }, deps({ detectPlatform: () => 'wsl', enabled: false }));
    expect(status).toMatchObject({
      platform: 'wsl',
      supported: false,
      enabled: false,
      hostname: 'desk',
      session: { ok: false, message: "Computer use isn't supported on this host (wsl) yet." },
      checks: [],
      setupSteps: [],
    });
  });

  it('lists no setup steps without a desktop session', async () => {
    const report: ReadinessReport = {
      session: { ok: false, message: 'No desktop session' },
      checks: [{ id: 'session', label: 'Desktop session', status: 'unavailable', detail: 'No desktop session' }],
      setupSteps: [],
    };
    const status = await buildStatus({ probeHelper: 'if-free' }, deps({ report, enabled: false }));
    expect(status.supported).toBe(true);
    expect(status.session).toEqual({ ok: false, message: 'No desktop session' });
    expect(status.setupSteps).toEqual([]);
  });

  it('is ready with no steps when enabled and every check is ok', async () => {
    const status = await buildStatus({ probeHelper: 'if-free' }, deps());
    expect(status.setupSteps).toEqual([]);
    expect(status.checks).toEqual(okChecks);
    expect(status.session).toEqual({ ok: true, label: 'x11 · display :1' });
  });

  it('lists enable-flag then test-helper when disabled and ready', async () => {
    const status = await buildStatus({ probeHelper: 'if-free' }, deps({ enabled: false }));
    expect(status.setupSteps).toEqual([
      { id: 'enable-flag', label: 'Turn on Computer Use' },
      { id: 'test-helper', label: 'Test the helper' },
    ]);
  });

  it('puts provider steps first when packages are missing', async () => {
    const report: ReadinessReport = {
      ...readyReport,
      setupSteps: [{ id: 'install-packages', label: 'Install xdotool', needsPassword: true }],
    };
    const status = await buildStatus({ probeHelper: 'if-free' }, deps({ report, enabled: false }));
    expect(status.setupSteps.map((step) => step.id)).toEqual(['install-packages', 'enable-flag', 'test-helper']);
  });

  it('lists test-helper alone when enabled but the helper check fails', async () => {
    const report: ReadinessReport = {
      ...readyReport,
      checks: [okChecks[0]!, { id: 'helper', label: 'Helper', status: 'missing', detail: 'Handshake failed: boom' }],
    };
    const status = await buildStatus({ probeHelper: 'if-free' }, deps({ report }));
    expect(status.setupSteps).toEqual([{ id: 'test-helper', label: 'Test the helper' }]);
  });

  it('passes probeHelper to the provider', async () => {
    const d = deps();
    await buildStatus({ probeHelper: 'wait' }, d);
    const linux = d.providerFor!('linux')!;
    expect(linux.readiness).toHaveBeenCalledWith({ probeHelper: 'wait' });
  });

  it('reports the lease and where the skill is installed', async () => {
    const readLease = vi.fn(async () => ({ holder: 'agent-x', expiresAt: '2026-11-17T12:02:00.000Z' }));
    const access = vi.fn(async (path: string) => {
      if (path !== '/home/op/.agents/skills/pan-computer-use/SKILL.md') throw new Error('missing');
    });
    const status = await buildStatus({ probeHelper: 'if-free' }, deps({ readLease, access, now: () => 42 }));
    expect(readLease).toHaveBeenCalledWith(42);
    expect(status.lease).toEqual({ holder: 'agent-x', expiresAt: '2026-11-17T12:02:00.000Z' });
    expect(status.skill).toEqual({ installed: true, locations: ['~/.agents/skills'] });
  });

  it('reports the skill as not installed when neither location has it', async () => {
    const status = await buildStatus({ probeHelper: 'if-free' }, deps());
    expect(status.skill).toEqual({ installed: false, locations: [] });
  });

  it('propagates a settings read error', async () => {
    const readSettings = async () => {
      throw new Error('YAML syntax error');
    };
    await expect(buildStatus({ probeHelper: 'if-free' }, deps({ readSettings }))).rejects.toThrow('YAML syntax error');
  });
});
