import { exec } from 'node:child_process';
import { access } from 'node:fs/promises';
import { promisify } from 'node:util';

const execAsync = promisify(exec);

const SYSTEMCTL_TIMEOUT_MS = 3000;
const CONTAINER_MARKER_PATHS = ['/.dockerenv', '/run/.containerenv'] as const;

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
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
    await execAsync('systemctl --user is-system-running', {
      encoding: 'utf-8',
      timeout: SYSTEMCTL_TIMEOUT_MS,
    });

    return true;
  } catch {
    return false;
  }
}
