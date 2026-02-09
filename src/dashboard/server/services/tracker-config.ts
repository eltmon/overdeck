/**
 * Tracker Configuration Readers
 *
 * Extracted from server/index.ts for reuse by IssueDataService.
 * Reads GitHub, Linear, and Rally configuration from ~/.panopticon.env.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// GitHub configuration
export interface GitHubConfig {
  token: string;
  repos: Array<{ owner: string; repo: string; prefix?: string }>;
}

// Rally configuration
export interface RallyConfig {
  apiKey: string;
  server?: string;
  workspace?: string;
  project?: string;
}

/**
 * Load Linear API key from ~/.panopticon.env or environment.
 */
export function getLinearApiKey(): string | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    const match = content.match(/LINEAR_API_KEY=(.+)/);
    if (match) return match[1].trim();
  }
  return process.env.LINEAR_API_KEY || null;
}

/**
 * Load Rally configuration from ~/.panopticon.env.
 */
export function getRallyConfig(): RallyConfig | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (!existsSync(envFile)) return null;

  const content = readFileSync(envFile, 'utf-8');

  const apiKeyMatch = content.match(/RALLY_API_KEY=(.+)/);
  if (!apiKeyMatch) return null;

  const apiKey = apiKeyMatch[1].trim();

  const serverMatch = content.match(/RALLY_SERVER=(.+)/);
  const server = serverMatch?.[1].trim();

  const workspaceMatch = content.match(/RALLY_WORKSPACE=(.+)/);
  const workspace = workspaceMatch?.[1].trim();

  const projectMatch = content.match(/RALLY_PROJECT=(.+)/);
  const project = projectMatch?.[1].trim();

  return { apiKey, server, workspace, project };
}

/**
 * Load GitHub configuration from ~/.panopticon.env.
 */
export function getGitHubConfig(): GitHubConfig | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (!existsSync(envFile)) return null;

  const content = readFileSync(envFile, 'utf-8');

  const tokenMatch = content.match(/GITHUB_TOKEN=(.+)/);
  if (!tokenMatch) return null;

  const token = tokenMatch[1].trim();

  const reposMatch = content.match(/GITHUB_REPOS=(.+)/);
  if (!reposMatch) return null;

  const repos = reposMatch[1].trim().split(',').map(r => {
    const [repoPath, prefix] = r.trim().split(':');
    const [owner, repo] = repoPath.split('/');
    return { owner, repo, prefix };
  }).filter(r => r.owner && r.repo);

  if (repos.length === 0) return null;

  return { token, repos };
}
