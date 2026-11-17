/**
 * Linux computer-use readiness (PAN-5461, PRD WI-2b).
 *
 * The read-only host probes that used to live inside `pan doctor`
 * (doctor-computer-use.ts) now live here, so the Settings page can run them
 * whether or not computer use is on (D-6). `probeLinux` gathers raw facts,
 * `planLinuxInstall` turns missing packages into one install plan, and
 * `linuxReadiness` shapes both into the "What Overdeck checked" rows plus the
 * setup steps the Setup button would run. Every probe goes through an injected
 * `execFile`, so tests never spawn processes. Types come from platform-types.ts
 * (D-10). Package-manager detection is local and never imports
 * prereqs/registry.ts (D-15).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { resolveDesktopEnv as resolveDesktopEnvReal, type ResolveDesktopEnvDeps, type ResolveDesktopEnvResult } from './desktop-env.js';
import { runHelper as runHelperReal, type HelperResponse } from './helper.js';
import { tryWithDesktopLock as tryWithDesktopLockReal, withDesktopLock as withDesktopLockReal } from './lease.js';
import type { ReadinessCheck, ReadinessReport, SetupStep } from './platform-types.js';

const execFileAsync = promisify(execFile);
const PROBE_TIMEOUT_MS = 5_000;
const HELPER_IF_FREE_WAIT_MS = 2_000;
const ATSPI_IMPORT = "import gi; gi.require_version('Atspi','2.0'); from gi.repository import Atspi";

export type ExecFileFn = (
  file: string,
  args: string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;
export type LinuxPackageManagerId = 'pacman' | 'dnf' | 'zypper' | 'apk' | 'apt-get';
export type HelperLockMode = 'wait' | 'if-free' | 'none';

/** Detection order matches src/lib/prereqs/registry.ts (D-15). */
const PACKAGE_MANAGER_ORDER: readonly LinuxPackageManagerId[] = ['pacman', 'dnf', 'zypper', 'apk', 'apt-get'];
const AUTOMATIC_MANAGERS: ReadonlySet<LinuxPackageManagerId> = new Set(['apt-get', 'dnf', 'pacman']);

type PackageRowId = 'atspi' | 'input' | 'clipboard' | 'screenshots';

/** Packages per missing readiness row, per package manager, in table order (PRD WI-2b). */
export const LINUX_PACKAGES: Readonly<Record<PackageRowId, Readonly<Record<LinuxPackageManagerId, readonly string[]>>>> = {
  atspi: {
    'apt-get': ['python3-gi', 'gir1.2-atspi-2.0'],
    dnf: ['python3-gobject', 'at-spi2-core'],
    pacman: ['python-gobject', 'at-spi2-core'],
    zypper: ['python3-gobject', 'at-spi2-core'],
    apk: ['py3-gobject3', 'at-spi2-core'],
  },
  input: { 'apt-get': ['xdotool'], dnf: ['xdotool'], pacman: ['xdotool'], zypper: ['xdotool'], apk: ['xdotool'] },
  clipboard: { 'apt-get': ['xclip'], dnf: ['xclip'], pacman: ['xclip'], zypper: ['xclip'], apk: ['xclip'] },
  screenshots: { 'apt-get': ['grim'], dnf: ['grim'], pacman: ['grim'], zypper: ['grim'], apk: ['grim'] },
};

export interface LinuxProbeResult {
  session: { ok: true; env: NodeJS.ProcessEnv; sessionType: string; display: string } | { ok: false; message: string };
  atspiOk: boolean;
  isWayland: boolean;
  xdotool: boolean; // true on Wayland (not needed)
  grim: boolean; // true on X11 (not needed)
  clipboard: string | null; // first of the clipboard commands found
  gsettings: boolean;
  accessibilityOn: boolean; // gsettings get … == 'true'; false when !gsettings
  packageManager: LinuxPackageManagerId | null; // null when not detected or detection skipped
}

export interface LinuxReadinessDeps {
  execFile?: ExecFileFn;
  resolveDesktopEnv?: (deps?: ResolveDesktopEnvDeps) => Promise<ResolveDesktopEnvResult>;
  runHelper?: (operation: Record<string, unknown>, env: NodeJS.ProcessEnv) => Promise<HelperResponse>;
  withDesktopLock?: <T>(fn: () => Promise<T>) => Promise<T>;
  tryWithDesktopLock?: <T>(
    fn: () => Promise<T>,
    options: { waitMs: number },
  ) => Promise<{ acquired: true; value: T } | { acquired: false }>;
}

export interface LinuxReadinessReport extends ReadinessReport {
  sessionType: string; // '' without a session
  display: string; // '' without a session
  helperError?: string; // raw handshake error message, for doctor
}

export interface LinuxInstallPlan {
  packageManager: LinuxPackageManagerId | null;
  packages: string[]; // that manager's names; apt-get names when packageManager is null
  automatic: boolean; // true only for apt-get, dnf, pacman
}

function execFor(deps: LinuxReadinessDeps): ExecFileFn {
  return deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options));
}

async function probeOk(exec: ExecFileFn, file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<boolean> {
  try {
    await exec(file, args, env ? { timeout: PROBE_TIMEOUT_MS, env } : { timeout: PROBE_TIMEOUT_MS });
    return true;
  } catch {
    return false;
  }
}

async function probeStdout(exec: ExecFileFn, file: string, args: string[], env?: NodeJS.ProcessEnv): Promise<string | null> {
  try {
    const { stdout } = await exec(file, args, env ? { timeout: PROBE_TIMEOUT_MS, env } : { timeout: PROBE_TIMEOUT_MS });
    return stdout.trim();
  } catch {
    return null;
  }
}

async function firstOnPath<T extends string>(exec: ExecFileFn, commands: readonly T[]): Promise<T | null> {
  for (const command of commands) {
    if (await probeOk(exec, 'which', [command])) return command;
  }
  return null;
}

async function probeAccessibility(exec: ExecFileFn, env: NodeJS.ProcessEnv): Promise<{ gsettings: boolean; accessibilityOn: boolean }> {
  if (!(await probeOk(exec, 'which', ['gsettings']))) return { gsettings: false, accessibilityOn: false };
  const value = await probeStdout(exec, 'gsettings', ['get', 'org.gnome.desktop.interface', 'toolkit-accessibility'], env);
  return { gsettings: true, accessibilityOn: value === 'true' };
}

/** Runs the read-only host probes (same files and args as the old doctor check). */
export async function probeLinux(options: { detectPackageManager: boolean }, deps: LinuxReadinessDeps = {}): Promise<LinuxProbeResult> {
  const exec = execFor(deps);
  const resolveDesktopEnv = deps.resolveDesktopEnv ?? ((envDeps?: ResolveDesktopEnvDeps) => resolveDesktopEnvReal(envDeps));

  const atspiOk = await probeOk(exec, '/usr/bin/python3', ['-I', '-c', ATSPI_IMPORT]);

  const envResult = await resolveDesktopEnv();
  if (!envResult.ok) {
    return {
      session: { ok: false, message: envResult.message },
      atspiOk,
      isWayland: false,
      xdotool: false,
      grim: false,
      clipboard: null,
      gsettings: false,
      accessibilityOn: false,
      packageManager: null,
    };
  }

  const env = envResult.env;
  const sessionType = (env.XDG_SESSION_TYPE ?? '').toLowerCase();
  const display = env.DISPLAY ?? env.WAYLAND_DISPLAY ?? '';
  const isWayland = sessionType === 'wayland';
  const clipboardCommands = isWayland ? ['wl-copy', 'xclip', 'xsel'] : ['xclip', 'xsel'];

  const [xdotool, grim, clipboard, accessibility, packageManager] = await Promise.all([
    isWayland ? Promise.resolve(true) : probeOk(exec, 'which', ['xdotool']),
    isWayland ? probeOk(exec, 'which', ['grim']) : Promise.resolve(true),
    firstOnPath(exec, clipboardCommands),
    probeAccessibility(exec, env),
    options.detectPackageManager ? firstOnPath(exec, PACKAGE_MANAGER_ORDER) : Promise.resolve(null),
  ]);

  return {
    session: { ok: true, env, sessionType, display },
    atspiOk,
    isWayland,
    xdotool,
    grim,
    clipboard,
    gsettings: accessibility.gsettings,
    accessibilityOn: accessibility.accessibilityOn,
    packageManager,
  };
}

function missingPackageRows(probe: LinuxProbeResult): PackageRowId[] {
  const rows: PackageRowId[] = [];
  if (!probe.atspiOk) rows.push('atspi');
  // Without a session the session-dependent probes never ran; only atspi is known.
  if (!probe.session.ok) return rows;
  if (!probe.xdotool) rows.push('input');
  if (probe.clipboard === null) rows.push('clipboard');
  if (!probe.grim) rows.push('screenshots');
  return rows;
}

function packagesFor(rows: readonly PackageRowId[], manager: LinuxPackageManagerId): string[] {
  const packages: string[] = [];
  for (const row of rows) {
    for (const name of LINUX_PACKAGES[row][manager]) {
      if (!packages.includes(name)) packages.push(name);
    }
  }
  return packages;
}

/** One install plan for every missing package row, or null when nothing is missing. */
export function planLinuxInstall(probe: LinuxProbeResult): LinuxInstallPlan | null {
  const rows = missingPackageRows(probe);
  if (rows.length === 0) return null;
  return {
    packageManager: probe.packageManager,
    packages: packagesFor(rows, probe.packageManager ?? 'apt-get'),
    automatic: probe.packageManager !== null && AUTOMATIC_MANAGERS.has(probe.packageManager),
  };
}

function missingPackageCheck(id: PackageRowId, label: string, detail: string, manager: LinuxPackageManagerId | null): ReadinessCheck {
  if (manager === null) {
    return { id, label, status: 'missing', detail: `${detail} — install ${LINUX_PACKAGES[id]['apt-get'].join(' ')} with your package manager` };
  }
  const packages = LINUX_PACKAGES[id][manager].join(' ');
  if (manager === 'zypper') return { id, label, status: 'missing', detail, fixCommand: `sudo zypper install -y ${packages}` };
  if (manager === 'apk') return { id, label, status: 'missing', detail, fixCommand: `sudo apk add ${packages}` };
  return { id, label, status: 'missing', detail };
}

type HandshakeOutcome = { kind: 'ok' } | { kind: 'skipped' } | { kind: 'failed'; message: string };

async function runHandshake(env: NodeJS.ProcessEnv, mode: HelperLockMode, deps: LinuxReadinessDeps): Promise<HandshakeOutcome> {
  const runHelper = deps.runHelper ?? ((operation: Record<string, unknown>, helperEnv: NodeJS.ProcessEnv) => runHelperReal(operation, helperEnv));
  const handshake = () => runHelper({ tool: 'handshake' }, env);
  try {
    let response: HelperResponse;
    if (mode === 'wait') {
      const withDesktopLock = deps.withDesktopLock ?? (<T>(fn: () => Promise<T>) => withDesktopLockReal(fn));
      response = await withDesktopLock(handshake);
    } else if (mode === 'if-free') {
      const tryWithDesktopLock =
        deps.tryWithDesktopLock ?? (<T>(fn: () => Promise<T>, options: { waitMs: number }) => tryWithDesktopLockReal(fn, options));
      const result = await tryWithDesktopLock(handshake, { waitMs: HELPER_IF_FREE_WAIT_MS });
      if (!result.acquired) return { kind: 'skipped' };
      response = result.value;
    } else {
      response = await handshake();
    }
    if (response.ok === false) {
      return { kind: 'failed', message: typeof response.error === 'string' ? response.error : 'unknown helper error' };
    }
    return { kind: 'ok' };
  } catch (error) {
    return { kind: 'failed', message: error instanceof Error ? error.message : String(error) };
  }
}

/** The "What Overdeck checked" rows (FR-3 order) and the provider setup steps. */
export async function linuxReadiness(
  options: { helperLock: HelperLockMode; setupSteps: boolean },
  deps: LinuxReadinessDeps = {},
): Promise<LinuxReadinessReport> {
  const probe = await probeLinux({ detectPackageManager: options.setupSteps }, deps);
  const manager = probe.packageManager;

  const atspiRow: ReadinessCheck = probe.atspiOk
    ? { id: 'atspi', label: 'Accessibility bindings', status: 'ok', detail: 'Importable' }
    : missingPackageCheck('atspi', 'Accessibility bindings', 'Not importable', manager);

  if (!probe.session.ok) {
    return {
      session: { ok: false, message: probe.session.message },
      checks: [{ id: 'session', label: 'Desktop session', status: 'unavailable', detail: probe.session.message }, atspiRow],
      setupSteps: [],
      sessionType: '',
      display: '',
    };
  }

  const { env, sessionType, display } = probe.session;
  const sessionLabel = `${sessionType} · display ${display}`;

  const gnomeRow: ReadinessCheck = !probe.gsettings
    ? { id: 'gnome-a11y', label: 'GNOME accessibility', status: 'ok', detail: 'Not GNOME' }
    : probe.accessibilityOn
      ? { id: 'gnome-a11y', label: 'GNOME accessibility', status: 'ok', detail: 'On' }
      : { id: 'gnome-a11y', label: 'GNOME accessibility', status: 'action', detail: 'Off' };

  const inputRow: ReadinessCheck = probe.isWayland
    ? { id: 'input', label: 'Mouse and keyboard input', status: 'ok', detail: 'Wayland: not used' }
    : probe.xdotool
      ? { id: 'input', label: 'Mouse and keyboard input', status: 'ok', detail: 'xdotool' }
      : missingPackageCheck('input', 'Mouse and keyboard input', 'xdotool not installed', manager);

  const screenshotsRow: ReadinessCheck = !probe.isWayland
    ? { id: 'screenshots', label: 'Screenshots', status: 'ok', detail: 'Built in on X11' }
    : probe.grim
      ? { id: 'screenshots', label: 'Screenshots', status: 'ok', detail: 'grim' }
      : missingPackageCheck('screenshots', 'Screenshots', 'grim not installed', manager);

  const clipboardRow: ReadinessCheck =
    probe.clipboard !== null
      ? { id: 'clipboard', label: 'Clipboard', status: 'ok', detail: probe.clipboard }
      : missingPackageCheck('clipboard', 'Clipboard', 'No xclip, xsel or wl-copy', manager);

  const handshake = await runHandshake(env, options.helperLock, deps);
  const helperRow: ReadinessCheck =
    handshake.kind === 'ok'
      ? { id: 'helper', label: 'Helper', status: 'ok', detail: 'Handshake ok' }
      : handshake.kind === 'skipped'
        ? { id: 'helper', label: 'Helper', status: 'ok', detail: 'Skipped: an agent is using the desktop' }
        : { id: 'helper', label: 'Helper', status: 'missing', detail: `Handshake failed: ${handshake.message}` };

  const setupSteps: SetupStep[] = [];
  if (options.setupSteps) {
    const plan = planLinuxInstall(probe);
    if (plan) {
      const step: SetupStep = { id: 'install-packages', label: `Install ${plan.packages.join(' ')}` };
      if (plan.automatic) step.needsPassword = true;
      setupSteps.push(step);
    }
    if (gnomeRow.status === 'action') {
      setupSteps.push({ id: 'enable-accessibility', label: 'Turn on GNOME accessibility' });
    }
  }

  const report: LinuxReadinessReport = {
    session: { ok: true, label: sessionLabel },
    checks: [
      { id: 'session', label: 'Desktop session', status: 'ok', detail: sessionLabel },
      atspiRow,
      gnomeRow,
      inputRow,
      screenshotsRow,
      clipboardRow,
      helperRow,
    ],
    setupSteps,
    sessionType,
    display,
  };
  if (handshake.kind === 'failed') report.helperError = handshake.message;
  return report;
}
