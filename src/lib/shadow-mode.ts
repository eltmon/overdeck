/**
 * Shadow Mode Resolution Module
 *
 * Determines whether shadow mode should be active based on configuration
 * hierarchy: CLI > Project > Global > Env > Default
 */

import { loadConfigSync } from './config-yaml.js';
import { getShadowModeFromEnv } from './env-loader.js';
import { isShadowed, getPendingSyncCount } from './shadow-state.js';
import type { TrackerType } from './tracker/interface.js';

/**
 * Options for resolving shadow mode
 */
export interface ShadowModeOptions {
  /** CLI flag --shadow / --no-shadow (highest priority) */
  cliFlag?: boolean;
  /** Issue ID for checking existing shadow state */
  issueId?: string;
  /** Tracker type for per-tracker configuration */
  trackerType?: TrackerType;
}

/**
 * Result of shadow mode resolution
 */
export interface ShadowModeResult {
  /** Whether shadow mode is enabled */
  enabled: boolean;
  /** The source of the decision (for debugging) */
  source: 'cli' | 'existing' | 'project' | 'global' | 'env' | 'default';
  /** Which tracker this applies to */
  trackerType?: TrackerType;
}

/** Resolve whether shadow mode applies for these options, and which source decided it. */
export async function resolveShadowMode(options: ShadowModeOptions = {}): Promise<ShadowModeResult> {
  const { cliFlag, issueId, trackerType } = options;

  // 1. CLI flag takes highest priority
  if (cliFlag !== undefined) {
    return {
      enabled: cliFlag,
      source: 'cli',
      trackerType,
    };
  }

  // 2. Check if issue already has shadow state
  if (issueId && (await isShadowed(issueId))) {
    return {
      enabled: true,
      source: 'existing',
      trackerType,
    };
  }

  // Load configuration (this merges project, global, and env settings)
  const { config } = loadConfigSync();

  // 3. Check per-project configuration (already merged into config.shadow)
  // 4. Check global configuration (already merged into config.shadow)

  // Determine base enabled state from config
  let enabled = config.shadow.enabled;
  let source: ShadowModeResult['source'] = config.shadow.enabled ? 'project' : 'default';

  // Check if it came from environment (config loader already applies env)
  if (process.env.SHADOW_MODE !== undefined) {
    source = 'env';
  }

  // 5. Apply per-tracker override if specified
  if (trackerType && config.shadow.trackers[trackerType] !== undefined) {
    enabled = config.shadow.trackers[trackerType];
    // If per-tracker is different from global, note that it's config-based
    if (enabled !== config.shadow.enabled) {
      source = 'project'; // Could be project or global, we use 'project' as a catch-all
    }
  }

  return {
    enabled,
    source,
    trackerType,
  };
}

/** Whether shadow mode is enabled for the given options. */
export async function isShadowModeEnabled(options: ShadowModeOptions = {}): Promise<boolean> {
  return (await resolveShadowMode(options)).enabled;
}

/** Whether a tracker update for `issueId` should be skipped because shadow mode applies. */
export async function shouldSkipTrackerUpdate(
  issueId: string,
  cliFlag?: boolean,
  trackerType: TrackerType = 'linear'
): Promise<boolean> {
  return (await isShadowModeEnabled({
    cliFlag,
    issueId,
    trackerType,
  }));
}

/**
 * Check if shadow mode is configured at the project level
 */
export function hasProjectShadowConfig(): boolean {
  const { config } = loadConfigSync();

  // Check if there's any project-specific shadow configuration
  // This is a heuristic - if shadow is enabled but not from env, it's likely project config
  if (config.shadow.enabled && process.env.SHADOW_MODE === undefined) {
    return true;
  }

  // Check if any per-tracker overrides are set
  return Object.values(config.shadow.trackers).some(v => v !== false);
}

/** Summarise shadow-mode configuration and the number of issues pending sync. */
export async function getShadowModeSummary(): Promise<{
  globalEnabled: boolean;
  perTracker: Record<TrackerType, boolean>;
  envSet: boolean;
  pendingSyncCount: number;
}> {
  const { config } = loadConfigSync();

  return {
    globalEnabled: config.shadow.enabled,
    perTracker: config.shadow.trackers,
    envSet: process.env.SHADOW_MODE !== undefined,
    pendingSyncCount: await getPendingSyncCount(),
  };
}
