import { describe, expect, it, vi } from 'vitest';

import { createLinuxProvider } from '../providers/linux.js';
import type { ExecFileFn } from '../readiness-linux.js';

type Handler = (args: string[]) => Promise<{ stdout: string; stderr: string }>;

const notFound: Handler = async () => {
  throw new Error('not found');
};

/** Every probe succeeds unless overridden; `which apt-get` resolves to /usr/bin/apt-get, other managers are absent. */
function fakeExecFile(overrides: Partial<Record<string, Handler>> = {}): ExecFileFn {
  return async (file, args) => {
    const key = file === 'which' ? args[0] : file;
    const handler = overrides[key];
    if (handler) return handler(args);
    if (file === 'which' && ['pacman', 'dnf', 'zypper', 'apk'].includes(args[0] ?? '')) throw new Error('not found');
    if (file === 'which') return { stdout: `/usr/bin/${args[0]}\n`, stderr: '' };
    if (file === 'gsettings') return { stdout: 'true\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
}

const x11Env = async () => ({ ok: true as const, env: { DISPLAY: ':1', XDG_SESSION_TYPE: 'x11' } });

describe('createLinuxProvider (PAN-5461 WI-1c)', () => {
  it('is the linux provider with Linux key rules', () => {
    const provider = createLinuxProvider({ resolveDesktopEnv: x11Env });
    expect(provider.id).toBe('linux');
    expect(provider.blockedKeyPlatform).toBe('linux');
  });

  it('labels the session "<type> · display <display>"', async () => {
    const provider = createLinuxProvider({ resolveDesktopEnv: x11Env });
    expect(await provider.resolveSession()).toEqual({
      ok: true,
      session: { label: 'x11 · display :1', env: { DISPLAY: ':1', XDG_SESSION_TYPE: 'x11' } },
    });

    const wayland = createLinuxProvider({ resolveDesktopEnv: async () => ({ ok: true, env: { WAYLAND_DISPLAY: 'wayland-0' } }) });
    const result = await wayland.resolveSession();
    expect(result.ok && result.session.label).toBe('unknown · display wayland-0');
  });

  it('passes a missing session through', async () => {
    const provider = createLinuxProvider({
      resolveDesktopEnv: async () => ({ ok: false, code: 'no_desktop_session', message: 'no display' }),
    });
    expect(await provider.resolveSession()).toEqual({ ok: false, code: 'no_desktop_session', message: 'no display' });
    expect(await provider.runSetupStep('install-packages')).toEqual({ status: 'failed', message: 'no display' });
  });

  it('returns readiness without the Linux-only extras', async () => {
    const provider = createLinuxProvider({ execFile: fakeExecFile(), resolveDesktopEnv: x11Env, runHelper: async () => ({ ok: true }) });
    const report = await provider.readiness({ probeHelper: 'wait' });
    expect(Object.keys(report).sort()).toEqual(['checks', 'session', 'setupSteps']);
    expect(report.checks).toHaveLength(7);
  });

  it("runSetupStep('install-packages') returns skipped when nothing is missing", async () => {
    const execFile = vi.fn(fakeExecFile());
    const provider = createLinuxProvider({ execFile, resolveDesktopEnv: x11Env, spawnDetached: vi.fn() });
    expect(await provider.runSetupStep('install-packages')).toEqual({ status: 'skipped' });
    expect(execFile.mock.calls.some(([file]) => file === 'pkexec')).toBe(false);
  });

  it("runSetupStep('install-packages') runs pkexec with the planned packages when xdotool is missing", async () => {
    const execFile = vi.fn(fakeExecFile({
      xdotool: notFound,
      pkexec: async () => ({ stdout: '', stderr: '' }),
    }));
    const provider = createLinuxProvider({ execFile, resolveDesktopEnv: x11Env, spawnDetached: vi.fn() });
    expect(await provider.runSetupStep('install-packages')).toEqual({ status: 'done', message: 'Installed xdotool.' });
    expect(execFile).toHaveBeenCalledWith('pkexec', ['/usr/bin/apt-get', 'install', '-y', 'xdotool'], {
      env: { DISPLAY: ':1', XDG_SESSION_TYPE: 'x11' },
      timeout: 600_000,
    });
  });

  it("runSetupStep('install-packages') returns the manual command for zypper", async () => {
    const execFile = vi.fn(fakeExecFile({
      xdotool: notFound,
      'apt-get': notFound,
      zypper: async () => ({ stdout: '/usr/bin/zypper\n', stderr: '' }),
    }));
    const provider = createLinuxProvider({ execFile, resolveDesktopEnv: x11Env, spawnDetached: vi.fn() });
    const result = await provider.runSetupStep('install-packages');
    expect(result).toMatchObject({ status: 'failed', command: 'sudo zypper install -y xdotool' });
    expect(execFile.mock.calls.some(([file]) => file === 'pkexec')).toBe(false);
  });

  it("runSetupStep('enable-accessibility') runs gsettings set with the session env", async () => {
    const execFile = vi.fn(fakeExecFile());
    const provider = createLinuxProvider({ execFile, resolveDesktopEnv: x11Env });
    expect((await provider.runSetupStep('enable-accessibility')).status).toBe('done');
    expect(execFile).toHaveBeenCalledWith(
      'gsettings',
      ['set', 'org.gnome.desktop.interface', 'toolkit-accessibility', 'true'],
      { env: { DISPLAY: ':1', XDG_SESSION_TYPE: 'x11' }, timeout: 5000 },
    );
  });

  it("runSetupStep('grant-permissions') is skipped on Linux", async () => {
    const resolveDesktopEnv = vi.fn(x11Env);
    const provider = createLinuxProvider({ resolveDesktopEnv });
    expect(await provider.runSetupStep('grant-permissions')).toEqual({ status: 'skipped' });
    expect(resolveDesktopEnv).not.toHaveBeenCalled();
  });

  it('runs the helper with the session env', async () => {
    const runHelper = vi.fn(async () => ({ ok: true }));
    const provider = createLinuxProvider({ runHelper });
    await provider.runHelper({ tool: 'handshake' }, { label: 'x11 · display :1', env: { DISPLAY: ':1' } });
    expect(runHelper).toHaveBeenCalledWith({ tool: 'handshake' }, { DISPLAY: ':1' });
  });
});
