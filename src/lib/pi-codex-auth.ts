/**
 * Pi (ChatGPT / Codex subscription) OAuth helpers — PAN-1520.
 *
 * Pi conversations on a GPT-5.x model authenticate with the user's ChatGPT
 * subscription through an OAuth credential under the `openai-codex` provider,
 * stored at ~/.pi/agent/auth.json. When that access token expires AND its
 * refresh token can no longer renew it, Pi fails with the opaque
 * "No API key for provider: openai-codex".
 *
 * This module:
 *   - reads/writes that credential in Pi's exact on-disk shape,
 *   - reports auth status (for `pan doctor` and the conversation spawn gate),
 *   - refreshes an expired-but-recoverable token, and
 *   - drives Pi's headless device-code login to re-authenticate.
 *
 * Refresh and login reuse Pi's OWN OAuth implementation, dynamically loaded
 * from the installed `pi` package (the lightweight oauth submodule only — it
 * imports no provider SDKs), so the credential format and OAuth endpoints
 * never drift from whatever the installed Pi expects. Every reuse is wrapped
 * so a missing/relocated Pi degrades gracefully rather than throwing.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, renameSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { pathToFileURL } from 'node:url';

export const PI_CODEX_PROVIDER = 'openai-codex';

/** Credential as persisted in ~/.pi/agent/auth.json. */
export interface PiCodexCredential {
  type: 'oauth';
  access: string;
  refresh: string;
  /** Access-token expiry, epoch milliseconds. */
  expires: number;
  accountId: string;
}

/** Token bundle returned by Pi's login/refresh (pre-persistence, no `type`). */
interface PiOAuthTokens {
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

interface PiCodexOAuthModule {
  refreshOpenAICodexToken: (refreshToken: string) => Promise<PiOAuthTokens>;
  loginOpenAICodexDeviceCode: (options: {
    onDeviceCode: (info: DeviceCodeInfo) => void;
    signal?: AbortSignal;
  }) => Promise<PiOAuthTokens>;
}

export function getPiAuthPath(): string {
  return join(homedir(), '.pi', 'agent', 'auth.json');
}

function readAuthFile(): Record<string, unknown> {
  const path = getPiAuthPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8'));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

export function readPiCodexCredential(): PiCodexCredential | null {
  const cred = readAuthFile()[PI_CODEX_PROVIDER];
  if (
    cred && typeof cred === 'object' &&
    typeof (cred as Record<string, unknown>)['access'] === 'string' &&
    typeof (cred as Record<string, unknown>)['refresh'] === 'string'
  ) {
    return cred as PiCodexCredential;
  }
  return null;
}

/** Atomically merge a fresh codex credential into auth.json (mode 0600). */
function writePiCodexCredential(tokens: PiOAuthTokens): PiCodexCredential {
  const path = getPiAuthPath();
  mkdirSync(dirname(path), { recursive: true });
  const auth = readAuthFile();
  const stored: PiCodexCredential = {
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

/** Locate the `pi` executable on PATH (no subprocess — event-loop safe). */
function findPiBinary(): string | null {
  for (const dir of (process.env['PATH'] ?? '').split(delimiter)) {
    if (!dir) continue;
    const candidate = join(dir, 'pi');
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

/** pi-ai exports ESM-only, so the CJS resolver rejects it. */
const PI_AI_OAUTH_SUBPATH = join('@earendil-works', 'pi-ai', 'dist', 'utils', 'oauth', 'openai-codex.js');

/**
 * Resolve Pi's openai-codex OAuth submodule by walking node_modules upward
 * from the real pi binary — covering both a nested install (pi-ai under
 * pi-coding-agent/node_modules) and a hoisted one. Avoids createRequire,
 * which can't resolve pi-ai's ESM-only `exports` map.
 */
function resolvePiCodexOAuthFile(piBin: string): string | null {
  let dir = dirname(realpathSync(piBin));
  for (let i = 0; i < 10; i++) {
    const candidate = join(dir, 'node_modules', PI_AI_OAUTH_SUBPATH);
    if (existsSync(candidate)) return candidate;
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}

let cachedModule: Promise<PiCodexOAuthModule | null> | null = null;

/**
 * Dynamically load Pi's openai-codex OAuth submodule from the installed `pi`
 * package. The submodule imports only local helpers (pkce, device-code
 * polling), never the heavy provider SDKs. Returns null on any failure so
 * callers can degrade gracefully.
 */
async function loadPiCodexOAuth(): Promise<PiCodexOAuthModule | null> {
  if (cachedModule) return cachedModule;
  cachedModule = (async () => {
    try {
      const piBin = findPiBinary();
      if (!piBin) return null;
      const oauthFile = resolvePiCodexOAuthFile(piBin);
      if (!oauthFile) return null;
      const mod = (await import(pathToFileURL(oauthFile).href)) as Partial<PiCodexOAuthModule>;
      if (
        typeof mod.refreshOpenAICodexToken !== 'function' ||
        typeof mod.loginOpenAICodexDeviceCode !== 'function'
      ) {
        return null;
      }
      return mod as PiCodexOAuthModule;
    } catch {
      return null;
    }
  })();
  return cachedModule;
}

export type PiCodexAuthStatus =
  /** Valid (unexpired) access token on disk. */
  | { status: 'ok'; expiresAt: number }
  /** No openai-codex credential — never logged in (or logged out). */
  | { status: 'missing' }
  /** Token expired; refresh either not attempted or attempted and failed. */
  | { status: 'expired'; expiresAt: number; refreshFailed: boolean }
  /** Pi's OAuth module could not be loaded — can't refresh/relogin via Panopticon. */
  | { status: 'unavailable' };

/** Treat a token expiring within this window as already expired. */
const EXPIRY_MARGIN_MS = 60_000;

/**
 * Report Pi openai-codex auth status. With `refreshIfExpired`, an expired
 * token triggers one refresh attempt (writing the renewed token back on
 * success) so the caller learns whether the credential is actually dead.
 */
export async function getPiCodexAuthStatus(opts?: { refreshIfExpired?: boolean }): Promise<PiCodexAuthStatus> {
  const cred = readPiCodexCredential();
  if (!cred) return { status: 'missing' };
  if (cred.expires > Date.now() + EXPIRY_MARGIN_MS) return { status: 'ok', expiresAt: cred.expires };

  if (opts?.refreshIfExpired) {
    const refreshed = await refreshPiCodexAuth();
    if (refreshed) return { status: 'ok', expiresAt: refreshed.expires };
    return { status: 'expired', expiresAt: cred.expires, refreshFailed: true };
  }
  return { status: 'expired', expiresAt: cred.expires, refreshFailed: false };
}

/**
 * Refresh an expired openai-codex token using its refresh token. Persists and
 * returns the renewed credential on success, or null if there is no refresh
 * token, Pi's OAuth module is unavailable, or the refresh was rejected (the
 * refresh token itself is dead → a full re-login is required).
 */
export async function refreshPiCodexAuth(): Promise<PiCodexCredential | null> {
  const cred = readPiCodexCredential();
  if (!cred?.refresh) return null;
  const mod = await loadPiCodexOAuth();
  if (!mod) return null;
  try {
    return writePiCodexCredential(await mod.refreshOpenAICodexToken(cred.refresh));
  } catch {
    return null;
  }
}

/** True when Pi's OAuth module can be loaded (so refresh/login are possible). */
export async function isPiCodexOAuthAvailable(): Promise<boolean> {
  return (await loadPiCodexOAuth()) !== null;
}

/**
 * Run Pi's headless device-code login: `onDeviceCode` is invoked with the
 * user code + verification URL to display, then this polls until the user
 * authorizes (or the signal aborts) and persists the new credential.
 */
export async function loginPiCodexDeviceCode(
  onDeviceCode: (info: DeviceCodeInfo) => void,
  signal?: AbortSignal,
): Promise<PiCodexCredential> {
  const mod = await loadPiCodexOAuth();
  if (!mod) {
    throw new Error(
      'Could not load Pi\'s OAuth module. Is `pi` (@earendil-works/pi-coding-agent) installed and on PATH?',
    );
  }
  return writePiCodexCredential(await mod.loginOpenAICodexDeviceCode({ onDeviceCode, signal }));
}
