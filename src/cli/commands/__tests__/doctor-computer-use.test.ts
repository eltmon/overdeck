import { describe, expect, it, vi } from 'vitest';

import { mergeConfigs } from '../../../lib/config-yaml/merge.js';
import type { ComputerUseProvider, ReadinessCheck } from '../../../lib/computer-use/platform.js';
import { INTEROP_FIX } from '../../../lib/computer-use/readiness-wsl.js';
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

  it('warns that macOS is unsupported and runs no further probe', async () => {
    const execFile = vi.fn();
    const checks = await checkComputerUse({ config: enabledConfig(), platform: 'darwin', deps: { execFile } });
    expect(checks).toEqual([
      { name: 'Computer use', status: 'warn', message: 'Enabled, but computer use supports Linux and Windows through WSL2 only' },
    ]);
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

  it('reports an error row carrying the handshake failure instead of going silent', async () => {
    const checks = await checkComputerUse({
      config: enabledConfig(),
      platform: 'linux',
      deps: baseDeps({ runHelper: async () => { throw new Error('boom'); } }),
    });
    expect(checks.some((c) => c.status === 'ok')).toBe(false);
    expect(checks).toContainEqual(expect.objectContaining({ status: 'error', message: expect.stringContaining('boom') }));
  });
});

describe('checkComputerUse under WSL2 (PAN-5462 FR-7)', () => {
  function fakeWslProvider(checks: ReadinessCheck[]): ComputerUseProvider {
    return {
      id: 'wsl',
      blockedKeyPlatform: 'windows',
      resolveSession: async () => ({ ok: true, session: { label: 'windows', env: {} } }),
      readiness: vi.fn(async () => ({ session: { ok: true as const, label: 'windows · 10.0.22631.0' }, checks, setupSteps: [] })),
      runSetupStep: async () => ({ status: 'skipped' as const }),
      runHelper: async () => ({ ok: true }),
    };
  }

  const okChecks: ReadinessCheck[] = [
    { id: 'interop', label: 'Windows interop', status: 'ok', detail: 'enabled' },
    { id: 'powershell', label: 'Windows PowerShell', status: 'ok', detail: 'PowerShell 5.1.22621.4391' },
    { id: 'helper-dir', label: 'Helper folder', status: 'ok', detail: 'C:\\Users\\me\\AppData\\Local\\Overdeck\\computer-use' },
    { id: 'helper', label: 'Helper test', status: 'ok', detail: 'handshake ok' },
  ];

  const wslDeps = (provider: ComputerUseProvider): CheckComputerUseDeps => ({ detectPlatform: () => 'wsl', wslProvider: provider });

  it('returns one ok row per readiness check (ac1)', async () => {
    const checks = await checkComputerUse({ config: enabledConfig(), deps: wslDeps(fakeWslProvider(okChecks)) });
    expect(checks.map((row) => row.status)).toEqual(['ok', 'ok', 'ok', 'ok']);
    expect(checks.map((row) => row.message.split(':')[0])).toEqual(['Windows interop', 'Windows PowerShell', 'Helper folder', 'Helper test']);
  });

  it('gives the interop row status error with the FR-4 fix when interop is missing (ac2)', async () => {
    const provider = fakeWslProvider([
      { id: 'interop', label: 'Windows interop', status: 'missing', detail: "WSL can't run Windows programs", fixCommand: INTEROP_FIX },
      { id: 'powershell', label: 'Windows PowerShell', status: 'unavailable', detail: 'needs Windows interop' },
      { id: 'helper-dir', label: 'Helper folder', status: 'unavailable', detail: 'needs Windows interop' },
      { id: 'helper', label: 'Helper test', status: 'unavailable', detail: 'needs Windows interop' },
    ]);
    const checks = await checkComputerUse({ config: enabledConfig(), deps: wslDeps(provider) });
    expect(checks[0]).toEqual({
      name: 'Computer use',
      status: 'error',
      message: "Windows interop: WSL can't run Windows programs",
      fix: INTEROP_FIX,
    });
  });

  it('returns no rows when the feature is disabled (ac3)', async () => {
    const provider = fakeWslProvider(okChecks);
    const checks = await checkComputerUse({ config: disabledConfig(), deps: wslDeps(provider) });
    expect(checks).toEqual([]);
    expect(provider.readiness).not.toHaveBeenCalled();
  });
});
