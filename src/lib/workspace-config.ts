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
  /** Default branch to create feature branches from (default: 'main') */
  default_branch?: string;
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
export function getServiceFromTemplate(
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
