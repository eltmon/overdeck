/**
 * Filesystem locations for `pan computer` (PAN-5452). Every location derives from
 * {@link getOverdeckHome}, resolved on each call so tests can swap OVERDECK_HOME.
 * NFR-1: nothing here lives under the system temp directory.
 */
import { join } from 'node:path';
import { getOverdeckHome, packageRoot } from '../paths.js';

export function computerUseDir(): string {
  return join(getOverdeckHome(), 'computer-use');
}

export function opsDir(): string {
  return join(computerUseDir(), 'ops');
}

export function lockPath(): string {
  return join(computerUseDir(), 'desktop.lock');
}

export function leasePath(): string {
  return join(computerUseDir(), 'lease.json');
}

export function snapshotDir(holderKey: string): string {
  return join(computerUseDir(), 'snapshots', holderKey);
}

export function screenshotDir(): string {
  return join(computerUseDir(), 'screenshots');
}

/** The vendored Orca helper, resolved from both `src/` and `dist/` (see `packageRoot`). */
export function helperPath(): string {
  return join(packageRoot, 'native', 'computer-use-linux', 'runtime.py');
}

/** The vendored Orca Windows helper (PAN-5462), copied to the Windows side before each call. */
export function windowsHelperSource(): string {
  return join(packageRoot, 'native', 'computer-use-windows', 'runtime.ps1');
}

/** Caches the WSL path of the Windows-side helper dir so later CLI calls skip a PowerShell start (PAN-5462 D-5). */
export function windowsHelperDirCachePath(): string {
  return join(computerUseDir(), 'windows-helper-dir.txt');
}

/** The only Python on this host with `gi`/AT-SPI bindings; the Linuxbrew python3 lacks them. */
export const SYSTEM_PYTHON = '/usr/bin/python3';
