import { describe, expect, it, vi } from 'vitest';

import { ComputerUseError, isComputerUseError } from '../errors.js';
import type { ComputerUseProvider } from '../platform-types.js';
import { runCapabilities, runComputerOperation, runRelease, type RunDeps } from '../run.js';

type FakeProviderParts = Partial<Pick<ComputerUseProvider, 'resolveSession' | 'runHelper'>>;

function fakeProvider(parts: FakeProviderParts = {}): ComputerUseProvider {
  return {
    id: 'linux',
    blockedKeyPlatform: 'linux',
    resolveSession: parts.resolveSession ?? (async () => ({ ok: true, session: { label: 'x11 · display :1', env: { DISPLAY: ':1' } } })),
    readiness: async () => ({ session: { ok: true, label: 'x11 · display :1' }, checks: [], setupSteps: [] }),
    runSetupStep: async () => ({ status: 'skipped' }),
    runHelper: parts.runHelper ?? (async () => ({ ok: true })),
  };
}

/** RunDeps plus the fake provider's parts; a non-Linux `platform` reaches the null-provider branch. */
function baseDeps(overrides: Partial<RunDeps> & FakeProviderParts = {}): RunDeps {
  const { resolveSession, runHelper, ...runOverrides } = overrides;
  const provider = fakeProvider({ resolveSession, runHelper });
  const platform = runOverrides.platform ?? 'linux';
  return {
    platform,
    detectPlatform: () => (platform === 'linux' ? 'linux' : platform === 'darwin' ? 'darwin' : 'unsupported'),
    providerFor: (id) => (id === 'linux' ? provider : null),
    loadConfig: () => ({ computerUse: { enabled: true } }),
    withDesktopLock: async (fn) => fn(),
    claimLease: async () => {},
    releaseLease: async () => {},
    saveSnapshot: async () => {},
    saveScreenshot: async () => null,
    holderKey: () => 'holder-a',
    now: () => 0,
    ...runOverrides,
  };
}

describe('runComputerOperation preamble (PAN-5452)', () => {
  it('throws disabled and never calls runHelper when computer_use is off (ac1)', async () => {
    const runHelper = vi.fn();
    const deps = baseDeps({ loadConfig: () => ({ computerUse: { enabled: false } }), runHelper });

    const error = await runComputerOperation({ kind: 'read', operation: { tool: 'list_apps' } }, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('disabled');
    expect(error.message).toBe(
      'Computer use is off. Turn it on in the dashboard under Settings → Computer Use, or set computer_use: { enabled: true } in ~/.overdeck/config.yaml.',
    );
    expect(runHelper).not.toHaveBeenCalled();
  });

  it('throws unsupported_platform before the config or env checks (ac2)', async () => {
    const loadConfig = vi.fn().mockReturnValue({ computerUse: { enabled: true } });
    const resolveSession = vi.fn();
    const deps = baseDeps({ platform: 'darwin', loadConfig, resolveSession });

    const error = await runComputerOperation({ kind: 'read', operation: {} }, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('unsupported_platform');
    expect(loadConfig).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it('a null provider throws unsupported_platform with the host platform before the config check (PAN-5461 FR-2)', async () => {
    const loadConfig = vi.fn().mockReturnValue({ computerUse: { enabled: true } });
    const deps = baseDeps({ platform: 'win32', loadConfig });

    const error = await runComputerOperation({ kind: 'read', operation: {} }, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('unsupported_platform');
    expect(error.message).toBe("Computer use isn't supported on this host (win32) yet.");
    expect(loadConfig).not.toHaveBeenCalled();
  });

  it('refuses WSL with unsupported_platform before reading config (PAN-5461 D-9)', async () => {
    const loadConfig = vi.fn().mockReturnValue({ computerUse: { enabled: true } });
    const resolveSession = vi.fn();
    const deps = baseDeps({ detectPlatform: () => 'wsl', loadConfig, resolveSession });

    const error = await runComputerOperation({ kind: 'read', operation: {} }, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('unsupported_platform');
    expect(error.message).toBe("Computer use isn't supported on this host (wsl) yet.");
    expect(loadConfig).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
  });

  it('passes the provider session to runHelper', async () => {
    const runHelper = vi.fn().mockResolvedValue({ ok: true, apps: [] });
    await runComputerOperation({ kind: 'read', operation: { tool: 'list_apps' } }, baseDeps({ runHelper }));
    expect(runHelper).toHaveBeenCalledWith({ tool: 'list_apps' }, { label: 'x11 · display :1', env: { DISPLAY: ':1' } });
  });

  it('an input op throws desktop_busy without calling runHelper when another holder holds the lease (ac3)', async () => {
    const claimLease = vi.fn().mockRejectedValue(new ComputerUseError('desktop_busy', 'busy'));
    const runHelper = vi.fn();
    const deps = baseDeps({ claimLease, runHelper });

    const error = await runComputerOperation({ kind: 'input', operation: { tool: 'click' } }, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('desktop_busy');
    expect(runHelper).not.toHaveBeenCalled();
  });

  it('a read op runs the helper and never calls claimLease (ac3)', async () => {
    const claimLease = vi.fn();
    const runHelper = vi.fn().mockResolvedValue({ ok: true, apps: [] });
    const deps = baseDeps({ claimLease, runHelper });

    const result = await runComputerOperation({ kind: 'read', operation: { tool: 'list_apps' } }, deps);
    expect(claimLease).not.toHaveBeenCalled();
    expect(runHelper).toHaveBeenCalled();
    expect(result.response).toEqual({ ok: true, apps: [] });
  });

  it('saves the snapshot and screenshot when the helper response includes one (step 8)', async () => {
    const snapshot = { snapshotId: 's1', windowIndex: 0, elements: [{ index: 0 }], screenshotPngBase64: 'abc' };
    const saveSnapshot = vi.fn().mockResolvedValue(undefined);
    const saveScreenshot = vi.fn().mockResolvedValue({ path: '/x/s.png', width: 1, height: 1, scale: 1 });
    const runHelper = vi.fn().mockResolvedValue({ ok: true, snapshot });
    const deps = baseDeps({ runHelper, saveSnapshot, saveScreenshot, holderKey: () => 'holder-a' });

    const result = await runComputerOperation({ kind: 'read', operation: { tool: 'get_app_state', app: 'calc' } }, deps);

    expect(saveSnapshot).toHaveBeenCalledWith('holder-a', 'calc', { snapshotId: 's1', windowIndex: 0, elements: [{ index: 0 }] });
    expect(saveScreenshot).toHaveBeenCalledWith(snapshot);
    expect(result.screenshot).toEqual({ path: '/x/s.png', width: 1, height: 1, scale: 1 });
  });

  it('skips saveSnapshot/saveScreenshot when the response has no snapshot', async () => {
    const saveSnapshot = vi.fn();
    const saveScreenshot = vi.fn();
    const runHelper = vi.fn().mockResolvedValue({ ok: true, apps: [] });
    const deps = baseDeps({ runHelper, saveSnapshot, saveScreenshot });

    const result = await runComputerOperation({ kind: 'read', operation: { tool: 'list_apps' } }, deps);
    expect(saveSnapshot).not.toHaveBeenCalled();
    expect(saveScreenshot).not.toHaveBeenCalled();
    expect(result.screenshot).toBeNull();
  });
});

describe('runCapabilities (PAN-5452 FR-13)', () => {
  it('on darwin, returns without throwing and helper is null (ac2)', async () => {
    const result = await runCapabilities(baseDeps({ platform: 'darwin' }));
    expect(result.platform).toBe('darwin');
    expect(result.desktopSession.ok).toBe(false);
    expect(result.helper).toBeNull();
  });

  it('reports disabled + no desktop session without calling runHelper (ac4)', async () => {
    const runHelper = vi.fn();
    const resolveSession = vi.fn().mockResolvedValue({ ok: false, code: 'no_desktop_session', message: 'no display' });
    const deps = baseDeps({ loadConfig: () => ({ computerUse: { enabled: false } }), resolveSession, runHelper });

    const result = await runCapabilities(deps);
    expect(result.enabled).toBe(false);
    expect(result.desktopSession.ok).toBe(false);
    expect(result.helper).toBeNull();
    expect(runHelper).not.toHaveBeenCalled();
  });

  it('runs the handshake under the lock on linux with a desktop session', async () => {
    const withDesktopLock = vi.fn(async <T>(fn: () => Promise<T>) => fn());
    const runHelper = vi.fn().mockResolvedValue({ ok: true, capabilities: { platform: 'linux' } });
    const deps = baseDeps({ withDesktopLock, runHelper });

    const result = await runCapabilities(deps);
    expect(withDesktopLock).toHaveBeenCalled();
    expect(result.helper).toEqual({ platform: 'linux' });
  });

  it('keeps the capabilities result shape for a Linux provider (PAN-5461)', async () => {
    const resolveSession = async () => ({
      ok: true as const,
      session: { label: 'x11 · display :1', env: { DISPLAY: ':1', XDG_SESSION_TYPE: 'x11' } },
    });
    const runHelper = vi.fn().mockResolvedValue({ ok: true, capabilities: { platform: 'linux' } });
    const result = await runCapabilities(baseDeps({ resolveSession, runHelper }));
    expect(result).toEqual({
      platform: 'linux',
      enabled: true,
      desktopSession: { ok: true, sessionType: 'x11', display: ':1' },
      helper: { platform: 'linux' },
    });
  });

  it('reports the unsupported message without throwing when the platform has no provider', async () => {
    const result = await runCapabilities(baseDeps({ detectPlatform: () => 'wsl' }));
    expect(result.desktopSession).toEqual({ ok: false, message: "Computer use isn't supported on this host (wsl) yet." });
    expect(result.helper).toBeNull();
  });

  it('fills helperError and still returns a result when the handshake fails', async () => {
    const runHelper = vi.fn().mockRejectedValue(new ComputerUseError('helper_error', 'boom'));
    const result = await runCapabilities(baseDeps({ runHelper }));
    expect(result.helper).toBeNull();
    expect(result.helperError).toBe('boom');
  });
});

describe('runCapabilities under WSL2 (PAN-5462 FR-1)', () => {
  function wslDeps(runHelper: ComputerUseProvider['runHelper'], windowsVersion = vi.fn(async () => ({ powershell: '5.1', build: '10.0.22631.0' }))) {
    const provider: ComputerUseProvider = {
      id: 'wsl',
      blockedKeyPlatform: 'windows',
      resolveSession: async () => ({
        ok: true,
        session: { label: 'windows', env: { XDG_SESSION_TYPE: 'wayland', DISPLAY: ':0', WAYLAND_DISPLAY: 'wayland-0' } },
      }),
      readiness: vi.fn(async () => ({ session: { ok: true as const, label: 'windows' }, checks: [], setupSteps: [] })),
      runSetupStep: async () => ({ status: 'skipped' }),
      runHelper,
    };
    return { provider, windowsVersion, deps: baseDeps({ detectPlatform: () => 'wsl', providerFor: (id) => (id === 'wsl' ? provider : null), windowsVersion }) };
  }

  it('reports the Windows build as the session label, never WSLg session fields (ac1)', async () => {
    const { deps, provider, windowsVersion } = wslDeps(async () => ({ ok: true, capabilities: { platform: 'win32' } }));
    const result = await runCapabilities(deps);

    expect(result.desktopSession).toEqual({ ok: true, label: 'windows · 10.0.22631.0' });
    expect(windowsVersion).toHaveBeenCalledTimes(1);
    expect(provider.readiness).not.toHaveBeenCalled();
  });

  it('keeps the handshake in helper (ac2)', async () => {
    const runHelper = vi.fn(async () => ({ ok: true, capabilities: { platform: 'win32', provider: 'orca-computer-use-windows' } }));
    const result = await runCapabilities(wslDeps(runHelper).deps);

    expect(runHelper).toHaveBeenCalledWith({ tool: 'handshake' }, expect.anything());
    expect(result.helper).toMatchObject({ platform: 'win32', provider: 'orca-computer-use-windows' });
  });

  it('keeps the bare windows label when the version probe fails', async () => {
    const failing = vi.fn(async () => {
      throw new Error('powershell.exe failed');
    });
    const result = await runCapabilities(wslDeps(async () => ({ ok: true }), failing).deps);
    expect(result.desktopSession).toEqual({ ok: true, label: 'windows' });
  });
});

describe('runRelease (PAN-5452)', () => {
  it('skips the platform/config/env checks and just releases the lease (ac5)', async () => {
    const loadConfig = vi.fn().mockReturnValue({ computerUse: { enabled: false } });
    const resolveSession = vi.fn();
    const releaseLease = vi.fn().mockResolvedValue(undefined);
    const deps = baseDeps({ loadConfig, resolveSession, releaseLease, platform: 'darwin' });

    await runRelease({ force: true }, deps);

    expect(releaseLease).toHaveBeenCalledWith({ force: true });
    expect(loadConfig).not.toHaveBeenCalled();
    expect(resolveSession).not.toHaveBeenCalled();
  });
});
