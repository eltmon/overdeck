/**
 * The systemd user session that `pan connect` relies on (PAN-4656).
 *
 * Lingering makes systemd start the user's manager at boot and keep it after
 * the last logout; without it the enabled supervisor unit stops at logout and
 * starts only at the next login. The user manager's own PATH lacks
 * `~/.local/bin` and nvm directories, so `pan connect` saves the operator's
 * PATH for it in `~/.config/environment.d/` and for the current boot with
 * `systemctl --user set-environment`.
 *
 * Async only. User names reach `execFile` argv, never a shell, and are
 * validated anyway.
 */

import { execFile } from 'node:child_process';
import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';
import { promisify } from 'node:util';

export const LINGER_DIR = '/var/lib/systemd/linger';
export const ENVIRONMENT_D_FILE = '60-overdeck.conf';

const LOGINCTL_SHOW_TIMEOUT_MS = 5_000;
const ENABLE_LINGER_TIMEOUT_MS = 10_000;
const SET_ENVIRONMENT_TIMEOUT_MS = 5_000;
const LINGER_POLL_MS = 2_000;
const VALID_USER = /^[a-z_][a-z0-9_.-]*\$?$/i;

export interface SystemdUserSessionDeps {
  execFile: (file: string, args: readonly string[], options: { timeout: number }) => Promise<{ stdout: string; stderr: string }>;
  fileExists: (path: string) => Promise<boolean>;
  /** File contents, or null when it cannot be read. */
  readFile: (path: string) => Promise<string | null>;
  writeFile: (path: string, data: string) => Promise<void>;
  mkdir: (path: string) => Promise<void>;
  homedir: () => string;
}

const execFileAsync = promisify(execFile);

const defaultDeps: SystemdUserSessionDeps = {
  execFile: async (file, args, options) => {
    const { stdout, stderr } = await execFileAsync(file, [...args], { encoding: 'utf-8', timeout: options.timeout });
    return { stdout, stderr };
  },
  fileExists: async (path) => {
    try {
      await access(path);
      return true;
    } catch {
      return false;
    }
  },
  readFile: async (path) => {
    try {
      return await readFile(path, 'utf-8');
    } catch {
      return null;
    }
  },
  writeFile: (path, data) => writeFile(path, data, 'utf-8'),
  mkdir: async (path) => {
    await mkdir(path, { recursive: true });
  },
  homedir,
};

function resolveDeps(deps: Partial<SystemdUserSessionDeps> = {}): SystemdUserSessionDeps {
  return { ...defaultDeps, ...deps };
}

function assertValidUser(user: string): void {
  if (!VALID_USER.test(user)) throw new Error(`Invalid user name: ${user}`);
}

/** The command the operator runs when `pan connect` cannot turn lingering on itself. */
export function lingerSudoCommand(user: string): string {
  assertValidUser(user);
  return `sudo loginctl enable-linger ${user}`;
}

/**
 * `loginctl show-user <user> --property=Linger --value` is `yes`. loginctl
 * fails for a user with no session, so on any loginctl error the answer is
 * whether `/var/lib/systemd/linger/<user>` exists.
 */
export async function isLingerEnabled(user: string, deps?: Partial<SystemdUserSessionDeps>): Promise<boolean> {
  assertValidUser(user);
  const d = resolveDeps(deps);
  try {
    const { stdout } = await d.execFile('loginctl', ['show-user', user, '--property=Linger', '--value'], {
      timeout: LOGINCTL_SHOW_TIMEOUT_MS,
    });
    return stdout.trim() === 'yes';
  } catch {
    return d.fileExists(join(LINGER_DIR, user));
  }
}

/**
 * Runs `loginctl enable-linger --no-ask-password <user>`, which polkit allows
 * for the user's own account on most distributions, then reports whether
 * lingering is on. Never throws for a valid user name.
 */
export async function tryEnableLinger(user: string, deps?: Partial<SystemdUserSessionDeps>): Promise<boolean> {
  assertValidUser(user);
  const d = resolveDeps(deps);
  try {
    await d.execFile('loginctl', ['enable-linger', '--no-ask-password', user], { timeout: ENABLE_LINGER_TIMEOUT_MS });
  } catch {
    // Not allowed without a password: the caller prints the sudo command.
  }
  return isLingerEnabled(user, d);
}

/**
 * Polls isLingerEnabled every 2 s with no timeout. Resolves `'on'` once it is
 * on, or `'off'` as soon as `skip` settles (the operator pressed Enter).
 */
export async function waitForLinger(
  user: string,
  skip: Promise<void>,
  deps?: Partial<SystemdUserSessionDeps>,
): Promise<'on' | 'off'> {
  assertValidUser(user);
  const d = resolveDeps(deps);
  const skipped = skip.then(() => 'skip' as const, () => 'skip' as const);
  for (;;) {
    const checked = await Promise.race([skipped, isLingerEnabled(user, d)]);
    if (checked === 'skip') return 'off';
    if (checked) return 'on';

    let timer: ReturnType<typeof setTimeout> | undefined;
    const tick = new Promise<'tick'>((resolve) => {
      timer = setTimeout(() => resolve('tick'), LINGER_POLL_MS);
    });
    const outcome = await Promise.race([skipped, tick]);
    clearTimeout(timer);
    if (outcome === 'skip') return 'off';
  }
}

/**
 * PATH without the per-agent git-guard shim directories (src/lib/launcher-git-guard.ts),
 * so a service set up from an agent shell never keeps a shim. Shared with the macOS agent.
 */
export function withoutGitGuard(path: string): string {
  return path.split(':').filter((segment) => !segment.endsWith('/git-guard')).join(':');
}

/**
 * Saves PATH for the systemd user manager: `~/.config/environment.d/60-overdeck.conf`
 * (read at every manager start; written only when it differs) and
 * `systemctl --user set-environment PATH=<path>` for units started from now
 * on. Run it before starting the supervisor unit.
 */
export async function persistUserManagerPath(
  path: string,
  deps?: Partial<SystemdUserSessionDeps>,
): Promise<{ file: string; written: boolean }> {
  const d = resolveDeps(deps);
  const cleanPath = withoutGitGuard(path);
  const file = join(d.homedir(), '.config', 'environment.d', ENVIRONMENT_D_FILE);
  const content = `PATH=${cleanPath}\n`;

  let written = false;
  if ((await d.readFile(file)) !== content) {
    await d.mkdir(dirname(file));
    await d.writeFile(file, content);
    written = true;
  }

  await d.execFile('systemctl', ['--user', 'set-environment', `PATH=${cleanPath}`], {
    timeout: SET_ENVIRONMENT_TIMEOUT_MS,
  });
  return { file, written };
}
