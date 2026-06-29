import { Context, Effect, Layer, Schema } from 'effect';
import { eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';

import { Db, EventBus, getOverdeckDatabaseSync } from './infra.js';
import { IssueId } from './issues.js';
import type { ProjectConfig as RawProjectConfig } from '../projects.js';
import { getProjectSync, loadProjectsConfigSync } from '../projects.js';

// ── Local Drizzle table definitions ─────────────────────────────────────────

const appSettings = sqliteTable('app_settings', {
  key: text('key').primaryKey(),
  value: text('value', { mode: 'json' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});

// issueId has no FK in the local def — the FK to issues.id lives only in the
// compiled schema (overdeck-schema.ts). Omitting FK here avoids a circular
// import between control-settings and issues at module load time.
const issuePolicy = sqliteTable('issue_policy', {
  issueId: text('issue_id').primaryKey(),
  deaconIgnored: integer('deacon_ignored', { mode: 'boolean' }),
  deaconIgnoredReason: text('deacon_ignored_reason'),
  autoMerge: integer('auto_merge', { mode: 'boolean' }),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }),
});

// ── Schema entities ──────────────────────────────────────────────────────────

export const FlywheelConfig = Schema.Struct({
  autoPickupBacklog: Schema.Boolean,      // flywheel.auto_pickup_backlog (app_settings)
  requireUatBeforeMerge: Schema.Boolean,  // flywheel.require_uat_before_merge — default TRUE
  mergeTrainEnabled: Schema.Boolean,      // flywheel.merge_train_enabled
});
export type FlywheelConfig = typeof FlywheelConfig.Type;

export const FlywheelConfigPatch = Schema.Struct({
  autoPickupBacklog: Schema.optional(Schema.Boolean),
  requireUatBeforeMerge: Schema.optional(Schema.Boolean),
  mergeTrainEnabled: Schema.optional(Schema.Boolean),
});
export type FlywheelConfigPatch = typeof FlywheelConfigPatch.Type;

export const FlywheelRuntime = Schema.Struct({
  activeRunId: Schema.NullOr(Schema.String),  // flywheel.active_run_id (app_settings)
  paused: Schema.Boolean,                      // flywheel.globally_paused
});
export type FlywheelRuntime = typeof FlywheelRuntime.Type;

// Locked schema (overdeck-schema.ts:330) retains deaconIgnoredReason for functional
// parity — the column was initially dropped as "display-only" but kept on review.
export const IssuePolicy = Schema.Struct({
  issueId: IssueId,
  deaconIgnored: Schema.Boolean,
  deaconIgnoredReason: Schema.NullOr(Schema.String),
  autoMerge: Schema.NullOr(Schema.Boolean),
});
export type IssuePolicy = typeof IssuePolicy.Type;

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
    readonly getPolicy: (id: IssueId) => Effect.Effect<IssuePolicy>;
  }
>()('overdeck/SettingsResolver') {}

export const SettingsResolverLive = Layer.effect(
  SettingsResolver,
  Effect.gen(function* () {
    const { q } = yield* Db;

    const readFlag = async (key: string, dflt: boolean): Promise<boolean> => {
      const [row] = await q.select().from(appSettings).where(eq(appSettings.key, key));
      return row?.value === undefined || row.value === null ? dflt : Boolean(row.value);
    };

    const isDeaconPaused = () => Effect.promise(() => readFlag('deacon.globally_paused', false));

    const getFlywheelConfig = () =>
      Effect.promise(async () => ({
        autoPickupBacklog: await readFlag('flywheel.auto_pickup_backlog', false),
        requireUatBeforeMerge: await readFlag('flywheel.require_uat_before_merge', true),
        mergeTrainEnabled: await readFlag('flywheel.merge_train_enabled', false),
      }));

    const getFlywheelRuntime = () =>
      Effect.promise(async () => {
        const paused = await readFlag('flywheel.globally_paused', false);
        const [row] = await q
          .select()
          .from(appSettings)
          .where(eq(appSettings.key, 'flywheel.active_run_id'));
        const activeRunId = (row?.value as string | null | undefined) ?? null;
        return { activeRunId, paused };
      });

    const getPolicy = (id: IssueId) =>
      Effect.promise(async () => {
        const [row] = await q.select().from(issuePolicy).where(eq(issuePolicy.issueId, id));
        return {
          issueId: id,
          deaconIgnored: Boolean(row?.deaconIgnored),
          deaconIgnoredReason: row?.deaconIgnoredReason ?? null,
          autoMerge: row?.autoMerge ?? null,
        };
      });

    return SettingsResolver.of({ isDeaconPaused, getFlywheelConfig, getFlywheelRuntime, getPolicy });
  }),
);

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
    readonly setDeaconIgnored: (
      id: IssueId,
      ignored: boolean,
      reason?: string,
    ) => Effect.Effect<IssuePolicy>;
    readonly setAutoMerge: (
      id: IssueId,
      autoMerge: boolean | null,
    ) => Effect.Effect<IssuePolicy>;
  }
>()('overdeck/SettingsWriter') {}

export const SettingsWriterLive = Layer.effect(
  SettingsWriter,
  Effect.gen(function* () {
    const { q } = yield* Db;
    const bus = yield* EventBus;
    const now = () => new Date();

    const setFlag = async (key: string, value: unknown): Promise<void> => {
      await q
        .insert(appSettings)
        .values({ key, value, updatedAt: now() })
        .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now() } });
    };

    const readFlag = async (key: string, dflt: boolean): Promise<boolean> => {
      const [row] = await q.select().from(appSettings).where(eq(appSettings.key, key));
      return row?.value === undefined || row.value === null ? dflt : Boolean(row.value);
    };

    const readFlywheelConfig = async (): Promise<FlywheelConfig> => ({
      autoPickupBacklog: await readFlag('flywheel.auto_pickup_backlog', false),
      requireUatBeforeMerge: await readFlag('flywheel.require_uat_before_merge', true),
      mergeTrainEnabled: await readFlag('flywheel.merge_train_enabled', false),
    });

    const readPolicy = async (id: IssueId): Promise<IssuePolicy> => {
      const [row] = await q.select().from(issuePolicy).where(eq(issuePolicy.issueId, id));
      return {
        issueId: id,
        deaconIgnored: Boolean(row?.deaconIgnored),
        deaconIgnoredReason: row?.deaconIgnoredReason ?? null,
        autoMerge: row?.autoMerge ?? null,
      };
    };

    const setDeaconPaused = (paused: boolean) =>
      Effect.gen(function* () {
        yield* Effect.promise(() => setFlag('deacon.globally_paused', paused));
        yield* bus.emit({ type: 'settings.deacon_paused', payload: { paused } });
      });

    const setFlywheelConfig = (patch: FlywheelConfigPatch) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          if (patch.autoPickupBacklog !== undefined)
            await setFlag('flywheel.auto_pickup_backlog', patch.autoPickupBacklog);
          if (patch.requireUatBeforeMerge !== undefined)
            await setFlag('flywheel.require_uat_before_merge', patch.requireUatBeforeMerge);
          if (patch.mergeTrainEnabled !== undefined)
            await setFlag('flywheel.merge_train_enabled', patch.mergeTrainEnabled);
        });
        const next = yield* Effect.promise(readFlywheelConfig);
        yield* bus.emit({ type: 'settings.flywheel_config', payload: next });
        return next;
      });

    const setDeaconIgnored = (id: IssueId, ignored: boolean, reason?: string) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await q
            .insert(issuePolicy)
            .values({
              issueId: id,
              deaconIgnored: ignored,
              deaconIgnoredReason: reason ?? null,
              autoMerge: null,
              updatedAt: now(),
            })
            .onConflictDoUpdate({
              target: issuePolicy.issueId,
              set: { deaconIgnored: ignored, deaconIgnoredReason: reason ?? null, updatedAt: now() },
            });
        });
        yield* bus.emit({
          type: 'settings.policy_changed',
          payload: { id, deaconIgnored: ignored, reason },
        });
        return yield* Effect.promise(() => readPolicy(id));
      });

    const setAutoMerge = (id: IssueId, autoMerge: boolean | null) =>
      Effect.gen(function* () {
        yield* Effect.promise(async () => {
          await q
            .insert(issuePolicy)
            .values({
              issueId: id,
              deaconIgnored: false,
              deaconIgnoredReason: null,
              autoMerge,
              updatedAt: now(),
            })
            .onConflictDoUpdate({
              target: issuePolicy.issueId,
              set: { autoMerge, updatedAt: now() },
            });
        });
        yield* bus.emit({ type: 'settings.policy_changed', payload: { id, autoMerge } });
        return yield* Effect.promise(() => readPolicy(id));
      });

    return SettingsWriter.of({ setDeaconPaused, setFlywheelConfig, setDeaconIgnored, setAutoMerge });
  }),
);

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

// ── HTTP API groups ──────────────────────────────────────────────────────────
// Runtime-control endpoints (startFlywheel, pauseFlywheel, resumeFlywheel,
// abortFlywheel, emergencyStop, brake) are omitted pending workspace-lf582.

export const SettingsApi = HttpApiGroup.make('settings')
  .add(
    HttpApiEndpoint.get('getDeaconPause', '/deacon/pause', {
      success: Schema.Struct({ paused: Schema.Boolean }),
    }),
  )
  .add(
    HttpApiEndpoint.get('getFlywheelConfig', '/flywheel/config', {
      success: FlywheelConfig,
    }),
  )
  .add(
    HttpApiEndpoint.get('getFlywheelRuntime', '/flywheel/state', {
      success: FlywheelRuntime,
    }),
  )
  .add(
    HttpApiEndpoint.get('getPolicy', '/issues/:id/policy', {
      params: { id: IssueId },
      success: IssuePolicy,
    }),
  )
  .add(
    HttpApiEndpoint.post('setDeaconPause', '/deacon/pause', {
      payload: Schema.Struct({ paused: Schema.Boolean }),
      success: Schema.Struct({ paused: Schema.Boolean }),
    }),
  )
  .add(
    HttpApiEndpoint.post('setFlywheelConfig', '/flywheel/config', {
      payload: FlywheelConfigPatch,
      success: FlywheelConfig,
    }),
  )
  .add(
    HttpApiEndpoint.post('setDeaconIgnored', '/workspaces/:id/deacon-ignore', {
      params: { id: IssueId },
      payload: Schema.Struct({
        ignored: Schema.Boolean,
        reason: Schema.optional(Schema.String),
      }),
      success: IssuePolicy,
    }),
  )
  .add(
    HttpApiEndpoint.post('setAutoMerge', '/workspaces/:id/auto-merge', {
      params: { id: IssueId },
      payload: Schema.Struct({ autoMerge: Schema.NullOr(Schema.Boolean) }),
      success: IssuePolicy,
    }),
  );

// ── Sync helpers (for call sites that cannot use Effect) ─────────────────────

function overdeckDb() {
  return getOverdeckDatabaseSync();
}

export const DEACON_GLOBAL_PAUSE_KEY = 'deacon.globally_paused';
export const FLYWHEEL_GLOBAL_PAUSE_KEY = 'flywheel.globally_paused';
export const FLYWHEEL_ACTIVE_RUN_ID_KEY = 'flywheel.active_run_id';
export const FLYWHEEL_AUTO_PICKUP_BACKLOG_KEY = 'flywheel.auto_pickup_backlog';
export const FLYWHEEL_REQUIRE_UAT_BEFORE_MERGE_KEY = 'flywheel.require_uat_before_merge';
export const FLYWHEEL_MERGE_TRAIN_ENABLED_KEY = 'flywheel.merge_train_enabled';
export const BOOT_RECONCILIATION_DECISION_KEY = 'boot_reconciliation.decision';
export const BOOT_RECONCILIATION_PER_AGENT_KEY = 'boot_reconciliation.per_agent';
export const BOOT_RECONCILIATION_DECIDED_AT_KEY = 'boot_reconciliation.decided_at';
export const BOOT_RECONCILIATION_BOOT_ID_KEY = 'boot_reconciliation.boot_id';
export const BOOT_RECONCILIATION_GRACE_DEADLINE_KEY = 'boot_reconciliation.grace_deadline';

export type BootReconciliationDecision = 'pending' | 'resume_all' | 'hold_all' | 'per_agent';
export type BootReconciliationPerAgentAction = 'resume' | 'hold';
export type BootReconciliationPerAgentMap = Record<string, BootReconciliationPerAgentAction>;

export interface BootReconciliationState {
  decision: BootReconciliationDecision | null;
  perAgent: BootReconciliationPerAgentMap;
  decidedAt: string | null;
  bootId: string | null;
  graceDeadline: string | null;
}

const BOOT_RECONCILIATION_DECISIONS = new Set<BootReconciliationDecision>([
  'pending',
  'resume_all',
  'hold_all',
  'per_agent',
]);

/** Read a raw app_settings value synchronously. Returns null if not set. */
export function getSetting(key: string): string | null {
  const row = overdeckDb()
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

function parseBootReconciliationDecision(value: string | null): BootReconciliationDecision | null {
  if (value && BOOT_RECONCILIATION_DECISIONS.has(value as BootReconciliationDecision)) {
    return value as BootReconciliationDecision;
  }
  return null;
}

function parseBootReconciliationPerAgent(value: string | null): BootReconciliationPerAgentMap {
  if (!value) return {};

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return {};
    }

    const perAgent: BootReconciliationPerAgentMap = {};
    for (const [issueId, action] of Object.entries(parsed)) {
      if (action === 'resume' || action === 'hold') {
        perAgent[issueId] = action;
      }
    }
    return perAgent;
  } catch (err) {
    console.warn('[control-settings] Failed to parse boot reconciliation per-agent map:', err);
    return {};
  }
}

export function getBootReconciliationState(): BootReconciliationState {
  return {
    decision: parseBootReconciliationDecision(getSetting(BOOT_RECONCILIATION_DECISION_KEY)),
    perAgent: parseBootReconciliationPerAgent(getSetting(BOOT_RECONCILIATION_PER_AGENT_KEY)),
    decidedAt: getSetting(BOOT_RECONCILIATION_DECIDED_AT_KEY),
    bootId: getSetting(BOOT_RECONCILIATION_BOOT_ID_KEY),
    graceDeadline: getSetting(BOOT_RECONCILIATION_GRACE_DEADLINE_KEY),
  };
}

export function setBootReconciliationDecision(
  decision: BootReconciliationDecision,
  perAgent: BootReconciliationPerAgentMap = {},
): void {
  setSetting(BOOT_RECONCILIATION_DECISION_KEY, decision);
  setSetting(BOOT_RECONCILIATION_PER_AGENT_KEY, JSON.stringify(perAgent));
  setSetting(BOOT_RECONCILIATION_DECIDED_AT_KEY, new Date().toISOString());
}

export function stampBootReconciliation(bootId: string, graceDeadline: string): void {
  setSetting(BOOT_RECONCILIATION_BOOT_ID_KEY, bootId);
  setSetting(BOOT_RECONCILIATION_GRACE_DEADLINE_KEY, graceDeadline);
}

/** Synchronous check of the global Deacon pause flag. */
export function isDeaconGloballyPausedSync(): boolean {
  try {
    return getSetting(DEACON_GLOBAL_PAUSE_KEY) === 'true';
  } catch (err) {
    console.warn('[control-settings] Failed to read deacon pause flag:', err);
    return false;
  }
}

/** Drop-in for isDeaconGloballyPaused() from app-settings.ts. */
export function isDeaconGloballyPaused(): boolean {
  return isDeaconGloballyPausedSync();
}

/** Synchronous set of the global Deacon pause flag. */
export function setDeaconGloballyPausedSync(paused: boolean): void {
  setSetting(DEACON_GLOBAL_PAUSE_KEY, paused ? 'true' : 'false');
}

/** Drop-in for setDeaconGloballyPaused() from app-settings.ts. */
export function setDeaconGloballyPaused(paused: boolean): void {
  setDeaconGloballyPausedSync(paused);
}

/** Drop-in for getFlywheelActiveRunId() from app-settings.ts. */
export function getFlywheelActiveRunId(): string | null {
  return getFlywheelActiveRunIdSync();
}

/** Set the active flywheel run ID. */
export function setFlywheelActiveRunId(runId: string | null): void {
  setSetting(FLYWHEEL_ACTIVE_RUN_ID_KEY, runId ?? '');
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
  return getSetting(FLYWHEEL_MERGE_TRAIN_ENABLED_KEY) === 'true';
}

/** Drop-in for setMergeTrainEnabled() from app-settings.ts. */
export function setMergeTrainEnabled(enabled: boolean): void {
  setSetting(FLYWHEEL_MERGE_TRAIN_ENABLED_KEY, enabled ? 'true' : 'false');
}

export const ConfigApi = HttpApiGroup.make('config')
  .add(
    HttpApiEndpoint.get('getProject', '/projects/:key', {
      params: { key: ProjectKey },
      success: ProjectConfig,
      error: ProjectNotFound,
    }),
  )
  .add(
    HttpApiEndpoint.get('listProjects', '/projects', {
      success: Schema.Array(ProjectConfig),
    }),
  );

// ── Sync bridge — used by lib/agents.ts (sync context) ──────────────────────

/**
 * Returns the currently-active flywheel run ID from overdeck.db, or null.
 * Sync version of SettingsResolver.getFlywheelRuntime().activeRunId.
 */
export function getFlywheelActiveRunIdSync(): string | null {
  const db = getOverdeckDatabaseSync();
  const row = db
    .prepare(`SELECT value FROM app_settings WHERE key = 'flywheel.active_run_id'`)
    .get() as { value: string | null } | undefined;
  return (row?.value as string | null | undefined) ?? null;
}
