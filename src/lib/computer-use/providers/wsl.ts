/**
 * The WSL2 computer-use provider (PAN-5462, PRD WI-1, D-1).
 *
 * Drives the Windows desktop from WSL2: wsl-bridge.ts runs the vendored Orca
 * helper through powershell.exe, and readiness-wsl.ts reports the four checks.
 * Nothing is installed on Windows, so every setup step is skipped. The session
 * never reads WSLg's XDG_SESSION_TYPE or DISPLAY. Types come from
 * ../platform-types.js, never ../platform.js, because platform.ts imports this
 * file (PAN-5461 D-10).
 */
import type { HelperResponse } from '../helper.js';
import type { ComputerUseProvider } from '../platform-types.js';
import { INTEROP_FIX, wslReadiness as wslReadinessReal, type WslReadinessDeps } from '../readiness-wsl.js';
import {
  interopEnabled as interopEnabledReal,
  POWERSHELL_NOT_FOUND_MESSAGE,
  resolvePowershell as resolvePowershellReal,
  runWindowsHelper as runWindowsHelperReal,
} from '../wsl-bridge.js';

export interface WslProviderDeps {
  interopEnabled?: () => boolean;
  resolvePowershell?: () => Promise<string | null>;
  runWindowsHelper?: (operation: Record<string, unknown>) => Promise<HelperResponse>;
  wslReadiness?: (options: { probeHelper: 'wait' | 'if-free' }, deps?: WslReadinessDeps) => ReturnType<typeof wslReadinessReal>;
}

export function createWslProvider(deps: WslProviderDeps = {}): ComputerUseProvider {
  const interopEnabled = deps.interopEnabled ?? (() => interopEnabledReal());
  const resolvePowershell = deps.resolvePowershell ?? (() => resolvePowershellReal());
  const runWindowsHelper = deps.runWindowsHelper ?? ((operation: Record<string, unknown>) => runWindowsHelperReal(operation));
  const wslReadiness = deps.wslReadiness ?? wslReadinessReal;

  return {
    id: 'wsl',
    blockedKeyPlatform: 'windows',
    async resolveSession() {
      if (!interopEnabled()) return { ok: false, code: 'no_desktop_session', message: INTEROP_FIX };
      if (!(await resolvePowershell())) return { ok: false, code: 'no_desktop_session', message: POWERSHELL_NOT_FOUND_MESSAGE };
      return { ok: true, session: { label: 'windows', env: process.env } };
    },
    readiness(options) {
      return wslReadiness(options);
    },
    async runSetupStep() {
      return { status: 'skipped' };
    },
    runHelper(operation) {
      return runWindowsHelper(operation);
    },
  };
}

export const wslProvider: ComputerUseProvider = createWslProvider();
