import { Context, Effect, Layer, Schema } from 'effect';

import { getOverdeckDatabase } from './infra.js';
import { IssueId } from './issues.js';
import type { ProjectConfig as RawProjectConfig } from '../projects.js';
import { getProjectSync, loadProjectsConfigSync } from '../projects.js';

// ── Local Drizzle table definitions ─────────────────────────────────────────

// ── Schema entities ──────────────────────────────────────────────────────────

const FlywheelConfig = Schema.Struct({
  autoPickupBacklog: Schema.Boolean,      // flywheel.auto_pickup_backlog (app_settings)
  requireUatBeforeMerge: Schema.Boolean,  // flywheel.require_uat_before_merge — default TRUE
  mergeTrainEnabled: Schema.Boolean,      // merge_train.enabled (with fallback to flywheel.merge_train_enabled)
});
export type FlywheelConfig = typeof FlywheelConfig.Type;

const FlywheelConfigPatch = Schema.Struct({
  autoPickupBacklog: Schema.optional(Schema.Boolean),
  requireUatBeforeMerge: Schema.optional(Schema.Boolean),
  mergeTrainEnabled: Schema.optional(Schema.Boolean),
});
export type FlywheelConfigPatch = typeof FlywheelConfigPatch.Type;

const FlywheelRuntime = Schema.Struct({
  activeRunId: Schema.NullOr(Schema.String),  // flywheel.active_run_id (app_settings)
  paused: Schema.Boolean,                      // flywheel.globally_paused
});
export type FlywheelRuntime = typeof FlywheelRuntime.Type;

// PAN-3917 FR-1/FR-12: the `issue_policy` table is dropped at boot, and the
// per-issue policy it stored is derived now — `deaconIgnored` went with the
// review-status row, and auto-merge eligibility is read from the project config
// and the tracker labels (auto-merge-eligibility.ts). What survives is the
// global flywheel/deacon configuration above, which lives in app_settings.

export const ProjectKey = Schema.String.pipe(Schema.brand('ProjectKey'));
export type ProjectKey = typeof ProjectKey.Type;

export const ProjectConfig = Schema.Struct({
  key: ProjectKey,
  path: Schema.String,
  autoMergeDefault: Schema.NullOr(Schema.Literals(['auto', 'hold'])),
});
export type ProjectConfig = typeof ProjectConfig.Type;

export class ProjectNotFound extends Schema.TaggedErrorClass<ProjectNotFound>()(
  'ProjectNotFound',
  { key: ProjectKey },
) {}

// ── SettingsResolver — read door ─────────────────────────────────────────────

export class SettingsResolver extends Context.Service<
  SettingsResolver,
  {
    readonly isDeaconPaused: () => Effect.Effect<boolean>;
    readonly getFlywheelConfig: () => Effect.Effect<FlywheelConfig>;
    readonly getFlywheelRuntime: () => Effect.Effect<FlywheelRuntime>;
  }
>()('overdeck/SettingsResolver') {}

// ── SettingsWriter — write door (data verbs only) ────────────────────────────
//
// Runtime-control verbs (startFlywheel, pauseFlywheel, resumeFlywheel,
// abortFlywheel, emergencyStop, brake) delegate to AgentWriter which does not
// exist yet. They are deferred to workspace-lf582 (Build the Agents domain).
// The ACs for this bead cover only the data-persistence verbs below.

export class SettingsWriter extends Context.Service<
  SettingsWriter,
  {
    readonly setDeaconPaused: (paused: boolean) => Effect.Effect<void>;
    readonly setFlywheelConfig: (patch: FlywheelConfigPatch) => Effect.Effect<FlywheelConfig>;
  }
>()('overdeck/SettingsWriter') {}

// ── ConfigResolver — read-only file door (no Db, no writer) ─────────────────

function mapProjectConfig(raw: RawProjectConfig, key: string): ProjectConfig {
  return {
    key: key as ProjectKey,
    path: raw.path,
    autoMergeDefault: raw.auto_merge_default ?? null,
  };
}

export class ConfigResolver extends Context.Service<
  ConfigResolver,
  {
    readonly getProject: (key: ProjectKey) => Effect.Effect<ProjectConfig, ProjectNotFound>;
    readonly listProjects: () => Effect.Effect<ReadonlyArray<ProjectConfig>>;
  }
>()('overdeck/ConfigResolver') {}

export const ConfigResolverLive = Layer.succeed(
  ConfigResolver,
  ConfigResolver.of({
    getProject: (key) =>
      Effect.gen(function* () {
        const raw = yield* Effect.sync(() => getProjectSync(key));
        if (!raw) return yield* Effect.fail(new ProjectNotFound({ key }));
        return mapProjectConfig(raw, key);
      }),
    listProjects: () =>
      Effect.sync(() => {
        const config = loadProjectsConfigSync();
        return Object.entries(config.projects).map(([k, raw]) => mapProjectConfig(raw, k));
      }),
  }),
);

// ── Sync helpers (for call sites that cannot use Effect) ─────────────────────

function overdeckDb() {
  return getOverdeckDatabase();
}

const DEACON_GLOBAL_PAUSE_KEY = 'deacon.globally_paused';
const CLOISTER_SPAWNS_PAUSED_KEY = 'cloister.spawns_paused';
const FLYWHEEL_GLOBAL_PAUSE_KEY = 'flywheel.globally_paused';
const FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY = 'flywheel.auto_pickup_backlog';
const FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY = 'flywheel.require_uat_before_merge';
export const FLYWHEEL_MERGE_TRAIN_ENABLED_KEY = 'flywheel.merge_train_enabled';
const MERGE_TRAIN_ENABLED_KEY = 'merge_train.enabled';
export const DASHBOARD_LAST_CLEAN_SHUTDOWN_AT_KEY = 'dashboard.last_clean_shutdown_at';

/** Read a raw app_settings value synchronously. Returns null if not set. */
export function getSetting(key: string): string | null {
  const row = getOverdeckDatabase(undefined, { readOnly: true })
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(key) as { value: string } | undefined;
  return row ? row.value : null;
}

/** Write a raw app_settings value synchronously. */
export function setSetting(key: string, value: string): void {
  const now = new Date().toISOString();
  overdeckDb().prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = excluded.updated_at`,
  ).run(key, value, now);
}

export function setLastCleanShutdownAt(iso: string): void {
  setSetting(DASHBOARD_LAST_CLEAN_SHUTDOWN_AT_KEY, iso);
}

/** Synchronous check of the global Deacon pause flag; a failed read logs and reports not paused. */
export function isDeaconGloballyPaused(): boolean {
  try {
    return getSetting(DEACON_GLOBAL_PAUSE_KEY) === 'true';
  } catch (err) {
    console.warn('[control-settings] Failed to read deacon pause flag:', err);
    return false;
  }
}

/** Synchronous set of the global Deacon pause flag. */
export function setDeaconGloballyPaused(paused: boolean): void {
  setSetting(DEACON_GLOBAL_PAUSE_KEY, paused ? 'true' : 'false');
}

/** Synchronous check of the Cloister spawn pause flag. */
export function isCloisterSpawnsPaused(): boolean {
  try {
    return getSetting(CLOISTER_SPAWNS_PAUSED_KEY) === 'true';
  } catch (err) {
    console.warn('[control-settings] Failed to read Cloister spawn pause flag:', err);
    return false;
  }
}

/** Synchronous set of the Cloister spawn pause flag. */
export function setCloisterSpawnsPaused(paused: boolean): void {
  setSetting(CLOISTER_SPAWNS_PAUSED_KEY, paused ? 'true' : 'false');
}

/** Drop-in for isFlywheelGloballyPaused() from app-settings.ts. */
export function isFlywheelGloballyPaused(): boolean {
  return getSetting(FLYWHEEL_GLOBAL_PAUSE_KEY) === 'true';
}

/** Drop-in for setFlywheelGloballyPaused() from app-settings.ts. */
export function setFlywheelGloballyPaused(paused: boolean): void {
  setSetting(FLYWHEEL_GLOBAL_PAUSE_KEY, paused ? 'true' : 'false');
}

/** Drop-in for isFlywheelAutoPickupBacklog() from app-settings.ts. */
export function isFlywheelAutoPickupBacklog(): boolean {
  return getSetting(FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY) === 'true'; // defaults to false if unset
}

/** Drop-in for setFlywheelAutoPickupBacklog() from app-settings.ts. */
export function setFlywheelAutoPickupBacklog(enabled: boolean): void {
  setSetting(FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY, enabled ? 'true' : 'false');
}

/**
 * PAN-4653: settle an operator conversation when its linked pull requests
 * are all merged or closed (the PR sync sweep, on the open → merged/closed
 * transition). Default ON when unset. A per-conversation override
 * (`conversations.auto_settle_override`) wins; agent conversations never settle.
 */
export const CONVERSATIONS_AUTO_SETTLE_ON_MERGE_KEY = 'conversations.auto_settle_on_merge';

export function isConversationsAutoSettleOnMerge(): boolean {
  return getSetting(CONVERSATIONS_AUTO_SETTLE_ON_MERGE_KEY) !== 'false'; // defaults to true if unset
}

export function setConversationsAutoSettleOnMerge(enabled: boolean): void {
  setSetting(CONVERSATIONS_AUTO_SETTLE_ON_MERGE_KEY, enabled ? 'true' : 'false');
}

/**
 * PAN-4655: settle an operator conversation after this many days without
 * activity (the idle-settle sweep). Default 3; 0 turns it off.
 */
export const CONVERSATIONS_AUTO_SETTLE_IDLE_DAYS_KEY = 'conversations.auto_settle_idle_days';
export const DEFAULT_AUTO_SETTLE_IDLE_DAYS = 3;
export const MAX_AUTO_SETTLE_IDLE_DAYS = 365;

/** An integer 0..365 (number, or a string of digits), else null. */
export function parseAutoSettleIdleDays(value: unknown): number | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string' && /^\d+$/.test(value.trim())
        ? Number(value.trim())
        : NaN;
  return Number.isInteger(n) && n >= 0 && n <= MAX_AUTO_SETTLE_IDLE_DAYS ? n : null;
}

/** Unset → 3; an invalid stored value → 3 (warns); a failed read → 0 (off). */
export function getConversationsAutoSettleIdleDays(): number {
  let stored: string | null;
  try {
    stored = getSetting(CONVERSATIONS_AUTO_SETTLE_IDLE_DAYS_KEY);
  } catch (error) {
    console.warn(`[idle-settle] could not read ${CONVERSATIONS_AUTO_SETTLE_IDLE_DAYS_KEY}; treating it as off:`, error);
    return 0;
  }
  if (stored === null) return DEFAULT_AUTO_SETTLE_IDLE_DAYS;
  const days = parseAutoSettleIdleDays(stored);
  if (days === null) {
    console.warn(
      `[idle-settle] ${CONVERSATIONS_AUTO_SETTLE_IDLE_DAYS_KEY} has invalid value "${stored}"; using ${DEFAULT_AUTO_SETTLE_IDLE_DAYS}`,
    );
    return DEFAULT_AUTO_SETTLE_IDLE_DAYS;
  }
  return days;
}

/** Throws RangeError unless parseAutoSettleIdleDays(days) accepts it. */
export function setConversationsAutoSettleIdleDays(days: number): void {
  if (parseAutoSettleIdleDays(days) === null) {
    throw new RangeError(`auto-settle idle days must be a whole number from 0 to ${MAX_AUTO_SETTLE_IDLE_DAYS}, got ${days}`);
  }
  setSetting(CONVERSATIONS_AUTO_SETTLE_IDLE_DAYS_KEY, String(days));
}

/** Drop-in for isFlywheelRequireUatBeforeMerge() from app-settings.ts. */
export function isFlywheelRequireUatBeforeMerge(): boolean {
  const val = getSetting(FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY);
  return val !== 'false'; // defaults to true if unset
}

/** Drop-in for setFlywheelRequireUatBeforeMerge() from app-settings.ts. */
export function setFlywheelRequireUatBeforeMerge(enabled: boolean): void {
  setSetting(FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY, enabled ? 'true' : 'false');
}

/** Drop-in for isMergeTrainEnabled() from app-settings.ts. */
export function isMergeTrainEnabled(): boolean {
  const newKey = getSetting(MERGE_TRAIN_ENABLED_KEY);
  if (newKey !== null) {
    return newKey === 'true';
  }
  // Fall back to legacy key for backward compatibility
  return getSetting(FLYWHEEL_MERGE_TRAIN_ENABLED_KEY) === 'true';
}

/** Drop-in for setMergeTrainEnabled() from app-settings.ts. */
export function setMergeTrainEnabled(enabled: boolean): void {
  // Write to new key only; never write to legacy key
  setSetting(MERGE_TRAIN_ENABLED_KEY, enabled ? 'true' : 'false');
}

