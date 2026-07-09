import { exec } from 'node:child_process';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { OVERDECK_HOME, packageRoot } from './paths.js';
import { getSupervisorPortSync, resolveSupervisorBundle } from './supervisor.js';

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

function systemdQuote(value: string): string {
  return `"${value.replaceAll('\\', '\\\\').replaceAll('"', '\\"')}"`;
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
  const workingDirectory = options.workingDirectory ?? packageRoot;
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
    `ExecStart=${systemdQuote(nodePath)} ${systemdQuote(supervisorBundle)}`,
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
    return { path, written: false };
  }

  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, unitText, 'utf-8');
  await systemctl('daemon-reload');
  return { path, written: true };
}

export async function startSupervisorUnitIfAvailable(options: InstallSupervisorUnitOptions = {}): Promise<boolean> {
  if (!(await systemdUserAvailable())) return false;
  await installSupervisorUnit(options);
  await startSupervisorUnit();
  return true;
}

export async function stopSupervisorUnitIfActive(): Promise<boolean> {
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

export async function uninstallSupervisorUnit(options: { unitDir?: string } = {}): Promise<void> {
  await rm(supervisorUnitPath(options.unitDir), { force: true });
  await systemctl('daemon-reload');
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
    await execAsync('systemctl --user is-system-running', {
      encoding: 'utf-8',
      timeout: SYSTEMCTL_TIMEOUT_MS,
    });

    return true;
  } catch {
    return false;
  }
}
