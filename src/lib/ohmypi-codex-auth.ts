/**
 * oh-my-pi (omp) OAuth helpers for the openai-codex (ChatGPT subscription) provider.
 * Forked from pi-codex-auth.ts (PAN-1520) for the omp migration (PAN-1989).
 *
 * omp stores its general credentials in ~/.omp/agent/agent.db (SQLite). The
 * openai-codex OAuth credential is persisted separately at ~/.omp/agent/auth.json
 * (same JSON format as Pi's ~/.pi/agent/auth.json) so that this helper's
 * read/write logic is unchanged from the Pi side.
 *
 * This module:
 *   - reads/writes the openai-codex credential under ~/.omp/agent/auth.json,
 *   - reports auth status (for `pan doctor` and the conversation spawn gate),
 *   - refreshes an expired-but-recoverable token, and
 *   - drives omp's headless device-code login to re-authenticate.
 *
 * The OAuth module is loaded from the installed `omp` package dynamically.
 * A missing or relocated omp OAuth module degrades to 'unavailable' — never throws.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PI_CODEX_PROVIDER = 'openai-codex';

/** Credential as persisted in ~/.omp/agent/auth.json. */
export interface OhmypiCodexCredential {
  type: 'oauth';
  access: string;
  refresh: string;
  /** Access-token expiry, epoch milliseconds. */
  expires: number;
  accountId: string;
}

/** Token bundle returned by omp's login/refresh (pre-persistence, no `type`). */
interface OhmypiOAuthTokens {
  access: string;
  refresh: string;
  expires: number;
  accountId: string;
}

export interface DeviceCodeInfo {
  userCode: string;
  verificationUri: string;
  intervalSeconds: number;
  expiresInSeconds: number;
}

interface OhmypiCodexOAuthModule {
  refreshOpenAICodexToken: (refreshToken: string) => Promise<OhmypiOAuthTokens>;
  loginOpenAICodexDeviceCode: (options: {
    onDeviceCode: (info: DeviceCodeInfo) => void;
    signal?: AbortSignal;
  }) => Promise<OhmypiOAuthTokens>;
}

export function getOhmypiAuthPath(): string {
  return join(homedir(), '.omp', 'agent', 'auth.json');
}

function readAuthFile(): Record<string, unknown> {
  const path = getOhmypiAuthPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readOhmypiCodexCredential(): OhmypiCodexCredential | null {
  const cred = readAuthFile()[PI_CODEX_PROVIDER];
  if (
    cred && typeof cred === 'object' &&
    typeof (cred as Record<string, unknown>)['access'] === 'string' &&
    typeof (cred as Record<string, unknown>)['refresh'] === 'string'
  ) {
    return cred as OhmypiCodexCredential;
  }
  return null;
}

/** Atomically merge a fresh codex credential into auth.json (mode 0600). */
function writeOhmypiCodexCredential(tokens: OhmypiOAuthTokens): OhmypiCodexCredential {
  const path = getOhmypiAuthPath();
  mkdirSync(dirname(path), { recursive: true });
  const auth = readAuthFile();
  const stored: OhmypiCodexCredential = {
    type: 'oauth',
    access: tokens.access,
    refresh: tokens.refresh,
    expires: tokens.expires,
    accountId: tokens.accountId,
  };
  auth[PI_CODEX_PROVIDER] = stored;
  const tmp = `${path}.tmp-${process.pid}`;
  writeFileSync(tmp, JSON.stringify(auth, null, 2), { mode: 0o600 });
  renameSync(tmp, path);
  return stored;
}

/** Locate the `omp` executable on PATH (no subprocess — event-loop safe). */
function findOmpBinary(): string | null {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'omp');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** omp is @oh-my-pi/pi-coding-agent; the oauth submodule path mirrors pi-ai's layout. */
const OMP_AI_OAUTH_SUBPATH = join('@oh-my-pi', 'pi-ai', 'dist', 'utils', 'oauth', 'openai-codex.js');

/**
 * Resolve omp's openai-codex OAuth submodule by walking node_modules upward
 * from the real omp binary. Returns null when not found — the caller degrades
 * gracefully to 'unavailable' status.
 */
function resolveOmpCodexOAuthFile(ompBin: string): string | null {
  let dir = dirname(realpathSync(ompBin));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', OMP_AI_OAUTH_SUBPATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let cachedModule: Promise<OhmypiCodexOAuthModule | null> | null = null;

/**
 * Dynamically load omp's openai-codex OAuth submodule from the installed `omp`
 * package. Returns null on any failure so callers can degrade gracefully.
 */
async function loadOhmypiCodexOAuth(): Promise<OhmypiCodexOAuthModule | null> {
  if (cachedModule) return cachedModule;
  cachedModule = (async () => {
    try {
      const ompBin = findOmpBinary();
      if (!ompBin) return null;
      const oauthFile = resolveOmpCodexOAuthFile(ompBin);
      if (!oauthFile) return null;
      const mod = (await import(pathToFileURL(oauthFile).href)) as Partial<OhmypiCodexOAuthModule>;
      if (
        typeof mod.refreshOpenAICodexToken !== 'function' ||
        typeof mod.loginOpenAICodexDeviceCode !== 'function'
      ) {
        return null;
      }
      return mod as OhmypiCodexOAuthModule;
    } catch {
      return null;
    }
  })();
  return cachedModule;
}

export type OhmypiCodexAuthStatus =
  | { status: 'ok'; expiresAt: number }
  | { status: 'missing' }
  | { status: 'expired'; expiresAt: number; refreshFailed: boolean }
  | { status: 'unavailable' };

const EXPIRY_MARGIN_MS = 60_000;

export async function getOhmypiCodexAuthStatus(opts?: { refreshIfExpired?: boolean }): Promise<OhmypiCodexAuthStatus> {
  const cred = readOhmypiCodexCredential();
  if (!cred) return { status: 'missing' };
  if (cred.expires > Date.now() + EXPIRY_MARGIN_MS) return { status: 'ok', expiresAt: cred.expires };

  if (opts?.refreshIfExpired) {
    const refreshed = await refreshOhmypiCodexAuth();
    if (refreshed) return { status: 'ok', expiresAt: refreshed.expires };
    return { status: 'expired', expiresAt: cred.expires, refreshFailed: true };
  }
  return { status: 'expired', expiresAt: cred.expires, refreshFailed: false };
}

export async function refreshOhmypiCodexAuth(): Promise<OhmypiCodexCredential | null> {
  const cred = readOhmypiCodexCredential();
  if (!cred?.refresh) return null;
  const mod = await loadOhmypiCodexOAuth();
  if (!mod) return null;
  try {
    return writeOhmypiCodexCredential(await mod.refreshOpenAICodexToken(cred.refresh));
  } catch {
    return null;
  }
}

export async function isOhmypiCodexOAuthAvailable(): Promise<boolean> {
  return (await loadOhmypiCodexOAuth()) !== null;
}

export async function loginOhmypiCodexDeviceCode(
  onDeviceCode: (info: DeviceCodeInfo) => void,
  signal?: AbortSignal,
): Promise<OhmypiCodexCredential> {
  const mod = await loadOhmypiCodexOAuth();
  if (!mod) {
    throw new Error(
      'Could not load omp\'s OAuth module. Is `omp` (@oh-my-pi/pi-coding-agent) installed and on PATH?',
    );
  }
  return writeOhmypiCodexCredential(await mod.loginOpenAICodexDeviceCode({ onDeviceCode, signal }));
}
