/**
 * Fly token sources (PAN-4748).
 *
 * `createFlyApiClient()` sends either an explicit token (`FLY_API_TOKEN` or
 * the `remote.fly.api_token_env` variable) or flyctl's stored login
 * (`~/.fly/config.yml`'s `access_token`). The stored login's discharge
 * tokens expire within minutes; flyctl refreshes and persists them only
 * when flyctl itself runs (`internal/config/tokens.go`'s `MonitorTokens`,
 * called by `RequireSession` before every flyctl command body). So a long
 * -lived Overdeck process holding the stored token eventually gets 401/403
 * on every Machines API call until something runs flyctl.
 *
 * A `FlyTokenSource` is what a `FlyApiClient` asks for the token to send
 * (`current()`) and, for the flyctl-backed source only, asks again after an
 * auth rejection (`refresh()`). Explicit tokens are never refreshed — a
 * 401/403 on one is a hard failure. Refresh state is process-wide (a module
 * -level `refreshedToken`/`inflight`/`failedAt`): concurrent rejections
 * share one flyctl run, and a failed refresh suppresses further flyctl
 * spawns for `REFRESH_COOLDOWN_MS` so a logged-out host doesn't spawn
 * flyctl on every request.
 */

import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

/** Where a FlyApiClient gets the token it sends (PAN-4748). */
export interface FlyTokenSource {
  /** Where the token came from: an explicit/env value, or flyctl's stored login. */
  readonly origin: 'explicit' | 'flyctl';
  /** The token to send now. */
  current(): Promise<string>;
  /**
   * Called after a 401/403 for `rejected`. Returns a different token to retry
   * once with, or null when there is none. Absent for explicit tokens.
   */
  refresh?(rejected: string): Promise<string | null>;
}

export interface FlyctlTokenDeps {
  /** Async read of ~/.fly/config.yml's access_token, or undefined. */
  readStoredToken: () => Promise<string | undefined>;
  /** Run `flyctl auth token --quiet --json`; resolves stdout, rejects on spawn error / non-zero exit / timeout. */
  runFlyctl: () => Promise<string>;
  now: () => number;
}

const execFileAsync = promisify(execFile);

const REFRESH_COOLDOWN_MS = 60_000;
const FLYCTL_TIMEOUT_MS = 30_000;

// Process-wide refresh state (D-4): shared by every flyctl token source so
// concurrent rejections across the dashboard server / deacon spawn at most
// one flyctl run.
let refreshedToken: string | null = null;
let inflight: Promise<string | null> | null = null;
let failedAt: number | null = null;

/** A token source for an explicit/env token. Never refreshed. */
export function staticFlyTokenSource(token: string): FlyTokenSource {
  return {
    origin: 'explicit',
    current: async () => token,
  };
}

async function defaultReadStoredToken(): Promise<string | undefined> {
  try {
    const configPath = join(homedir(), '.fly', 'config.yml');
    const contents = await readFile(configPath, 'utf8');
    return contents.match(/^access_token:\s*(\S+)/m)?.[1];
  } catch {
    return undefined;
  }
}

async function runFlyctlAuthToken(binary: string): Promise<string> {
  const env: Record<string, string | undefined> = { ...process.env };
  delete env.FLY_API_TOKEN;
  delete env.FLY_ACCESS_TOKEN;
  try {
    const { stdout } = await execFileAsync(binary, ['auth', 'token', '--quiet', '--json'], {
      timeout: FLYCTL_TIMEOUT_MS,
      env,
      windowsHide: true,
    });
    return stdout;
  } catch (error) {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    const fallbackBinary = join(homedir(), '.fly', 'bin', 'flyctl');
    if (code === 'ENOENT' && binary !== fallbackBinary) {
      return runFlyctlAuthToken(fallbackBinary);
    }
    if (code === 'ENOENT') {
      throw new Error('flyctl not found');
    }
    // Never surface stdout/stderr here — they may carry a token (D-12).
    throw new Error(`flyctl auth token exited ${typeof code === 'number' ? code : 'unknown'}`);
  }
}

async function defaultRunFlyctl(): Promise<string> {
  return runFlyctlAuthToken('flyctl');
}

/** Takes `token` from the last `{...}` line of flyctl's stdout, or undefined. */
function parseFlyctlToken(stdout: string): string | undefined {
  const jsonLines = stdout.split('\n').filter((line) => line.trimStart().startsWith('{'));
  const lastLine = jsonLines[jsonLines.length - 1];
  if (lastLine === undefined) return undefined;
  try {
    const parsed = JSON.parse(lastLine) as { token?: unknown };
    return typeof parsed.token === 'string' && parsed.token.length > 0 ? parsed.token : undefined;
  } catch {
    return undefined;
  }
}

async function performRefresh(
  rejected: string,
  deps: FlyctlTokenDeps,
): Promise<string | null> {
  let token: string | undefined;
  try {
    token = parseFlyctlToken(await deps.runFlyctl());
  } catch {
    token = undefined;
  }
  if (token === undefined) {
    const stored = await deps.readStoredToken().catch(() => undefined);
    token = stored !== undefined && stored !== rejected ? stored : undefined;
  }
  if (token !== undefined && token !== rejected) {
    refreshedToken = token;
    failedAt = null;
    return token;
  }
  failedAt = deps.now();
  return null;
}

/** A token source backed by flyctl's stored login, refreshed on rejection (D-1). */
export function flyctlTokenSource(initial: string, deps: Partial<FlyctlTokenDeps> = {}): FlyTokenSource {
  const resolved: FlyctlTokenDeps = {
    readStoredToken: deps.readStoredToken ?? defaultReadStoredToken,
    runFlyctl: deps.runFlyctl ?? defaultRunFlyctl,
    now: deps.now ?? Date.now,
  };

  return {
    origin: 'flyctl',
    async current() {
      if (refreshedToken !== null) return refreshedToken;
      return (await resolved.readStoredToken()) ?? initial;
    },
    async refresh(rejected: string): Promise<string | null> {
      if (refreshedToken !== null && refreshedToken !== rejected) {
        return refreshedToken;
      }
      if (failedAt !== null && resolved.now() - failedAt < REFRESH_COOLDOWN_MS) {
        return null;
      }
      if (inflight) {
        return inflight;
      }
      inflight = performRefresh(rejected, resolved).finally(() => {
        inflight = null;
      });
      return inflight;
    },
  };
}

/**
 * Sync read of flyctl's stored login, used only by `createFlyApiClient`'s
 * "is there any token at all" check (existing behaviour, moved unchanged).
 */
export function readStoredFlyTokenSync(): string | undefined {
  try {
    const configPath = join(homedir(), '.fly', 'config.yml');
    if (!existsSync(configPath)) return undefined;
    const match = readFileSync(configPath, 'utf-8').match(/^access_token:\s*(\S+)/m);
    return match?.[1];
  } catch {
    return undefined;
  }
}

/** Test seam: no production caller; resets the shared refresh state. */
export function _resetFlyTokenStateForTests(): void {
  refreshedToken = null;
  inflight = null;
  failedAt = null;
}
