/**
 * Cloister Configuration
 *
 * Loads and manages Cloister configuration from ~/.panopticon/cloister.toml
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'fs';
import { parse, stringify } from '@iarna/toml';
import { join } from 'path';
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
  agent_state_days: number; // Days to keep agent state dirs (default: 30)
  health_staleness_hours: number; // Hours before hiding stale agents in health API (default: 24)
}

/**
 * Flywheel autonomous daemon configuration (PAN-709)
 */
export interface FlywheelConfig {
  /** Enable autonomous flywheel daemon. Default: true */
  autonomous: boolean;
  /** Quiet hours: no non-blocker actions (format "HH:MM-HH:MM"). Default: "22:00-08:00" */
  quiet_hours: string;
  /** How often to run the synthesis step (minutes). Default: 30 */
  trigger_interval_minutes: number;
  /** How often to run a full flywheel cycle (hours). Default: 24 */
  full_cycle_interval_hours: number;
  /** Back off when user has an active Claude Code session. Default: true */
  backoff_on_active_session: boolean;
  /** Number of flywheel-change issues in Awaiting Merge before showing a dashboard banner. Default: 5 */
  awaiting_merge_notify_threshold: number;
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
  /** Autonomous flywheel daemon configuration (PAN-709) */
  flywheel?: FlywheelConfig;
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
      // PAN-754: no hardcoded defaults. User config.yaml overrides are authoritative.
      // Resolution falls through to work-type-router, then to the global fallback model.
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
    agent_state_days: 30,
    health_staleness_hours: 24,
  },
  flywheel: {
    autonomous: true,
    quiet_hours: '22:00-08:00',
    trigger_interval_minutes: 30,
    full_cycle_interval_hours: 24,
    backoff_on_active_session: true,
    awaiting_merge_notify_threshold: 5,
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

/**
 * Load Cloister configuration
 *
 * Reads from ~/.panopticon/cloister.toml and merges with defaults.
 * Creates default config file if it doesn't exist.
 */
export function loadCloisterConfig(): CloisterConfig {
  // Ensure panopticon home exists
  if (!existsSync(PANOPTICON_HOME)) {
    mkdirSync(PANOPTICON_HOME, { recursive: true });
  }

  // If config file doesn't exist, create it with defaults
  if (!existsSync(CLOISTER_CONFIG_FILE)) {
    saveCloisterConfig(DEFAULT_CLOISTER_CONFIG);
    return DEFAULT_CLOISTER_CONFIG;
  }

  try {
    const content = readFileSync(CLOISTER_CONFIG_FILE, 'utf-8');
    const parsed = parse(content) as unknown as Partial<CloisterConfig>;

    // Deep merge with defaults
    return deepMerge(DEFAULT_CLOISTER_CONFIG, parsed);
  } catch (error) {
    console.error('Failed to load Cloister config:', error);
    console.error('Using default configuration');
    return DEFAULT_CLOISTER_CONFIG;
  }
}

/**
 * Save Cloister configuration
 *
 * Writes configuration to ~/.panopticon/cloister.toml
 */
export function saveCloisterConfig(config: CloisterConfig): void {
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
export function updateCloisterConfig(updates: Partial<CloisterConfig>): CloisterConfig {
  const current = loadCloisterConfig();
  const updated = deepMerge(current, updates);
  saveCloisterConfig(updated);
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
  const config = loadCloisterConfig();
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
  const config = loadCloisterConfig();
  return {
    stale: config.thresholds.stale * 60 * 1000,
    warning: config.thresholds.warning * 60 * 1000,
    stuck: config.thresholds.stuck * 60 * 1000,
  };
}
