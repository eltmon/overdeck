import { spawn, type ChildProcess } from 'node:child_process';

const TRUSTED_GIT_ENV_KEYS = [
  'HOME',
  'LANG',
  'LC_ALL',
  'LOGNAME',
  'PATH',
  'SSH_ASKPASS',
  'SSH_AUTH_SOCK',
  'TMPDIR',
  'USER',
  'XDG_CONFIG_HOME',
] as const;

export function versionShipGitArgs(args: readonly string[]): string[] {
  return ['-c', 'core.hooksPath=/dev/null', ...args];
}

export function versionShipGitEnv(base: NodeJS.ProcessEnv = process.env): Record<string, string> {
  const env: Record<string, string> = {
    GIT_CONFIG_NOSYSTEM: '1',
    GIT_TERMINAL_PROMPT: '0',
    HUSKY: '0',
  };
  for (const key of TRUSTED_GIT_ENV_KEYS) {
    const value = base[key];
    if (value !== undefined) env[key] = value;
  }
  return env;
}

export const VERSION_SHIP_GIT_LOCAL_TIMEOUT_MS = 30_000;
export const VERSION_SHIP_GIT_NETWORK_TIMEOUT_MS = 120_000;
export const VERSION_SHIP_GIT_CLEANUP_TIMEOUT_MS = 15_000;
const VERSION_SHIP_GIT_MAX_OUTPUT_BYTES = 16 * 1024 * 1024;

export interface VersionShipGitResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

function killProcessTree(child: ChildProcess): void {
  if (!child.pid) return;
  try {
    if (process.platform === 'win32') child.kill('SIGKILL');
    else process.kill(-child.pid, 'SIGKILL');
  } catch {
    try { child.kill('SIGKILL'); } catch { /* process already exited */ }
  }
}

export function runVersionShipGit(
  args: readonly string[],
  cwd: string,
  timeoutMs = VERSION_SHIP_GIT_LOCAL_TIMEOUT_MS,
): Promise<VersionShipGitResult> {
  return new Promise(resolveResult => {
    const child = spawn('git', versionShipGitArgs(args), {
      cwd,
      detached: process.platform !== 'win32',
      env: versionShipGitEnv(),
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let outputExceeded = false;
    const append = (current: string, chunk: Buffer): string => {
      const next = current + chunk.toString('utf-8');
      if (Buffer.byteLength(next) > VERSION_SHIP_GIT_MAX_OUTPUT_BYTES) {
        outputExceeded = true;
        killProcessTree(child);
        return next.slice(-VERSION_SHIP_GIT_MAX_OUTPUT_BYTES);
      }
      return next;
    };
    child.stdout?.on('data', (chunk: Buffer) => { stdout = append(stdout, chunk); });
    child.stderr?.on('data', (chunk: Buffer) => { stderr = append(stderr, chunk); });
    const timer = setTimeout(() => {
      timedOut = true;
      killProcessTree(child);
    }, timeoutMs);
    child.once('error', error => {
      clearTimeout(timer);
      resolveResult({ exitCode: 1, stdout, stderr: `${stderr}${error.message}`, timedOut });
    });
    child.once('close', code => {
      clearTimeout(timer);
      resolveResult({
        exitCode: timedOut || outputExceeded ? 1 : (code ?? 1),
        stdout,
        stderr: outputExceeded ? `${stderr}\nGit output exceeded the bounded buffer` : stderr,
        timedOut,
      });
    });
  });
}
