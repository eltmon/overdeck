/**
 * Linux computer-use setup steps (PAN-5461, PRD WI-4a).
 *
 * `installPackages` runs `pkexec <pkgmgr> install` so the desktop's polkit
 * dialog asks for the password once (D-2); without a polkit agent it opens a
 * terminal window that runs the sudo command instead (D-17). Package names only
 * ever come from LINUX_PACKAGES through the provider's install plan (D-3), so
 * the command text is safe inside a `bash -c` string. `manualInstallResult`
 * covers managers Overdeck does not run for the operator (D-4), and
 * `enableGnomeAccessibility` flips the GNOME setting without a password (D-5).
 * Every child process goes through injected deps, so tests never spawn.
 */
import { execFile, spawn } from 'node:child_process';
import { promisify } from 'node:util';
import type { ProviderSession, SetupStepResult } from './platform-types.js';

const execFileAsync = promisify(execFile);
const WHICH_TIMEOUT_MS = 5_000;
const INSTALL_TIMEOUT_MS = 600_000;
const GSETTINGS_TIMEOUT_MS = 5_000;
const GSETTINGS_COMMAND = 'gsettings set org.gnome.desktop.interface toolkit-accessibility true';

export type SetupExecFileFn = (
  file: string,
  args: string[],
  options: { timeout: number; env?: NodeJS.ProcessEnv },
) => Promise<{ stdout: string; stderr: string }>;
export type SpawnDetachedFn = (file: string, args: string[], env: NodeJS.ProcessEnv) => void;
export interface LinuxSetupDeps {
  execFile?: SetupExecFileFn;
  spawnDetached?: SpawnDetachedFn;
}

type AutomaticManager = 'apt-get' | 'dnf' | 'pacman';
type AnyManager = AutomaticManager | 'zypper' | 'apk';

const INSTALL_ARGS: Readonly<Record<AutomaticManager, readonly string[]>> = {
  'apt-get': ['install', '-y'],
  dnf: ['install', '-y'],
  pacman: ['-S', '--needed', '--noconfirm'],
};

/** Terminals tried for the fallback, in order, with the args that run a command. */
const TERMINALS: ReadonlyArray<{ command: string; args: (script: string) => string[] }> = [
  { command: 'gnome-terminal', args: (script) => ['--', 'bash', '-c', script] },
  { command: 'x-terminal-emulator', args: (script) => ['-e', 'bash', '-c', script] },
  { command: 'konsole', args: (script) => ['-e', 'bash', '-c', script] },
  { command: 'xterm', args: (script) => ['-e', 'bash', '-c', script] },
];

function execFor(deps: LinuxSetupDeps): SetupExecFileFn {
  return deps.execFile ?? ((file, args, options) => execFileAsync(file, args, options));
}

function defaultSpawnDetached(file: string, args: string[], env: NodeJS.ProcessEnv): void {
  const child = spawn(file, args, { env, detached: true, stdio: 'ignore' });
  child.on('error', () => {});
  child.unref();
}

/** The sudo command an operator can copy for this manager. */
export function installCommandText(packageManager: AnyManager, packages: string[]): string {
  const names = packages.join(' ');
  switch (packageManager) {
    case 'apt-get':
      return `sudo apt-get install -y ${names}`;
    case 'dnf':
      return `sudo dnf install -y ${names}`;
    case 'pacman':
      return `sudo pacman -S --needed --noconfirm ${names}`;
    case 'zypper':
      return `sudo zypper install -y ${names}`;
    case 'apk':
      return `sudo apk add ${names}`;
  }
}

/** The install step for managers Overdeck does not run, or no manager at all (D-4). */
export function manualInstallResult(packageManager: 'zypper' | 'apk' | null, packages: string[]): SetupStepResult {
  if (packageManager === null) {
    return {
      status: 'failed',
      message: `No supported package manager found. Install ${packages.join(' ')} (Debian/Ubuntu names) with your system's package manager, then press Try again.`,
    };
  }
  return {
    status: 'failed',
    message: `Overdeck can't run ${packageManager} for you. Run the command below in a terminal, then press Try again.`,
    command: installCommandText(packageManager, packages),
  };
}

function lastNonEmptyLine(text: string): string {
  const lines = text.split('\n').map((line) => line.trim()).filter((line) => line.length > 0);
  return lines.at(-1) ?? '';
}

async function openTerminalFallback(
  command: string,
  session: ProviderSession,
  exec: SetupExecFileFn,
  spawnDetached: SpawnDetachedFn,
): Promise<SetupStepResult> {
  const script = `${command}; echo; read -p "Press Enter to close"`;
  for (const terminal of TERMINALS) {
    try {
      await exec('which', [terminal.command], { timeout: WHICH_TIMEOUT_MS });
    } catch {
      continue;
    }
    spawnDetached(terminal.command, terminal.args(script), session.env);
    return {
      status: 'failed',
      message: 'A terminal window opened to install the packages. Enter your password there, then press Try again.',
      command,
    };
  }
  return { status: 'failed', message: 'Run this command in a terminal, then press Try again.', command };
}

/** Installs `packages` with pkexec, falling back to a terminal window when there is no polkit agent (D-17). */
export async function installPackages(
  packageManager: AutomaticManager,
  packages: string[],
  session: ProviderSession,
  deps: LinuxSetupDeps = {},
): Promise<SetupStepResult> {
  const exec = execFor(deps);
  const spawnDetached = deps.spawnDetached ?? defaultSpawnDetached;
  const command = installCommandText(packageManager, packages);

  let managerPath: string;
  try {
    const { stdout } = await exec('which', [packageManager], { timeout: WHICH_TIMEOUT_MS });
    managerPath = stdout.trim();
    if (!managerPath) throw new Error('empty which output');
  } catch {
    return { status: 'failed', message: `Couldn't find ${packageManager} on PATH.`, command };
  }

  try {
    await exec('pkexec', [managerPath, ...INSTALL_ARGS[packageManager], ...packages], {
      env: session.env,
      timeout: INSTALL_TIMEOUT_MS,
    });
    return { status: 'done', message: `Installed ${packages.join(' ')}.` };
  } catch (error) {
    const code = (error as { code?: unknown }).code;
    const stderr = String((error as { stderr?: unknown }).stderr ?? '');
    if (code === 126) {
      return {
        status: 'failed',
        message: 'The password prompt was cancelled. Try again, or run the command below in a terminal.',
        command,
      };
    }
    if (code === 127 || code === 'ENOENT' || stderr.includes('No authentication agent found')) {
      return openTerminalFallback(command, session, exec, spawnDetached);
    }
    if (packageManager === 'apt-get' && stderr.includes('Unable to locate package')) {
      return {
        status: 'failed',
        message: "apt couldn't find a package. Run sudo apt-get update, then press Try again.",
        command,
      };
    }
    const detail = lastNonEmptyLine(stderr) || (error instanceof Error ? error.message : String(error));
    return { status: 'failed', message: `Package install failed: ${detail}`, command };
  }
}

/** Turns on GNOME accessibility in the operator's session; no password needed (D-5). */
export async function enableGnomeAccessibility(session: ProviderSession, deps: LinuxSetupDeps = {}): Promise<SetupStepResult> {
  const exec = execFor(deps);
  try {
    await exec('gsettings', ['set', 'org.gnome.desktop.interface', 'toolkit-accessibility', 'true'], {
      env: session.env,
      timeout: GSETTINGS_TIMEOUT_MS,
    });
    return { status: 'done', message: 'Done. Apps opened before this need a restart to show their contents.' };
  } catch (error) {
    return {
      status: 'failed',
      message: `Couldn't turn on GNOME accessibility: ${error instanceof Error ? error.message : String(error)}`,
      command: GSETTINGS_COMMAND,
    };
  }
}
