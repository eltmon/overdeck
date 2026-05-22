/**
 * Shared tracker utilities for resolving issue IDs to their tracker type
 * (GitHub or Linear) based on GITHUB_REPOS configuration.
 *
 * Eliminates hardcoded prefix checks like `issueId.startsWith('PAN-')`.
 */

import { readFileSync, existsSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { Effect } from 'effect';
import { loadProjectsConfigSync, getIssuePrefix } from './projects.js';
import { extractPrefixSync, extractNumberSync, parseIssueIdSync } from './issue-id.js';
import { ConfigError } from './errors.js';

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
export function parseGitHubReposSync(): GitHubRepoConfig[] {
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
      const { projects } = loadProjectsConfigSync();
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
 * Extract the prefix from an issue ID (e.g., "CLI" from "CLI-1", "PAN" from "PAN-42", "F" from "F29698").
 * Uses unified parser to support standard, Rally, and custom formats.
 * @deprecated Use extractPrefix from issue-id.ts for unified parsing
 */
export function extractIssuePrefix(issueId: string): string {
  return extractPrefixSync(issueId) ?? issueId.split('-')[0].toUpperCase();
}

/**
 * Resolve an issue ID to its GitHub repo config, or determine it's not a GitHub issue.
 *
 * Checks the issue prefix against all prefixes configured in GITHUB_REPOS.
 * Returns the matching repo config with parsed issue number, or { isGitHub: false }.
 */
export function resolveGitHubIssueSync(issueId: string): IssueResolution {
  const prefix = extractIssuePrefix(issueId);
  const repos = parseGitHubReposSync();

  for (const repoConfig of repos) {
    if (repoConfig.prefix === prefix) {
      const number = extractNumberSync(issueId);
      if (number !== null) {
        return { isGitHub: true, ...repoConfig, number };
      }
    }
  }

  return { isGitHub: false };
}

/**
 * Check if an issue ID belongs to a GitHub-tracked project.
 */
export function isGitHubIssueSync(issueId: string): boolean {
  return resolveGitHubIssueSync(issueId).isGitHub;
}

export type TrackerTypeResolution = 'github' | 'rally' | 'linear' | 'gitlab';

/**
 * Resolve the tracker type for an issue ID by checking projects.yaml configuration.
 *
 * Resolution order:
 * 1. GitHub — prefix matches a configured github_repo project
 * 2. Rally — prefix matches a project with rally_project or tracker: 'rally'
 * 3. Linear — fallback (matches linear_team or unknown prefix)
 */
export function resolveTrackerTypeSync(issueId: string): TrackerTypeResolution {
  // Check GitHub first (existing logic)
  if (resolveGitHubIssueSync(issueId).isGitHub) {
    return 'github';
  }

  // Check if the issue prefix matches a project with explicit tracker type
  const parsed = parseIssueIdSync(issueId);
  if (!parsed) {
    return 'linear'; // default for unparseable IDs
  }

  try {
    const { projects } = loadProjectsConfigSync();
    for (const [key, project] of Object.entries(projects)) {
      // Check single issue_prefix
      const singlePrefix = getIssuePrefix(project);
      if (singlePrefix?.toUpperCase() === parsed.prefix) {
        if (project.tracker) return project.tracker;
        if (project.github_repo) return 'github';
        if (project.rally_project) return 'rally';
        return 'linear';
      }

      // Check issue_prefixes array (multiple prefixes per project)
      if (project.issue_prefixes?.some(p => p.toUpperCase() === parsed.prefix)) {
        if (project.tracker) return project.tracker;
        if (project.rally_project) return 'rally';
        return 'linear';
      }

      // Derive prefix from project key for projects without explicit prefixes
      if (!singlePrefix && !project.issue_prefixes) {
        const derivedPrefix = key.toUpperCase().replace(/-/g, '');
        if (derivedPrefix === parsed.prefix) {
          if (project.tracker) return project.tracker;
          if (project.github_repo) return 'github';
          if (project.rally_project) return 'rally';
          return 'linear';
        }
      }
    }
  } catch { /* ignore config errors */ }

  // Default to Linear for unknown prefixes
  return 'linear';
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Parse configured GitHub repo entries from env + projects.yaml. Wraps the
 * sync implementation so callers in Effect graphs can stay Effect-native.
 */
export const parseGitHubRepos = (): Effect.Effect<readonly GitHubRepoConfig[], ConfigError> =>
  Effect.try({
    try: () => parseGitHubReposSync(),
    catch: (cause) =>
      new ConfigError({ message: 'parseGitHubRepos failed', cause }),
  });

/** Resolve an issue ID to a GitHub repo, or signal it's not a GitHub issue. */
export const resolveGitHubIssue = (
  issueId: string,
): Effect.Effect<IssueResolution, ConfigError> =>
  Effect.try({
    try: () => resolveGitHubIssueSync(issueId),
    catch: (cause) =>
      new ConfigError({ message: `resolveGitHubIssue(${issueId}) failed`, cause }),
  });

/** True if the issue prefix matches a configured github_repo project. */
export const isGitHubIssue = (issueId: string): Effect.Effect<boolean, ConfigError> =>
  Effect.try({
    try: () => isGitHubIssueSync(issueId),
    catch: (cause) =>
      new ConfigError({ message: `isGitHubIssue(${issueId}) failed`, cause }),
  });

/**
 * Resolve the tracker type for an issue ID via projects.yaml.
 * Falls back to 'linear' for unknown prefixes.
 */
export const resolveTrackerType = (
  issueId: string,
): Effect.Effect<TrackerTypeResolution, ConfigError> =>
  Effect.try({
    try: () => resolveTrackerTypeSync(issueId),
    catch: (cause) =>
      new ConfigError({ message: `resolveTrackerType(${issueId}) failed`, cause }),
  });
