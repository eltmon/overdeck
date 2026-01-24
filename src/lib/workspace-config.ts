/**
 * Workspace Configuration Types
 *
 * Defines the schema for project workspace configuration in projects.yaml
 */

export interface RepoConfig {
  /** Name of the repo in the workspace (e.g., 'fe', 'api') */
  name: string;
  /** Path to source repo relative to project root */
  path: string;
  /** Branch prefix for feature branches (default: 'feature/') */
  branch_prefix?: string;
}

export interface DnsConfig {
  /** Base domain (e.g., 'myn.test') */
  domain: string;
  /**
   * DNS entry patterns. Supports placeholders:
   * - {{FEATURE_FOLDER}}: e.g., 'feature-min-123'
   * - {{FEATURE_NAME}}: e.g., 'min-123'
   * - {{DOMAIN}}: the domain value
   */
  entries: string[];
  /** How to sync DNS: 'wsl2hosts' | 'hosts_file' | 'dnsmasq' */
  sync_method?: 'wsl2hosts' | 'hosts_file' | 'dnsmasq';
}

export interface PortConfig {
  /** Port range [start, end] */
  range: [number, number];
}

export interface DockerConfig {
  /** Path to Traefik compose file (relative to project root) */
  traefik?: string;
  /** Path to devcontainer template directory */
  compose_template?: string;
}

export interface AgentTemplateConfig {
  /** Path to agent template directory */
  template_dir: string;
  /** Files to process with placeholder replacement */
  templates?: Array<{
    source: string;
    target: string;
  }>;
  /** Directories to symlink (shared across workspaces) */
  symlinks?: string[];
}

export interface EnvConfig {
  /** Environment variable template with placeholders */
  template?: string;
  /** Additional env vars from secrets */
  secrets_file?: string;
}

export interface TestConfig {
  /** Test type: 'maven' | 'vitest' | 'playwright' | 'jest' | 'pytest' | 'cargo' */
  type: string;
  /** Path to test directory (relative to workspace) */
  path: string;
  /** Command to run tests */
  command: string;
  /** Run inside container for feature workspaces */
  container?: boolean;
  /** Container name pattern (uses {{FEATURE_FOLDER}}) */
  container_name?: string;
  /** Additional environment variables */
  env?: Record<string, string>;
}

export interface WorkspaceConfig {
  /** Workspace type: 'polyrepo' (multiple git repos) or 'monorepo' (single repo, default) */
  type?: 'polyrepo' | 'monorepo';
  /** Where to create workspaces (relative to project path) */
  workspaces_dir?: string;
  /** Git repositories to include (for polyrepo) */
  repos?: RepoConfig[];
  /** DNS configuration */
  dns?: DnsConfig;
  /** Port assignments for services */
  ports?: Record<string, PortConfig>;
  /** Docker configuration */
  docker?: DockerConfig;
  /** Agent configuration templates */
  agent?: AgentTemplateConfig;
  /** Environment variables */
  env?: EnvConfig;
}

export interface TestsConfig {
  [name: string]: TestConfig;
}

export interface ProjectConfig {
  name: string;
  path: string;
  linear_team?: string;
  github_repo?: string;
  gitlab_repo?: string;

  /** Workspace configuration */
  workspace?: WorkspaceConfig;

  /** Test configuration */
  tests?: TestsConfig;

  /** Issue routing rules */
  issue_routing?: Array<{
    labels?: string[];
    path: string;
    default?: boolean;
  }>;

  /** Legacy: custom workspace command (deprecated, use workspace config) */
  workspace_command?: string;
  workspace_remove_command?: string;
}

export interface ProjectsConfig {
  projects: Record<string, ProjectConfig>;
}

/**
 * Template placeholders that can be used in configuration
 */
export interface TemplatePlaceholders {
  FEATURE_NAME: string;      // e.g., 'min-123'
  FEATURE_FOLDER: string;    // e.g., 'feature-min-123'
  BRANCH_NAME: string;       // e.g., 'feature/min-123'
  COMPOSE_PROJECT: string;   // e.g., 'myn-feature-min-123'
  DOMAIN: string;            // e.g., 'myn.test'
  PROJECT_NAME: string;      // e.g., 'myn'
  PROJECT_PATH: string;      // e.g., '/home/user/projects/myn'
  WORKSPACE_PATH: string;    // e.g., '/home/user/projects/myn/workspaces/feature-min-123'
}

/**
 * Replace template placeholders in a string
 */
export function replacePlaceholders(template: string, placeholders: TemplatePlaceholders): string {
  let result = template;
  for (const [key, value] of Object.entries(placeholders)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Get default workspace config for a monorepo project
 */
export function getDefaultWorkspaceConfig(): WorkspaceConfig {
  return {
    type: 'monorepo',
    workspaces_dir: 'workspaces',
  };
}
