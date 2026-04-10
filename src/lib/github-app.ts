/**
 * GitHub App Integration (PAN-536)
 *
 * Generates short-lived installation access tokens for the panopticon-agent GitHub App.
 * Agents push via HTTPS with these tokens instead of the user's SSH key, so commits
 * show as `panopticon-agent[bot]` with a verified badge.
 *
 * Credentials stored at: ~/.panopticon/github-app/
 *   - app-id, private-key.pem, installation-id
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { createSign } from 'crypto';

const APP_DIR = join(homedir(), '.panopticon', 'github-app');

export interface GitHubAppConfig {
  appId: string;
  installationId: string;
  privateKey: string;
}

export interface InstallationToken {
  token: string;
  expiresAt: string; // ISO timestamp
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
 * Load GitHub App credentials from ~/.panopticon/github-app/
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
}

/**
 * Generate a short-lived installation access token (~1 hour TTL).
 * Used for git push and PR operations by agent workspaces.
 */
export async function generateInstallationToken(
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
        'User-Agent': 'panopticon-cli',
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
 * @param context - Check name (e.g. "panopticon/review", "panopticon/test")
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

  const { token } = await generateInstallationToken(config);

  const response = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/statuses/${sha}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `token ${token}`,
        'Accept': 'application/vnd.github+json',
        'User-Agent': 'panopticon-cli',
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
 * Refresh the installation token for a workspace (call when token expires).
 * Updates the credential file in-place.
 */
export async function refreshWorkspaceToken(
  workspacePath: string,
): Promise<void> {
  const config = loadGitHubAppConfig();
  if (!config) throw new Error('GitHub App not configured');

  const { token } = await generateInstallationToken(config);
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
