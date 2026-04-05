/**
 * Shared tracker utilities for resolving issue IDs to their tracker type
 * (GitHub or Linear) based on GITHUB_REPOS configuration.
 *
 * Eliminates hardcoded prefix checks like `issueId.startsWith('PAN-')`.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { loadProjectsConfig, getIssuePrefix } from './projects.js';

export interface GitHubRepoConfig {
  owner: string;
  repo: string;
  prefix: string;
}

export interface GitHubIssueResolution {
  isGitHub: true;
  owner: string;
  repo: string;
  prefix: string;
  number: number;
}

export interface NonGitHubResolution {
  isGitHub: false;
}

export type IssueResolution = GitHubIssueResolution | NonGitHubResolution;

/**
 * Parse GitHub repos from GITHUB_REPOS env var and projects.yaml.
 * Priority: GITHUB_REPOS env var first, then auto-derive from projects.yaml.
 * Format for env var: "owner/repo:PREFIX,owner2/repo2:PREFIX2"
 */
export function parseGitHubRepos(): GitHubRepoConfig[] {
  const repos: GitHubRepoConfig[] = [];

  // 1. Check GITHUB_REPOS env var
  const envFile = join(homedir(), '.panopticon.env');
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    const reposMatch = content.match(/GITHUB_REPOS=(.+)/);
    if (reposMatch) {
      repos.push(...reposMatch[1].trim().split(',').map(r => {
        const [repoPath, prefix] = r.trim().split(':');
        const [owner, repo] = (repoPath || '').split('/');
        return { owner: owner || '', repo: repo || '', prefix: (prefix || '').toUpperCase() };
      }).filter(r => r.owner && r.repo && r.prefix));
    }
  }

  // 2. Auto-derive from projects.yaml (if no explicit GITHUB_REPOS)
  if (repos.length === 0) {
    try {
      const { projects } = loadProjectsConfig();
      for (const [key, project] of Object.entries(projects)) {
        if (project.github_repo) {
          const [owner, repo] = project.github_repo.split('/');
          // Derive prefix: linear_team if set, otherwise uppercase project key
          const prefix = getIssuePrefix(project) || key.toUpperCase().replace(/-/g, '');
          if (owner && repo && prefix) {
            repos.push({ owner, repo, prefix: prefix.toUpperCase() });
          }
        }
      }
    } catch { /* ignore */ }
  }

  return repos;
}

/**
 * Extract the prefix from an issue ID (e.g., "CLI" from "CLI-1", "PAN" from "PAN-42").
 */
export function extractIssuePrefix(issueId: string): string {
  return issueId.split('-')[0].toUpperCase();
}

/**
 * Resolve an issue ID to its GitHub repo config, or determine it's not a GitHub issue.
 *
 * Checks the issue prefix against all prefixes configured in GITHUB_REPOS.
 * Returns the matching repo config with parsed issue number, or { isGitHub: false }.
 */
export function resolveGitHubIssue(issueId: string): IssueResolution {
  const prefix = extractIssuePrefix(issueId);
  const repos = parseGitHubRepos();

  for (const repoConfig of repos) {
    if (repoConfig.prefix === prefix) {
      const number = parseInt(issueId.split('-')[1], 10);
      if (!isNaN(number)) {
        return { isGitHub: true, ...repoConfig, number };
      }
    }
  }

  return { isGitHub: false };
}

/**
 * Check if an issue ID belongs to a GitHub-tracked project.
 */
export function isGitHubIssue(issueId: string): boolean {
  return resolveGitHubIssue(issueId).isGitHub;
}

export type TrackerTypeResolution = 'github' | 'rally' | 'linear';

/**
 * Resolve the tracker type for an issue ID by checking projects.yaml configuration.
 *
 * Resolution order:
 * 1. GitHub — prefix matches a configured github_repo project
 * 2. Rally — prefix matches a project with rally_project but no linear_team / github_repo
 * 3. Linear — fallback (matches linear_team or unknown prefix)
 */
export function resolveTrackerType(issueId: string): TrackerTypeResolution {
  // Check GitHub first (existing logic)
  if (resolveGitHubIssue(issueId).isGitHub) {
    return 'github';
  }

  // Check if the issue prefix matches a Rally-only project
  const prefix = extractIssuePrefix(issueId);
  try {
    const { projects } = loadProjectsConfig();
    for (const [key, project] of Object.entries(projects)) {
      const projectPrefix = getIssuePrefix(project) || key.toUpperCase().replace(/-/g, '');
      if (projectPrefix?.toUpperCase() === prefix) {
        // Prefix matches — determine tracker by what's configured
        if (project.github_repo) return 'github';
        if (project.rally_project) return 'rally';
        return 'linear';
      }
    }
  } catch { /* ignore config errors */ }

  // Default to Linear for unknown prefixes
  return 'linear';
}
