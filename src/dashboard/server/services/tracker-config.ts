/**
 * Tracker Configuration Readers
 *
 * Extracted from server/index.ts for reuse by IssueDataService.
 * Priority: config.yaml (Settings page) > ~/.panopticon.env > environment variables
 *
 * NOTE: .panopticon.env content is cached at startup to avoid blocking FS reads
 * during request handling (PAN-70 type issue). See initTrackerConfigCache().
 */

import { existsSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { homedir } from 'os';
import { loadConfig as loadYamlConfig } from '../../../lib/config-yaml.js';
import { loadProjectsConfig, getIssuePrefix } from '../../../lib/projects.js';

// ─── In-memory cache (populated at startup) ───────────────────────────────────
let cachedEnvContent: string | null = null;
let cachedTrackedRepos: Array<{ owner: string; repo: string; prefix?: string }> | null = null;

export async function initTrackerConfigCache(): Promise<void> {
  try {
    const envFile = join(homedir(), '.panopticon.env');
    if (existsSync(envFile)) {
      cachedEnvContent = await readFile(envFile, 'utf-8');
    }
  } catch {
    // If read fails, leave cache as null; functions will fallback to env vars
  }

  try {
    const projectsConfig = loadProjectsConfig();
    cachedTrackedRepos = Object.values(projectsConfig.projects)
      .flatMap((project) => {
        if (!project.github_repo) return [];
        const [owner, repo] = project.github_repo.split('/');
        if (!owner || !repo) return [];
        return [{ owner, repo, prefix: getIssuePrefix(project) ? getIssuePrefix(project) : undefined }];
      });
  } catch {
    cachedTrackedRepos = null;
  }
}

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
 * Load Linear API key.
 * Priority: config.yaml > ~/.panopticon.env > env var
 */
export function getLinearApiKey(): string | null {
  // 1. Check config.yaml (Settings page)
  try {
    const yamlConfig = loadYamlConfig();
    if (yamlConfig.config.trackerKeys.linear) return yamlConfig.config.trackerKeys.linear;
  } catch { /* ignore */ }

  // 2. Check cached ~/.panopticon.env (populated at startup to avoid blocking FS read)
  if (cachedEnvContent) {
    const match = cachedEnvContent.match(/LINEAR_API_KEY=(.+)/);
    if (match) return match[1].trim();
  }

  // 3. Check environment variable
  return process.env.LINEAR_API_KEY || null;
}

/**
 * Load Rally configuration.
 * Priority: config.yaml > ~/.panopticon.env > env var
 */
export function getRallyConfig(): RallyConfig | null {
  let apiKey: string | undefined;
  let server: string | undefined;
  let workspace: string | undefined;
  let project: string | undefined;

  // 1. Check config.yaml (Settings page)
  try {
    const yamlConfig = loadYamlConfig();
    if (yamlConfig.config.trackerKeys.rally) apiKey = yamlConfig.config.trackerKeys.rally;
  } catch { /* ignore */ }

  // 2. Check cached ~/.panopticon.env (also get server/workspace/project from here)
  if (cachedEnvContent) {
    if (!apiKey) {
      const apiKeyMatch = cachedEnvContent.match(/RALLY_API_KEY=(.+)/);
      if (apiKeyMatch) apiKey = apiKeyMatch[1].trim();
    }
    const serverMatch = cachedEnvContent.match(/RALLY_SERVER=(.+)/);
    server = serverMatch?.[1].trim();
    const workspaceMatch = cachedEnvContent.match(/RALLY_WORKSPACE=(.+)/);
    workspace = workspaceMatch?.[1].trim();
    const projectMatch = cachedEnvContent.match(/RALLY_PROJECT=(.+)/);
    project = projectMatch?.[1].trim();
  }

  // 3. Check environment variable
  if (!apiKey) apiKey = process.env.RALLY_API_KEY;

  if (!apiKey) return null;
  return { apiKey, server, workspace, project };
}

/**
 * Validate Rally configuration and return warnings/errors.
 * Does not block functionality — only provides diagnostic info.
 */
export function validateRallyConfig(config: RallyConfig): {
  valid: boolean;
  warnings: string[];
  errors: string[];
} {
  const warnings: string[] = [];
  const errors: string[] = [];

  if (!config.apiKey) {
    errors.push('RALLY_API_KEY is required');
  }

  if (!config.workspace) {
    warnings.push('RALLY_WORKSPACE not configured - queries may return unexpected results');
  }

  if (!config.project) {
    warnings.push('RALLY_PROJECT not configured - queries will search all projects');
  }

  return { valid: errors.length === 0, warnings, errors };
}

/**
 * Load GitHub configuration.
 * Priority: config.yaml > ~/.panopticon.env > env var
 */
export function getGitHubConfig(): GitHubConfig | null {
  let token: string | undefined;
  let repos: Array<{ owner: string; repo: string; prefix?: string }> = [];

  // 1. Check config.yaml (Settings page)
  try {
    const yamlConfig = loadYamlConfig();
    if (yamlConfig.config.trackerKeys.github) token = yamlConfig.config.trackerKeys.github;
  } catch { /* ignore */ }

  // 2. Check cached ~/.panopticon.env (also get repos from here)
  if (cachedEnvContent) {
    if (!token) {
      const tokenMatch = cachedEnvContent.match(/GITHUB_TOKEN=(.+)/);
      if (tokenMatch) token = tokenMatch[1].trim();
    }

    const reposMatch = cachedEnvContent.match(/GITHUB_REPOS=(.+)/);
    if (reposMatch) {
      repos = reposMatch[1].trim().split(',').map(r => {
        const [repoPath, prefix] = r.trim().split(':');
        const [owner, repo] = repoPath.split('/');
        return { owner, repo, prefix };
      }).filter(r => r.owner && r.repo);
    }
  }

  // 3. Check environment variable
  if (!token) token = process.env.GITHUB_TOKEN;

  // 4. Auto-derive repos from startup-cached projects.yaml if none explicitly configured
  if (repos.length === 0 && cachedTrackedRepos) {
    repos = [...cachedTrackedRepos];
  }

  if (!token || repos.length === 0) return null;
  return { token, repos };
}
