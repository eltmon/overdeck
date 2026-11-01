/**
 * Tailscale sign-in URL capture (PAN-1254 W-4, FR-5, D-6, D-11).
 *
 * `startTailscaleLogin()` spawns `tailscale login` (or `tailscale up` when the
 * backend is `Stopped`) and resolves with the first sign-in URL Tailscale
 * prints (it prints it on stderr). The child stays alive so Tailscale can
 * finish the sign-in once the operator opens the URL; it is killed after 10
 * minutes if it has not exited. One login child exists per process: a second
 * call while one is pending gets the same result.
 *
 * An access-denied write (the user is not the Tailscale operator) resolves
 * `{ error: 'access-denied' }`, which is how an `unknown` operator (D-6) turns
 * into the operator step.
 */
import { spawn as nodeSpawn } from 'node:child_process';
import type { TailscaleCli } from './cli.js';
import { invalidateTailscaleStateCache, type TailscaleState } from './state.js';

export const LOGIN_URL_TIMEOUT_MS = 15_000;
export const LOGIN_CHILD_MAX_MS = 10 * 60_000;

const URL_PATTERN = /https:\/\/\S+/;
/** D-6 access-denied stderr from a prefs write. */
export const ACCESS_DENIED_PATTERN = /access denied|permission denied|prefs write access denied/i;

export type LoginResult =
  | { authUrl: string | null }
  | { error: 'access-denied' | 'timeout' | 'failed'; message: string };

interface DataSource {
  on(event: 'data', listener: (chunk: Buffer | string) => void): unknown;
}

/** The part of a ChildProcess this module uses. */
export interface LoginChild {
  stdout: DataSource | null;
  stderr: DataSource | null;
  on(event: 'exit', listener: (code: number | null) => void): unknown;
  on(event: 'error', listener: (error: Error) => void): unknown;
  kill(): unknown;
}

export interface LoginDeps {
  spawn?: (bin: string, args: string[]) => LoginChild;
}

function defaultSpawn(bin: string, args: string[]): LoginChild {
  return nodeSpawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'] });
}

let active: Promise<LoginResult> | null = null;

function firstLine(text: string): string | null {
  return text.split('\n').map((line) => line.trim()).find((line) => line !== '') ?? null;
}

function run(
  cli: TailscaleCli,
  verb: 'login' | 'up',
  spawnImpl: (bin: string, args: string[]) => LoginChild,
  onExit: () => void,
): Promise<LoginResult> {
  return new Promise<LoginResult>((resolve) => {
    let output = '';
    let settled = false;
    let child: LoginChild;

    const release = () => {
      clearTimeout(killTimer);
      onExit();
      invalidateTailscaleStateCache();
    };
    const finish = (result: LoginResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(urlTimer);
      if (!('authUrl' in result) || result.authUrl === null) clearTimeout(killTimer);
      resolve(result);
    };

    const urlTimer = setTimeout(() => {
      finish({ error: 'timeout', message: `tailscale ${verb} printed no sign-in link within ${LOGIN_URL_TIMEOUT_MS / 1000} s.` });
      child.kill();
    }, LOGIN_URL_TIMEOUT_MS);
    const killTimer = setTimeout(() => child.kill(), LOGIN_CHILD_MAX_MS);

    try {
      child = spawnImpl(cli.bin, [...cli.baseArgs, verb]);
    } catch (error) {
      finish({ error: 'failed', message: error instanceof Error ? error.message : String(error) });
      return;
    }

    const onData = (chunk: Buffer | string) => {
      output += chunk.toString();
      if (ACCESS_DENIED_PATTERN.test(output)) {
        finish({ error: 'access-denied', message: firstLine(output) ?? 'Access denied.' });
        child.kill();
        return;
      }
      const match = output.match(URL_PATTERN);
      if (match) finish({ authUrl: match[0] });
    };
    child.stdout?.on('data', onData);
    child.stderr?.on('data', onData);
    child.on('error', (error) => {
      finish({ error: 'failed', message: error.message });
      release();
    });
    child.on('exit', (code) => {
      if (ACCESS_DENIED_PATTERN.test(output)) {
        finish({ error: 'access-denied', message: firstLine(output) ?? 'Access denied.' });
      } else if (code === 0) {
        finish({ authUrl: null });
      } else {
        finish({ error: 'failed', message: firstLine(output) ?? `tailscale ${verb} exited with code ${code}.` });
      }
      release();
    });
  });
}

/** Start sign-in and resolve with the URL to open, `null` when none was needed, or an error. */
export function startTailscaleLogin(state: TailscaleState, deps: LoginDeps = {}): Promise<LoginResult> {
  if (active) return active;
  if (!state.cli) return Promise.resolve({ error: 'failed', message: 'Tailscale is not installed.' });
  const verb = state.backendState === 'Stopped' ? 'up' : 'login';
  const promise: Promise<LoginResult> = run(state.cli, verb, deps.spawn ?? defaultSpawn, () => {
    if (active === promise) active = null;
  });
  active = promise;
  // Only a URL keeps the child, and so the shared result, alive for the sign-in.
  void promise.then((result) => {
    if ((!('authUrl' in result) || result.authUrl === null) && active === promise) active = null;
  });
  return promise;
}
