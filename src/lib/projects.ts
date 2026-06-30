/**
 * Project Registry - Multi-project support for Overdeck
 *
 * Maps Linear team prefixes and labels to project paths for workspace creation.
 */

import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'fs';
import { mkdir, readFile, stat, writeFile } from 'fs/promises';
import { join, resolve } from 'path';
import { parse as parseYaml, stringify as stringifyYaml } from 'yaml';
import { Effect } from 'effect';
import { ConfigError, ConfigParseError, FsError } from './errors.js';
import { OVERDECK_HOME } from './paths.js';
import { extractPrefixSync, parseIssueIdSync } from './issue-id.js';
import type { DatabaseConfig, QualityGateConfig, RepoConfig } from './workspace-config.js';
import type { AutoResumeConfig } from './cloister/auto-resume-config.js';

export const PROJECTS_CONFIG_FILE = join(OVERDECK_HOME, 'projects.yaml');

/**
 * Issue routing rule - routes issues with certain labels to specific paths
 */
export interface IssueRoutingRule {
  labels?: string[];
  default?: boolean;
  path: string;
}

/**
 * PAN-1908: where per-issue permanent records (vBRIEF continue + pipeline +
 * close-out + owner lease) are committed in git.
 */
export interface PanRecordsConfig {
  /** Repo name from workspace.repos[] (polyrepo) or "." (monorepo/default). */
  repo?: string;
  /** Subdirectory within the infra repo (default: ".pan"). */
  path?: string;
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
  database?: DatabaseConfig;
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

export interface SwarmConfig {
  /** File paths/globs that are intentionally high-churn and ignored for overlap scheduling. */
  hotspots?: string[];
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
  /** Per-project auto-resume failure tracking and backoff overrides */
  autoResume?: Partial<AutoResumeConfig>;
  /** Per-project foreman/swarm settings. */
  swarm?: SwarmConfig;
  /**
   * PAN-1695: per-project auto-merge default for issues with no explicit
   * per-issue setting. 'auto' = auto-merge when ready, 'hold' = hold for UAT.
   * Unset = fall through to the global require-UAT setting.
   */
  auto_merge_default?: 'auto' | 'hold';
  /** Quality gates run by merge-agent before pushing (lint, typecheck, prod build, etc.) */
  quality_gates?: Record<string, QualityGateConfig>;
  /** Package manager for dependency installation in workspaces (bun, npm, pnpm) */
  package_manager?: 'bun' | 'npm' | 'pnpm';
  /** Local workspace packages that need building before quality gates (e.g., @overdeck/contracts) */
  workspace_packages?: Array<{ path: string; build_command: string }>;
  /**
   * Directory name for vBRIEF lifecycle directories (proposed/active/completed/cancelled).
   * Defaults to "vbrief". Relative to the project root.
   */
  vbrief_dir?: string;
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
  /**
   * PAN-1908: infra-repo declaration for git-backed per-issue permanent records.
   * Defaults to the project repo itself (monorepo) when absent.
   */
  pan_records?: PanRecordsConfig;
}

/** Resolve the issue prefix for a project. */
export function getIssuePrefix(config: ProjectConfig): string | undefined {
  return config.issue_prefix;
}

export function getProjectSwarmHotspots(project: ProjectConfig | null | undefined): string[] {
  return Array.isArray(project?.swarm?.hotspots)
    ? project.swarm.hotspots.filter((hotspot): hotspot is string => typeof hotspot === 'string' && hotspot.length > 0)
    : [];
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

// Mtime-based cache: re-parse projects.yaml only when the file changes on disk.
// Without this cache, every call to resolveProjectFromIssue (enrichment service,
// deacon patrol, status updates — dozens of times per minute) re-read and re-parsed
// the YAML, consuming ~50% of the server's non-idle CPU and causing 1.5-second
// event loop stalls.
let _projectsCache: { mtime: number; config: ProjectsConfig } | null = null;

export function loadProjectsConfigSync(): ProjectsConfig {
  if (!existsSync(PROJECTS_CONFIG_FILE)) {
    return { projects: {} };
  }

  try {
    const mtime = statSync(PROJECTS_CONFIG_FILE).mtimeMs;
    if (_projectsCache && _projectsCache.mtime === mtime) {
      return _projectsCache.config;
    }
    const content = readFileSync(PROJECTS_CONFIG_FILE, 'utf-8');
    const config = (parseYaml(content) as ProjectsConfig) || { projects: {} };
    _projectsCache = { mtime, config };
    return config;
  } catch (error: any) {
    console.error(`Failed to parse projects.yaml: ${error.message}`);
    return { projects: {} };
  }
}

/**
 * Save projects configuration
 */
export function saveProjectsConfigSync(config: ProjectsConfig): void {
  const dir = OVERDECK_HOME;
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const yaml = stringifyYaml(config, { indent: 2 });
  writeFileSync(PROJECTS_CONFIG_FILE, yaml, 'utf-8');
  _projectsCache = null;
}

/**
 * Get a list of all registered projects
 */
export function listProjectsSync(): Array<{ key: string; config: ProjectConfig }> {
  const config = loadProjectsConfigSync();
  return Object.entries(config.projects).map(([key, projectConfig]) => ({
    key,
    config: projectConfig,
  }));
}

/**
 * Add or update a project in the registry
 */
export function registerProjectSync(key: string, projectConfig: ProjectConfig): void {
  const config = loadProjectsConfigSync();
  config.projects[key] = projectConfig;
  saveProjectsConfigSync(config);
}

/**
 * PAN-1695: set or clear a project's auto-merge default. `value === null`
 * removes the field so the project falls through to the global require-UAT
 * setting. Preserves all other project config.
 */
export function setProjectAutoMergeDefaultSync(key: string, value: 'auto' | 'hold' | null): void {
  const config = getProjectSync(key);
  if (!config) throw new Error(`Unknown project: ${key}`);
  const updated: ProjectConfig = { ...config };
  if (value === null) delete updated.auto_merge_default;
  else updated.auto_merge_default = value;
  registerProjectSync(key, updated);
}

/**
 * Remove a project from the registry
 */
export function unregisterProjectSync(key: string): boolean {
  const config = loadProjectsConfigSync();
  if (config.projects[key]) {
    delete config.projects[key];
    saveProjectsConfigSync(config);
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
  return extractPrefixSync(issueId);
}

/**
 * Find project by Linear team prefix
 */
export function findProjectByTeamSync(teamPrefix: string): ProjectConfig | null {
  if (!teamPrefix) return null;
  const config = loadProjectsConfigSync();

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
export function findProjectByPathSync(workspacePath: string): ProjectConfig | null {
  const config = loadProjectsConfigSync();
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
/**
 * PAN-1908: resolve the infra-repo checkout path and records subdir for a project.
 *
 * - monorepo / missing pan_records: repoPath = project.path, recordsPath = .pan
 * - polyrepo with pan_records.repo: look up named repo in workspace.repos[]
 * - pan_records.repo = ".": repoPath = project.path
 */
export function resolveInfraRepo(project: ProjectConfig): {
  repoPath: string;
  recordsPath: string;
} {
  const recordsPath = project.pan_records?.path ?? '.pan';
  const repoName = project.pan_records?.repo;

  if (!repoName || repoName === '.') {
    return { repoPath: project.path, recordsPath };
  }

  const repos = project.workspace?.repos ?? [];
  const matching = repos.find(r => r.name === repoName);
  if (!matching) {
    throw new Error(
      `Project pan_records.repo "${repoName}" not found in workspace.repos. ` +
      `Available repos: ${repos.map(r => r.name).join(', ') || 'none'}`
    );
  }

  return { repoPath: resolve(project.path, matching.path), recordsPath };
}

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
export function resolveProjectFromIssueSync(
  issueId: string,
  labels: string[] = []
): ResolvedProject | null {
  const parsed = parseIssueIdSync(issueId);
  if (!parsed) {
    return null;
  }

  const config = loadProjectsConfigSync();

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
export function getProjectSync(key: string): ProjectConfig | null {
  const config = loadProjectsConfigSync();
  return config.projects[key] || null;
}

/**
 * Check if projects.yaml exists and has any projects
 */
export function hasProjectsSync(): boolean {
  const config = loadProjectsConfigSync();
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
export function initializeProjectsConfigSync(): void {
  if (existsSync(PROJECTS_CONFIG_FILE)) {
    console.log(`Projects config already exists at ${PROJECTS_CONFIG_FILE}`);
    return;
  }

  const exampleYaml = `# Overdeck Project Registry
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
  #   quality_gates:
  #     typecheck:
  #       command: npm run typecheck
  #       required: true
  #     lint:
  #       command: npm run lint
  #       required: true
  #     test:
  #       # Keep per-change gates fast. Put e2e/Playwright in CI-only or @slow tiers.
  #       command: npx vitest run --changed {{CHANGED_BASE}}
  #       required: true

  # Example: Overdeck itself
  # overdeck:
  #   name: "Overdeck"
  #   path: /home/user/projects/overdeck
  #   linear_team: PAN
`;

  const dir = OVERDECK_HOME;
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
  const project = getProjectSync(projectKey);

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
  const config = loadProjectsConfigSync();
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

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect variant of {@link loadProjectsConfigSync}.
 *
 * Reuses the mtime-cache from the sync implementation but reads the YAML
 * asynchronously when a cache miss occurs. Parse failures surface as
 * `ConfigParseError` instead of being swallowed.
 */
export const loadProjectsConfig = (): Effect.Effect<ProjectsConfig, ConfigParseError | FsError> =>
  Effect.gen(function* () {
    const exists = yield* Effect.sync(() => existsSync(PROJECTS_CONFIG_FILE));
    if (!exists) return { projects: {} } as ProjectsConfig;

    const mtime = yield* Effect.tryPromise({
      try: async () => (await stat(PROJECTS_CONFIG_FILE)).mtimeMs,
      catch: (cause) =>
        new FsError({ path: PROJECTS_CONFIG_FILE, operation: 'stat', cause }),
    });
    if (_projectsCache && _projectsCache.mtime === mtime) {
      return _projectsCache.config;
    }
    const content = yield* Effect.tryPromise({
      try: () => readFile(PROJECTS_CONFIG_FILE, 'utf-8'),
      catch: (cause) =>
        new FsError({ path: PROJECTS_CONFIG_FILE, operation: 'readFile', cause }),
    });
    const config = yield* Effect.try({
      try: () => (parseYaml(content) as ProjectsConfig) || { projects: {} },
      catch: (cause) =>
        new ConfigParseError({
          path: PROJECTS_CONFIG_FILE,
          message: cause instanceof Error ? cause.message : String(cause),
          cause,
        }),
    });
    _projectsCache = { mtime, config };
    return config;
  });

/** Effect variant of {@link saveProjectsConfigSync}. */
export const saveProjectsConfig = (config: ProjectsConfig): Effect.Effect<void, FsError> =>
  Effect.tryPromise({
    try: async () => {
      const dir = OVERDECK_HOME;
      if (!existsSync(dir)) {
        await mkdir(dir, { recursive: true });
      }
      const out = stringifyYaml(config, { indent: 2 });
      await writeFile(PROJECTS_CONFIG_FILE, out, 'utf-8');
      _projectsCache = null;
    },
    catch: (cause) =>
      new FsError({ path: PROJECTS_CONFIG_FILE, operation: 'saveProjectsConfig', cause }),
  });

/** Effect variant of {@link listProjectsSync}. */
export const listProjects = (): Effect.Effect<Array<{ key: string; config: ProjectConfig }>, ConfigParseError | FsError> =>
  loadProjectsConfig().pipe(
    Effect.map((config) =>
      Object.entries(config.projects).map(([key, projectConfig]) => ({ key, config: projectConfig })),
    ),
  );

/** Effect variant of {@link registerProjectSync}. */
export const registerProject = (key: string, projectConfig: ProjectConfig): Effect.Effect<void, ConfigParseError | FsError> =>
  loadProjectsConfig().pipe(
    Effect.flatMap((config) => {
      config.projects[key] = projectConfig;
      return saveProjectsConfig(config);
    }),
  );

/** Effect variant of {@link unregisterProjectSync}. */
export const unregisterProject = (key: string): Effect.Effect<boolean, ConfigParseError | FsError> =>
  loadProjectsConfig().pipe(
    Effect.flatMap((config) => {
      if (!config.projects[key]) return Effect.succeed(false);
      delete config.projects[key];
      return saveProjectsConfig(config).pipe(Effect.as(true));
    }),
  );

/** Effect variant of {@link findProjectByTeamSync}. */
export const findProjectByTeam = (teamPrefix: string): Effect.Effect<ProjectConfig | null, ConfigParseError | FsError> =>
  loadProjectsConfig().pipe(
    Effect.map((config) => {
      for (const [, projectConfig] of Object.entries(config.projects)) {
        if (getIssuePrefix(projectConfig)?.toUpperCase() === teamPrefix.toUpperCase()) {
          return projectConfig;
        }
      }
      return null;
    }),
  );

/** Effect variant of {@link findProjectByPathSync}. */
export const findProjectByPath = (workspacePath: string): Effect.Effect<ProjectConfig | null, ConfigParseError | FsError> =>
  loadProjectsConfig().pipe(
    Effect.map((config) => {
      const normalizedTarget = resolve(workspacePath);
      for (const [, projectConfig] of Object.entries(config.projects)) {
        const normalizedProject = resolve(projectConfig.path);
        if (
          normalizedTarget === normalizedProject ||
          normalizedTarget.startsWith(normalizedProject + '/')
        ) {
          return projectConfig;
        }
      }
      return null;
    }),
  );

/** Effect variant of {@link resolveProjectFromIssueSync}. */
export const resolveProjectFromIssue = (
  issueId: string,
  labels: string[] = [],
): Effect.Effect<ResolvedProject | null, ConfigParseError | FsError> =>
  loadProjectsConfig().pipe(
    Effect.map((config) => {
      const parsed = parseIssueIdSync(issueId);
      if (!parsed) return null;
      for (const [key, projectConfig] of Object.entries(config.projects)) {
        const singlePrefix = getIssuePrefix(projectConfig);
        if (singlePrefix?.toUpperCase() === parsed.prefix) {
          return {
            projectKey: key,
            projectName: projectConfig.name,
            projectPath: resolveProjectPath(projectConfig, labels),
            linearTeam: singlePrefix,
          } satisfies ResolvedProject;
        }
        if (projectConfig.issue_prefixes?.some((p) => p.toUpperCase() === parsed.prefix)) {
          return {
            projectKey: key,
            projectName: projectConfig.name,
            projectPath: resolveProjectPath(projectConfig, labels),
            linearTeam: projectConfig.issue_prefixes?.find((p) => p.toUpperCase() === parsed.prefix),
          } satisfies ResolvedProject;
        }
        if (!singlePrefix && !projectConfig.issue_prefixes) {
          const derivedPrefix = key.toUpperCase().replace(/-/g, '');
          if (derivedPrefix === parsed.prefix) {
            return {
              projectKey: key,
              projectName: projectConfig.name,
              projectPath: resolveProjectPath(projectConfig, labels),
              linearTeam: undefined,
            } satisfies ResolvedProject;
          }
        }
      }
      return null;
    }),
  );

/** Effect variant of {@link getProjectSync}. */
export const getProject = (key: string): Effect.Effect<ProjectConfig | null, ConfigParseError | FsError> =>
  loadProjectsConfig().pipe(Effect.map((config) => config.projects[key] || null));

/** Effect variant of {@link hasProjectsSync}. */
export const hasProjects = (): Effect.Effect<boolean, ConfigParseError | FsError> =>
  loadProjectsConfig().pipe(Effect.map((config) => Object.keys(config.projects).length > 0));

/** Effect variant of {@link initializeProjectsConfigSync}. */
export const initializeProjectsConfig = (): Effect.Effect<void, FsError> =>
  Effect.try({
    try: () => initializeProjectsConfigSync(),
    catch: (cause) => new FsError({ path: PROJECTS_CONFIG_FILE, operation: 'initializeProjectsConfig', cause }),
  });
