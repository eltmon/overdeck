import { execFile as execFileCb } from 'node:child_process';
import { promisify } from 'node:util';
import { lstat, readlink, mkdir, unlink, symlink } from 'node:fs/promises';
import { join } from 'node:path';
import { getOverdeckHome } from '../paths.js';

const execFileAsync = promisify(execFileCb);

export const SEMGREP_VERSION = '1.180.0';

/** Env every Overdeck-run Semgrep process gets (NFR-2). */
export const SEMGREP_QUIET_ENV = { SEMGREP_ENABLE_VERSION_CHECK: '0', SEMGREP_SEND_METRICS: 'off' } as const;

/** `~/.overdeck/bin/semgrep` — the only path Overdeck ever runs Semgrep from. */
export function managedSemgrepPath(home = getOverdeckHome()): string {
  return join(home, 'bin', 'semgrep');
}

/** `~/.overdeck/tools/semgrep` — uv/pipx tool environments and their bin dir. */
export function semgrepToolsDir(home = getOverdeckHome()): string {
  return join(home, 'tools', 'semgrep');
}

export type SemgrepInstallStatus = 'present' | 'installed' | 'failed' | 'unsupported';

export interface SemgrepInstallOutcome {
  status: SemgrepInstallStatus;
  /** Version the managed binary reports after the call; null when none runs. */
  version: string | null;
  installer?: 'uv' | 'pipx';
  message: string;
  fix?: string;
}

type ExecFile = (
  file: string,
  args: string[],
  opts: { env: NodeJS.ProcessEnv; timeout: number },
) => Promise<{ stdout: string; stderr: string }>;

export interface SemgrepInstallDeps {
  home?: string;
  platform?: NodeJS.Platform;
  execFile?: ExecFile;
  /** What occupies the launcher path; default lstat + readlink (see step 3). */
  inspectLauncher?: (linkPath: string) => Promise<LauncherOccupant>;
  /** Point the launcher at the managed target; default unlink-if-present + fs.promises.symlink. */
  linkLauncher?: (target: string, linkPath: string) => Promise<void>;
}

/** `absent`: nothing there. `managed`: a symlink whose readlink equals the managed target. `foreign`: anything else. */
export type LauncherOccupant = 'absent' | 'managed' | 'foreign';

const defaultExecFile: ExecFile = async (file, args, opts) => execFileAsync(file, args, opts);

async function defaultInspectLauncher(linkPath: string, expectedTarget: string): Promise<LauncherOccupant> {
  let stats;
  try {
    stats = await lstat(linkPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return 'absent';
    throw error;
  }
  if (!stats.isSymbolicLink()) return 'foreign';
  const target = await readlink(linkPath);
  return target === expectedTarget ? 'managed' : 'foreign';
}

async function defaultLinkLauncher(target: string, linkPath: string): Promise<void> {
  try {
    await unlink(linkPath);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error;
  }
  await symlink(target, linkPath);
}

/** Trimmed stdout of `<binary> --version`, or null when it cannot run (missing, not executable, timeout). */
export async function readSemgrepVersion(
  binary: string,
  deps?: Pick<SemgrepInstallDeps, 'execFile'>,
): Promise<string | null> {
  const execFile = deps?.execFile ?? defaultExecFile;
  try {
    const { stdout } = await execFile(binary, ['--version'], {
      env: { ...process.env, ...SEMGREP_QUIET_ENV },
      timeout: 30_000,
    });
    return stdout.trim() || null;
  } catch {
    return null;
  }
}

export async function ensureSemgrepInstalled(deps: SemgrepInstallDeps = {}): Promise<SemgrepInstallOutcome> {
  const home = deps.home ?? getOverdeckHome();
  const platform = deps.platform ?? process.platform;
  const binary = managedSemgrepPath(home);
  const tools = semgrepToolsDir(home);
  const toolsBin = join(tools, 'bin', 'semgrep');

  if (platform === 'win32') {
    return {
      status: 'unsupported',
      version: null,
      message: 'Semgrep support is Linux and macOS only (Windows is unsupported)',
    };
  }

  const current = await readSemgrepVersion(binary, deps);
  if (current === SEMGREP_VERSION) {
    return { status: 'present', version: current, message: `Semgrep ${SEMGREP_VERSION} already installed` };
  }

  const inspectLauncher = deps.inspectLauncher ?? ((linkPath: string) => defaultInspectLauncher(linkPath, toolsBin));
  const occupant = await inspectLauncher(binary);
  if (occupant === 'foreign') {
    return {
      status: 'failed',
      version: current,
      message: '~/.overdeck/bin/semgrep exists and is not the Overdeck-managed launcher',
      fix: 'Move ~/.overdeck/bin/semgrep out of the way, then run pan sync',
    };
  }

  const execFile = deps.execFile ?? defaultExecFile;
  const probeEnv = { ...process.env, ...SEMGREP_QUIET_ENV };
  let installer: 'uv' | 'pipx' | undefined;
  try {
    await execFile('uv', ['--version'], { env: probeEnv, timeout: 10_000 });
    installer = 'uv';
  } catch {
    try {
      await execFile('pipx', ['--version'], { env: probeEnv, timeout: 10_000 });
      installer = 'pipx';
    } catch {
      // neither installer is available
    }
  }

  if (!installer) {
    return {
      status: 'failed',
      version: current,
      message: 'Neither uv nor pipx is installed',
      fix: 'Install uv (https://docs.astral.sh/uv/getting-started/installation/) or pipx, then run pan sync',
    };
  }

  try {
    if (installer === 'uv') {
      await execFile('uv', ['tool', 'install', '--force', `semgrep==${SEMGREP_VERSION}`], {
        env: {
          ...process.env,
          ...SEMGREP_QUIET_ENV,
          UV_TOOL_DIR: join(tools, 'uv'),
          UV_TOOL_BIN_DIR: join(tools, 'bin'),
        },
        timeout: 600_000,
      });
    } else {
      await execFile('pipx', ['install', '--force', `semgrep==${SEMGREP_VERSION}`], {
        env: {
          ...process.env,
          ...SEMGREP_QUIET_ENV,
          PIPX_HOME: join(tools, 'pipx'),
          PIPX_BIN_DIR: join(tools, 'bin'),
        },
        timeout: 600_000,
      });
    }
  } catch (error) {
    const firstLine = String((error as Error).message ?? error).split('\n')[0];
    return {
      status: 'failed',
      installer,
      version: current,
      message: `${installer} install of semgrep==${SEMGREP_VERSION} failed: ${firstLine}`,
      fix: 'Run pan sync again; see the installer output above',
    };
  }

  const linkLauncher = deps.linkLauncher ?? defaultLinkLauncher;
  await mkdir(join(home, 'bin'), { recursive: true });
  await linkLauncher(toolsBin, binary);

  const after = await readSemgrepVersion(binary, deps);
  if (after === SEMGREP_VERSION) {
    return {
      status: 'installed',
      version: after,
      installer,
      message: `Installed Semgrep ${SEMGREP_VERSION} to ~/.overdeck/bin/semgrep (via ${installer})`,
    };
  }
  return {
    status: 'failed',
    version: after,
    installer,
    message: `semgrep --version returned ${after ?? 'no output'} after install`,
  };
}

/** One spinner line for the two CLI callers (sync, install). */
export function formatSemgrepInstallOutcome(
  outcome: SemgrepInstallOutcome,
): { level: 'succeed' | 'info' | 'warn'; text: string } {
  const suffix = outcome.fix ? ` — ${outcome.fix}` : '';
  switch (outcome.status) {
    case 'present':
      return { level: 'info', text: outcome.message };
    case 'installed':
      return { level: 'succeed', text: outcome.message };
    case 'failed':
      return { level: 'warn', text: `${outcome.message}${suffix}` };
    case 'unsupported':
      return { level: 'warn', text: outcome.message };
  }
}
