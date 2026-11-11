/**
 * Per-repository GitHub App installation discovery (PAN-5153).
 *
 * One App can be installed on many owners. This module answers "which
 * installation covers owner/repo" with `GET /repos/{owner}/{repo}/installation`
 * (App JWT), so a repository the App is not installed on routes to the gh user
 * instead of failing on the home installation's token.
 *
 * - A positive answer is cached in memory for 6 hours, keyed by lowercase
 *   owner/repo. Concurrent callers share one request.
 * - A 404 is recorded in repo notes (`github-quota/repo-notes.json`), which
 *   already persist "not installed" for 6 hours across processes.
 * - Any other failure throws from `resolveRepoInstallationId`; the callers
 *   that never throw treat it as "covered" so a network failure keeps the
 *   home-installation behavior (NFR-1).
 * - The lookup uses the App JWT and is not recorded in the quota ledger.
 *
 * In-repo imports: github-app-auth.ts and github-quota/repo-notes.ts only.
 */

import {
  generateAppJwt,
  getInstallationAccessToken,
  isGitHubAppConfigured,
  loadGitHubAppConfig,
  withGitHubTimeout,
  type GitHubAppConfig,
} from './github-app-auth.js';
import { isAppMarkedNotInstalled, markAppNotInstalled } from './github-quota/repo-notes.js';

export const APP_INSTALLATION_TTL_MS = 6 * 60 * 60_000;

export interface RepoInstallationDeps {
  isConfigured?: () => boolean;
  fetchImpl?: typeof fetch;
  now?: () => number;
  loadConfig?: () => GitHubAppConfig | null;
  makeJwt?: (appId: string, privateKey: string) => string;
}

interface CacheEntry {
  promise: Promise<string | null>;
  /** Infinity while the lookup is in flight. */
  expiresAtMs: number;
}

const installationCache = new Map<string, CacheEntry>();

/** Forget every cached installation id (used by `pan doctor`'s fresh check and by tests). */
export function resetRepoInstallationCache(): void {
  installationCache.clear();
}

/** `/repos/{owner}/{repo}/...` → { owner, repo }; any other path → null. */
export function repoFromApiPath(path: string): { owner: string; repo: string } | null {
  const match = /^\/repos\/([^/?#]+)\/([^/?#]+)/.exec(path);
  if (!match) return null;
  return { owner: decodeURIComponent(match[1]), repo: decodeURIComponent(match[2]) };
}

async function fetchRepoInstallationId(
  owner: string,
  repo: string,
  deps: RepoInstallationDeps,
  nowMs: number,
): Promise<string | null> {
  const config = (deps.loadConfig ?? loadGitHubAppConfig)();
  if (!config) return null;
  const jwt = (deps.makeJwt ?? generateAppJwt)(config.appId, config.privateKey);
  const fetchImpl = deps.fetchImpl ?? fetch;
  const result = await withGitHubTimeout('GET repo installation', async (signal) => {
    const response = await fetchImpl(`https://api.github.com/repos/${owner}/${repo}/installation`, {
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'overdeck',
      },
      signal,
    });
    if (response.status === 200) {
      const body = await response.json() as { id?: unknown };
      if (body.id === undefined || body.id === null) {
        throw new Error(`GitHub App installation lookup for ${owner}/${repo} returned no id`);
      }
      return { status: 200, id: String(body.id) };
    }
    return { status: response.status, id: null };
  });
  if (result.status === 200) return result.id;
  if (result.status === 404) {
    markAppNotInstalled(owner, repo, nowMs);
    return null;
  }
  throw new Error(`GitHub App installation lookup for ${owner}/${repo} failed: ${result.status}`);
}

/**
 * The installation id that covers owner/repo, or null when the App is not
 * installed there. Throws on any failure other than 404.
 */
export async function resolveRepoInstallationId(
  owner: string,
  repo: string,
  deps: RepoInstallationDeps = {},
): Promise<string | null> {
  if (!(deps.isConfigured ?? isGitHubAppConfigured)()) return null;
  const now = deps.now ?? Date.now;
  const nowMs = now();
  if (isAppMarkedNotInstalled(owner, repo, nowMs)) return null;

  const key = `${owner}/${repo}`.toLowerCase();
  const cached = installationCache.get(key);
  if (cached && cached.expiresAtMs > nowMs) return cached.promise;

  const entry: CacheEntry = { promise: Promise.resolve(null), expiresAtMs: Infinity };
  entry.promise = fetchRepoInstallationId(owner, repo, deps, nowMs).then(
    (id) => {
      if (installationCache.get(key) === entry) {
        if (id === null) installationCache.delete(key);
        else entry.expiresAtMs = now() + APP_INSTALLATION_TTL_MS;
      }
      return id;
    },
    (error: unknown) => {
      if (installationCache.get(key) === entry) installationCache.delete(key);
      throw error;
    },
  );
  installationCache.set(key, entry);
  return entry.promise;
}

/** True when the App covers owner/repo. Never throws: a lookup failure returns isConfigured(). */
export async function appCoversRepo(
  owner: string,
  repo: string,
  deps: RepoInstallationDeps = {},
): Promise<boolean> {
  try {
    return (await resolveRepoInstallationId(owner, repo, deps)) !== null;
  } catch {
    return (deps.isConfigured ?? isGitHubAppConfigured)();
  }
}

/**
 * A token for the installation that covers owner/repo; null when the App is
 * not configured or not installed there; the home installation's token when
 * the lookup fails (NFR-1).
 */
export async function getRepoInstallationToken(
  owner: string,
  repo: string,
  deps: RepoInstallationDeps = {},
): Promise<string | null> {
  if (!(deps.isConfigured ?? isGitHubAppConfigured)()) return null;
  let id: string | null;
  try {
    id = await resolveRepoInstallationId(owner, repo, deps);
  } catch {
    return getInstallationAccessToken();
  }
  if (id === null) return null;
  return getInstallationAccessToken(id);
}

/** The token for an App REST path: the covering installation's token, else the home installation's. */
export async function installationTokenForApiPath(path: string): Promise<string> {
  const target = repoFromApiPath(path);
  const id = target
    ? await resolveRepoInstallationId(target.owner, target.repo).catch(() => null)
    : null;
  return getInstallationAccessToken(id ?? undefined);
}
