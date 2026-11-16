import { describe, expect, it, vi } from 'vitest';

import { mergeConfigs } from '../../../lib/config-yaml/merge.js';
import { checkComputerUse, type CheckComputerUseDeps, type ExecFileFn } from '../doctor-computer-use.js';

function enabledConfig() {
  return mergeConfigs(null, { computer_use: { enabled: true } }).config;
}

function disabledConfig() {
  return mergeConfigs(null).config;
}

/** Every `which`/gi/gsettings probe succeeds; override per test. */
function okExecFile(overrides: Partial<Record<string, (args: string[]) => Promise<{ stdout: string; stderr: string }>>> = {}): ExecFileFn {
  return async (file, args) => {
    const key = file === 'which' ? args[0] : file;
    const handler = overrides[key];
    if (handler) return handler(args);
    if (file === 'gsettings') return { stdout: 'true\n', stderr: '' };
    return { stdout: '', stderr: '' };
  };
}

function baseDeps(overrides: Partial<CheckComputerUseDeps> = {}): CheckComputerUseDeps {
  return {
    execFile: okExecFile(),
    resolveDesktopEnv: async () => ({ ok: true, env: { DISPLAY: ':1', XDG_SESSION_TYPE: 'x11' } }),
    runHelper: async () => ({ ok: true, capabilities: {} }),
    ...overrides,
  };
}

describe('checkComputerUse (PAN-5452)', () => {
  it('returns no rows and runs no probe when the feature is disabled (ac1)', async () => {
    const execFile = vi.fn();
    const checks = await checkComputerUse({ config: disabledConfig(), deps: { execFile } });
    expect(checks).toEqual([]);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('warns that non-Linux is unsupported and runs no further probe', async () => {
    const execFile = vi.fn();
    const checks = await checkComputerUse({ config: enabledConfig(), platform: 'darwin', deps: { execFile } });
    expect(checks).toEqual([{ name: 'Computer use', status: 'warn', message: 'Enabled, but computer use supports Linux only' }]);
    expect(execFile).not.toHaveBeenCalled();
  });

  it('gives an error row with the apt fix when the gi import probe fails (ac2)', async () => {
    const execFile = okExecFile({
      '/usr/bin/python3': async () => {
        throw new Error('ModuleNotFoundError');
      },
    });
    const checks = await checkComputerUse({ config: enabledConfig(), platform: 'linux', deps: baseDeps({ execFile }) });
    expect(checks).toContainEqual(
      expect.objectContaining({ status: 'error', fix: 'sudo apt install python3-gi gir1.2-atspi-2.0' }),
    );
  });

  it('warns and stops when there is no desktop session (ac3)', async () => {
    const execFile = vi.fn();
    const resolveDesktopEnv = async () => ({ ok: false as const, code: 'no_desktop_session' as const, message: 'no display' });
    const checks = await checkComputerUse({
      config: enabledConfig(),
      platform: 'linux',
      deps: { execFile, resolveDesktopEnv },
    });
    expect(checks).toEqual([
      { name: 'Computer use', status: 'warn', message: 'No desktop session here; pan computer refuses on this host' },
    ]);
  });

  it('returns exactly one ok row when every probe succeeds on X11 (ac4)', async () => {
    const checks = await checkComputerUse({ config: enabledConfig(), platform: 'linux', deps: baseDeps() });
    expect(checks).toEqual([{ name: 'Computer use', status: 'ok', message: 'Ready (x11, display :1)' }]);
  });

  it('gives an error row when xdotool is missing on X11', async () => {
    const execFile = okExecFile({ xdotool: async () => { throw new Error('not found'); } });
    const checks = await checkComputerUse({ config: enabledConfig(), platform: 'linux', deps: baseDeps({ execFile }) });
    expect(checks).toContainEqual(expect.objectContaining({ status: 'error', fix: 'sudo apt install xdotool' }));
  });

  it('warns when no clipboard tool is available', async () => {
    const execFile = okExecFile({
      xclip: async () => { throw new Error('not found'); },
      xsel: async () => { throw new Error('not found'); },
    });
    const checks = await checkComputerUse({ config: enabledConfig(), platform: 'linux', deps: baseDeps({ execFile }) });
    expect(checks).toContainEqual(expect.objectContaining({ status: 'warn', message: 'paste-text unavailable' }));
  });

  it('warns when GNOME accessibility is off', async () => {
    const execFile = okExecFile({ gsettings: async () => ({ stdout: 'false\n', stderr: '' }) });
    const checks = await checkComputerUse({ config: enabledConfig(), platform: 'linux', deps: baseDeps({ execFile }) });
    expect(checks).toContainEqual(
      expect.objectContaining({ status: 'warn', fix: 'gsettings set org.gnome.desktop.interface toolkit-accessibility true' }),
    );
  });

  it('checks for grim (not xdotool) on a Wayland session', async () => {
    const execFile = okExecFile({ grim: async () => { throw new Error('not found'); } });
    const checks = await checkComputerUse({
      config: enabledConfig(),
      platform: 'linux',
      deps: baseDeps({ execFile, resolveDesktopEnv: async () => ({ ok: true, env: { WAYLAND_DISPLAY: 'wayland-0', XDG_SESSION_TYPE: 'wayland' } }) }),
    });
    expect(checks).toContainEqual(expect.objectContaining({ status: 'warn', message: 'screenshots unavailable on Wayland' }));
  });

  it('omits the ok row when the handshake fails', async () => {
    const checks = await checkComputerUse({
      config: enabledConfig(),
      platform: 'linux',
      deps: baseDeps({ runHelper: async () => { throw new Error('boom'); } }),
    });
    expect(checks.some((c) => c.status === 'ok')).toBe(false);
  });
});
