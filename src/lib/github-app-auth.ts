/**
 * GitHub App authentication primitives (PAN-536, PAN-5153).
 *
 * This module owns the App's credentials (~/.overdeck/github-app/), the App
 * JWT, and the per-installation token memo. One App can have many
 * installations: the home installation (`installation-id`) plus any other
 * installation that covers a repository. The token functions take an optional
 * installation id and default to the home installation.
 *
 * It imports nothing from github-app.ts, github-app-installations.ts or
 * github-repo-identity.ts, so those modules can depend on it without a cycle.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createSign } from 'crypto';

export const APP_DIR = join(homedir(), '.overdeck', 'github-app');

/**
 * Upper bound on one GitHub App API request, including reading its body
 * (PAN-4047). Without it a hung connection blocks the caller forever.
 */
export const GITHUB_API_TIMEOUT_MS = 30_000;

/**
 * A GitHub App API request did not finish within its timeout. It is an Error,
 * so every caller that already catches a failed forge call handles it.
 */
export class GitHubRequestTimeoutError extends Error {
  readonly _tag = 'GitHubRequestTimeoutError';

  constructor(
    readonly operation: string,
    readonly timeoutMs: number,
  ) {
    super(`GitHub API ${operation} timed out after ${timeoutMs}ms`);
    this.name = 'GitHubRequestTimeoutError';
  }
}

/**
 * Run one GitHub request under an AbortController that fires after
 * `timeoutMs`. `run` receives the signal to pass to fetch and should read the
 * response body inside the callback so a stalled body is bounded too. The
 * race makes the bound hold even if the request ignores the signal.
 */
export async function withGitHubTimeout<T>(
  operation: string,
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number = GITHUB_API_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timedOut = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      const error = new GitHubRequestTimeoutError(operation, timeoutMs);
      controller.abort(error);
      reject(error);
    }, timeoutMs);
  });
  const request = run(controller.signal);
  try {
    return await Promise.race([request, timedOut]);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new GitHubRequestTimeoutError(operation, timeoutMs);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    // The losing side of the race must not surface as an unhandled rejection.
    request.catch(() => {});
  }
}

export interface GitHubAppConfig {
  appId: string;
  installationId: string;
  privateKey: string;
}

export interface InstallationToken {
  token: string;
  expiresAt: string; // ISO timestamp
  permissions?: Record<string, string>;
}

/**
 * Check if the GitHub App is configured (credentials exist)
 */
export function isGitHubAppConfigured(): boolean {
  return (
    existsSync(join(APP_DIR, 'app-id')) &&
    existsSync(join(APP_DIR, 'private-key.pem')) &&
    existsSync(join(APP_DIR, 'installation-id'))
  );
}

/**
 * Load GitHub App credentials from ~/.overdeck/github-app/
 */
export function loadGitHubAppConfig(): GitHubAppConfig | null {
  if (!isGitHubAppConfigured()) return null;
  try {
    return {
      appId: readFileSync(join(APP_DIR, 'app-id'), 'utf-8').trim(),
      installationId: readFileSync(join(APP_DIR, 'installation-id'), 'utf-8').trim(),
      privateKey: readFileSync(join(APP_DIR, 'private-key.pem'), 'utf-8'),
    };
  } catch {
    return null;
  }
}

/**
 * Generate a JWT for GitHub App authentication
 */
export function generateAppJwt(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60, // 60s clock drift allowance
    // GitHub rejects exp more than 600s ahead of *its* clock. A local clock
    // running even a few seconds fast made `now + 600` land at 608s and 401 with
    // "'Expiration time' claim ('exp') is too far in the future", so leave 60s
    // of headroom instead of sitting exactly on the limit.
    exp: now + 540,
    iss: appId,
  })).toString('base64url');

  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKey, 'base64url');

  return `${header}.${payload}.${signature}`;
}

/**
 * Mint an installation access token. `installationId` defaults to the home
 * installation from `config` (or the loaded config).
 */
export async function generateInstallationTokenBody(
  config?: GitHubAppConfig,
  installationId?: string,
): Promise<InstallationToken> {
  const appConfig = config || loadGitHubAppConfig();
  if (!appConfig) {
    throw new Error('GitHub App not configured. Run: node scripts/create-github-app.mjs');
  }

  const jwt = generateAppJwt(appConfig.appId, appConfig.privateKey);
  const id = installationId ?? appConfig.installationId;

  const data = await withGitHubTimeout('POST installation access token', async (signal) => {
    const response = await fetch(
      `https://api.github.com/app/installations/${id}/access_tokens`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${jwt}`,
          'Accept': 'application/vnd.github+json',
          'User-Agent': 'overdeck',
        },
        signal,
      }
    );

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`Failed to generate installation token: ${response.status} ${text}`);
    }

    return await response.json() as {
      token: string;
      expires_at: string;
      permissions?: Record<string, string>;
    };
  });
  return {
    token: data.token,
    expiresAt: data.expires_at,
    permissions: data.permissions,
  };
}

/** PAN-4264: a minted installation token is reused until 5 minutes before it expires. */
export const INSTALLATION_TOKEN_REUSE_MARGIN_MS = 5 * 60_000;
/** PAN-5153: one memoized token per installation id. */
const installationTokenMemo = new Map<string, { token: string; expiresAtMs: number }>();

/** Drop every memoized installation token (tests only). */
export function resetInstallationTokenCacheForTests(): void {
  installationTokenMemo.clear();
}

/**
 * A usable token for `installationId` (default: the home installation),
 * reused from the memo until 5 minutes before it expires.
 */
export async function getInstallationAccessToken(installationId?: string): Promise<string> {
  const config = loadGitHubAppConfig();
  if (!config) {
    throw new Error('GitHub App not configured. Run: node scripts/create-github-app.mjs');
  }
  const id = installationId ?? config.installationId;
  const memo = installationTokenMemo.get(id);
  if (memo && Date.now() < memo.expiresAtMs - INSTALLATION_TOKEN_REUSE_MARGIN_MS) {
    return memo.token;
  }
  const { token, expiresAt } = await generateInstallationTokenBody(config, id);
  const expiresAtMs = Date.parse(expiresAt);
  if (Number.isFinite(expiresAtMs)) {
    installationTokenMemo.set(id, { token, expiresAtMs });
  } else {
    installationTokenMemo.delete(id);
  }
  return token;
}
