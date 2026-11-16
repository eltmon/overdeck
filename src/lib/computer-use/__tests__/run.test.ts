import { describe, expect, it, vi } from 'vitest';

import { ComputerUseError, isComputerUseError } from '../errors.js';
import { runCapabilities, runComputerOperation, runRelease, type RunDeps } from '../run.js';

function baseDeps(overrides: Partial<RunDeps> = {}): RunDeps {
  return {
    platform: 'linux',
    loadConfig: () => ({ computerUse: { enabled: true } }),
    resolveDesktopEnv: async () => ({ ok: true, env: { DISPLAY: ':1' } }),
    withDesktopLock: async (fn) => fn(),
    claimLease: async () => {},
    releaseLease: async () => {},
    runHelper: async () => ({ ok: true }),
    saveSnapshot: async () => {},
    saveScreenshot: async () => null,
    holderKey: () => 'holder-a',
    now: () => 0,
    ...overrides,
  };
}

describe('runComputerOperation preamble (PAN-5452)', () => {
  it('throws disabled and never calls runHelper when computer_use is off (ac1)', async () => {
    const runHelper = vi.fn();
    const deps = baseDeps({ loadConfig: () => ({ computerUse: { enabled: false } }), runHelper });

    const error = await runComputerOperation({ kind: 'read', operation: { tool: 'list_apps' } }, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('disabled');
    expect(runHelper).not.toHaveBeenCalled();
  });

  it('throws unsupported_platform before the config or env checks (ac2)', async () => {
    const loadConfig = vi.fn().mockReturnValue({ computerUse: { enabled: true } });
    const resolveDesktopEnv = vi.fn();
    const deps = baseDeps({ platform: 'darwin', loadConfig, resolveDesktopEnv });

    const error = await runComputerOperation({ kind: 'read', operation: {} }, deps).catch((e) => e);
    expect(isComputerUseError(error)).toBe(true);
    expect(error.code).toBe('unsupported_platform');
    expect(loadConfig).not.toHaveBeenCalled();
    expect(resolveDesktopEnv).not.toHaveBeenCalled();
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
    const resolveDesktopEnv = vi.fn().mockResolvedValue({ ok: false, code: 'no_desktop_session', message: 'no display' });
    const deps = baseDeps({ loadConfig: () => ({ computerUse: { enabled: false } }), resolveDesktopEnv, runHelper });

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

  it('fills helperError and still returns a result when the handshake fails', async () => {
    const runHelper = vi.fn().mockRejectedValue(new ComputerUseError('helper_error', 'boom'));
    const result = await runCapabilities(baseDeps({ runHelper }));
    expect(result.helper).toBeNull();
    expect(result.helperError).toBe('boom');
  });
});

describe('runRelease (PAN-5452)', () => {
  it('skips the platform/config/env checks and just releases the lease (ac5)', async () => {
    const loadConfig = vi.fn().mockReturnValue({ computerUse: { enabled: false } });
    const resolveDesktopEnv = vi.fn();
    const releaseLease = vi.fn().mockResolvedValue(undefined);
    const deps = baseDeps({ loadConfig, resolveDesktopEnv, releaseLease, platform: 'darwin' });

    await runRelease({ force: true }, deps);

    expect(releaseLease).toHaveBeenCalledWith({ force: true });
    expect(loadConfig).not.toHaveBeenCalled();
    expect(resolveDesktopEnv).not.toHaveBeenCalled();
  });
});
