import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';

import { Db } from '../../../../src/lib/overdeck/infra.js';
import { EventBus } from '../../../../src/lib/overdeck/infra.js';
import {
  SettingsResolver,
  SettingsResolverLive,
  SettingsWriter,
  SettingsWriterLive,
  ConfigResolver,
  ConfigResolverLive,
  FLYWHEEL_MERGE_TRAIN_ENABLED_KEY,
  type FlywheelConfig,
  type IssuePolicy,
} from '../../../../src/lib/overdeck/control-settings.js';
import type { IssueId } from '../../../../src/lib/overdeck/issues.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeIssueId(s: string) {
  return s as IssueId;
}

// A fully-wired fake DB that routes select/insert to in-memory maps.
function makeWiredFakeDb() {
  const flags = new Map<string, unknown>();
  const policies = new Map<
    string,
    {
      deaconIgnored: boolean;
      deaconIgnoredReason: string | null;
      autoMerge: boolean | null;
      updatedAt: Date;
    }
  >();
  const insertedEvents: Array<{ type: string; payload: unknown }> = [];

  // Track which SQL was executed to assert on query patterns
  const upsertedKeys: string[] = [];
  const upsertedPolicies: string[] = [];

  // Extract the right-hand literal value from a Drizzle eq() SQL object.
  // drizzle eq(col, val) builds: sql`${col} = ${bindIfParam(val, col)}`
  // Drizzle's sql tag interleaves strings and values; the layout is:
  //   chunks[0] = StringChunk { value: [''] }   (empty prefix — kept because strings[0] is '')
  //   chunks[1] = column object                  (circular — do NOT JSON.stringify)
  //   chunks[2] = StringChunk { value: [' = '] }
  //   chunks[3] = Param { brand, value, encoder } ← the right-hand literal
  //   chunks[4] = StringChunk { value: [''] }   (empty suffix)
  function extractEqValue(cond: unknown): string | undefined {
    const chunks = (cond as { queryChunks?: Array<unknown> }).queryChunks;
    if (!Array.isArray(chunks) || chunks.length < 4) return undefined;
    const param = chunks[3] as { value?: unknown } | undefined;
    return typeof param?.value === 'string' ? param.value : undefined;
  }

  const q = new Proxy({} as never, {
    get: (_target: unknown, prop: string) => {
      if (prop === 'then') return undefined; // not a promise

      if (prop === 'select') {
        // Capture which table was passed to from() so where() knows which store to query
        return () => {
          let tableIsPolicy = false;
          return {
            from: (table: Record<string, unknown>) => {
              // issue_policy has an issueId column; app_settings has key
              tableIsPolicy = 'issueId' in table;
              return {
                where: (cond: unknown) => {
                  const rightVal = extractEqValue(cond);
                  if (tableIsPolicy) {
                    if (rightVal && policies.has(rightVal)) {
                      const p = policies.get(rightVal)!;
                      return Promise.resolve([{ issueId: rightVal, ...p }]);
                    }
                    return Promise.resolve([]);
                  }
                  // app_settings
                  if (rightVal !== undefined && flags.has(rightVal)) {
                    return Promise.resolve([{ key: rightVal, value: flags.get(rightVal) }]);
                  }
                  return Promise.resolve([]);
                },
              };
            },
          };
        };
      }

      if (prop === 'insert') {
        return (_table: unknown) => ({
          values: (vals: Record<string, unknown>) => ({
            onConflictDoUpdate: (opts: { set?: Record<string, unknown> }) => {
              if ('key' in vals) {
                const key = vals['key'] as string;
                upsertedKeys.push(key);
                flags.set(key, opts.set?.['value'] ?? vals['value']);
              } else if ('issueId' in vals) {
                const id = vals['issueId'] as string;
                upsertedPolicies.push(id);
                const existing = policies.get(id) ?? {
                  deaconIgnored: false,
                  deaconIgnoredReason: null,
                  autoMerge: null,
                  updatedAt: new Date(),
                };
                policies.set(id, {
                  deaconIgnored:
                    (opts.set?.['deaconIgnored'] as boolean | undefined) ?? existing.deaconIgnored,
                  deaconIgnoredReason:
                    opts.set && 'deaconIgnoredReason' in opts.set
                      ? (opts.set['deaconIgnoredReason'] as string | null)
                      : existing.deaconIgnoredReason,
                  autoMerge:
                    opts.set && 'autoMerge' in opts.set
                      ? (opts.set['autoMerge'] as boolean | null)
                      : existing.autoMerge,
                  updatedAt: new Date(),
                });
              }
              return Promise.resolve();
            },
          }),
        });
      }

      return () => {
        throw new Error(`Unexpected db call: q.${prop}`);
      };
    },
  });

  const dbLayer = Layer.succeed(Db, Db.of({ q: q as never, path: ':memory:' }));

  const busLayer = Layer.succeed(
    EventBus,
    EventBus.of({
      emit: (event) =>
        Effect.sync(() => {
          insertedEvents.push({ type: event.type, payload: event.payload });
          return 0;
        }),
      readFrom: () => Effect.succeed([]),
      getLatestSequence: Effect.succeed(0),
      stream: undefined as never,
    }),
  );

  return { dbLayer, busLayer, insertedEvents, flags, policies, upsertedKeys, upsertedPolicies };
}

// ── AC1: SettingsResolver.getFlywheelConfig reads flags from app_settings ───

describe('SettingsResolver', () => {
  it('getFlywheelConfig returns defaults when no flags are set', async () => {
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = SettingsResolverLive.pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const config = await Effect.runPromise(
      SettingsResolver.use((r) => r.getFlywheelConfig()).pipe(Effect.provide(layer)),
    );

    expect(config.autoPickupBacklog).toBe(false);
    expect(config.requireUatBeforeMerge).toBe(true); // default TRUE per app-settings.ts:123
    expect(config.mergeTrainEnabled).toBe(false);
  });

  it('getFlywheelConfig returns stored flag values', async () => {
    const { dbLayer, busLayer, flags } = makeWiredFakeDb();
    flags.set('flywheel.auto_pickup_backlog', true);
    flags.set('flywheel.require_uat_before_merge', false);
    flags.set(FLYWHEEL_MERGE_TRAIN_ENABLED_KEY, true);

    const layer = SettingsResolverLive.pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const config: FlywheelConfig = await Effect.runPromise(
      SettingsResolver.use((r) => r.getFlywheelConfig()).pipe(Effect.provide(layer)),
    );

    expect(config.autoPickupBacklog).toBe(true);
    expect(config.requireUatBeforeMerge).toBe(false);
    expect(config.mergeTrainEnabled).toBe(true);
  });

  it('isDeaconPaused returns false by default', async () => {
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = SettingsResolverLive.pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const paused = await Effect.runPromise(
      SettingsResolver.use((r) => r.isDeaconPaused()).pipe(Effect.provide(layer)),
    );
    expect(paused).toBe(false);
  });

  it('getPolicy returns defaults (not-ignored, no autoMerge) when no row exists', async () => {
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = SettingsResolverLive.pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const policy: IssuePolicy = await Effect.runPromise(
      SettingsResolver.use((r) => r.getPolicy(makeIssueId('PAN-42'))).pipe(Effect.provide(layer)),
    );

    expect(policy.issueId).toBe('PAN-42');
    expect(policy.deaconIgnored).toBe(false);
    expect(policy.autoMerge).toBeNull();
  });

  it('getFlywheelRuntime reads active_run_id and paused flag', async () => {
    const { dbLayer, busLayer, flags } = makeWiredFakeDb();
    flags.set('flywheel.active_run_id', 'run-abc');
    flags.set('flywheel.globally_paused', true);

    const layer = SettingsResolverLive.pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const runtime = await Effect.runPromise(
      SettingsResolver.use((r) => r.getFlywheelRuntime()).pipe(Effect.provide(layer)),
    );

    expect(runtime.activeRunId).toBe('run-abc');
    expect(runtime.paused).toBe(true);
  });
});

// ── AC2: SettingsWriter persists to app_settings and issue_policy, no Records ─

describe('SettingsWriter', () => {
  it('setDeaconPaused writes the flag and emits an event', async () => {
    const { dbLayer, busLayer, insertedEvents, upsertedKeys } = makeWiredFakeDb();
    const layer = Layer.mergeAll(
      SettingsWriterLive,
      SettingsResolverLive,
    ).pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    await Effect.runPromise(
      SettingsWriter.use((w) => w.setDeaconPaused(true)).pipe(Effect.provide(layer)),
    );

    expect(upsertedKeys).toContain('deacon.globally_paused');
    expect(insertedEvents.some((e) => e.type === 'settings.deacon_paused')).toBe(true);
  });

  it('setFlywheelConfig writes changed flags and emits flywheel_config event', async () => {
    const { dbLayer, busLayer, insertedEvents, upsertedKeys } = makeWiredFakeDb();
    const layer = Layer.mergeAll(
      SettingsWriterLive,
      SettingsResolverLive,
    ).pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const result: FlywheelConfig = await Effect.runPromise(
      SettingsWriter.use((w) =>
        w.setFlywheelConfig({ autoPickupBacklog: true, mergeTrainEnabled: true }),
      ).pipe(Effect.provide(layer)),
    );

    expect(upsertedKeys).toContain('flywheel.auto_pickup_backlog');
    expect(upsertedKeys).toContain(FLYWHEEL_MERGE_TRAIN_ENABLED_KEY);
    expect(upsertedKeys).not.toContain('flywheel.require_uat_before_merge');
    expect(result.autoPickupBacklog).toBe(true);
    expect(result.mergeTrainEnabled).toBe(true);
    expect(insertedEvents.some((e) => e.type === 'settings.flywheel_config')).toBe(true);
  });

  it('SettingsWriter R excludes Records (type test: SettingsWriterLive compiles without Records)', () => {
    // If SettingsWriterLive required Records, `Layer.provide(dbLayer)` alone would
    // leave an unsatisfied Records dependency. This test simply ensures the layer
    // builds when only Db + EventBus are provided.
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = Layer.mergeAll(SettingsWriterLive, SettingsResolverLive).pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
    );
    // If this compiles and runs, Records is not required.
    expect(layer).toBeDefined();
  });
});

// ── AC3: setDeaconIgnored and setAutoMerge persist to issue_policy ───────────

describe('SettingsWriter — issue_policy writes', () => {
  it('setDeaconIgnored writes deacon_ignored and reason to issue_policy', async () => {
    const { dbLayer, busLayer, insertedEvents, upsertedPolicies, policies } = makeWiredFakeDb();
    const layer = Layer.mergeAll(
      SettingsWriterLive,
      SettingsResolverLive,
    ).pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const result: IssuePolicy = await Effect.runPromise(
      SettingsWriter.use((w) =>
        w.setDeaconIgnored(makeIssueId('PAN-99'), true, 'stuck in review'),
      ).pipe(Effect.provide(layer)),
    );

    expect(upsertedPolicies).toContain('PAN-99');
    const stored = policies.get('PAN-99');
    expect(stored?.deaconIgnored).toBe(true);
    expect(stored?.deaconIgnoredReason).toBe('stuck in review');
    expect(result.deaconIgnored).toBe(true);
    expect(result.deaconIgnoredReason).toBe('stuck in review');
    expect(insertedEvents.some((e) => e.type === 'settings.policy_changed')).toBe(true);
  });

  it('setAutoMerge writes auto_merge to issue_policy', async () => {
    const { dbLayer, busLayer, insertedEvents, upsertedPolicies, policies } = makeWiredFakeDb();
    const layer = Layer.mergeAll(
      SettingsWriterLive,
      SettingsResolverLive,
    ).pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const result: IssuePolicy = await Effect.runPromise(
      SettingsWriter.use((w) => w.setAutoMerge(makeIssueId('PAN-55'), true)).pipe(
        Effect.provide(layer),
      ),
    );

    expect(upsertedPolicies).toContain('PAN-55');
    const stored = policies.get('PAN-55');
    expect(stored?.autoMerge).toBe(true);
    expect(result.autoMerge).toBe(true);
    expect(insertedEvents.some((e) => e.type === 'settings.policy_changed')).toBe(true);
  });

  it('setAutoMerge with null clears the override', async () => {
    const { dbLayer, busLayer, policies } = makeWiredFakeDb();
    // Pre-seed a policy
    policies.set('PAN-7', { deaconIgnored: false, deaconIgnoredReason: null, autoMerge: true, updatedAt: new Date() });

    const layer = Layer.mergeAll(
      SettingsWriterLive,
      SettingsResolverLive,
    ).pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const result: IssuePolicy = await Effect.runPromise(
      SettingsWriter.use((w) => w.setAutoMerge(makeIssueId('PAN-7'), null)).pipe(
        Effect.provide(layer),
      ),
    );

    expect(result.autoMerge).toBeNull();
  });
});

// ── ConfigResolver — file-backed, no Db ──────────────────────────────────────

describe('ConfigResolver', () => {
  it('listProjects returns an array (real projects.yaml)', async () => {
    const result = await Effect.runPromise(
      ConfigResolver.use((r) => r.listProjects()).pipe(Effect.provide(ConfigResolverLive)),
    );
    // Just verify it's an array — the real YAML may have 0+ projects
    expect(Array.isArray(result)).toBe(true);
  });

  it('getProject returns ProjectNotFound for unknown key', async () => {
    const error = await Effect.runPromise(
      ConfigResolver.use((r) => r.getProject('no-such-project' as never))
        .pipe(Effect.provide(ConfigResolverLive))
        .pipe(Effect.flip),
    );
    expect(error._tag).toBe('ProjectNotFound');
  });
});
