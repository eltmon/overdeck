/**
 * Tailscale CLI resolution and runner (PAN-1254 W-1, D-7, NFR-2, NFR-3).
 *
 * The `tailscale` CLI talks to the `tailscaled` daemon over a local socket.
 * Overdeck finds the CLI in this order: the userspace binary it installed under
 * `${OVERDECK_HOME}/tailscale/bin/` (talking to its own socket), then
 * `tailscale` on PATH, then the macOS app binary. A missing CLI is a normal
 * state, so resolution returns null instead of throwing.
 *
 * Every call is an async `execFile`. The timeout is our own timer plus an
 * AbortSignal (not execFile's `timeout` option), so tests can drive it with
 * fake timers — the same pattern as `src/lib/sageox/probe.ts`.
 */
import { execFile } from 'node:child_process';
import { constants } from 'node:fs';
import { access as fsAccess } from 'node:fs/promises';
import { delimiter, join } from 'node:path';
import { promisify } from 'node:util';
import { getOverdeckHome } from '../paths.js';

export type TailscaleMode = 'system' | 'app' | 'userspace';

export interface TailscaleCli {
  bin: string;
  mode: TailscaleMode;
  /** Prepended to every invocation: `['--socket=<sock>']` in userspace mode, else `[]`. */
  baseArgs: string[];
}

export const TAILSCALE_READ_TIMEOUT_MS = 1500;
export const TAILSCALE_WRITE_TIMEOUT_MS = 10_000;
export const MACOS_APP_CLI = '/Applications/Tailscale.app/Contents/MacOS/Tailscale';

/** `${OVERDECK_HOME}/tailscale` — the userspace install root (D-10). */
export function tailscaleHome(): string {
  return join(getOverdeckHome(), 'tailscale');
}

export function userspaceSocketPath(): string {
  return join(tailscaleHome(), 'tailscaled.sock');
}

export function userspaceBinDir(): string {
  return join(tailscaleHome(), 'bin');
}

export interface ResolveTailscaleCliDeps {
  /** Resolves when `path` is executable; rejects otherwise. */
  access?: (path: string) => Promise<void>;
  platform?: NodeJS.Platform;
  pathEnv?: string;
}

async function isExecutable(access: (path: string) => Promise<void>, path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/** D-7 resolution order: userspace install, then PATH, then the macOS app. */
export async function resolveTailscaleCli(deps: ResolveTailscaleCliDeps = {}): Promise<TailscaleCli | null> {
  const access = deps.access ?? ((path: string) => fsAccess(path, constants.X_OK));
  const platform = deps.platform ?? process.platform;

  const userspaceBin = join(userspaceBinDir(), 'tailscale');
  if (await isExecutable(access, userspaceBin)) {
    return { bin: userspaceBin, mode: 'userspace', baseArgs: [`--socket=${userspaceSocketPath()}`] };
  }

  const names = platform === 'win32' ? ['tailscale.exe', 'tailscale'] : ['tailscale'];
  for (const dir of (deps.pathEnv ?? process.env.PATH ?? '').split(delimiter)) {
    if (!dir) continue;
    for (const name of names) {
      const candidate = join(dir, name);
      if (await isExecutable(access, candidate)) return { bin: candidate, mode: 'system', baseArgs: [] };
    }
  }

  if (platform === 'darwin' && await isExecutable(access, MACOS_APP_CLI)) {
    return { bin: MACOS_APP_CLI, mode: 'app', baseArgs: [] };
  }
  return null;
}

export interface TailscaleRunResult {
  ok: boolean;
  code: number | null;
  stdout: string;
  stderr: string;
  timedOut: boolean;
}

type ExecFileAsync = (
  file: string,
  args: string[],
  options: { signal: AbortSignal; encoding: 'utf8'; maxBuffer: number },
) => Promise<{ stdout: string; stderr: string }>;

const defaultExecFile = promisify(execFile) as unknown as ExecFileAsync;

/** `status --json` lists every peer; give it room beyond execFile's 1 MiB default. */
const MAX_BUFFER = 16 * 1024 * 1024;

/** Run the CLI. Never throws: a non-zero exit, a missing binary and a timeout all return `ok: false`. */
export async function runTailscale(
  cli: TailscaleCli,
  args: string[],
  opts: { timeoutMs?: number; execFile?: ExecFileAsync } = {},
): Promise<TailscaleRunResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? TAILSCALE_READ_TIMEOUT_MS);
  try {
    const { stdout, stderr } = await (opts.execFile ?? defaultExecFile)(cli.bin, [...cli.baseArgs, ...args], {
      signal: controller.signal,
      encoding: 'utf8',
      maxBuffer: MAX_BUFFER,
    });
    return { ok: true, code: 0, stdout: String(stdout ?? ''), stderr: String(stderr ?? ''), timedOut: false };
  } catch (error) {
    const err = error as NodeJS.ErrnoException & { code?: unknown; stdout?: unknown; stderr?: unknown };
    return {
      ok: false,
      code: !controller.signal.aborted && typeof err.code === 'number' ? err.code : null,
      stdout: typeof err.stdout === 'string' ? err.stdout : '',
      stderr: typeof err.stderr === 'string' ? err.stderr : (err.message ?? ''),
      timedOut: controller.signal.aborted,
    };
  } finally {
    clearTimeout(timer);
  }
}
