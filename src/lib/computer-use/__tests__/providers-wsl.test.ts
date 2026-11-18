import { describe, expect, it, vi } from 'vitest';

import { providerFor } from '../platform.js';
import { createWslProvider } from '../providers/wsl.js';
import { INTEROP_FIX } from '../readiness-wsl.js';
import { POWERSHELL_NOT_FOUND_MESSAGE } from '../wsl-bridge.js';

describe('createWslProvider (PAN-5462 WI-1)', () => {
  it('refuses with no_desktop_session and the FR-4 message when interop is off (ac1)', async () => {
    const resolvePowershell = vi.fn(async () => '/mnt/c/powershell.exe');
    const provider = createWslProvider({ interopEnabled: () => false, resolvePowershell });

    expect(await provider.resolveSession()).toEqual({ ok: false, code: 'no_desktop_session', message: INTEROP_FIX });
    expect(resolvePowershell).not.toHaveBeenCalled();
  });

  it('resolves a windows session when interop is on and powershell.exe is found (ac2)', async () => {
    const provider = createWslProvider({ interopEnabled: () => true, resolvePowershell: async () => '/mnt/c/powershell.exe' });
    const result = await provider.resolveSession();

    expect(result.ok).toBe(true);
    expect(result.ok && result.session.label).toBe('windows');
  });

  it('refuses with the appendWindowsPath hint when powershell.exe is missing', async () => {
    const provider = createWslProvider({ interopEnabled: () => true, resolvePowershell: async () => null });
    expect(await provider.resolveSession()).toEqual({ ok: false, code: 'no_desktop_session', message: POWERSHELL_NOT_FOUND_MESSAGE });
  });

  it('is what providerFor returns for wsl, with Windows key rules (ac3)', () => {
    const provider = providerFor('wsl');
    expect(provider?.id).toBe('wsl');
    expect(provider?.blockedKeyPlatform).toBe('windows');
  });

  it.each(['install-packages', 'enable-accessibility', 'grant-permissions'] as const)(
    'skips the %s setup step (ac4)',
    async (id) => {
      expect(await createWslProvider().runSetupStep(id)).toEqual({ status: 'skipped' });
    },
  );

  it('runs operations through the Windows bridge and readiness through wslReadiness', async () => {
    const runWindowsHelper = vi.fn(async () => ({ ok: true, apps: [] }));
    const report = { session: { ok: true as const, label: 'windows · 10.0.22631.0' }, checks: [], setupSteps: [] };
    const wslReadiness = vi.fn(async () => report);
    const provider = createWslProvider({ runWindowsHelper, wslReadiness });

    expect(await provider.runHelper({ tool: 'list_apps' }, { label: 'windows', env: {} })).toEqual({ ok: true, apps: [] });
    expect(runWindowsHelper).toHaveBeenCalledWith({ tool: 'list_apps' });
    expect(await provider.readiness({ probeHelper: 'if-free' })).toBe(report);
    expect(wslReadiness).toHaveBeenCalledWith({ probeHelper: 'if-free' });
  });
});
