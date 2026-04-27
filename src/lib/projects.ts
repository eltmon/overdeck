/**
 * Project Registry - Multi-project support for Panopticon
 *
 * Maps Linear team prefixes and labels to project paths for workspace creation.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'fs';
import { join, resolve } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { PANOPTICON_HOME } from './paths.js';
import { extractPrefix, parseIssueId } from './issue-id.js';
import type { QualityGateConfig, RepoConfig } from './workspace-config.js';

export const PROJECTS_CONFIG_FILE = join(PANOPTICON_HOME, 'projects.yaml');

/**
 * Issue routing rule - routes issues with certain labels to specific paths
 */
export interface IssueRoutingRule {
  labels?: string[];
  default?: boolean;
  path: string;
}

/**
 * Workspace configuration (imported from workspace-config.ts for full details)
 */
export interface WorkspaceConfig {
  type?: 'polyrepo' | 'monorepo';
  workspaces_dir?: string;
  default_branch?: string;
  repos?: RepoConfig[];
  dns?: { domain: string; entries: string[]; sync_method?: 'wsl2hosts' | 'hosts_file' | 'dnsmasq' };
  ports?: Record<string, { range: [number, number] }>;
  docker?: { traefik?: string; compose_template?: string };
  database?: { seed_file?: string; container_name?: string; [key: string]: any };
  agent?: { template_dir: string; templates?: Array<{ source: string; target: string }>; copy_dirs?: string[]; symlinks?: string[] };
  env?: { template?: string; secrets_file?: string };
  services?: Array<{ name: string; path: string; start_command: string; docker_command?: string; health_url?: string; port?: number }>;
  progressive?: boolean;
  always_include?: string[];
  pr_target?: string;
  groups_file?: string;
}

/**
 * Test configuration
 */
export interface TestConfig {
  type: string;
  path: string;
  command: string;
  container?: boolean;
  container_name?: string;
  env?: Record<string, string>;
}

/**
 * Specialist configuration for per-project specialists
 */
export interface SpecialistConfig {
  /** Number of recent runs to include in context digest (default: 5) */
  context_runs?: number;
  /** Model to use for generating context digests (null = same as specialist) */
  digest_model?: string | null;
  /** Log retention policy */
  retention?: {
    /** Maximum days to keep logs */
    max_days: number;
    /** Maximum number of runs to keep (whichever is more permissive) */
    max_runs: number;
  };
  /** Per-specialist prompt overrides */
  prompts?: {
    'review-agent'?: string;
    'test-agent'?: string;
    'merge-agent'?: string;
  };
}

/**
 * Project configuration
 */
export interface ProjectConfig {
  name: string;
  path: string;
  /** Issue prefix for identifier construction (e.g., "PAN" → PAN-123) */
  issue_prefix?: string;
  github_repo?: string;  // e.g. "owner/repo"
  gitlab_repo?: string;  // e.g. "group/repo"
  /** Tracker type for this project. Affects ID parsing and state management. */
  tracker?: 'linear' | 'github' | 'gitlab' | 'rally';
  /**
   * Custom regex pattern for issue ID parsing. Must have two capture groups:
   * group 1 = prefix, group 2 = number. Example: "^(PROJ)-(\\d+)$"
   */
  issue_pattern?: string;
  /**
   * Multiple prefixes that map to this project.
   * For Rally: ['F', 'US', 'DE', 'TA'] — all artifact types route here.
   * For standard trackers: usually just one prefix via issue_prefix.
   */
  issue_prefixes?: string[];
  issue_routing?: IssueRoutingRule[];
  /** Workspace configuration */
  workspace?: WorkspaceConfig;
  /** Test configuration by name */
  tests?: Record<string, TestConfig>;
  /** Custom command to create workspaces (e.g., infra/new-feature for MYN) */
  workspace_command?: string;
  /** Custom command to remove workspaces */
  workspace_remove_command?: string;
  /** Rally project OID (e.g., "/project/822404704163") for per-project Rally scoping */
  rally_project?: string;
  /** Specialist agent configuration */
  specialists?: SpecialistConfig;
  /** Quality gates run by merge-agent before pushing (lint, typecheck, prod build, etc.) */
  quality_gates?: Record<string, QualityGateConfig>;
  /** Package manager for dependency installation in workspaces (bun, npm, pnpm) */
  package_manager?: 'bun' | 'npm' | 'pnpm';
  /** Local workspace packages that need building before quality gates (e.g., @panctl/contracts) */
  workspace_packages?: Array<{ path: string; build_command: string }>;
  /**
   * Path to the repo where per-project cost WAL files live.
   * Defaults to `path` (the project repo itself).
   * For polyrepo setups, point this at the docs/shared repo.
   */
  events_repo?: string;
  /**
   * Subdirectory within events_repo where cost JSONL files are stored.
   * Defaults to ".pan/events".
   */
  events_path?: string;
}

/** Resolve the issue prefix for a project. */
export function getIssuePrefix(config: ProjectConfig): string | undefined {
  return config.issue_prefix;
}

/**
 * Full projects configuration file
 */
export interface ProjectsConfig {
  projects: Record<string, ProjectConfig>;
}

/**
 * Resolved project info for workspace creation
 */
export interface ResolvedProject {
  projectKey: string;
  projectName: string;
  projectPath: string;
  linearTeam?: string;
}

/**
 * Load projects configuration from ~/.panopticon/projects.yaml
 */
export function loadProjectsConfig(): ProjectsConfig {
  if (!existsSync(PROJECTS_CONFIG_FILE)) {
    return { projects: {} };
  }

  try {
    const content = readFileSync(PROJECTS_CONFIG_FILE, 'utf-8');
    const config = parseYaml(content) as ProjectsConfig;
    return config || { projects: {} };
  } catch (error: any) {
    console.error(`Failed to parse projects.yaml: ${error.message}`);
    return { projects: {} };
  }
}

/**
 * Save projects configuration
 */
export function saveProjectsConfig(config: ProjectsConfig): void {
  const dir = PANOPTICON_HOME;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const yaml = stringifyYaml(config, { indent: 2 });
  writeFileSync(PROJECTS_CONFIG_FILE, yaml, 'utf-8');
}

/**
 * Get a list of all registered projects
 */
export function listProjects(): Array<{ key: string; config: ProjectConfig }> {
  const config = loadProjectsConfig();
  return Object.entries(config.projects).map(([key, projectConfig]) => ({
    key,
    config: projectConfig,
  }));
}

/**
 * Add or update a project in the registry
 */
export function registerProject(key: string, projectConfig: ProjectConfig): void {
  const config = loadProjectsConfig();
  config.projects[key] = projectConfig;
  saveProjectsConfig(config);
}

/**
 * Remove a project from the registry
 */
export function unregisterProject(key: string): boolean {
  const config = loadProjectsConfig();
  if (config.projects[key]) {
    delete config.projects[key];
    saveProjectsConfig(config);
    return true;
  }
  return false;
}

/**
 * Extract Linear team prefix from an issue ID.
 * Supports standard (MIN-123), Rally (F29698), and custom formats.
 * @deprecated Use extractPrefix from issue-id.ts for unified parsing
 */
export function extractTeamPrefix(issueId: string): string | null {
  return extractPrefix(issueId);
}

/**
 * Find project by Linear team prefix
 */
export function findProjectByTeam(teamPrefix: string): ProjectConfig | null {
  const config = loadProjectsConfig();

  for (const [, projectConfig] of Object.entries(config.projects)) {
    if (getIssuePrefix(projectConfig)?.toUpperCase() === teamPrefix.toUpperCase()) {
      return projectConfig;
    }
  }

  return null;
}

/**
 * Find project by workspace path.
 * Matches any project whose root path is an ancestor of the given path.
 * Used to resolve the tracker (GitHub/GitLab) from a workspace directory.
 */
export function findProjectByPath(workspacePath: string): ProjectConfig | null {
  const config = loadProjectsConfig();
  const normalizedTarget = resolve(workspacePath);

  for (const [, projectConfig] of Object.entries(config.projects)) {
    const normalizedProject = resolve(projectConfig.path);
    if (normalizedTarget === normalizedProject || normalizedTarget.startsWith(normalizedProject + '/')) {
      return projectConfig;
    }
  }

  return null;
}


/**
 * Resolve the correct project path for an issue based on labels
 *
 * @param project - The project config
 * @param labels - Array of label names from the Linear issue
 * @returns The resolved path (may differ from project.path based on routing rules)
 */
export function resolveProjectPath(project: ProjectConfig, labels: string[] = []): string {
  if (!project.issue_routing || project.issue_routing.length === 0) {
    return project.path;
  }

  // Normalize labels to lowercase for comparison
  const normalizedLabels = labels.map(l => l.toLowerCase());

  // First, check label-based routing rules
  for (const rule of project.issue_routing) {
    if (rule.labels && rule.labels.length > 0) {
      const ruleLabels = rule.labels.map(l => l.toLowerCase());
      const hasMatch = ruleLabels.some(label => normalizedLabels.includes(label));
      if (hasMatch) {
        return rule.path;
      }
    }
  }

  // Then, find default rule
  for (const rule of project.issue_routing) {
    if (rule.default) {
      return rule.path;
    }
  }

  // Fall back to project path
  return project.path;
}

/**
 * Resolve project from an issue ID (and optional labels)
 *
 * @param issueId - Issue ID in any supported format (e.g., "MIN-123", "F29698")
 * @param labels - Optional array of label names
 * @returns Resolved project info or null if not found
 */
export function resolveProjectFromIssue(
  issueId: string,
  labels: string[] = []
): ResolvedProject | null {
  const parsed = parseIssueId(issueId);
  if (!parsed) {
    return null;
  }

  const config = loadProjectsConfig();

  for (const [key, projectConfig] of Object.entries(config.projects)) {
    // Check single issue_prefix (existing behavior)
    const singlePrefix = getIssuePrefix(projectConfig);
    if (singlePrefix?.toUpperCase() === parsed.prefix) {
      const resolvedPath = resolveProjectPath(projectConfig, labels);
      return {
        projectKey: key,
        projectName: projectConfig.name,
        projectPath: resolvedPath,
        linearTeam: singlePrefix,
      };
    }

    // Check issue_prefixes array (new: multiple prefixes per project)
    if (projectConfig.issue_prefixes?.some(p => p.toUpperCase() === parsed.prefix)) {
      const resolvedPath = resolveProjectPath(projectConfig, labels);
      return {
        projectKey: key,
        projectName: projectConfig.name,
        projectPath: resolvedPath,
        linearTeam: projectConfig.issue_prefixes?.find(p => p.toUpperCase() === parsed.prefix),
      };
    }

    // Fallback: derive prefix from project key for projects without explicit prefixes
    if (!singlePrefix && !projectConfig.issue_prefixes) {
      const derivedPrefix = key.toUpperCase().replace(/-/g, '');
      if (derivedPrefix === parsed.prefix) {
        const resolvedPath = resolveProjectPath(projectConfig, labels);
        return {
          projectKey: key,
          projectName: projectConfig.name,
          projectPath: resolvedPath,
          linearTeam: undefined,
        };
      }
    }
  }

  return null;
}

/**
 * Get a project by key
 */
export function getProject(key: string): ProjectConfig | null {
  const config = loadProjectsConfig();
  return config.projects[key] || null;
}

/**
 * Check if projects.yaml exists and has any projects
 */
export function hasProjects(): boolean {
  const config = loadProjectsConfig();
  return Object.keys(config.projects).length > 0;
}

/**
 * Create a default projects.yaml with example structure
 */
export function createDefaultProjectsConfig(): ProjectsConfig {
  const defaultConfig: ProjectsConfig = {
    projects: {
      // Example project - commented out in actual file
    },
  };

  return defaultConfig;
}

/**
 * Initialize projects.yaml with example configuration
 */
export function initializeProjectsConfig(): void {
  if (existsSync(PROJECTS_CONFIG_FILE)) {
    console.log(`Projects config already exists at ${PROJECTS_CONFIG_FILE}`);
    return;
  }

  const exampleYaml = `# Panopticon Project Registry
# Maps Linear teams to project paths for workspace creation

projects:
  # Example: Mind Your Now project
  # myn:
  #   name: "Mind Your Now"
  #   path: /home/user/projects/myn
  #   linear_team: MIN
  #   issue_routing:
  #     # Route docs/marketing issues to docs repo
  #     - labels: [docs, marketing, seo, landing-pages]
  #       path: /home/user/projects/myn/docs
  #     # Default: main repo
  #     - default: true
  #       path: /home/user/projects/myn
  #   specialists:
  #     context_runs: 5
  #     digest_model: null  # Use same model as specialist
  #     retention:
  #       max_days: 30
  #       max_runs: 50
  #     prompts:
  #       review-agent: |
  #         Pay special attention to:
  #         - Database migration safety
  #         - API backward compatibility

  # Example: Panopticon itself
  # panopticon:
  #   name: "Panopticon"
  #   path: /home/user/projects/panopticon
  #   linear_team: PAN
`;

  const dir = PANOPTICON_HOME;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  writeFileSync(PROJECTS_CONFIG_FILE, exampleYaml, 'utf-8');
  console.log(`Created example projects config at ${PROJECTS_CONFIG_FILE}`);
}

/**
 * Default specialist configuration values
 */
const DEFAULT_SPECIALIST_CONFIG: Required<SpecialistConfig> = {
  context_runs: 5,
  digest_model: null,
  retention: {
    max_days: 30,
    max_runs: 50,
  },
  prompts: {},
};

/**
 * Get specialist configuration for a project with defaults
 *
 * @param projectKey - Project key
 * @returns Specialist config with defaults applied
 */
export function getSpecialistConfig(projectKey: string): Required<SpecialistConfig> {
  const project = getProject(projectKey);

  if (!project || !project.specialists) {
    return DEFAULT_SPECIALIST_CONFIG;
  }

  return {
    context_runs: project.specialists.context_runs ?? DEFAULT_SPECIALIST_CONFIG.context_runs,
    digest_model: project.specialists.digest_model ?? DEFAULT_SPECIALIST_CONFIG.digest_model,
    retention: {
      max_days: project.specialists.retention?.max_days ?? DEFAULT_SPECIALIST_CONFIG.retention.max_days,
      max_runs: project.specialists.retention?.max_runs ?? DEFAULT_SPECIALIST_CONFIG.retention.max_runs,
    },
    prompts: project.specialists.prompts ?? DEFAULT_SPECIALIST_CONFIG.prompts,
  };
}

/**
 * Get retention policy for a project's specialists
 *
 * @param projectKey - Project key
 * @returns Retention policy
 */
export function getSpecialistRetention(projectKey: string): { max_days: number; max_runs: number } {
  const config = getSpecialistConfig(projectKey);
  return config.retention;
}

/**
 * Find all projects that have a rally_project configured.
 * Returns array of { key, config } for projects with Rally project OIDs.
 */
export function findProjectsByRallyProject(): Array<{ key: string; config: ProjectConfig }> {
  const config = loadProjectsConfig();
  return Object.entries(config.projects)
    .filter(([, projectConfig]) => !!projectConfig.rally_project)
    .map(([key, projectConfig]) => ({ key, config: projectConfig }));
}

/**
 * Get custom prompt override for a specialist (if configured)
 *
 * @param projectKey - Project key
 * @param specialistType - Specialist type
 * @returns Custom prompt or null if not configured
 */
export function getSpecialistPromptOverride(
  projectKey: string,
  specialistType: string
): string | null {
  const config = getSpecialistConfig(projectKey);
  return (config.prompts as Record<string, string | undefined>)[specialistType] || null;
}
