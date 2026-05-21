/**
 * Shadow Mode Resolution Module
 *
 * Determines whether shadow mode should be active based on configuration
 * hierarchy: CLI > Project > Global > Env > Default
 */

import { Data, Effect } from 'effect';
import { loadConfig } from './config-yaml.js';
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

/**
 * Resolve shadow mode configuration
 *
 * Priority (highest to lowest):
 * 1. CLI flag --shadow / --no-shadow
 * 2. Existing shadow state for the issue
 * 3. Per-project .pan.yaml shadow.enabled
 * 4. Global ~/.panopticon/config.yaml shadow.enabled
 * 5. Global ~/.panopticon.env SHADOW_MODE
 * 6. Default: false
 *
 * Per-tracker configuration is checked after the global setting.
 */
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
  const { config } = loadConfig();

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

/**
 * Simple boolean check for shadow mode
 * Convenience function that just returns whether shadow mode is enabled
 */
export async function isShadowModeEnabled(options: ShadowModeOptions = {}): Promise<boolean> {
  return (await resolveShadowMode(options)).enabled;
}

/**
 * Check if shadow mode should skip tracker updates
 *
 * This is the main function to use in commands that would normally
 * update the issue tracker. It considers all configuration sources.
 *
 * @example
 * ```typescript
 * if (shouldSkipTrackerUpdate('MIN-123', { cliFlag: options.shadow })) {
 *   // Skip the tracker update
 * } else {
 *   // Update the tracker as normal
 * }
 * ```
 */
export async function shouldSkipTrackerUpdate(
  issueId: string,
  cliFlag?: boolean,
  trackerType: TrackerType = 'linear'
): Promise<boolean> {
  return isShadowModeEnabled({
    cliFlag,
    issueId,
    trackerType,
  });
}

/**
 * Get shadow mode status message for display
 */
export async function getShadowModeStatus(options: ShadowModeOptions = {}): Promise<string> {
  const result = await resolveShadowMode(options);

  if (!result.enabled) {
    return 'Shadow mode: disabled';
  }

  const sourceLabels: Record<string, string> = {
    'cli': 'CLI flag',
    existing: 'existing shadow state',
    project: 'project config',
    global: 'global config',
    env: 'environment variable',
    default: 'default',
  };

  const trackerLabel = result.trackerType ? ` (${result.trackerType})` : '';
  return `Shadow mode: enabled (${sourceLabels[result.source]})${trackerLabel}`;
}

/**
 * Check if shadow mode is configured at the project level
 */
export function hasProjectShadowConfig(): boolean {
  const { config } = loadConfig();

  // Check if there's any project-specific shadow configuration
  // This is a heuristic - if shadow is enabled but not from env, it's likely project config
  if (config.shadow.enabled && process.env.SHADOW_MODE === undefined) {
    return true;
  }

  // Check if any per-tracker overrides are set
  return Object.values(config.shadow.trackers).some(v => v !== false);
}

/**
 * Get a summary of shadow mode configuration
 */
export async function getShadowModeSummary(): Promise<{
  globalEnabled: boolean;
  perTracker: Record<TrackerType, boolean>;
  envSet: boolean;
  pendingSyncCount: number;
}> {
  const { config } = loadConfig();

  return {
    globalEnabled: config.shadow.enabled,
    perTracker: config.shadow.trackers,
    envSet: process.env.SHADOW_MODE !== undefined,
    pendingSyncCount: await getPendingSyncCount(),
  };
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────

/** Tagged error for shadow-mode Effect variants. */
export class ShadowModeError extends Data.TaggedError('ShadowModeError')<{
  readonly operation: string;
  readonly message: string;
  readonly cause?: unknown;
}> {}

/** Effect variant of `resolveShadowMode`. */
export const resolveShadowModeEffect = (
  options: ShadowModeOptions = {},
): Effect.Effect<ShadowModeResult, ShadowModeError> =>
  Effect.tryPromise({
    try: () => resolveShadowMode(options),
    catch: (cause) =>
      new ShadowModeError({
        operation: 'resolveShadowMode',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `isShadowModeEnabled`. */
export const isShadowModeEnabledEffect = (
  options: ShadowModeOptions = {},
): Effect.Effect<boolean, ShadowModeError> =>
  Effect.tryPromise({
    try: () => isShadowModeEnabled(options),
    catch: (cause) =>
      new ShadowModeError({
        operation: 'isShadowModeEnabled',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `shouldSkipTrackerUpdate`. */
export const shouldSkipTrackerUpdateEffect = (
  issueId: string,
  cliFlag?: boolean,
  trackerType: TrackerType = 'linear',
): Effect.Effect<boolean, ShadowModeError> =>
  Effect.tryPromise({
    try: () => shouldSkipTrackerUpdate(issueId, cliFlag, trackerType),
    catch: (cause) =>
      new ShadowModeError({
        operation: 'shouldSkipTrackerUpdate',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getShadowModeStatus`. */
export const getShadowModeStatusEffect = (
  options: ShadowModeOptions = {},
): Effect.Effect<string, ShadowModeError> =>
  Effect.tryPromise({
    try: () => getShadowModeStatus(options),
    catch: (cause) =>
      new ShadowModeError({
        operation: 'getShadowModeStatus',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getShadowModeSummary`. */
export const getShadowModeSummaryEffect = (): Effect.Effect<
  Awaited<ReturnType<typeof getShadowModeSummary>>,
  ShadowModeError
> =>
  Effect.tryPromise({
    try: () => getShadowModeSummary(),
    catch: (cause) =>
      new ShadowModeError({
        operation: 'getShadowModeSummary',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

