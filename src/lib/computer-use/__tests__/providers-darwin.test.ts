import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createDarwinProvider, WAITING_MESSAGE, type DarwinProviderDeps } from '../providers/darwin.js';

const HOME = '/home/tester/.overdeck';
const APP = `${HOME}/computer-use/macos/Overdeck Computer Use.app`;

type Perms = { accessibility: string; screenshots: string } | null;

/** Fakes for a Mac where the helper writes `perms` to the status file it is asked for. */
function makeDeps(options: { installed?: boolean; current?: boolean; perms?: Perms; release?: string } = {}) {
  const files = new Map<string, string>();
  const execFile = vi.fn(async (file: string, args: string[]) => {
    const statusIndex = args.indexOf('--permission-status-file');
    if (file === '/usr/bin/open' && statusIndex !== -1 && options.perms) {
      files.set(args[statusIndex + 1], JSON.stringify(options.perms));
    }
    return { stdout: file === '/usr/bin/sw_vers' ? '14.6.1\n' : '', stderr: '' };
  });
  const request = vi.fn(async (_method: string, _params?: Record<string, unknown>): Promise<unknown> => ({ platform: 'darwin' }));
  const deps = {
    osRelease: () => options.release ?? '23.6.0',
    execFile,
    readFile: vi.fn(async (path: string) => {
      const value = files.get(path);
      if (value === undefined) throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
      return value;
    }),
    rm: vi.fn(async (path: string) => {
      files.delete(path);
    }),
    pathExists: vi.fn(async (path: string) => path === APP && (options.installed ?? true)),
    randomUUID: () => 'u1',
    sleep: async () => {},
    isInstalledCurrent: async () => options.current ?? true,
    installHelper: vi.fn(async () => ({ status: 'installed' as const })),
    request,
    holderKey: () => 'holder-1',
    withDesktopLock: <T,>(fn: () => Promise<T>) => fn(),
    tryWithDesktopLock: async <T,>(fn: () => Promise<T>) => ({ acquired: true as const, value: await fn() }),
  } satisfies DarwinProviderDeps;
  return { deps, execFile, request, files };
}

describe('darwin provider (PAN-5463)', () => {
  const previousHome = process.env.OVERDECK_HOME;
  beforeEach(() => {
    process.env.OVERDECK_HOME = HOME;
  });
  afterEach(() => {
    vi.useRealTimers();
    if (previousHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = previousHome;
  });

  it('uses mac shortcut rules (ac1)', () => {
    expect(createDarwinProvider().blockedKeyPlatform).toBe('mac');
    expect(createDarwinProvider().id).toBe('darwin');
  });

  it('refuses a session before macOS 14 (ac4)', async () => {
    const { deps } = makeDeps({ release: '22.6.0' });
    const result = await createDarwinProvider(deps).resolveSession();
    expect(result).toEqual({ ok: false, code: 'no_desktop_session', message: 'Computer use on macOS needs macOS 14 or newer.' });
  });

  it('refuses a session until the helper is installed, and labels it with the macOS version after', async () => {
    const missing = await createDarwinProvider(makeDeps({ installed: false }).deps).resolveSession();
    expect(missing).toMatchObject({ ok: false, code: 'no_desktop_session' });
    expect(!missing.ok && missing.message).toContain('Run setup in Settings → Computer Use');

    const ready = await createDarwinProvider(makeDeps().deps).resolveSession();
    expect(ready.ok && ready.session.label).toBe('macOS 14.6.1');
  });

  it('reports accessibility ok and screen recording needing action, and lists grant-permissions (ac2)', async () => {
    const { deps, execFile } = makeDeps({ perms: { accessibility: 'granted', screenshots: 'not-granted' } });

    const report = await createDarwinProvider(deps).readiness({ probeHelper: 'if-free' });

    expect(report.session).toEqual({ ok: true, label: 'macOS 14.6.1' });
    expect(report.checks.map((check) => [check.id, check.status])).toEqual([
      ['macos-version', 'ok'],
      ['helper', 'ok'],
      ['accessibility', 'ok'],
      ['screen-recording', 'action'],
      ['handshake', 'ok'],
    ]);
    expect(report.setupSteps.map((step) => step.id)).toEqual(['grant-permissions']);
    expect(execFile).toHaveBeenCalledWith(
      '/usr/bin/open',
      ['-n', '-g', '-a', APP, '--args', '--permission-status-file', `${HOME}/computer-use/macos/permission-status-u1.json`],
      expect.any(Object),
    );
    expect(deps.rm).toHaveBeenCalledWith(`${HOME}/computer-use/macos/permission-status-u1.json`, { force: true });
  });

  it('keeps the session ok but lists install and permissions when the helper is not installed', async () => {
    const { deps, execFile } = makeDeps({ installed: false });

    const report = await createDarwinProvider(deps).readiness({ probeHelper: 'if-free' });

    expect(report.session.ok).toBe(true);
    expect(report.checks.find((check) => check.id === 'helper')).toMatchObject({ status: 'missing', detail: 'Not installed' });
    expect(report.setupSteps.map((step) => step.id)).toEqual(['install-packages', 'grant-permissions']);
    expect(execFile).not.toHaveBeenCalledWith('/usr/bin/open', expect.anything(), expect.anything());
  });

  it('marks an outdated helper as needing action and lists install-packages', async () => {
    const report = await createDarwinProvider(
      makeDeps({ current: false, perms: { accessibility: 'granted', screenshots: 'granted' } }).deps,
    ).readiness({ probeHelper: 'if-free' });
    expect(report.checks.find((check) => check.id === 'helper')?.status).toBe('action');
    expect(report.setupSteps.map((step) => step.id)).toEqual(['install-packages']);
  });

  it('reports both permissions unavailable when the status file never appears within 5 s (fake timers)', async () => {
    vi.useFakeTimers();
    const { deps } = makeDeps({ perms: null });
    const { sleep: _sleep, ...withRealSleep } = deps;

    const pending = createDarwinProvider(withRealSleep).readiness({ probeHelper: 'if-free' });
    await vi.advanceTimersByTimeAsync(5_000);
    const report = await pending;

    expect(report.checks.find((check) => check.id === 'accessibility')).toMatchObject({
      status: 'unavailable',
      detail: 'Could not read permission status',
    });
    expect(report.checks.find((check) => check.id === 'screen-recording')?.status).toBe('unavailable');
    expect(deps.readFile).toHaveBeenCalledTimes(50);
  });

  it('skips the handshake when an agent holds the desktop lock (if-free)', async () => {
    const { deps, request } = makeDeps({ perms: { accessibility: 'granted', screenshots: 'granted' } });
    const report = await createDarwinProvider({ ...deps, tryWithDesktopLock: async () => ({ acquired: false }) }).readiness({ probeHelper: 'if-free' });
    expect(report.checks.find((check) => check.id === 'handshake')?.detail).toBe('Skipped: an agent is using the desktop');
    expect(request).not.toHaveBeenCalled();
  });

  it('opens the permission window and waits while a permission is missing (ac3)', async () => {
    const { deps, execFile } = makeDeps({ perms: { accessibility: 'not-granted', screenshots: 'granted' } });

    const result = await createDarwinProvider(deps).runSetupStep('grant-permissions');

    expect(result).toEqual({ status: 'waiting', message: WAITING_MESSAGE });
    expect(execFile).toHaveBeenCalledWith('/usr/bin/open', ['-n', '-a', APP, '--args', '--permissions'], expect.any(Object));
  });

  it('finishes grant-permissions once both permissions are granted', async () => {
    const { deps, execFile } = makeDeps({ perms: { accessibility: 'granted', screenshots: 'granted' } });
    expect(await createDarwinProvider(deps).runSetupStep('grant-permissions')).toEqual({ status: 'done' });
    expect(execFile).not.toHaveBeenCalledWith('/usr/bin/open', ['-n', '-a', APP, '--args', '--permissions'], expect.anything());
  });

  it('maps install results: current is skipped, updated warns about granting again', async () => {
    const { deps } = makeDeps();
    expect(await createDarwinProvider({ ...deps, installHelper: async () => ({ status: 'current' }) }).runSetupStep('install-packages')).toEqual({
      status: 'skipped',
    });
    const updated = await createDarwinProvider({ ...deps, installHelper: async () => ({ status: 'updated' }) }).runSetupStep('install-packages');
    expect(updated).toEqual({ status: 'done', message: 'Updated the helper. macOS asks you to allow the updated helper again.' });
  });

  it('runs operations through the protocol adapter with the holder key', async () => {
    const { deps, request } = makeDeps();
    request.mockResolvedValueOnce({ apps: [{ name: 'Finder', bundleId: 'com.apple.finder', pid: 1 }] });

    const response = await createDarwinProvider(deps).runHelper({ tool: 'list_apps' }, { label: 'macOS 14.6.1', env: {} });

    expect(request).toHaveBeenCalledWith('listApps', { session: 'holder-1' });
    expect(response).toEqual({ ok: true, apps: [{ name: 'Finder', bundleIdentifier: 'com.apple.finder', pid: 1 }] });
  });

  it('opens one permission pane with the helper permission name', async () => {
    const { deps, execFile } = makeDeps();
    await createDarwinProvider(deps).openPermissionPane('screen-recording');
    expect(execFile).toHaveBeenCalledWith('/usr/bin/open', ['-n', '-a', APP, '--args', '--permission', 'screenshots'], expect.any(Object));
  });
});
