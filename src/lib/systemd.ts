import { exec } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { OVERDECK_HOME, getCanonicalOverdeckHome } from './paths.js';
import { getSupervisorPortSync, resolveSupervisorBundle, resolveSupervisorPrimaryRepoRoot } from './supervisor.js';

const execAsync = promisify(exec);

export const SUPERVISOR_UNIT_NAME = 'overdeck-supervisor.service';

const SYSTEMCTL_TIMEOUT_MS = 3000;
const CONTAINER_MARKER_PATHS = ['/.dockerenv', '/run/.containerenv'] as const;
const DEFAULT_START_LIMIT_INTERVAL_SEC = 300;
const DEFAULT_START_LIMIT_BURST = 3;
const DEFAULT_RESTART_SEC = 5;

export interface RenderSupervisorUnitOptions {
  nodePath?: string;
  supervisorBundle?: string;
  supervisorPort?: number;
  workingDirectory?: string;
  overdeckHome?: string;
  restartSec?: number;
  startLimitIntervalSec?: number;
  startLimitBurst?: number;
}

export interface InstallSupervisorUnitOptions extends RenderSupervisorUnitOptions {
  unitDir?: string;
  unitText?: string;
}

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** One quoted word; `%` is doubled so systemd's specifier expansion leaves it alone. */
function systemdQuote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"').replaceAll('%', '%%')}"`;
}

/** An ExecStart= word: ExecStart= also expands `$VAR`, so `$` is doubled too (Environment= does not). */
function execStartQuote(value: string): string {
  return systemdQuote(value).replaceAll('$', '$$$$');
}

function systemctl(command: string): Promise<{ stdout: string; stderr: string }> {
  return execAsync(`systemctl --user ${command}`, {
    encoding: 'utf-8',
    timeout: SYSTEMCTL_TIMEOUT_MS,
  });
}

export function userUnitDir(): string {
  return join(homedir(), '.config', 'systemd', 'user');
}

export function supervisorUnitPath(unitDir = userUnitDir()): string {
  return join(unitDir, SUPERVISOR_UNIT_NAME);
}

export function renderSupervisorUnit(options: RenderSupervisorUnitOptions = {}): string {
  const nodePath = options.nodePath ?? process.execPath;
  const supervisorBundle = options.supervisorBundle ?? resolveSupervisorBundle();
  const supervisorPort = options.supervisorPort ?? getSupervisorPortSync();
  const workingDirectory = options.workingDirectory ?? resolveSupervisorPrimaryRepoRoot();
  const overdeckHome = options.overdeckHome ?? OVERDECK_HOME;
  const restartSec = options.restartSec ?? DEFAULT_RESTART_SEC;
  const startLimitIntervalSec = options.startLimitIntervalSec ?? DEFAULT_START_LIMIT_INTERVAL_SEC;
  const startLimitBurst = options.startLimitBurst ?? DEFAULT_START_LIMIT_BURST;

  const environment = [
    `OVERDECK_SUPERVISOR_PORT=${supervisorPort}`,
    `OVERDECK_HOME=${overdeckHome}`,
  ].map(systemdQuote).join(' ');

  return [
    '[Unit]',
    'Description=Overdeck supervisor sidecar',
    `StartLimitIntervalSec=${startLimitIntervalSec}`,
    `StartLimitBurst=${startLimitBurst}`,
    '',
    '[Service]',
    'Type=simple',
    // WorkingDirectory= takes a single path that systemd does NOT unquote —
    // a quoted value is read literally and rejected as "not absolute" (its
    // first char is `"`, not `/`). ExecStart= (a command line) and Environment=
    // (word-split assignments) DO support quoting, so those stay quoted.
    `WorkingDirectory=${workingDirectory}`,
    `ExecStart=${execStartQuote(nodePath)} ${execStartQuote(supervisorBundle)}`,
    `Environment=${environment}`,
    'Restart=on-failure',
    `RestartSec=${restartSec}`,
    '',
  ].join('\n');
}

export async function installSupervisorUnit(options: InstallSupervisorUnitOptions = {}): Promise<{ path: string; written: boolean }> {
  const path = supervisorUnitPath(options.unitDir);
  const unitText = options.unitText ?? renderSupervisorUnit(options);

  let existing: string | null = null;
  try {
    existing = await readFile(path, 'utf-8');
  } catch {
    existing = null;
  }

  if (existing === unitText) {
    if (await unitNeedsDaemonReload(SUPERVISOR_UNIT_NAME)) await systemctl('daemon-reload');
    return { path, written: false };
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, unitText, 'utf-8');
  await systemctl('daemon-reload');
  return { path, written: true };
}

/**
 * `overdeck-supervisor.service` is one unit per user, and it carries its
 * home's `OVERDECK_HOME`. Only the canonical home (`~/.overdeck`) may write,
 * start or stop it; any other home runs its own supervisor as a plain process
 * unless it opts in with `OVERDECK_SUPERVISOR_UNIT=1`. Without this a shell
 * with a throwaway `OVERDECK_HOME` rewrites the real unit on `pan up` and stops
 * the real supervisor on `pan down` (review of #4020, finding 1).
 */
export function supervisorUnitAllowed(env: Readonly<Record<string, string | undefined>> = process.env): boolean {
  const home = env.OVERDECK_HOME?.trim();
  if (!home || resolve(home) === resolve(getCanonicalOverdeckHome())) return true;
  return env.OVERDECK_SUPERVISOR_UNIT === '1';
}

export interface StartSupervisorUnitOptions extends InstallSupervisorUnitOptions {
  /** Unit upkeep failed but the unit is running: a warning, not a failed start. */
  onWarning?: (message: string) => void;
}

export async function startSupervisorUnitIfAvailable(options: StartSupervisorUnitOptions = {}): Promise<boolean> {
  if (!supervisorUnitAllowed()) return false;
  if (!(await systemdUserAvailable())) return false;
  try {
    await installSupervisorUnit(options);
  } catch (error) {
    // A daemon-reload timeout while the unit already runs is not a failed start.
    if (!(await isSupervisorUnitActive())) throw error;
    options.onWarning?.(
      `Could not refresh ${SUPERVISOR_UNIT_NAME}: ${error instanceof Error ? error.message : String(error)}; `
      + 'the running supervisor is unaffected',
    );
    return true;
  }
  await startSupervisorUnit();
  return true;
}

export async function stopSupervisorUnitIfActive(): Promise<boolean> {
  if (!supervisorUnitAllowed()) return false;
  if (!(await systemdUserAvailable())) return false;
  if (!(await isSupervisorUnitActive())) return false;
  await stopSupervisorUnit();
  return true;
}

export async function startSupervisorUnit(): Promise<void> {
  if (await isSupervisorUnitActive()) return;
  await systemctl(`start ${SUPERVISOR_UNIT_NAME}`);
}

export async function stopSupervisorUnit(): Promise<void> {
  await systemctl(`stop ${SUPERVISOR_UNIT_NAME}`);
}

export async function isSupervisorUnitActive(): Promise<boolean> {
  try {
    await systemctl(`is-active --quiet ${SUPERVISOR_UNIT_NAME}`);
    return true;
  } catch {
    return false;
  }
}

export async function isSupervisorUnitFailed(): Promise<boolean> {
  try {
    const { stdout } = await systemctl(`is-failed ${SUPERVISOR_UNIT_NAME}`);
    return stdout.trim() === 'failed';
  } catch {
    return false;
  }
}

async function runningInContainer(): Promise<boolean> {
  if (process.env.container || process.env.CONTAINER) return true;

  for (const marker of CONTAINER_MARKER_PATHS) {
    if (await pathExists(marker)) return true;
  }

  return false;
}

async function userDbusSessionExists(): Promise<boolean> {
  const runtimeDir = process.env.XDG_RUNTIME_DIR?.trim();
  if (!runtimeDir) return false;

  if (process.env.DBUS_SESSION_BUS_ADDRESS?.trim()) return true;

  return pathExists(`${runtimeDir}/bus`);
}

export async function systemdUserAvailable(): Promise<boolean> {
  try {
    if (process.platform !== 'linux') return false;
    if (process.env.CI) return false;
    if (await runningInContainer()) return false;
    if (!(await userDbusSessionExists())) return false;

    await execAsync('systemctl --user --version', {
      encoding: 'utf-8',
      timeout: SYSTEMCTL_TIMEOUT_MS,
    });
    return USABLE_MANAGER_STATES.has(await userManagerState());
  } catch {
    return false;
  }
}

/**
 * States in which the user manager installs, enables and starts units. A
 * `degraded` manager (one failed unit anywhere, e.g. a failed transient
 * deploy unit) or one still `starting` works exactly like a `running` one; only
 * `offline`, `stopping`, `maintenance` and an unreadable state fall back
 * (PAN-3956 review finding 7).
 */
const USABLE_MANAGER_STATES: ReadonlySet<string> = new Set(['running', 'degraded', 'starting', 'initializing']);

/**
 * `systemctl --user is-system-running` prints the state on stdout and exits
 * non-zero for everything but `running`, so the state is read from stdout on
 * either exit path. Empty when systemctl could not answer at all.
 */
async function userManagerState(): Promise<string> {
  try {
    const { stdout } = await execAsync('systemctl --user is-system-running', {
      encoding: 'utf-8',
      timeout: SYSTEMCTL_TIMEOUT_MS,
    });
    return String(stdout).trim();
  } catch (error) {
    const { stdout, killed } = error as { stdout?: unknown; killed?: boolean };
    if (killed) return '';
    return typeof stdout === 'string' ? stdout.trim() : '';
  }
}

/**
 * True when systemd still has an older copy of the unit loaded — a previous
 * write whose `daemon-reload` failed or timed out. Without this check the next
 * run sees an identical file and never reloads (PAN-3956 review finding 9).
 */
async function unitNeedsDaemonReload(unitName: string): Promise<boolean> {
  try {
    const { stdout } = await systemctl(`show -p NeedDaemonReload --value ${unitName}`);
    return String(stdout).trim() === 'yes';
  } catch {
    return false;
  }
}

// ─── generic user units (PAN-3956: the Herdr session server) ──────────────────

const SAFE_UNIT_NAME = /^[A-Za-z0-9@._-]+\.service$/;

function assertSafeUnitName(unitName: string): void {
  if (!SAFE_UNIT_NAME.test(unitName)) throw new Error(`Invalid systemd unit name: ${unitName}`);
}

/** Write `unitText` to `<unitDir>/<unitName>` when it differs, then daemon-reload. */
export async function installUserUnit(
  unitName: string,
  unitText: string,
  unitDir = userUnitDir(),
): Promise<{ path: string; written: boolean }> {
  assertSafeUnitName(unitName);
  const path = join(unitDir, unitName);
  let existing: string | null = null;
  try {
    existing = await readFile(path, 'utf-8');
  } catch {
    existing = null;
  }
  if (existing === unitText) {
    if (await unitNeedsDaemonReload(unitName)) await systemctl('daemon-reload');
    return { path, written: false };
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, unitText, 'utf-8');
  await systemctl('daemon-reload');
  return { path, written: true };
}

/** `systemctl --user enable <unit>` — start it at login/boot; starts nothing now. */
export async function enableUserUnit(unitName: string): Promise<void> {
  assertSafeUnitName(unitName);
  await systemctl(`enable ${unitName}`);
}

/**
 * `systemctl --user enable --now <unit>`. On an already-active unit this only
 * enables it: `--now` starts an inactive unit and never restarts a running one.
 */
export async function enableUserUnitNow(unitName: string): Promise<void> {
  assertSafeUnitName(unitName);
  await systemctl(`enable --now ${unitName}`);
}

export async function isUserUnitActive(unitName: string): Promise<boolean> {
  assertSafeUnitName(unitName);
  try {
    await systemctl(`is-active --quiet ${unitName}`);
    return true;
  } catch {
    return false;
  }
}
