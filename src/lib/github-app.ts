/**
 * GitHub App Integration (PAN-536)
 *
 * Generates short-lived installation access tokens for the panopticon-agent GitHub App.
 * Agents push via HTTPS with these tokens instead of the user's SSH key, so commits
 * show as `panopticon-agent[bot]` with a verified badge.
 *
 * Credentials stored at: ~/.overdeck/github-app/
 *   - app-id, private-key.pem, installation-id
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createSign } from 'crypto';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { GitHubApiError, ConfigError, FsError } from './errors.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const APP_DIR = join(homedir(), '.overdeck', 'github-app');

export interface GitHubAppConfig {
  appId: string;
  installationId: string;
  privateKey: string;
}

export interface InstallationToken {
  token: string;
  expiresAt: string; // ISO timestamp
}

export interface GitHubPullRequestRef {
  owner: string;
  repo: string;
  number: number;
}

export interface GitHubPullRequestState extends GitHubPullRequestRef {
  url?: string;
  state: 'OPEN' | 'CLOSED';
  merged: boolean;
  mergeable: boolean | null;
  mergeableState: string | null;
  draft: boolean;
  headSha: string;
  baseBranch: string;
  checksPending: boolean;
  checksFailed: boolean;
}

export interface GitHubPullRequestHeadState extends GitHubPullRequestRef {
  url?: string;
  state: 'OPEN' | 'CLOSED';
  merged: boolean;
  headSha: string;
}

export type GitHubCiCheckRunsVerdict = 'green' | 'pending' | 'red';

export interface GitHubCiCheckRunSummary {
  id?: number;
  name: string;
  status: string;
  conclusion: string | null;
  htmlUrl?: string;
}

export interface GitHubCiCheckRunsState {
  verdict: GitHubCiCheckRunsVerdict;
  green: boolean;
  pending: boolean;
  failed: boolean;
  total: number;
  successCount: number;
  pendingCount: number;
  failedCount: number;
  checkRuns: GitHubCiCheckRunSummary[];
  successfulRuns: GitHubCiCheckRunSummary[];
  pendingRuns: GitHubCiCheckRunSummary[];
  failedRuns: GitHubCiCheckRunSummary[];
}

export type MergeBackendStatus = {
  available: boolean;
  mode: 'app' | 'gh-cli' | 'none';
  detail: string;
};

export interface MergeBackendStatusDeps {
  isConfigured?: () => boolean;
  checkGhAuth?: () => Promise<boolean>;
}

type GitHubCheckRunApiResponse = {
  check_runs?: Array<{
    id?: number;
    name?: string;
    status?: string;
    conclusion?: string | null;
    html_url?: string;
  }>;
};

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

async function defaultCheckGhAuth(): Promise<boolean> {
  try {
    await execFileAsync('gh', ['auth', 'status'], { timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

export async function getMergeBackendStatus(deps: MergeBackendStatusDeps = {}): Promise<MergeBackendStatus> {
  const isConfigured = deps.isConfigured ?? isGitHubAppConfigured;
  if (isConfigured()) {
    return {
      available: true,
      mode: 'app',
      detail: 'GitHub App credentials are configured',
    };
  }

  const checkGhAuth = deps.checkGhAuth ?? defaultCheckGhAuth;
  if (await checkGhAuth()) {
    return {
      available: true,
      mode: 'gh-cli',
      detail: 'gh CLI is authenticated',
    };
  }

  return {
    available: false,
    mode: 'none',
    detail: 'No GitHub App credentials or gh CLI authentication found',
  };
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
function generateJWT(appId: string, privateKey: string): string {
  const now = Math.floor(Date.now() / 1000);
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify({
    iat: now - 60, // 60s clock drift allowance
    exp: now + 600, // 10 minute expiry
    iss: appId,
  })).toString('base64url');

  const signer = createSign('SHA256');
  signer.update(`${header}.${payload}`);
  const signature = signer.sign(privateKey, 'base64url');

  return `${header}.${payload}.${signature}`;
}async function generateInstallationTokenPromise(
  config?: GitHubAppConfig
): Promise<InstallationToken> {
  const appConfig = config || loadGitHubAppConfig();
  if (!appConfig) {
    throw new Error('GitHub App not configured. Run: node scripts/create-github-app.mjs');
  }

  const jwt = generateJWT(appConfig.appId, appConfig.privateKey);

  const response = await fetch(
    `https://api.github.com/app/installations/${appConfig.installationId}/access_tokens`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${jwt}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'overdeck',
      },
    }
  );

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`Failed to generate installation token: ${response.status} ${text}`);
  }

  const data = await response.json() as { token: string; expires_at: string };
  return {
    token: data.token,
    expiresAt: data.expires_at,
  };
}

async function getInstallationAccessToken(): Promise<string> {
  const config = loadGitHubAppConfig();
  if (!config) {
    throw new Error('GitHub App not configured. Run: node scripts/create-github-app.mjs');
  }
  const { token } = await Effect.runPromise(generateInstallationToken(config));
  return token;
}

async function githubApiWithToken<T>(
  token: string,
  path: string,
  init: RequestInit = {},
  extraHeaders: Record<string, string> = {}
): Promise<{ data: T; headers: Headers; status: number }> {
  const response = await fetch(`https://api.github.com${path}`, {
    ...init,
    headers: {
      'Authorization': `token ${token}`,
      'Accept': 'application/vnd.github+json',
      'User-Agent': 'overdeck',
      ...extraHeaders,
      ...(init.headers || {}),
    },
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`GitHub API ${init.method || 'GET'} ${path} failed: ${response.status} ${text}`);
  }

  const data = response.status === 204 ? undefined as T : await response.json() as T;
  return { data, headers: response.headers, status: response.status };
}

async function githubApi<T>(
  path: string,
  init: RequestInit = {},
  extraHeaders: Record<string, string> = {}
): Promise<T> {
  const token = await getInstallationAccessToken();
  const { data } = await githubApiWithToken<T>(token, path, init, extraHeaders);
  return data;
}

function withPerPage(path: string, perPage: number): string {
  const [pathname, query = ''] = path.split('?');
  const params = new URLSearchParams(query);
  if (!params.has('per_page')) params.set('per_page', String(perPage));
  return `${pathname}?${params.toString()}`;
}

function nextPathFromLinkHeader(linkHeader: string | null): string | null {
  if (!linkHeader) return null;
  const match = linkHeader.split(',').map(part => part.trim()).find(part => part.endsWith('rel="next"'))?.match(/^<([^>]+)>/);
  if (!match) return null;
  const url = new URL(match[1]);
  if (url.hostname !== 'api.github.com') return null;
  return `${url.pathname}${url.search}`;
}

async function githubApiAllCheckRunPages(path: string): Promise<NonNullable<GitHubCheckRunApiResponse['check_runs']>> {
  const token = await getInstallationAccessToken();
  const allRuns: NonNullable<GitHubCheckRunApiResponse['check_runs']> = [];
  let nextPath: string | null = withPerPage(path, 100);

  while (nextPath) {
    const { data, headers } = await githubApiWithToken<GitHubCheckRunApiResponse>(token, nextPath);
    allRuns.push(...(data.check_runs || []));
    nextPath = nextPathFromLinkHeader(headers.get('link'));
  }

  return allRuns;
}

export function parsePullRequestRef(input: {
  url?: string;
  id?: string;
  repository?: string;
}): GitHubPullRequestRef {
  if (input.url) {
    const match = input.url.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
    if (!match) {
      throw new Error(`Could not parse GitHub PR from URL: ${input.url}`);
    }
    return {
      owner: match[1],
      repo: match[2],
      number: Number.parseInt(match[3], 10),
    };
  }

  if (input.repository && input.id) {
    const [owner, repo] = input.repository.split('/');
    const number = Number.parseInt(input.id, 10);
    if (owner && repo && Number.isFinite(number)) {
      return { owner, repo, number };
    }
  }

  throw new Error('GitHub PR reference requires either a PR URL or repository + numeric id');
}

function summarizeCiCheckRuns(
  runs: NonNullable<GitHubCheckRunApiResponse['check_runs']>,
): GitHubCiCheckRunsState {
  const checkRuns = runs.map((run) => ({
    id: run.id,
    name: run.name || 'GitHub check run',
    status: run.status || 'unknown',
    conclusion: run.conclusion ?? null,
    htmlUrl: run.html_url,
  }));

  const pendingRuns = checkRuns.filter((run) => run.status !== 'completed');
  const successfulRuns = checkRuns.filter(
    (run) => run.status === 'completed' && run.conclusion === 'success',
  );
  const failedRuns = checkRuns.filter((run) => {
    if (run.status !== 'completed') return false;
    return !['success', 'neutral', 'skipped'].includes(run.conclusion || '');
  });

  const pending = pendingRuns.length > 0 || successfulRuns.length === 0;
  const failed = failedRuns.length > 0;
  const green = checkRuns.length > 0 && successfulRuns.length > 0 && !pending && !failed;
  const verdict: GitHubCiCheckRunsVerdict = failed ? 'red' : green ? 'green' : 'pending';

  return {
    verdict,
    green,
    pending: verdict === 'pending',
    failed,
    total: checkRuns.length,
    successCount: successfulRuns.length,
    pendingCount: pendingRuns.length,
    failedCount: failedRuns.length,
    checkRuns,
    successfulRuns,
    pendingRuns,
    failedRuns,
  };
}

async function getCiCheckRunsStatePromise(
  owner: string,
  repo: string,
  sha: string,
): Promise<GitHubCiCheckRunsState> {
  const checkRuns = await githubApiAllCheckRunPages(
    `/repos/${owner}/${repo}/commits/${sha}/check-runs`
  );
  return summarizeCiCheckRuns(checkRuns);
}

async function getCommitCheckState(
  owner: string,
  repo: string,
  sha: string,
): Promise<{ pending: boolean; failed: boolean }> {
  const [combinedStatus, checkRuns] = await Promise.all([
    githubApi<{ state?: string }>(`/repos/${owner}/${repo}/commits/${sha}/status`),
    githubApi<GitHubCheckRunApiResponse>(
      `/repos/${owner}/${repo}/commits/${sha}/check-runs`
    ),
  ]);

  const statusState = combinedStatus.state || '';
  const pendingStatus = statusState === 'pending';
  const failedStatus = statusState === 'failure' || statusState === 'error';
  const ciState = summarizeCiCheckRuns(checkRuns.check_runs || []);

  return {
    pending: pendingStatus || ciState.pendingRuns.length > 0,
    failed: failedStatus || ciState.failed,
  };
}async function getPullRequestStatePromise(
  owner: string,
  repo: string,
  number: number,
): Promise<GitHubPullRequestState> {
  const pull = await githubApi<{
    html_url?: string;
    state: 'open' | 'closed';
    merged?: boolean;
    mergeable?: boolean | null;
    mergeable_state?: string | null;
    draft?: boolean;
    head?: { sha?: string };
    base?: { ref?: string };
  }>(`/repos/${owner}/${repo}/pulls/${number}`);

  const headSha = pull.head?.sha || '';
  const checkState = headSha
    ? await getCommitCheckState(owner, repo, headSha)
    : { pending: false, failed: false };

  return {
    owner,
    repo,
    number,
    url: pull.html_url,
    state: pull.state === 'open' ? 'OPEN' : 'CLOSED',
    merged: pull.merged === true,
    mergeable: pull.mergeable ?? null,
    mergeableState: pull.mergeable_state ?? null,
    draft: pull.draft === true,
    headSha,
    baseBranch: pull.base?.ref || 'main',
    checksPending: checkState.pending,
    checksFailed: checkState.failed,
  };
}

async function getPullRequestHeadStatePromise(
  owner: string,
  repo: string,
  number: number,
): Promise<GitHubPullRequestHeadState> {
  const pull = await githubApi<{
    html_url?: string;
    state: 'open' | 'closed';
    merged?: boolean;
    head?: { sha?: string };
  }>(`/repos/${owner}/${repo}/pulls/${number}`);

  return {
    owner,
    repo,
    number,
    url: pull.html_url,
    state: pull.state === 'open' ? 'OPEN' : 'CLOSED',
    merged: pull.merged === true,
    headSha: pull.head?.sha || '',
  };
}async function mergePullRequestWithAppPromise(
  owner: string,
  repo: string,
  number: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash',
  sha?: string,
): Promise<{ merged: boolean; message?: string }> {
  const token = await getInstallationAccessToken();
  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/pulls/${number}/merge`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'overdeck',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        merge_method: method,
        ...(sha ? { sha } : {}),
      }),
    }
  );

  if (response.ok) {
    const data = await response.json() as { merged?: boolean; message?: string };
    return {
      merged: data.merged === true,
      message: data.message,
    };
  }

  const text = await response.text();
  throw new Error(`GitHub merge failed: ${response.status} ${text}`);
}

/**
 * Get the bot identity for git config
 */
export function getBotIdentity(appConfig?: GitHubAppConfig): { name: string; email: string } {
  const config = appConfig || loadGitHubAppConfig();
  const appId = config?.appId || '0';
  return {
    name: 'panopticon-agent[bot]',
    email: `${appId}+panopticon-agent[bot]@users.noreply.github.com`,
  };
}

/**
 * Configure a workspace to push as the bot identity.
 * Sets git remote to HTTPS with token auth and configures bot user.
 *
 * @param workspacePath - Path to the git workspace
 * @param owner - GitHub repo owner
 * @param repo - GitHub repo name
 * @param token - Installation access token
 */
export async function configureWorkspaceForBot(
  workspacePath: string,
  owner: string,
  repo: string,
  token: string,
): Promise<void> {
  const { exec } = await import('child_process');
  const { promisify } = await import('util');
  const { writeFileSync } = await import('fs');
  const execAsync = promisify(exec);
  const { name, email } = getBotIdentity();

  // Set git user identity for this workspace
  await execAsync(`git config user.name "${name}"`, { cwd: workspacePath, encoding: 'utf-8' });
  await execAsync(`git config user.email "${email}"`, { cwd: workspacePath, encoding: 'utf-8' });

  // Use git credential store with a workspace-local credential file.
  // Token is refreshed at workspace creation (~1hr TTL). For long sessions,
  // call refreshWorkspaceToken() to get a fresh one.
  const credFile = join(workspacePath, '.git', 'pan-credentials');
  writeFileSync(credFile, `https://x-access-token:${token}@github.com\n`, { mode: 0o600 });

  // Set remote to HTTPS and configure credential store
  const httpsUrl = `https://github.com/${owner}/${repo}.git`;
  await execAsync(`git remote set-url origin "${httpsUrl}"`, { cwd: workspacePath, encoding: 'utf-8' });
  await execAsync(`git config credential.helper "store --file=${credFile}"`, { cwd: workspacePath, encoding: 'utf-8' });
}

/**
 * Report a check status on a commit (replaces the need for CI)
 *
 * @param owner - Repo owner
 * @param repo - Repo name
 * @param sha - Commit SHA
 * @param status - Check status
 * @param context - Check name (e.g. "overdeck/review", "overdeck/test")
 * @param description - Short description
 */
export async function reportCommitStatus(
  owner: string,
  repo: string,
  sha: string,
  status: 'pending' | 'success' | 'failure' | 'error',
  context: string,
  description: string,
): Promise<void> {
  const config = loadGitHubAppConfig();
  if (!config) return; // Silently skip in fallback mode

  const { token } = await Effect.runPromise(generateInstallationToken(config));

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'overdeck',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ state: status, context, description }),
    }
  );

  if (!response.ok) {
    const text = await response.text();
    console.warn(`[github-app] Failed to report status: ${response.status} ${text}`);
  }
}

/**
 * Post the `overdeck/tests` commit status for the HEAD of a workspace.
 *
 * Used by verification-runner (pre-review gate) and the test specialist
 * (post-review gate) to signal that Overdeck has run the test suite
 * against this exact commit. The `test` job in .github/workflows/ci.yml
 * reads this status and skips its own vitest run when it's `success`,
 * eliminating duplicate test execution for pipeline-managed PRs.
 *
 * Non-pipeline pushes (no workspace, no `overdeck/tests` status) cause
 * CI to fall through and run vitest as normal — defense in depth.
 *
 * Failures are non-fatal: status posting is informational and must never
 * block the verification or test specialist's primary outcome.
 */
export async function postOverdeckTestsStatus(
  workspacePath: string,
  owner: string,
  repo: string,
  status: 'success' | 'failure',
  description: string,
): Promise<void> {
  if (!isGitHubAppConfigured()) return;
  try {
    const { stdout } = await execAsync('git rev-parse HEAD', {
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: 5000,
    });
    const sha = stdout.trim();
    if (!sha) return;
    // Context name MUST match branch protection's required_status_checks.contexts
    // for main, which is the singular "overdeck/test". Don't change to plural
    // without coordinating the branch protection rule update.
    await reportCommitStatus(owner, repo, sha, status, 'overdeck/test', description);
    console.log(
      `[github-app] Posted overdeck/test=${status} for ${sha.slice(0, 8)} in ${owner}/${repo}`,
    );
  } catch (err: any) {
    console.warn(`[github-app] Failed to post overdeck/test status: ${err.message}`);
  }
}async function refreshWorkspaceTokenPromise(
  workspacePath: string,
): Promise<void> {
  const config = loadGitHubAppConfig();
  if (!config) throw new Error('GitHub App not configured');

  const { token } = await Effect.runPromise(generateInstallationToken(config));
  const { writeFileSync } = await import('fs');
  const credFile = join(workspacePath, '.git', 'pan-credentials');
  writeFileSync(credFile, `https://x-access-token:${token}@github.com\n`, { mode: 0o600 });
}

/**
 * Get GitHub App status for `pan status` display
 */
export function getAppStatus(): {
  configured: boolean;
  appId?: string;
  installationId?: string;
  mode: 'app' | 'fallback';
} {
  const config = loadGitHubAppConfig();
  if (config) {
    return {
      configured: true,
      appId: config.appId,
      installationId: config.installationId,
      mode: 'app',
    };
  }
  return { configured: false, mode: 'fallback' };
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

const apiCatch = (operation: string) => (cause: unknown) =>
  new GitHubApiError({
    operation,
    status: 0,
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/**
 * Effect-native generateInstallationToken. Fails with ConfigError if the
 * GitHub App is not configured locally; GitHubApiError on transport / 4xx.
 */
export const generateInstallationToken = (
  config?: GitHubAppConfig,
): Effect.Effect<InstallationToken, GitHubApiError | ConfigError> =>
  Effect.gen(function* () {
    const cfg = config ?? loadGitHubAppConfig();
    if (!cfg) {
      return yield* Effect.fail(
        new ConfigError({ message: 'GitHub App not configured' }),
      );
    }
    return yield* Effect.tryPromise({
      try: () => generateInstallationTokenPromise(cfg),
      catch: apiCatch('generateInstallationToken'),
    });
  });

/** Effect-native getPullRequestState — typed-error fetch + check aggregator. */
export const getPullRequestState = (
  owner: string,
  repo: string,
  number: number,
): Effect.Effect<GitHubPullRequestState, GitHubApiError> =>
  Effect.tryPromise({
    try: () => getPullRequestStatePromise(owner, repo, number),
    catch: apiCatch('getPullRequestState'),
  });

/** Effect-native lightweight PR state fetch without commit status/check aggregation. */
export const getPullRequestHeadState = (
  owner: string,
  repo: string,
  number: number,
): Effect.Effect<GitHubPullRequestHeadState, GitHubApiError> =>
  Effect.tryPromise({
    try: () => getPullRequestHeadStatePromise(owner, repo, number),
    catch: apiCatch('getPullRequestHeadState'),
  });

/**
 * Effect-native check-runs-only CI verdict for one commit SHA.
 * Unlike getPullRequestState(), this intentionally ignores commit statuses.
 */
export const getCiCheckRunsState = (
  owner: string,
  repo: string,
  sha: string,
): Effect.Effect<GitHubCiCheckRunsState, GitHubApiError> =>
  Effect.tryPromise({
    try: () => getCiCheckRunsStatePromise(owner, repo, sha),
    catch: apiCatch('getCiCheckRunsState'),
  });

/** Effect-native mergePullRequestWithApp — typed-error merge call. */
export const mergePullRequestWithApp = (
  owner: string,
  repo: string,
  number: number,
  method: 'merge' | 'squash' | 'rebase' = 'squash',
  sha?: string,
): Effect.Effect<{ merged: boolean; message?: string }, GitHubApiError> =>
  Effect.tryPromise({
    try: () => mergePullRequestWithAppPromise(owner, repo, number, method, sha),
    catch: apiCatch('mergePullRequestWithApp'),
  });

/** Effect-native refreshWorkspaceToken — fails with FsError or GitHubApiError. */
export const refreshWorkspaceToken = (
  workspacePath: string,
): Effect.Effect<void, GitHubApiError | ConfigError | FsError> =>
  Effect.gen(function* () {
    const cfg = loadGitHubAppConfig();
    if (!cfg) {
      return yield* Effect.fail(
        new ConfigError({ message: 'GitHub App not configured' }),
      );
    }
    return yield* Effect.tryPromise({
      try: () => refreshWorkspaceTokenPromise(workspacePath),
      catch: (cause) =>
        new FsError({
          path: join(workspacePath, '.git', 'pan-credentials'),
          operation: 'refreshWorkspaceToken',
          cause,
        }),
    });
  });
