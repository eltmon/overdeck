/**
 * Tracker Configuration Readers
 *
 * Extracted from server/index.ts for reuse by IssueDataService.
 * Reads GitHub, Linear, and Rally configuration from ~/.panopticon.env.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig as loadYamlConfig } from '../../../lib/config-yaml.js';

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
 * Load Linear API key from ~/.panopticon.env, environment, or config.yaml.
 */
export function getLinearApiKey(): string | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    const match = content.match(/LINEAR_API_KEY=(.+)/);
    if (match) return match[1].trim();
  }
  if (process.env.LINEAR_API_KEY) return process.env.LINEAR_API_KEY;
  try {
    const yamlConfig = loadYamlConfig();
    if (yamlConfig.trackerKeys.linear) return yamlConfig.trackerKeys.linear;
  } catch { /* ignore */ }
  return null;
}

/**
 * Load Rally configuration from ~/.panopticon.env, environment, or config.yaml.
 */
export function getRallyConfig(): RallyConfig | null {
  const envFile = join(homedir(), '.panopticon.env');
  let apiKey: string | undefined;
  let server: string | undefined;
  let workspace: string | undefined;
  let project: string | undefined;

  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    const apiKeyMatch = content.match(/RALLY_API_KEY=(.+)/);
    if (apiKeyMatch) apiKey = apiKeyMatch[1].trim();
    const serverMatch = content.match(/RALLY_SERVER=(.+)/);
    server = serverMatch?.[1].trim();
    const workspaceMatch = content.match(/RALLY_WORKSPACE=(.+)/);
    workspace = workspaceMatch?.[1].trim();
    const projectMatch = content.match(/RALLY_PROJECT=(.+)/);
    project = projectMatch?.[1].trim();
  }

  // Fall back to env var
  if (!apiKey) apiKey = process.env.RALLY_API_KEY;

  // Fall back to config.yaml
  if (!apiKey) {
    try {
      const yamlConfig = loadYamlConfig();
      if (yamlConfig.trackerKeys.rally) apiKey = yamlConfig.trackerKeys.rally;
    } catch { /* ignore */ }
  }

  if (!apiKey) return null;
  return { apiKey, server, workspace, project };
}

/**
 * Load GitHub configuration from ~/.panopticon.env, environment, or config.yaml.
 */
export function getGitHubConfig(): GitHubConfig | null {
  const envFile = join(homedir(), '.panopticon.env');
  let token: string | undefined;
  let repos: Array<{ owner: string; repo: string; prefix?: string }> = [];

  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    const tokenMatch = content.match(/GITHUB_TOKEN=(.+)/);
    if (tokenMatch) token = tokenMatch[1].trim();

    const reposMatch = content.match(/GITHUB_REPOS=(.+)/);
    if (reposMatch) {
      repos = reposMatch[1].trim().split(',').map(r => {
        const [repoPath, prefix] = r.trim().split(':');
        const [owner, repo] = repoPath.split('/');
        return { owner, repo, prefix };
      }).filter(r => r.owner && r.repo);
    }
  }

  // Fall back to env var
  if (!token) token = process.env.GITHUB_TOKEN;

  // Fall back to config.yaml
  if (!token) {
    try {
      const yamlConfig = loadYamlConfig();
      if (yamlConfig.trackerKeys.github) token = yamlConfig.trackerKeys.github;
    } catch { /* ignore */ }
  }

  if (!token || repos.length === 0) return null;
  return { token, repos };
}
