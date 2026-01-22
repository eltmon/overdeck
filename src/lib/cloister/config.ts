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
  kill_on_stuck: boolean;
  restart_on_kill: boolean;
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
 * All specialist agents configuration
 */
export interface SpecialistsConfig {
  merge_agent?: SpecialistConfig;
  review_agent?: SpecialistConfig;
  test_agent?: SpecialistConfig;
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
    merge_agent: 'opus' | 'sonnet' | 'haiku';
    review_agent: 'opus' | 'sonnet' | 'haiku';
    test_agent: 'opus' | 'sonnet' | 'haiku';
    planning_agent: 'opus' | 'sonnet' | 'haiku';
  };
}

/**
 * Handoff trigger configuration
 */
export interface HandoffTriggersConfig {
  planning_complete?: {
    enabled: boolean;
    from_model: 'opus' | 'sonnet' | 'haiku';
    to_model: 'opus' | 'sonnet' | 'haiku';
  };
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
    kill_on_stuck: false, // Manual by default for safety
    restart_on_kill: false,
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
      auto_wake: false, // Only wake on explicit request
    },
    test_agent: {
      enabled: false, // Not yet implemented
      auto_wake: false,
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
      merge_agent: 'sonnet',
      review_agent: 'sonnet',
      test_agent: 'haiku',
      planning_agent: 'opus',
    },
  },
  handoffs: {
    auto_triggers: {
      planning_complete: {
        enabled: true,
        from_model: 'opus',
        to_model: 'sonnet',
      },
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
