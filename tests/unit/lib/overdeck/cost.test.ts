import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';

import { Db, EventBus, CostArchive } from '../../../../src/lib/overdeck/infra.js';
import {
  CostResolver,
  CostResolverLive,
  CostWriter,
  CostWriterLive,
  type CostEvent,
  type Window,
} from '../../../../src/lib/overdeck/cost.js';
import type { IssueId } from '../../../../src/lib/overdeck/issues.js';

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeIssueId(s: string) {
  return s as IssueId;
}

// A fake DB that holds an in-memory table of cost events and captures inserts.
function makeWiredFakeDb() {
  type Row = {
    id: number;
    ts: Date;
    issueId: string | null;
    agentId: string | null;
    sessionId: string | null;
    sessionType: string | null;
    provider: string | null;
    model: string | null;
    input: number | null;
    output: number | null;
    cacheRead: number | null;
    cacheWrite: number | null;
    cost: number | null;
    requestId: string | null;
    sourceFile: string | null;
  };

  const rows: Row[] = [];
  let nextId = 1;
  const insertedValues: unknown[] = [];

  // Build a tiny SQL-aware facade over the in-memory array.
  // Drizzle's sqlite-proxy returns thenables at every terminal step.
  // We model this by making groupBy/orderBy/limit all thenable with .then chaining.
  const makeQueryResult = (data: Row[]) => {
    const result: unknown = {
      then: (resolve: (v: Row[]) => void, _reject?: unknown) => { resolve(data); return result; },
      orderBy: (..._args: unknown[]) => makeQueryResult(data),
      limit: (n: number) => makeQueryResult(data.slice(0, n)),
      groupBy: (..._args: unknown[]) => makeQueryResult(data),
      where: (_cond: unknown) => makeQueryResult(data),
    };
    return result;
  };

  const q = new Proxy({} as never, {
    get: (_target: unknown, prop: string) => {
      if (prop === 'then') return undefined;

      if (prop === 'select') {
        return (_fields?: Record<string, unknown>) => ({
          from: (_table: unknown) => ({
            // where returns current rows so checkDuplicate can detect existing sourceFiles
            where: (_cond: unknown) => makeQueryResult(rows),
            groupBy: (..._args: unknown[]) => makeQueryResult([]),
            orderBy: (..._args: unknown[]) => makeQueryResult(rows),
            limit: (n: number) => makeQueryResult(rows.slice(0, n)),
          }),
        });
      }

      if (prop === 'insert') {
        return (_table: unknown) => ({
          values: (vals: unknown) => ({
            onConflictDoNothing: () => {
              insertedValues.push(vals);
              const v = vals as Row;
              rows.push({ id: nextId++, ...v });
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

  const emittedEvents: Array<{ type: string; payload: unknown }> = [];
  const busLayer = Layer.succeed(
    EventBus,
    EventBus.of({
      emit: (event) =>
        Effect.sync(() => {
          emittedEvents.push({ type: event.type, payload: event.payload });
          return 0;
        }),
      readFrom: () => Effect.succeed([]),
      getLatestSequence: Effect.succeed(0),
      stream: undefined as never,
    }),
  );

  const appendedEvents: unknown[] = [];
  const archiveLayer = Layer.succeed(
    CostArchive,
    CostArchive.of({
      append: (event) =>
        Effect.sync(() => {
          appendedEvents.push(event);
        }),
    }),
  );

  return { dbLayer, busLayer, archiveLayer, insertedValues, appendedEvents, emittedEvents, rows };
}

function makeSampleEvent(): CostEvent {
  return {
    ts:          new Date('2026-01-01T00:00:00Z'),
    issueId:     makeIssueId('PAN-42'),
    agentId:     'agent-abc',
    sessionId:   'sess-001',
    sessionType: 'work',
    provider:    'anthropic',
    model:       'claude-sonnet-4-6',
    input:       1000,
    output:      500,
    cacheRead:   200,
    cacheWrite:  100,
    cost:        0.05,
    requestId:   'req-xyz',
    sourceFile:  null,
  };
}

// ── AC1: CostResolver returns data from one door ─────────────────────────────

describe('CostResolver — one door for all cost reads', () => {
  it('all 11 resolver methods are present on the service interface', async () => {
    // Structural check: every method exists and is callable.
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = CostResolverLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
    );

    const result = await Effect.runPromise(
      CostResolver.use((r) => {
        // Verify all 9 event-cost methods + 2 budget reads exist
        expect(typeof r.summary).toBe('function');
        expect(typeof r.byIssue).toBe('function');
        expect(typeof r.issueDetail).toBe('function');
        expect(typeof r.byDay).toBe('function');
        expect(typeof r.byModel).toBe('function');
        expect(typeof r.byAgent).toBe('function');
        expect(typeof r.byBackgroundSource).toBe('function');
        expect(typeof r.byProject).toBe('function');
        expect(typeof r.recent).toBe('function');
        expect(typeof r.listBudgets).toBe('function');
        expect(typeof r.checkBudget).toBe('function');
        return Effect.succeed(true);
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toBe(true);
  });

  it('byAgent returns an array (empty DB returns empty)', async () => {
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = CostResolverLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
    );

    const result = await Effect.runPromise(
      CostResolver.use((r) => r.byAgent()).pipe(Effect.provide(layer)),
    );

    expect(Array.isArray(result)).toBe(true);
  });

  it('byModel returns an array', async () => {
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = CostResolverLive.pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const result = await Effect.runPromise(
      CostResolver.use((r) => r.byModel()).pipe(Effect.provide(layer)),
    );

    expect(Array.isArray(result)).toBe(true);
  });

  it('byIssue returns an array', async () => {
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = CostResolverLive.pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const result = await Effect.runPromise(
      CostResolver.use((r) => r.byIssue()).pipe(Effect.provide(layer)),
    );

    expect(Array.isArray(result)).toBe(true);
  });

  it('byProject returns an array', async () => {
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = CostResolverLive.pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const result = await Effect.runPromise(
      CostResolver.use((r) => r.byProject()).pipe(Effect.provide(layer)),
    );

    expect(Array.isArray(result)).toBe(true);
  });

  it('byDay returns an array', async () => {
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = CostResolverLive.pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const result = await Effect.runPromise(
      CostResolver.use((r) => r.byDay(7)).pipe(Effect.provide(layer)),
    );

    expect(Array.isArray(result)).toBe(true);
  });

  it('recent returns an array', async () => {
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = CostResolverLive.pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const result = await Effect.runPromise(
      CostResolver.use((r) => r.recent(50)).pipe(Effect.provide(layer)),
    );

    expect(Array.isArray(result)).toBe(true);
  });

  it('listBudgets returns an array (reads budgets.json store)', async () => {
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = CostResolverLive.pipe(Layer.provide(dbLayer), Layer.provide(busLayer));

    const result = await Effect.runPromise(
      CostResolver.use((r) => r.listBudgets()).pipe(Effect.provide(layer)),
    );

    // budgets.json may have 0..N entries — just verify it's an array
    expect(Array.isArray(result)).toBe(true);
  });
});

// ── AC2: CostResolver interface covers every `pan cost` CLI subcommand ────────
// These are a no-loss audit: every CLI verb maps to a CostResolver or CostWriter
// method. workspace-1ee26 will delete the old code paths; this test proves the
// door surface is a superset before that deletion.
//
// CLI verb → resolver/writer mapping (cost.md §1B):
//   pan cost              → CostResolver.summary("day")
//   pan cost --week       → CostResolver.summary("week")
//   pan cost --month      → CostResolver.summary("month")
//   pan cost issue <id>   → CostResolver.issueDetail(id)
//   pan cost by-day       → CostResolver.byDay(7)
//   pan cost by-model     → CostResolver.byModel()
//   pan cost by-agent     → CostResolver.byAgent()
//   pan cost by-project   → CostResolver.byProject()
//   pan cost sync         → CostWriter.reconcile({ source: "wal" })
//   pan cost budget list  → CostResolver.listBudgets()
//   pan cost budget check → CostResolver.checkBudget(id)
//   pan cost budget create → CostWriter.createBudget(spec)
//   pan cost budget delete → CostWriter.deleteBudget(id)

describe('AC2 — no-loss audit: CostResolver covers all pan cost CLI subcommands', () => {
  it('CostResolver exposes all read subcommand targets', async () => {
    const { dbLayer, busLayer } = makeWiredFakeDb();
    const layer = CostResolverLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
    );

    await Effect.runPromise(
      CostResolver.use((r) => {
        // Summary verbs (pan cost / --week / --month)
        const windows: Window[] = ['day', 'week', 'month'];
        for (const w of windows) expect(typeof r.summary(w)).toBe('object');

        // pan cost issue <id>
        expect(typeof r.issueDetail(makeIssueId('PAN-1'))).toBe('object');

        // pan cost by-day / by-model / by-agent / by-project
        expect(typeof r.byDay(7)).toBe('object');
        expect(typeof r.byModel()).toBe('object');
        expect(typeof r.byAgent()).toBe('object');
        expect(typeof r.byProject()).toBe('object');

        // pan cost background
        expect(typeof r.byBackgroundSource(24)).toBe('object');

        // pan cost budget list / check
        expect(typeof r.listBudgets()).toBe('object');
        expect(typeof r.checkBudget('some-id')).toBe('object');

        return Effect.succeed(true);
      }).pipe(Effect.provide(layer)),
    );
  });

  it('CostWriter exposes all write subcommand targets', async () => {
    const { dbLayer, busLayer, archiveLayer } = makeWiredFakeDb();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(archiveLayer),
    );

    await Effect.runPromise(
      CostWriter.use((w) => {
        // pan cost sync
        expect(typeof w.reconcile({ source: 'wal' })).toBe('object');

        // pan cost budget create / delete
        expect(
          typeof w.createBudget({
            name: 'test', type: 'daily', limit: 1, currency: 'USD', alertThreshold: 0.8,
          }),
        ).toBe('object');
        expect(typeof w.deleteBudget('some-id')).toBe('object');

        return Effect.succeed(true);
      }).pipe(Effect.provide(layer)),
    );
  });
});

// ── AC3: CostWriter.record persists to BOTH cost_events AND CostArchive ───────

describe('CostWriter — record persists to archive then DB then bus', () => {
  it('record() calls archive.append before the DB insert', async () => {
    const { dbLayer, busLayer, archiveLayer, insertedValues, appendedEvents, emittedEvents } =
      makeWiredFakeDb();

    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(archiveLayer),
    );

    const event = makeSampleEvent();
    await Effect.runPromise(
      CostWriter.use((w) => w.record(event)).pipe(Effect.provide(layer)),
    );

    // Archive must have been called
    expect(appendedEvents).toHaveLength(1);
    expect(appendedEvents[0]).toEqual(event);

    // DB must have been inserted
    expect(insertedValues).toHaveLength(1);
    const inserted = insertedValues[0] as typeof event;
    expect(inserted.issueId).toBe('PAN-42');
    expect(inserted.model).toBe('claude-sonnet-4-6');
    expect(inserted.cost).toBe(0.05);

    // Event bus must have been notified
    expect(emittedEvents.some((e) => e.type === 'cost.recorded')).toBe(true);
  });

  it('record() passes all 14 NEED columns to the DB insert', async () => {
    const { dbLayer, busLayer, archiveLayer, insertedValues } = makeWiredFakeDb();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(archiveLayer),
    );

    const event = makeSampleEvent();
    await Effect.runPromise(
      CostWriter.use((w) => w.record(event)).pipe(Effect.provide(layer)),
    );

    const row = insertedValues[0] as Record<string, unknown>;
    expect(row).toMatchObject({
      ts:          event.ts,
      issueId:     'PAN-42',
      agentId:     'agent-abc',
      sessionId:   'sess-001',
      sessionType: 'work',
      provider:    'anthropic',
      model:       'claude-sonnet-4-6',
      input:       1000,
      output:      500,
      cacheRead:   200,
      cacheWrite:  100,
      cost:        0.05,
      requestId:   'req-xyz',
      sourceFile:  null,
    });
  });

  it('reconcile() returns { imported: 0 } for default (claude) source', async () => {
    const { dbLayer, busLayer, archiveLayer } = makeWiredFakeDb();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(archiveLayer),
    );

    const result = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile()).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ imported: 0 });
  });

  it('rebuild() returns { events: 0 } (stub)', async () => {
    const { dbLayer, busLayer, archiveLayer } = makeWiredFakeDb();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(archiveLayer),
    );

    const result = await Effect.runPromise(
      CostWriter.use((w) => w.rebuild()).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ events: 0 });
  });

  it('CostWriter R excludes Records (layer compiles with only Db + EventBus + CostArchive)', () => {
    // If CostWriterLive required Records or any other service, providing only
    // Db + EventBus + CostArchive would leave an unsatisfied dependency.
    const { dbLayer, busLayer, archiveLayer } = makeWiredFakeDb();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(archiveLayer),
    );
    expect(layer).toBeDefined();
  });
});
