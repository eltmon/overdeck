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
  /** Forge for review artifacts and merge operations. */
  forge?: 'github' | 'gitlab';
  /** Legacy alias used in existing config for forge selection. */
  remote?: string;
  /** Branch prefix for feature branches (default: 'feature/') */
  branch_prefix?: string;
  /** Default branch to create feature branches from (default: 'main') */
  default_branch?: string;
  /** PR target branch for this repo (overrides workspace pr_target) */
  pr_target?: string;
  /** If true, agent should not commit to this repo */
  readonly?: boolean;
  /** How to include this repo in workspace: 'worktree' (default) or 'symlink' */
  link_type?: 'worktree' | 'symlink';
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
  /** Directories to copy from project template into workspace */
  copy_dirs?: string[];
  /** @deprecated Use copy_dirs instead */
  symlinks?: string[];
}

export interface EnvConfig {
  /** Environment variable template with placeholders */
  template?: string;
  /** Additional env vars from secrets */
  secrets_file?: string;
}

export interface ServiceConfig {
  /** Service name (e.g., 'api', 'frontend') */
  name: string;
  /** Path relative to workspace (e.g., 'api', 'fe') */
  path: string;
  /** Command to start the service natively (e.g., './run-dev.sh', 'pnpm start') */
  start_command: string;
  /** Command to start inside Docker container (if different) */
  docker_command?: string;
  /** Health check URL pattern (supports placeholders) */
  health_url?: string;
  /** Port the service runs on */
  port?: number;
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

export interface QualityGateConfig {
  /** Command to run (e.g., 'pnpm lint', 'pnpm typecheck') */
  command: string;
  /** Path relative to workspace (e.g., 'frontend' for polyrepo) */
  path?: string;
  /** If true, merge is blocked on failure (default: true) */
  required?: boolean;
  /** Additional environment variables */
  env?: Record<string, string>;
  /** When to run: before push (default) or after push */
  phase?: 'pre_push' | 'post_push';
  /** Gate type: shell command (default) or HTTP health check */
  type?: 'command' | 'http_health';
  /** URL for http_health type */
  url?: string;
  /** Seconds to wait for deployment before checking (http_health only) */
  wait?: number;
  /** Expected HTTP status code (http_health only, default: 200) */
  expect_status?: number;
  /** Run command inside a Docker container (uses docker exec) */
  container?: boolean;
  /** Container name pattern (supports {{FEATURE_FOLDER}} etc.) */
  container_name?: string;
}

export interface DatabaseConfig {
  /** Path to seed file for database initialization */
  seed_file?: string;
  /** Command to run after loading seed (e.g., sanitization script) */
  seed_command?: string;
  /** Command to create snapshots from external source (e.g., kubectl exec pg_dump) */
  snapshot_command?: string;
  /** External database connection for direct access */
  external_db?: {
    host: string;
    port?: number;
    database: string;
    user?: string;
    /** Environment variable name containing password */
    password_env?: string;
  };
  /** Container name pattern (supports {{PROJECT}} placeholder) */
  container_name?: string;
  /** Migration tool configuration */
  migrations?: {
    type: 'flyway' | 'liquibase' | 'prisma' | 'typeorm' | 'custom';
    path?: string;
    command?: string;
  };
}

export interface TunnelHostname {
  /** Hostname pattern (supports {{FEATURE_FOLDER}} etc.) e.g., "api-{{FEATURE_FOLDER}}.mindyournow.com" */
  pattern: string;
  /** HTTP Host header for Traefik routing e.g., "api-{{FEATURE_FOLDER}}.myn.localhost" */
  http_host_header?: string;
  /** Skip TLS verification for local dev (default: true) */
  no_tls_verify?: boolean;
}

export interface TunnelConfig {
  /** Tunnel provider (currently only Cloudflare) */
  provider: 'cloudflare';
  /** Cloudflare tunnel ID */
  tunnel_id: string;
  /** Cloudflare account ID */
  account_id: string;
  /** Cloudflare zone ID */
  zone_id: string;
  /** Path to credentials file (cert.pem) containing API token */
  credentials_file: string;
  /** Service target for ingress rules (e.g., "https://localhost") */
  service_target: string;
  /** Hostnames to create ingress rules + DNS records for */
  hostnames: TunnelHostname[];
}

export interface HumeConfig {
  /** Env var name containing the Hume API key (default: HUME_API_KEY) */
  api_key_env?: string;
  /** Config ID of the production/template config to clone from */
  template_config_id: string;
  /** Config name pattern for workspaces (supports placeholders) */
  name_pattern: string;
  /** BYOLLM callback URL pattern (supports placeholders) */
  byollm_url_pattern: string;
}

export interface WorkspaceConfig {
  /** Workspace type: 'polyrepo' (multiple git repos) or 'monorepo' (single repo, default) */
  type?: 'polyrepo' | 'monorepo';
  /** Where to create workspaces (relative to project path) */
  workspaces_dir?: string;
  /** Default branch for all repos (default: 'main'). Can be overridden per-repo. */
  default_branch?: string;
  /** Git repositories to include (for polyrepo) */
  repos?: RepoConfig[];
  /** DNS configuration */
  dns?: DnsConfig;
  /** Port assignments for services */
  ports?: Record<string, PortConfig>;
  /** Docker configuration */
  docker?: DockerConfig;
  /** Database seeding configuration */
  database?: DatabaseConfig;
  /** Agent configuration templates */
  agent?: AgentTemplateConfig;
  /** Environment variables */
  env?: EnvConfig;
  /** Service definitions for startup commands */
  services?: ServiceConfig[];
  /** Cloudflare tunnel configuration for external access */
  tunnel?: TunnelConfig;
  /** Hume EVI config management for workspace lifecycle */
  hume?: HumeConfig;
  /** PRD directory path (relative to project path, default: 'docs/prds') */
  prdDir?: string;
  /** When true, only always_include repos are created on workspace init (progressive mode) */
  progressive?: boolean;
  /** Repo names to always include in progressive workspaces (typically meta/docs repos) */
  always_include?: string[];
  /** Path (relative to project root) to repo-groups.yaml for named repo groups */
  groups_file?: string;
  /** Default PR target branch for all repos (e.g., 'qa') */
  pr_target?: string;
}

export interface TestsConfig {
  [name: string]: TestConfig;
}

export interface ProjectConfig {
  name: string;
  path: string;
  /** Issue prefix for identifier construction (e.g., "PAN" → PAN-123) */
  issue_prefix?: string;
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

  /** Package manager for dependency installation in workspaces (bun, npm, pnpm) */
  package_manager?: 'bun' | 'npm' | 'pnpm';
  /** Local workspace packages that need building before quality gates */
  workspace_packages?: Array<{ path: string; build_command: string }>;
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
  PROJECT_PATH: string;      // e.g., '/home/user/Projects/myn'
  PROJECTS_DIR: string;      // e.g., '/home/user/Projects' (parent of PROJECT_PATH)
  WORKSPACE_PATH: string;    // e.g., '/home/user/Projects/myn/workspaces/feature-min-123'
  HOME?: string;             // e.g., '/home/user' (for docker-compose path sanitization)
}

/**
 * Replace template placeholders in a string
 */
export function replacePlaceholdersSync(template: string, placeholders: TemplatePlaceholders): string {
  let result = template;
  for (const [key, value] of Object.entries(placeholders)) {
    result = result.replace(new RegExp(`\\{\\{${key}\\}\\}`, 'g'), value);
  }
  return result;
}

/**
 * Get default workspace config for a monorepo project
 */
export function getDefaultWorkspaceConfigSync(): WorkspaceConfig {
  return {
    type: 'monorepo',
    workspaces_dir: 'workspaces',
  };
}

/**
 * Service templates for common project types
 * These provide sensible defaults that can be overridden
 */
export const SERVICE_TEMPLATES: Record<string, Partial<ServiceConfig>> = {
  // Frontend frameworks
  'react': {
    start_command: 'npm start',
    docker_command: 'npm start',
    port: 3000,
  },
  'react-vite': {
    start_command: 'npm run dev',
    docker_command: 'npm run dev',
    port: 5173,
  },
  'react-pnpm': {
    start_command: 'pnpm start',
    docker_command: 'pnpm start',
    port: 3000,
  },
  'nextjs': {
    start_command: 'npm run dev',
    docker_command: 'npm run dev',
    port: 3000,
  },
  'vue': {
    start_command: 'npm run dev',
    docker_command: 'npm run dev',
    port: 5173,
  },
  'angular': {
    start_command: 'ng serve',
    docker_command: 'ng serve',
    port: 4200,
  },

  // Backend frameworks
  'spring-boot-maven': {
    start_command: './mvnw spring-boot:run',
    docker_command: './mvnw spring-boot:run',
    port: 8080,
  },
  'spring-boot-gradle': {
    start_command: './gradlew bootRun',
    docker_command: './gradlew bootRun',
    port: 8080,
  },
  'express': {
    start_command: 'npm start',
    docker_command: 'npm start',
    port: 3000,
  },
  'fastapi': {
    start_command: 'uvicorn main:app --reload',
    docker_command: 'uvicorn main:app --host 0.0.0.0 --reload',
    port: 8000,
  },
  'django': {
    start_command: 'python manage.py runserver',
    docker_command: 'python manage.py runserver 0.0.0.0:8000',
    port: 8000,
  },
  'rails': {
    start_command: 'rails server',
    docker_command: 'rails server -b 0.0.0.0',
    port: 3000,
  },
  'go': {
    start_command: 'go run .',
    docker_command: 'go run .',
    port: 8080,
  },
  'rust-cargo': {
    start_command: 'cargo run',
    docker_command: 'cargo run',
    port: 8080,
  },
};

/**
 * Get service config from template with overrides
 */
export function getServiceFromTemplateSync(
  templateName: string,
  overrides: Partial<ServiceConfig>
): ServiceConfig {
  const template = SERVICE_TEMPLATES[templateName] || {};
  return {
    name: overrides.name || templateName,
    path: overrides.path || '.',
    start_command: overrides.start_command || template.start_command || 'npm start',
    docker_command: overrides.docker_command || template.docker_command,
    health_url: overrides.health_url,
    port: overrides.port || template.port,
  };
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Pure helpers; Effect wrappers exist solely so consumers can stay in Effect.

import { Effect } from 'effect';

/** Substitute {{KEY}} placeholders. Pure. */
export const replacePlaceholders = (
  template: string,
  placeholders: TemplatePlaceholders,
): Effect.Effect<string> => Effect.sync(() => replacePlaceholdersSync(template, placeholders));

/** Workspace defaults (ports, services, DNS). Pure. */
export const getDefaultWorkspaceConfig = (): Effect.Effect<WorkspaceConfig> =>
  Effect.sync(() => getDefaultWorkspaceConfigSync());

/** Merge a service template with overrides. Pure. */
export const getServiceFromTemplate = (
  templateName: string,
  overrides: Partial<ServiceConfig>,
): Effect.Effect<ServiceConfig> =>
  Effect.sync(() => getServiceFromTemplateSync(templateName, overrides));
