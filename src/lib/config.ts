import { readFileSync, writeFileSync, existsSync } from 'fs';
import { parse, stringify } from '@iarna/toml';
import { CONFIG_FILE } from './paths.js';
import type { TrackerType } from './tracker/interface.js';

// Individual tracker configuration
export interface LinearConfig {
  type: 'linear';
  api_key_env?: string;  // Env var name for API key (default: LINEAR_API_KEY)
  team?: string;         // Default team prefix (e.g., 'MIN')
}

export interface GitHubConfig {
  type: 'github';
  token_env?: string;    // Env var name for token (default: GITHUB_TOKEN)
  owner: string;         // Repository owner
  repo: string;          // Repository name
}

export interface GitLabConfig {
  type: 'gitlab';
  token_env?: string;    // Env var name for token (default: GITLAB_TOKEN)
  project_id: string;    // GitLab project ID
}

export interface RallyConfig {
  type: 'rally';
  api_key_env?: string;  // Env var name for API key (default: RALLY_API_KEY)
  server?: string;       // Rally server URL (default: rally1.rallydev.com)
  workspace?: string;    // Rally workspace OID (e.g., "/workspace/12345")
  project?: string;      // Rally project OID (e.g., "/project/67890")
}

export type TrackerConfigItem = LinearConfig | GitHubConfig | GitLabConfig | RallyConfig;

export interface TrackersConfig {
  primary: TrackerType;
  secondary?: TrackerType;
  linear?: LinearConfig;
  github?: GitHubConfig;
  gitlab?: GitLabConfig;
  rally?: RallyConfig;
}

export interface RemoteExeConfig {
  /** Shared infrastructure VM for postgres/redis/traefik */
  infra_vm?: string;
  /** Postgres settings on infra VM */
  postgres_host?: string;
  postgres_port?: number;
  postgres_user?: string;
  postgres_password_env?: string;
  /** Redis settings on infra VM */
  redis_host?: string;
  redis_port?: number;
}

export interface RemoteConfig {
  /** Enable remote workspace support */
  enabled: boolean;
  /** Remote provider type */
  provider?: 'exe';
  /** Default location for new workspaces */
  default_location?: 'local' | 'remote';
  /** Auto-hibernate idle workspaces after N minutes (0 = disabled) */
  auto_hibernate_minutes?: number;
  /** exe.dev specific configuration */
  exe?: RemoteExeConfig;
}

export interface ShadowConfig {
  enabled: boolean;
  trackers: {
    linear: boolean;
    github: boolean;
    gitlab: boolean;
    rally: boolean;
  };
}

export interface PanopticonConfig {
  panopticon: {
    version: string;
  };
  sync: {
    targets: string[];  // 'claude', 'codex', 'cursor', 'gemini'
    backup_before_sync: boolean;
    auto_sync?: boolean;
    strategy?: 'symlink' | 'copy';
  };
  trackers: TrackersConfig;
  dashboard: {
    port: number;
    api_port: number;
  };
  traefik: {
    enabled: boolean;
    dashboard_port?: number;
    domain?: string;
    dns_sync_method?: 'wsl2hosts' | 'hosts_file' | 'dnsmasq';
  };
  remote?: RemoteConfig;
  shadow: ShadowConfig;
}

const DEFAULT_CONFIG: PanopticonConfig = {
  panopticon: {
    version: '1.0.0',
  },
  sync: {
    targets: ['claude'],
    backup_before_sync: true,
    auto_sync: false,
    strategy: 'symlink',
  },
  trackers: {
    primary: 'linear',
    linear: {
      type: 'linear',
      api_key_env: 'LINEAR_API_KEY',
    },
  },
  dashboard: {
    port: 3010,
    api_port: 3011,
  },
  traefik: {
    enabled: false,
    dashboard_port: 8080,
    domain: 'pan.localhost',
  },
  shadow: {
    enabled: false,
    trackers: {
      linear: false,
      github: false,
      gitlab: false,
      rally: false,
    },
  },
};

/**
 * Deep merge utility that recursively merges objects.
 * - Recursively merges nested objects
 * - Arrays in overrides replace defaults (not concatenated)
 * - User values take precedence over defaults
 */
function deepMerge<T extends object>(defaults: T, overrides: Partial<T>): T {
  const result = { ...defaults };

  for (const key of Object.keys(overrides) as (keyof T)[]) {
    const defaultVal = defaults[key];
    const overrideVal = overrides[key];

    // Skip undefined values in overrides
    if (overrideVal === undefined) continue;

    // Deep merge if both values are non-array objects
    if (
      typeof defaultVal === 'object' &&
      defaultVal !== null &&
      !Array.isArray(defaultVal) &&
      typeof overrideVal === 'object' &&
      overrideVal !== null &&
      !Array.isArray(overrideVal)
    ) {
      result[key] = deepMerge(defaultVal, overrideVal as any);
    } else {
      // For primitives, arrays, or null - override wins
      result[key] = overrideVal as T[keyof T];
    }
  }

  return result;
}

export function loadConfig(): PanopticonConfig {
  if (!existsSync(CONFIG_FILE)) {
    return DEFAULT_CONFIG;
  }

  try {
    const content = readFileSync(CONFIG_FILE, 'utf8');
    const parsed = parse(content) as unknown as Partial<PanopticonConfig>;
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch (error) {
    console.error('Warning: Failed to parse config, using defaults');
    return DEFAULT_CONFIG;
  }
}

export function saveConfig(config: PanopticonConfig): void {
  const content = stringify(config as any);
  writeFileSync(CONFIG_FILE, content, 'utf8');
}

export function getDefaultConfig(): PanopticonConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

/**
 * Get the dashboard API base URL from config.
 * Reads from DASHBOARD_URL env var first, then config file, then defaults.
 */
export function getDashboardApiUrl(): string {
  if (process.env.DASHBOARD_URL) return process.env.DASHBOARD_URL;
  const config = loadConfig();
  const port = config.dashboard?.api_port || 3011;
  return `http://localhost:${port}`;
}
