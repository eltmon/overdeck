import { Effect } from 'effect';
import { readFileSync, writeFileSync, existsSync } from 'fs';
import { promises as fs } from 'fs';
import { join, dirname, parse as parsePath } from 'path';
import { homedir } from 'os';
import { parse, stringify } from '@iarna/toml';
import { CONFIG_FILE } from './paths.js';
import type { TrackerType } from './tracker/interface.js';
import { FsError } from './errors.js';

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

export interface RemoteFlyConfig {
  /** Fly.io app name for workspace machines */
  app?: string;
  /** Fly.io org slug */
  org?: string;
  /** Default region (e.g. 'iad') */
  region?: string;
  /** Machine size (e.g. 'shared-cpu-2x') */
  vm_size?: string;
  /** Memory in MB */
  vm_memory?: number;
  /** Docker image for workspace machines */
  image?: string;
  /** Stop machine when agent is idle */
  auto_stop?: boolean;
  /** Seconds of inactivity before stop */
  auto_stop_timeout?: number;
  /** Env var name for API token (default: FLY_API_TOKEN) */
  api_token_env?: string;
}

export interface RemoteConfig {
  /** Enable remote workspace support */
  enabled: boolean;
  /** Remote provider type */
  provider?: 'fly';
  /** Default location for new workspaces */
  default_location?: 'local' | 'remote';
  /** Auto-hibernate idle workspaces after N minutes (0 = disabled) */
  auto_hibernate_minutes?: number;
  /** Fly.io specific configuration */
  fly?: RemoteFlyConfig;
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

/**
 * Permission mode for spawned Claude Code agents.
 *
 * - `auto` (default): pass `--permission-mode auto`. Uses Claude Code's built-in
 *   classifier to approve safe tool calls and block destructive ones (force pushes,
 *   exfiltration, `rm -rf`, etc.). Requires `skipAutoPermissionPrompt: true` in
 *   `~/.claude/settings.json` and a supporting Anthropic plan (Max/Team/Enterprise/API).
 * - `bypass`: pass `--dangerously-skip-permissions --permission-mode bypassPermissions`.
 *   The historical Panopticon behavior — fully autonomous, no approval prompts and no
 *   classifier. Use when running providers that reject the `auto` flag (some Bedrock/
 *   Vertex/Foundry setups) or when you genuinely want zero gating.
 *
 * Override precedence (highest first): PAN_YOLO env var → `--yolo` CLI flag → this config → 'auto'.
 *
 * The persisted setting lives in `~/.panopticon/config.yaml` under `claude.permissionMode`
 * (loaded by `config-yaml.ts` and surfaced through `loadConfig().config.claude`). The
 * type is exported here so other modules can reference it without pulling the whole
 * yaml-config layer.
 */
export type ClaudePermissionMode = 'bypass' | 'auto';

export interface ConversationsEnrichmentConfig {
  /** Model tier for quick (L1) enrichment. null = Haiku tier via model-fallback */
  quickModel: string | null;
  /** Model tier for deep (L2) enrichment. null = Sonnet tier via model-fallback */
  deepModel: string | null;
  /** Max concurrent enrichment workers */
  maxParallel: number;
  /** USD threshold: prompt user before spending more than this */
  costConfirmThreshold: number;
}

export interface ConversationsConfig {
  /** Directories to scan in --watched mode (default: ['~/Projects']) */
  watchDirs: string[];
  /** Max parallel scanner workers. null = auto from SystemCapabilities probe */
  scanMaxParallel: number | null;
  /** Enable vector embedding storage and semantic search (opt-in) */
  embeddings: boolean;
  /** Embedding provider: openai | voyage | ollama */
  embeddingProvider: 'openai' | 'voyage' | 'ollama';
  /** Embedding model name */
  embeddingModel: string;
  /** Automatically embed sessions after deep (L2+) enrichment */
  embeddingAutoOnDeep: boolean;
  enrichment: ConversationsEnrichmentConfig;
}

export interface PanopticonConfig {
  panopticon: {
    version: string;
  };
  sync: {
    backup_before_sync: boolean;
    auto_sync?: boolean;
    strategy?: 'symlink' | 'copy';
    /**
     * @deprecated PAN-1201 — the layered context model replaces devroot.
     * `pan sync` no longer distributes anything via `<devroot>/.claude/`;
     * a non-null value here only triggers a migration warning. Run
     * `pan context migrate`, then set this to null to silence it. The field
     * is removed in a future major.
     */
    devroot?: string | null;
  };
  /** Layered context distribution (PAN-1201). All layers default to on. */
  context?: {
    layers?: { global?: boolean; project?: boolean; workspace?: boolean };
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
  conversations?: ConversationsConfig;
}

const DEFAULT_CONFIG: PanopticonConfig = {
  panopticon: {
    version: '1.0.0',
  },
  sync: {
    backup_before_sync: true,
    auto_sync: false,
    strategy: 'symlink',
    // PAN-1201: devroot is deprecated; default off so fresh installs use the
    // layered context model and never see the migration warning.
    devroot: null,
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
  conversations: {
    watchDirs: ['~/Projects'],
    scanMaxParallel: null,
    embeddings: false,
    embeddingProvider: 'openai',
    embeddingModel: 'text-embedding-3-small',
    embeddingAutoOnDeep: true,
    enrichment: {
      quickModel: null,
      deepModel: null,
      maxParallel: 4,
      costConfirmThreshold: 1.00,
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

export function loadConfigSync(): PanopticonConfig {
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

export function saveConfigSync(config: PanopticonConfig): void {
  const content = stringify(config as any);
  writeFileSync(CONFIG_FILE, content, 'utf8');
}

async function loadConfigPromise(): Promise<PanopticonConfig> {
  try {
    const content = await fs.readFile(CONFIG_FILE, 'utf8');
    const parsed = parse(content) as unknown as Partial<PanopticonConfig>;
    return deepMerge(DEFAULT_CONFIG, parsed);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return DEFAULT_CONFIG;
    }
    console.error('Warning: Failed to parse config, using defaults');
    return DEFAULT_CONFIG;
  }
}

async function saveConfigPromise(config: PanopticonConfig): Promise<void> {
  const content = stringify(config as any);
  await fs.writeFile(CONFIG_FILE, content, 'utf8');
}

export function getDefaultConfigSync(): PanopticonConfig {
  return JSON.parse(JSON.stringify(DEFAULT_CONFIG));
}

/**
 * Get the dashboard API base URL from config.
 * Reads from DASHBOARD_URL env var first, then config file, then defaults.
 */
export function getDashboardApiUrlSync(): string {
  if (process.env.DASHBOARD_URL) return process.env.DASHBOARD_URL;
  const config = loadConfigSync();
  const port = config.dashboard?.api_port || 3011;
  return `http://localhost:${port}`;
}

/**
 * Get the resolved devroot path from config.
 * Returns null if devroot is disabled (set to null or empty string).
 * Resolves ~ to home directory and validates the directory exists.
 */
export function getDevrootPathSync(): string | null {
  const config = loadConfigSync();
  const devroot = config.sync?.devroot;

  if (!devroot) return null;

  // Resolve ~ to home directory
  const resolved = devroot.startsWith('~/')
    ? join(homedir(), devroot.slice(2))
    : devroot;

  if (!existsSync(resolved)) return null;

  return resolved;
}

/**
 * Build the deprecation warning for a still-configured `sync.devroot`
 * (PAN-1201), or null when devroot is unset. `pan sync` prints this once per
 * run so users with the old default migrate to the layered context model.
 */
export function checkDevrootDeprecation(): string | null {
  const devroot = loadConfigSync().sync?.devroot;
  if (!devroot) return null;
  const oldLocation = `${devroot.replace(/\/+$/, '')}/.claude/`;
  return [
    '[WARN] sync.devroot is deprecated — the layered context model has replaced it.',
    '       Run `pan context migrate` to move your content across.',
    `       Old location: ${oldLocation}`,
    '       New location: ~/.panopticon/context/global/',
    '       Set sync.devroot to null in config to silence this warning after migrating.',
  ].join('\n');
}

/**
 * Find the devroot for a given project path.
 * Tries config first, then walks up from projectPath looking for .claude/ directory.
 * Returns the project path itself as last resort.
 */
export function findDevrootForProjectSync(projectPath: string): string {
  // 1. Explicit config takes priority
  const configured = getDevrootPathSync();
  if (configured) return configured;

  // 2. Walk up from project path to find nearest .claude/ directory
  let dir = projectPath;
  const root = parsePath(dir).root;
  while (dir !== root && dir !== homedir()) {
    const parent = dirname(dir);
    if (parent === dir) break;
    if (existsSync(join(parent, '.claude'))) {
      return parent;
    }
    dir = parent;
  }

  // 3. Fallback to project path itself
  return projectPath;
}

/**
 * Get the conversations config block, with defaults merged in.
 * Resolves watchDirs ~ to home directory.
 */
function resolveConversationsConfig(config: PanopticonConfig): ConversationsConfig {
  const conv = config.conversations ?? (DEFAULT_CONFIG.conversations as ConversationsConfig);
  return {
    ...conv,
    watchDirs: conv.watchDirs.map((d) =>
      d.startsWith('~/') ? join(homedir(), d.slice(2)) : d,
    ),
  };
}

export function getConversationsConfigSync(): ConversationsConfig {
  return resolveConversationsConfig(loadConfigSync());
}

async function getConversationsConfigPromise(): Promise<ConversationsConfig> {
  return resolveConversationsConfig(await loadConfigPromise());
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Both sync and async config IO surfaces get Effect variants. The async paths
// (preferred in dashboard-reachable code) wrap the existing Promise functions
// via Effect.tryPromise; the sync paths route through Effect.try.

/** Load config.toml (async; dashboard-safe). */
export const loadConfig = (): Effect.Effect<PanopticonConfig, FsError> =>
  Effect.tryPromise({
    try: () => loadConfigPromise(),
    catch: (cause) =>
      new FsError({ path: CONFIG_FILE, operation: 'load-config-async', cause }),
  });

/** Persist config.toml (async; dashboard-safe). */
export const saveConfig = (
  config: PanopticonConfig,
): Effect.Effect<void, FsError> =>
  Effect.tryPromise({
    try: () => saveConfigPromise(config),
    catch: (cause) =>
      new FsError({ path: CONFIG_FILE, operation: 'save-config-async', cause }),
  });

/** Default config template. Pure. */
export const getDefaultConfig = (): Effect.Effect<PanopticonConfig> =>
  Effect.sync(() => getDefaultConfigSync());

/** Compute the dashboard's external API URL. Pure (reads env). */
export const getDashboardApiUrl = (): Effect.Effect<string> =>
  Effect.sync(() => getDashboardApiUrlSync());

/** Resolve the configured devroot path. Pure (reads config). */
export const getDevrootPath = (): Effect.Effect<string | null> =>
  Effect.sync(() => getDevrootPathSync());

/** Compute the devroot for a project path. Pure. */
export const findDevrootForProject = (
  projectPath: string,
): Effect.Effect<string> => Effect.sync(() => findDevrootForProjectSync(projectPath));

/** Resolve conversations sub-config (async). */
export const getConversationsConfig =
  (): Effect.Effect<ConversationsConfig, FsError> =>
    Effect.tryPromise({
      try: () => getConversationsConfigPromise(),
      catch: (cause) =>
        new FsError({
          path: CONFIG_FILE,
          operation: 'get-conversations-config-async',
          cause,
        }),
    });
