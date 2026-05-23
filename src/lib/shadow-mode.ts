/**
 * Shadow Mode Resolution Module
 *
 * Determines whether shadow mode should be active based on configuration
 * hierarchy: CLI > Project > Global > Env > Default
 */

import { Data, Effect } from 'effect';
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
}async function resolveShadowModePromise(options: ShadowModeOptions = {}): Promise<ShadowModeResult> {
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
  if (issueId && (await Effect.runPromise(isShadowed(issueId)))) {
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
}async function isShadowModeEnabledPromise(options: ShadowModeOptions = {}): Promise<boolean> {
  return (await Effect.runPromise(resolveShadowMode(options))).enabled;
}async function shouldSkipTrackerUpdatePromise(
  issueId: string,
  cliFlag?: boolean,
  trackerType: TrackerType = 'linear'
): Promise<boolean> {
  return (await Effect.runPromise(isShadowModeEnabled({
    cliFlag,
    issueId,
    trackerType,
  })));
}async function getShadowModeStatusPromise(options: ShadowModeOptions = {}): Promise<string> {
  const result = await Effect.runPromise(resolveShadowMode(options));

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
  const { config } = loadConfigSync();

  // Check if there's any project-specific shadow configuration
  // This is a heuristic - if shadow is enabled but not from env, it's likely project config
  if (config.shadow.enabled && process.env.SHADOW_MODE === undefined) {
    return true;
  }

  // Check if any per-tracker overrides are set
  return Object.values(config.shadow.trackers).some(v => v !== false);
}async function getShadowModeSummaryPromise(): Promise<{
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
    pendingSyncCount: await Effect.runPromise(getPendingSyncCount()),
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
export const resolveShadowMode = (
  options: ShadowModeOptions = {},
): Effect.Effect<ShadowModeResult, ShadowModeError> =>
  Effect.tryPromise({
    try: () => resolveShadowModePromise(options),
    catch: (cause) =>
      new ShadowModeError({
        operation: 'resolveShadowMode',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `isShadowModeEnabled`. */
export const isShadowModeEnabled = (
  options: ShadowModeOptions = {},
): Effect.Effect<boolean, ShadowModeError> =>
  Effect.tryPromise({
    try: () => isShadowModeEnabledPromise(options),
    catch: (cause) =>
      new ShadowModeError({
        operation: 'isShadowModeEnabled',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `shouldSkipTrackerUpdate`. */
export const shouldSkipTrackerUpdate = (
  issueId: string,
  cliFlag?: boolean,
  trackerType: TrackerType = 'linear',
): Effect.Effect<boolean, ShadowModeError> =>
  Effect.tryPromise({
    try: () => shouldSkipTrackerUpdatePromise(issueId, cliFlag, trackerType),
    catch: (cause) =>
      new ShadowModeError({
        operation: 'shouldSkipTrackerUpdate',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getShadowModeStatus`. */
export const getShadowModeStatus = (
  options: ShadowModeOptions = {},
): Effect.Effect<string, ShadowModeError> =>
  Effect.tryPromise({
    try: () => getShadowModeStatusPromise(options),
    catch: (cause) =>
      new ShadowModeError({
        operation: 'getShadowModeStatus',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

/** Effect variant of `getShadowModeSummary`. */
export const getShadowModeSummary = (): Effect.Effect<
  Awaited<ReturnType<typeof getShadowModeSummaryPromise>>,
  ShadowModeError
> =>
  Effect.tryPromise({
    try: () => getShadowModeSummaryPromise(),
    catch: (cause) =>
      new ShadowModeError({
        operation: 'getShadowModeSummary',
        message: cause instanceof Error ? cause.message : String(cause),
        cause,
      }),
  });

