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
  traefik?: {
    enabled: boolean;
    dashboard_port?: number;
    domain?: string;
  };
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
    port: 3001,
    api_port: 3002,
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
