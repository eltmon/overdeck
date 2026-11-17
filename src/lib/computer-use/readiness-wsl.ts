/**
 * Readiness for the WSL2 computer-use provider (PAN-5462, PRD WI-1, FR-3, FR-4).
 *
 * Four checks, in order: Windows interop, Windows PowerShell, the helper
 * folder under %LOCALAPPDATA%, and a helper handshake. Nothing is installed on
 * Windows, so setupSteps is always empty: the helper copy happens on every
 * call. Types come from platform-types.ts, never platform.ts (D-10 of PAN-5461).
 */
import { randomUUID } from 'node:crypto';
import { rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { HelperResponse } from './helper.js';
import { tryWithDesktopLock as tryWithDesktopLockReal, withDesktopLock as withDesktopLockReal } from './lease.js';
import type { ReadinessCheck, ReadinessReport } from './platform-types.js';
import {
  interopEnabled as interopEnabledReal,
  resolveHelperDir as resolveHelperDirReal,
  runWindowsHelper as runWindowsHelperReal,
  windowsVersion as windowsVersionReal,
  type HelperDir,
  type WslBridgeDeps,
} from './wsl-bridge.js';

const HELPER_IF_FREE_WAIT_MS = 2_000;

/** FR-4: shown when WSL can't run Windows programs. */
export const INTEROP_FIX = 'Enable interop in /etc/wsl.conf ([interop] enabled=true), then run wsl --shutdown from Windows.';

export interface WslReadinessDeps extends WslBridgeDeps {
  interopEnabled?: () => boolean;
  windowsVersion?: () => Promise<{ powershell: string; build: string }>;
  resolveHelperDir?: () => Promise<HelperDir>;
  runWindowsHelper?: (operation: Record<string, unknown>) => Promise<HelperResponse>;
  withDesktopLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  tryWithDesktopLock?: <T>(
    fn: () => Promise<T>,
    options: { waitMs: number },
  ) => Promise<{ acquired: true; value: T } | { acquired: false }>;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unavailable(id: string, label: string, detail: string): ReadinessCheck {
  return { id, label, status: 'unavailable', detail };
}

async function probeHelperDir(deps: WslReadinessDeps): Promise<ReadinessCheck> {
  const label = 'Helper folder';
  try {
    const dir = await (deps.resolveHelperDir ?? (() => resolveHelperDirReal(deps)))();
    const probe = join(dir.linux, `.probe-${(deps.randomUUID ?? randomUUID)()}`);
    await (deps.writeFile ?? writeFile)(probe, 'ok');
    await (deps.rm ?? rm)(probe, { force: true });
    return { id: 'helper-dir', label, status: 'ok', detail: dir.win };
  } catch (error) {
    return { id: 'helper-dir', label, status: 'missing', detail: errorMessage(error) };
  }
}

async function probeHelper(mode: 'wait' | 'if-free', deps: WslReadinessDeps): Promise<ReadinessCheck> {
  const label = 'Helper test';
  const runHelper = deps.runWindowsHelper ?? ((operation: Record<string, unknown>) => runWindowsHelperReal(operation, deps));
  const handshake = () => runHelper({ tool: 'handshake' });
  try {
    if (mode === 'wait') {
      const withDesktopLock = deps.withDesktopLock ?? (<T>(fn: () => Promise<T>) => withDesktopLockReal(fn));
      await withDesktopLock(handshake);
    } else {
      const tryWithDesktopLock =
        deps.tryWithDesktopLock ?? (<T>(fn: () => Promise<T>, options: { waitMs: number }) => tryWithDesktopLockReal(fn, options));
      const result = await tryWithDesktopLock(handshake, { waitMs: HELPER_IF_FREE_WAIT_MS });
      if (!result.acquired) return { id: 'helper', label, status: 'ok', detail: 'skipped: an agent is using the desktop' };
    }
    return { id: 'helper', label, status: 'ok', detail: 'handshake ok' };
  } catch (error) {
    return { id: 'helper', label, status: 'missing', detail: errorMessage(error) };
  }
}

/** The "What Overdeck checked" rows for WSL2 (FR-3 order). */
export async function wslReadiness(
  options: { probeHelper: 'wait' | 'if-free' },
  deps: WslReadinessDeps = {},
): Promise<ReadinessReport> {
  const interopOn = (deps.interopEnabled ?? (() => interopEnabledReal(deps)))();
  if (!interopOn) {
    const detail = "WSL can't run Windows programs";
    return {
      session: { ok: false, message: detail },
      checks: [
        { id: 'interop', label: 'Windows interop', status: 'missing', detail, fixCommand: INTEROP_FIX },
        unavailable('powershell', 'Windows PowerShell', 'needs Windows interop'),
        unavailable('helper-dir', 'Helper folder', 'needs Windows interop'),
        unavailable('helper', 'Helper test', 'needs Windows interop'),
      ],
      setupSteps: [],
    };
  }
  const interopRow: ReadinessCheck = { id: 'interop', label: 'Windows interop', status: 'ok', detail: 'enabled' };

  let version: { powershell: string; build: string };
  try {
    version = await (deps.windowsVersion ?? (() => windowsVersionReal(deps)))();
  } catch {
    const detail = 'powershell.exe not found or failed to start';
    return {
      session: { ok: false, message: detail },
      checks: [
        interopRow,
        { id: 'powershell', label: 'Windows PowerShell', status: 'missing', detail },
        unavailable('helper-dir', 'Helper folder', 'needs Windows PowerShell'),
        unavailable('helper', 'Helper test', 'needs Windows PowerShell'),
      ],
      setupSteps: [],
    };
  }

  const helperDirRow = await probeHelperDir(deps);
  const helperRow =
    helperDirRow.status === 'ok'
      ? await probeHelper(options.probeHelper, deps)
      : unavailable('helper', 'Helper test', 'needs the helper folder');

  return {
    session: { ok: true, label: `windows · ${version.build}` },
    checks: [
      interopRow,
      { id: 'powershell', label: 'Windows PowerShell', status: 'ok', detail: `PowerShell ${version.powershell}` },
      helperDirRow,
      helperRow,
    ],
    setupSteps: [],
  };
}
