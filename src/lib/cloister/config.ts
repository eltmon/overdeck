/**
 * Cloister Configuration
 *
 * Loads and manages Cloister configuration from ~/.panopticon/cloister.toml
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { access, mkdir, readFile, writeFile } from 'fs/promises';
import { parse, stringify } from '@iarna/toml';
import { join } from 'path';
import { Effect } from 'effect';
import { ConfigError, FsError } from '../errors.js';
import { PANOPTICON_HOME } from '../paths.js';

const CLOISTER_CONFIG_FILE = join(PANOPTICON_HOME, 'cloister.toml');

/**
 * Health threshold configuration (in minutes)
 */
export interface HealthThresholds {
  stale: number;
  warning: number;
  stuck: number;
}

/**
 * Automatic action configuration
 */
export interface AutoActions {
  poke_on_warning: boolean;
  poke_on_stuck: boolean;   // Poke agents idle > stuck threshold (default: true)
  kill_on_stuck: boolean;
  restart_on_kill: boolean;
  /** Minimum ms between pokes for the same agent. Prevents spam on repeated health checks. Default: 30 min */
  poke_cooldown_ms: number;
}

/**
 * Monitoring configuration
 */
export interface MonitoringConfig {
  check_interval: number; // seconds between health checks
  heartbeat_sources: ('jsonl_mtime' | 'tmux_activity' | 'git_activity' | 'active_heartbeat')[];
  /** Patrol cycles between stash janitor sweeps. Default: hourly based on patrol cadence. */
  stash_janitor_every_cycles?: number;
}

/**
 * Startup configuration
 */
export interface StartupConfig {
  auto_start: boolean; // Start Cloister when dashboard starts
}

/**
 * Notification configuration (future feature)
 */
export interface NotificationConfig {
  slack_webhook?: string;
  email?: string;
}

/**
 * Specialist agent configuration
 */
export interface SpecialistConfig {
  enabled: boolean;
  auto_wake: boolean;
}

/**
 * Test agent specific configuration
 */
export interface TestAgentConfig extends SpecialistConfig {
  test_command?: string; // Optional test command override (e.g., "npm test", "pytest", etc.)
}

/**
 * Configuration for a single reviewer agent in the parallel review flow.
 */
export interface ReviewAgentConfig {
  /** Unique name / role identifier (e.g. 'correctness', 'security', 'performance') */
  name: string;
  /** Optional model override (e.g. 'claude-opus-4-6'). Falls back to work-type routing. */
  model?: string;
  /** Focus areas for this reviewer (informational, passed as context) */
  focus?: string[];
  /** Set to false to skip this reviewer. Defaults to true. */
  enabled?: boolean;
}

/**
 * All specialist agents configuration
 */
export interface SpecialistsConfig {
  merge_agent?: SpecialistConfig;
  review_agent?: SpecialistConfig;
  test_agent?: TestAgentConfig;
  inspect_agent?: SpecialistConfig;
  uat_agent?: SpecialistConfig;
  /** User-configurable list of parallel reviewer agents. Absent ⇒ 3 built-in defaults. */
  review_agents?: ReviewAgentConfig[];
}

/**
 * Model selection configuration
 */
export interface ModelSelectionConfig {
  default_model: 'opus' | 'sonnet' | 'haiku';
  complexity_routing: {
    trivial: 'opus' | 'sonnet' | 'haiku';
    simple: 'opus' | 'sonnet' | 'haiku';
    medium: 'opus' | 'sonnet' | 'haiku';
    complex: 'opus' | 'sonnet' | 'haiku';
    expert: 'opus' | 'sonnet' | 'haiku';
  };
  specialist_models: {
    merge_agent?: 'opus' | 'sonnet' | 'haiku';
    review_agent?: 'opus' | 'sonnet' | 'haiku';
    test_agent?: 'opus' | 'sonnet' | 'haiku';
    inspect_agent?: 'opus' | 'sonnet' | 'haiku';
    uat_agent?: 'opus' | 'sonnet' | 'haiku';
  };
  /**
   * PAN-636 — per-role coding-agent harness override. Defaults to
   * 'claude-code' for every role when unset. Absent keys are normal
   * (forward compat with config files written before harness existed).
   */
  specialist_harnesses?: {
    merge_agent?: 'claude-code' | 'pi';
    review_agent?: 'claude-code' | 'pi';
    test_agent?: 'claude-code' | 'pi';
    inspect_agent?: 'claude-code' | 'pi';
    uat_agent?: 'claude-code' | 'pi';
  };
}

/**
 * Handoff trigger configuration
 */
export interface HandoffTriggersConfig {
  stuck_escalation?: {
    enabled: boolean;
    haiku_to_sonnet_minutes: number;
    sonnet_to_opus_minutes: number;
  };
  test_failure?: {
    enabled: boolean;
    from_model: 'opus' | 'sonnet' | 'haiku';
    to_model: 'opus' | 'sonnet' | 'haiku';
    trigger_on: 'any_failure' | '2_consecutive';
  };
  implementation_complete?: {
    enabled: boolean;
    to_specialist: string; // e.g., 'test-agent'
  };
}

/**
 * Handoff configuration
 */
export interface HandoffConfig {
  auto_triggers: HandoffTriggersConfig;
}

/**
 * Cost tracking configuration
 */
export interface CostTrackingConfig {
  display_enabled: boolean;
  log_to_jsonl: boolean;
}

/**
 * Auto-restart configuration
 */
export interface AutoRestartConfig {
  enabled: boolean;
  max_retries: number;
  backoff_seconds: number[]; // Array of backoff delays (e.g., [30, 60, 120])
}

/**
 * Cost limits configuration
 */
export interface CostLimitsConfig {
  per_agent_usd: number;
  per_issue_usd: number;
  daily_total_usd: number;
  alert_threshold: number; // Fraction (0.0-1.0) at which to start alerting
}

/**
 * Retention policy configuration
 */
export interface RetentionConfig {
  /**
   * Days to keep work/planning agent state dirs after their session ends.
   * Default 7. Event-driven cleanup (postMergeLifecycle, executeCloseOut)
   * deletes state at the moment it becomes useless; this retention is only
   * a safety net for cases where those events didn't fire.
   */
  agent_state_days: number;
  /**
   * Days to keep reviewer state dirs (review-* prefix). Default 1.
   * runParallelReview Phase 6 deletes reviewer state immediately after the
   * review posts; this retention catches crashed-mid-cleanup edge cases.
   */
  reviewer_state_days?: number;
  health_staleness_hours: number; // Hours before hiding stale agents in health API (default: 24)
}

export interface CloseOutConfig {
  remove_workspace: boolean;
  delete_feature_branch: boolean;
  auto: boolean;
  auto_delay_minutes: number;
}

/**
 * Complete Cloister configuration
 */
export interface CloisterConfig {
  startup: StartupConfig;
  thresholds: HealthThresholds;
  auto_actions: AutoActions;
  monitoring: MonitoringConfig;
  notifications?: NotificationConfig;
  specialists?: SpecialistsConfig;
  model_selection?: ModelSelectionConfig;
  handoffs?: HandoffConfig;
  cost_tracking?: CostTrackingConfig;
  auto_restart?: AutoRestartConfig;
  cost_limits?: CostLimitsConfig;
  retention?: RetentionConfig;
  close_out?: CloseOutConfig;
}

/**
 * Default Cloister configuration
 */
export const DEFAULT_CLOISTER_CONFIG: CloisterConfig = {
  startup: {
    auto_start: true,
  },
  thresholds: {
    stale: 5,
    warning: 15,
    stuck: 30,
  },
  auto_actions: {
    poke_on_warning: true,
    poke_on_stuck: true,   // Poke agents that have been idle > stuck threshold
    kill_on_stuck: false,  // Manual by default for safety
    restart_on_kill: false,
    poke_cooldown_ms: 30 * 60 * 1000, // 30 min between pokes for the same agent
  },
  monitoring: {
    check_interval: 60, // 1 minute
    heartbeat_sources: ['jsonl_mtime', 'tmux_activity', 'git_activity'],
  },
  notifications: {
    slack_webhook: undefined,
    email: undefined,
  },
  specialists: {
    merge_agent: {
      enabled: true,
      auto_wake: false, // Only wake on explicit "Approve & Merge" click
    },
    review_agent: {
      enabled: true,
      auto_wake: false, // Woken by the verification pipeline, not ad hoc polling
    },
    test_agent: {
      enabled: true,
      auto_wake: true,
    },
    inspect_agent: {
      enabled: true,
      auto_wake: false, // Triggered explicitly per bead via pan inspect
    },
    uat_agent: {
      enabled: true,
      auto_wake: true,
    },
  },
  model_selection: {
    default_model: 'sonnet',
    complexity_routing: {
      trivial: 'haiku',
      simple: 'haiku',
      medium: 'sonnet',
      complex: 'sonnet',
      expert: 'opus',
    },
    specialist_models: {
      // PAN-754: no hardcoded defaults. User config.yaml role settings are authoritative.
      // Resolution falls through to role model config, then to the global fallback model.
    },
    specialist_harnesses: {
      // PAN-636: every role defaults to 'claude-code' when not overridden in
      // config.yaml. Reads through ModelRouter.getSpecialistHarness which
      // returns 'claude-code' for missing keys.
    },
  },
  handoffs: {
    auto_triggers: {
      stuck_escalation: {
        enabled: true,
        haiku_to_sonnet_minutes: 10,
        sonnet_to_opus_minutes: 20,
      },
      test_failure: {
        enabled: true,
        from_model: 'haiku',
        to_model: 'sonnet',
        trigger_on: 'any_failure',
      },
      implementation_complete: {
        enabled: true, // Auto-handoff to test-agent when implementation done
        to_specialist: 'test-agent',
      },
    },
  },
  cost_tracking: {
    display_enabled: true,
    log_to_jsonl: true,
  },
  auto_restart: {
    enabled: true,
    max_retries: 3,
    backoff_seconds: [30, 60, 120], // 30s, 1m, 2m
  },
  cost_limits: {
    per_agent_usd: 10.0,
    per_issue_usd: 25.0,
    daily_total_usd: 100.0,
    alert_threshold: 0.8, // Alert at 80%
  },
  retention: {
    agent_state_days: 7,
    reviewer_state_days: 1,
    health_staleness_hours: 24,
  },
  close_out: {
    remove_workspace: false,
    delete_feature_branch: false,
    auto: false,
    auto_delay_minutes: 60,
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
      result[key] = deepMerge(defaultVal as any, overrideVal as any);
    } else {
      // Direct override for primitives and arrays
      result[key] = overrideVal as T[keyof T];
    }
  }

  return result;
}

function applyEnvironmentOverrides(config: CloisterConfig): CloisterConfig {
  const stashJanitorEnv = process.env.PAN_STASH_JANITOR_CYCLES;
  if (stashJanitorEnv === undefined) return config;

  const parsed = Number.parseInt(stashJanitorEnv, 10);
  if (!Number.isFinite(parsed) || parsed < 0) return config;

  return {
    ...config,
    monitoring: {
      ...config.monitoring,
      stash_janitor_every_cycles: parsed,
    },
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load Cloister configuration
 *
 * Reads from ~/.panopticon/cloister.toml and merges with defaults.
 * Creates default config file if it doesn't exist.
 */
export function loadCloisterConfigSync(): CloisterConfig {
  // Ensure panopticon home exists
  if (!existsSync(PANOPTICON_HOME)) {
    mkdirSync(PANOPTICON_HOME, { recursive: true });
  }

  let config = DEFAULT_CLOISTER_CONFIG;

  // If config file doesn't exist, create it with defaults
  if (!existsSync(CLOISTER_CONFIG_FILE)) {
    saveCloisterConfigSync(DEFAULT_CLOISTER_CONFIG);
  } else {
    try {
      const content = readFileSync(CLOISTER_CONFIG_FILE, 'utf-8');
      const parsed = parse(content) as unknown as Partial<CloisterConfig>;

      // Deep merge with defaults
      config = deepMerge(DEFAULT_CLOISTER_CONFIG, parsed);
    } catch (error) {
      console.error('Failed to load Cloister config:', error);
      console.error('Using default configuration');
      config = DEFAULT_CLOISTER_CONFIG;
    }
  }

  return applyEnvironmentOverrides(config);
}

async function loadCloisterConfigPromise(): Promise<CloisterConfig> {
  await mkdir(PANOPTICON_HOME, { recursive: true });

  let config = DEFAULT_CLOISTER_CONFIG;

  if (!(await fileExists(CLOISTER_CONFIG_FILE))) {
    await saveCloisterConfigPromise(DEFAULT_CLOISTER_CONFIG);
  } else {
    try {
      const content = await readFile(CLOISTER_CONFIG_FILE, 'utf-8');
      const parsed = parse(content) as unknown as Partial<CloisterConfig>;
      config = deepMerge(DEFAULT_CLOISTER_CONFIG, parsed);
    } catch (error) {
      console.error('Failed to load Cloister config:', error);
      console.error('Using default configuration');
      config = DEFAULT_CLOISTER_CONFIG;
    }
  }

  return applyEnvironmentOverrides(config);
}

async function saveCloisterConfigPromise(config: CloisterConfig): Promise<void> {
  await mkdir(PANOPTICON_HOME, { recursive: true });

  try {
    const content = stringify(config as any);
    await writeFile(CLOISTER_CONFIG_FILE, content, 'utf-8');
  } catch (error) {
    console.error('Failed to save Cloister config:', error);
    throw error;
  }
}

/**
 * Save Cloister configuration
 *
 * Writes configuration to ~/.panopticon/cloister.toml
 */
export function saveCloisterConfigSync(config: CloisterConfig): void {
  // Ensure panopticon home exists
  if (!existsSync(PANOPTICON_HOME)) {
    mkdirSync(PANOPTICON_HOME, { recursive: true });
  }

  try {
    const content = stringify(config as any);
    writeFileSync(CLOISTER_CONFIG_FILE, content, 'utf-8');
  } catch (error) {
    console.error('Failed to save Cloister config:', error);
    throw error;
  }
}

/**
 * Update Cloister configuration
 *
 * Merges partial config updates with existing config.
 */
export function updateCloisterConfigSync(updates: Partial<CloisterConfig>): CloisterConfig {
  const current = loadCloisterConfigSync();
  const updated = deepMerge(current, updates);
  saveCloisterConfigSync(updated);
  return updated;
}

/**
 * Get the path to the Cloister config file
 */
export function getCloisterConfigPath(): string {
  return CLOISTER_CONFIG_FILE;
}

/**
 * Check if Cloister should auto-start
 */
export function shouldAutoStart(): boolean {
  const config = loadCloisterConfigSync();
  return config.startup.auto_start;
}

/**
 * Get health thresholds in milliseconds
 */
export function getHealthThresholdsMs(): {
  stale: number;
  warning: number;
  stuck: number;
} {
  const config = loadCloisterConfigSync();
  return {
    stale: config.thresholds.stale * 60 * 1000,
    warning: config.thresholds.warning * 60 * 1000,
    stuck: config.thresholds.stuck * 60 * 1000,
  };
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
//
// Additive Effect-channel variants of the config helpers above. The sync
// variants are preserved so existing callers (CLI scripts, top-level module
// initialization) do not have to migrate; new Effect-based callers can compose
// these directly without `Effect.runSync` round-tripping.

/** Effect variant of `loadCloisterConfig`. Falls back to defaults on read/parse failures. */
export const loadCloisterConfig = (): Effect.Effect<CloisterConfig, FsError | ConfigError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(PANOPTICON_HOME, { recursive: true }),
      catch: (cause) => new FsError({ path: PANOPTICON_HOME, operation: 'mkdir', cause }),
    });

    let config: CloisterConfig = DEFAULT_CLOISTER_CONFIG;

    if (!existsSync(CLOISTER_CONFIG_FILE)) {
      yield* saveCloisterConfig(DEFAULT_CLOISTER_CONFIG);
    } else {
      const content: string | null = yield* Effect.tryPromise({
        try: () => readFile(CLOISTER_CONFIG_FILE, 'utf-8'),
        catch: (cause) => new FsError({ path: CLOISTER_CONFIG_FILE, operation: 'readFile', cause }),
      }).pipe(
        Effect.catch((err: FsError) => {
          console.error('Failed to load Cloister config:', err);
          console.error('Using default configuration');
          return Effect.succeed<string | null>(null);
        }),
      );

      if (content !== null) {
        try {
          const parsed = parse(content) as unknown as Partial<CloisterConfig>;
          config = deepMerge(DEFAULT_CLOISTER_CONFIG, parsed);
        } catch (error) {
          console.error('Failed to parse Cloister config:', error);
          console.error('Using default configuration');
          config = DEFAULT_CLOISTER_CONFIG;
        }
      }
    }

    const stashJanitorEnv = process.env.PAN_STASH_JANITOR_CYCLES;
    if (stashJanitorEnv !== undefined) {
      const parsedEnv = Number.parseInt(stashJanitorEnv, 10);
      if (Number.isFinite(parsedEnv) && parsedEnv >= 0) {
        config = {
          ...config,
          monitoring: {
            ...config.monitoring,
            stash_janitor_every_cycles: parsedEnv,
          },
        };
      }
    }

    return config;
  });

/** Effect variant of `saveCloisterConfig`. */
export const saveCloisterConfig = (config: CloisterConfig): Effect.Effect<void, FsError | ConfigError> =>
  Effect.gen(function* () {
    yield* Effect.tryPromise({
      try: () => mkdir(PANOPTICON_HOME, { recursive: true }),
      catch: (cause) => new FsError({ path: PANOPTICON_HOME, operation: 'mkdir', cause }),
    });

    const content = yield* Effect.try({
      try: () => stringify(config as any),
      catch: (cause) => new ConfigError({ message: 'Failed to serialize Cloister config', cause }),
    });

    yield* Effect.tryPromise({
      try: () => writeFile(CLOISTER_CONFIG_FILE, content, 'utf-8'),
      catch: (cause) => new FsError({ path: CLOISTER_CONFIG_FILE, operation: 'writeFile', cause }),
    });
  });

/** Effect variant of `updateCloisterConfig`. */
export const updateCloisterConfig = (
  updates: Partial<CloisterConfig>,
): Effect.Effect<CloisterConfig, FsError | ConfigError> =>
  Effect.gen(function* () {
    const current = yield* loadCloisterConfig();
    const updated = deepMerge(current, updates);
    yield* saveCloisterConfig(updated);
    return updated;
  });
