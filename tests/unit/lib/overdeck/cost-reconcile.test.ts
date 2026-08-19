/**
 * Tests for CostWriter.reconcile() — pi and codex session ingest (AC2 of workspace-3zhmy).
 *
 * These tests mock the filesystem and parsers so no real disk I/O is needed.
 */
import { vi, describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';

vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return {
    ...actual,
    existsSync: vi.fn(),
    readdirSync: vi.fn(),
    statSync: vi.fn(() => ({ mtimeMs: 1, size: 1 })),
  };
});

vi.mock('../../../../src/lib/cost-parsers/ohmypi-parser.js', () => ({
  parseOhmypiSessionSync: vi.fn(),
  parseOhmypiSessionCostEventsSync: vi.fn(),
  parseOhmypiSessionCostResultSync: vi.fn(),
}));

vi.mock('../../../../src/lib/cost-parsers/codex-parser.js', () => ({
  parseCodexSessionCostEventsSync: vi.fn(),
}));

vi.mock('../../../../src/lib/costs/skip-cache.js', () => ({
  lookupSkipVerdict: vi.fn(() => null),
  recordSkipVerdict: vi.fn(),
}));

vi.mock('../../../../src/lib/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/paths.js')>();
  return {
    ...actual,
    getOverdeckHome: vi.fn(() => '/fake/pan'),
    OVERDECK_HOME:   '/fake/pan',
    AGENTS_DIR:        '/fake/pan/agents',
  };
});

import { existsSync, readdirSync } from 'node:fs';
import { parseOhmypiSessionCostEventsSync, parseOhmypiSessionCostResultSync, parseOhmypiSessionSync } from '../../../../src/lib/cost-parsers/ohmypi-parser.js';
import { parseCodexSessionCostEventsSync } from '../../../../src/lib/cost-parsers/codex-parser.js';
import { Db, EventBus, CostArchive } from '../../../../src/lib/overdeck/infra.js';
import { CostWriter, CostWriterLive } from '../../../../src/lib/overdeck/cost.js';

// ── Helpers ───────────────────────────────────────────────────────────────────

const makeDirent = (name: string, isDir: boolean) =>
  ({ name, isDirectory: () => isDir, isFile: () => !isDir } as ReturnType<typeof readdirSync>[number]);

function makeTestLayer() {
  type Row = { id: number; sourceFile: string | null; [k: string]: unknown };
  const rows: Row[] = [];
  let nextId = 1;
  const insertedValues: unknown[] = [];

  const filterRows = (cond: unknown): Row[] => {
    const chunks = (cond as { queryChunks?: Array<{ name?: string; value?: unknown }> })?.queryChunks;
    const column = chunks?.find((chunk) => typeof chunk?.name === 'string')?.name;
    const value = chunks?.find((chunk) =>
      Object.prototype.hasOwnProperty.call(chunk ?? {}, 'value') && !Array.isArray(chunk.value)
    )?.value;
    if (column === 'request_id') return rows.filter((row) => row.requestId === value);
    if (column === 'source_file') return rows.filter((row) => row.sourceFile === value);
    return rows;
  };

  const makeQueryResult = (data: unknown[]) => {
    const result: unknown = {
      then: (resolve: (v: unknown[]) => void) => { resolve(data); return result; },
      orderBy: (..._: unknown[]) => makeQueryResult(data),
      limit:   (n: number) => makeQueryResult(data.slice(0, n)),
      groupBy: (..._: unknown[]) => makeQueryResult(data),
      where:   (cond: unknown) => makeQueryResult(filterRows(cond)),
    };
    return result;
  };

  const q = new Proxy({} as never, {
    get: (_: unknown, prop: string) => {
      if (prop === 'then') return undefined;

      if (prop === 'select') {
        return (_fields?: unknown) => ({
          from: (_table: unknown) => ({
            where:   (cond: unknown) => makeQueryResult(filterRows(cond)),
            orderBy: (..._: unknown[]) => makeQueryResult(rows),
            limit:   (n: number) => makeQueryResult(rows.slice(0, n)),
            groupBy: (..._: unknown[]) => makeQueryResult([]),
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

      return () => { throw new Error(`Unexpected db call: q.${String(prop)}`); };
    },
  });

  const dbLayer = Layer.succeed(Db, Db.of({ q: q as never, path: ':memory:' }));
  const busLayer = Layer.succeed(
    EventBus,
    EventBus.of({
      emit:              () => Effect.sync(() => 0),
      readFrom:          () => Effect.succeed([]),
      getLatestSequence: Effect.succeed(0),
      stream:            undefined as never,
    }),
  );
  const appendedEvents: unknown[] = [];
  const archiveLayer = Layer.succeed(
    CostArchive,
    CostArchive.of({ append: (event) => Effect.sync(() => { appendedEvents.push(event); }) }),
  );

  return { dbLayer, busLayer, archiveLayer, insertedValues, appendedEvents, rows };
}

function makePiCostEvents(sessionFile: string) {
  return [
    {
      requestId:   'ohmypi:sess-abc:e1',
      timestamp:   '2026-06-17T10:00:01Z',
      sessionId:   'sess-abc',
      sessionFile,
      provider:    'custom',
      model:       'kimi-k2.7-code',
      input:       1000,
      output:      500,
      cacheRead:   200,
      cacheWrite:  20,
      cost:        0.03,
    },
    {
      requestId:   'ohmypi:sess-abc:e2',
      timestamp:   '2026-06-17T10:00:02Z',
      sessionId:   'sess-abc',
      sessionFile,
      provider:    'custom',
      model:       'kimi-k2.7-code',
      input:       200,
      output:      100,
      cacheRead:   0,
      cacheWrite:  0,
      cost:        0.01,
    },
  ];
}

function makeCodexCostEvents(sessionFile: string) {
  return [
    {
      requestId:  'codex:sess-abc:0',
      timestamp:  '2026-06-17T10:00:01Z',
      sessionId:  'sess-abc',
      sessionFile,
      provider:   'openai' as const,
      model:      'gpt-5.5',
      input:      1000,
      output:     500,
      cacheRead:  200,
      cacheWrite: 0,
      cost:       0.03,
    },
    {
      requestId:  'codex:sess-abc:1',
      timestamp:  '2026-06-17T10:00:02Z',
      sessionId:  'sess-abc',
      sessionFile,
      provider:   'openai' as const,
      model:      'gpt-5.5',
      input:      200,
      output:     100,
      cacheRead:  0,
      cacheWrite: 0,
      cost:       0.01,
    },
  ];
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CostWriter.reconcile — ohmypi source', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(parseOhmypiSessionSync).mockReturnValue(null);
    vi.mocked(parseOhmypiSessionCostEventsSync).mockReturnValue([]);
    vi.mocked(parseOhmypiSessionCostResultSync).mockReturnValue({ ok: true, usageEvents: [] });
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('returns { imported: 0 } when no agent directories exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);  // agents dir absent

    const { dbLayer, busLayer, archiveLayer } = makeTestLayer();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer), Layer.provide(busLayer), Layer.provide(archiveLayer),
    );

    const result = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'ohmypi' })).pipe(Effect.provide(layer)),
    );

    expect(result).toMatchObject({
      imported: 0,
      skipped: [],
      sessionsScanned: 0,
      eventsImported: 0,
      duplicatesSkipped: 0,
      errors: [],
      earliestEventTs: null,
      latestEventTs: null,
    });
  });

  it('imports ohmypi assistant usage events and returns the inserted count', async () => {
    const agentDir = '/fake/pan/agents';
    const sessionFile = '/fake/pan/agents/agent-pan-1/sessions/sess.jsonl';

    vi.mocked(readdirSync).mockImplementation((dir, _opts) => {
      if (String(dir) === agentDir)
        return [makeDirent('agent-pan-1', true)];
      if (String(dir) === '/fake/pan/agents/agent-pan-1/sessions')
        return [makeDirent('sess.jsonl', false)];
      return [];
    });

    vi.mocked(parseOhmypiSessionCostResultSync).mockReturnValue({
      ok: true,
      usageEvents: makePiCostEvents(sessionFile),
    });

    const { dbLayer, busLayer, archiveLayer, insertedValues } = makeTestLayer();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer), Layer.provide(busLayer), Layer.provide(archiveLayer),
    );

    const result = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'ohmypi' })).pipe(Effect.provide(layer)),
    );

    expect(result).toMatchObject({
      imported: 2,
      skipped: [],
      sessionsScanned: 1,
      eventsImported: 2,
      duplicatesSkipped: 0,
      errors: [],
      earliestEventTs: '2026-06-17T10:00:01.000Z',
      latestEventTs: '2026-06-17T10:00:02.000Z',
    });
    expect(insertedValues).toHaveLength(2);
    const row = insertedValues[0] as Record<string, unknown>;
    expect(row.agentId).toBe('agent-pan-1');
    expect(row.issueId).toBe('PAN-1');
    expect(row.sessionType).toBe('ohmypi');
    expect(row.provider).toBe('custom');
    expect(row.model).toBe('kimi-k2.7-code');
    expect(row.requestId).toBe('ohmypi:sess-abc:e1');
    expect(row.sourceFile).toBe(sessionFile);
    expect(row.cost).toBe(0.03);
    expect((insertedValues[1] as Record<string, unknown>).requestId).toBe('ohmypi:sess-abc:e2');
  });

  it('surfaces and preserves ohmypi unpriced-token warning metadata during reconcile', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agentDir = '/fake/pan/agents';
    const sessionFile = '/fake/pan/agents/agent-pan-1/sessions/sess.jsonl';

    vi.mocked(readdirSync).mockImplementation((dir, _opts) => {
      if (String(dir) === agentDir)
        return [makeDirent('agent-pan-1', true)];
      if (String(dir) === '/fake/pan/agents/agent-pan-1/sessions')
        return [makeDirent('sess.jsonl', false)];
      return [];
    });

    vi.mocked(parseOhmypiSessionCostResultSync).mockReturnValue({
      ok: true,
      unpricedModels: [{ provider: 'mystery', model: 'mystery-model', reason: 'unknown-provider' }],
      usageEvents: [{
        requestId:   'ohmypi:sess-abc:e1',
        timestamp:   '2026-06-17T10:00:01Z',
        sessionId:   'sess-abc',
        sessionFile,
        provider:    'mystery',
        model:       'mystery-model',
        input:       100,
        output:      10,
        cacheRead:   0,
        cacheWrite:  0,
        cost:        0,
      }],
    });

    const { dbLayer, busLayer, archiveLayer, appendedEvents } = makeTestLayer();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer), Layer.provide(busLayer), Layer.provide(archiveLayer),
    );

    const result = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'ohmypi' })).pipe(Effect.provide(layer)),
    );

    expect(result).toMatchObject({
      imported: 1,
      sessionsScanned: 1,
      eventsImported: 1,
      skipped: [{ file: sessionFile, reason: 'unpriced-model' }],
      warnings: [{ file: sessionFile, reason: 'unknown-provider', provider: 'mystery', model: 'mystery-model' }],
    });
    expect(warnSpy).toHaveBeenCalledWith(
      `[cost-reconcile] warning ${sessionFile}: unknown-provider provider=mystery model=mystery-model`,
    );
    expect(appendedEvents).toHaveLength(1);
    expect(appendedEvents[0]).toMatchObject({
      requestId: 'ohmypi:sess-abc:e1',
      warnings: [{ type: 'unpriced-model', provider: 'mystery', model: 'mystery-model', reason: 'unknown-provider' }],
    });
  });

});

describe('CostWriter.reconcile — codex source', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(parseCodexSessionCostEventsSync).mockReturnValue([]);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it('imports one codex cost event per token_count turn with request ids', async () => {
    const agentDir = '/fake/pan/agents';
    const rolloutFile = '/fake/pan/agents/agent-2/codex-home/sessions/2026/06/17/rollout-abc.jsonl';

    vi.mocked(readdirSync).mockImplementation((dir, _opts) => {
      if (String(dir) === agentDir) return [makeDirent('agent-2', true)];
      if (String(dir) === '/fake/pan/agents/agent-2/codex-home/sessions') return [makeDirent('2026', true)];
      if (String(dir) === '/fake/pan/agents/agent-2/codex-home/sessions/2026') return [makeDirent('06', true)];
      if (String(dir) === '/fake/pan/agents/agent-2/codex-home/sessions/2026/06') return [makeDirent('17', true)];
      if (String(dir) === '/fake/pan/agents/agent-2/codex-home/sessions/2026/06/17')
        return [makeDirent('rollout-abc.jsonl', false)];
      return [];
    });

    vi.mocked(parseCodexSessionCostEventsSync).mockReturnValue(makeCodexCostEvents(rolloutFile));

    const { dbLayer, busLayer, archiveLayer, insertedValues } = makeTestLayer();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer), Layer.provide(busLayer), Layer.provide(archiveLayer),
    );

    const result = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'codex' })).pipe(Effect.provide(layer)),
    );

    expect(result).toMatchObject({
      imported: 2,
      skipped: [],
      sessionsScanned: 1,
      eventsImported: 2,
      duplicatesSkipped: 0,
      errors: [],
      earliestEventTs: '2026-06-17T10:00:01.000Z',
      latestEventTs: '2026-06-17T10:00:02.000Z',
    });
    expect(insertedValues).toHaveLength(2);
    const row = insertedValues[0] as Record<string, unknown>;
    expect(row.agentId).toBe('agent-2');
    expect(row.sessionType).toBe('codex');
    expect(row.provider).toBe('openai');
    expect(row.model).toBe('gpt-5.5');
    expect(row.requestId).toBe('codex:sess-abc:0');
    expect(row.sourceFile).toBe(rolloutFile);
    expect((insertedValues[1] as Record<string, unknown>).requestId).toBe('codex:sess-abc:1');
  });

  it('imports only new codex turns when a rollout file grows', async () => {
    const agentDir = '/fake/pan/agents';
    const rolloutFile = '/fake/pan/agents/agent-pan-2/codex-home/sessions/2026/06/17/rollout-abc.jsonl';
    const events = makeCodexCostEvents(rolloutFile);

    vi.mocked(readdirSync).mockImplementation((dir, _opts) => {
      if (String(dir) === agentDir) return [makeDirent('agent-pan-2', true)];
      if (String(dir) === '/fake/pan/agents/agent-pan-2/codex-home/sessions') return [makeDirent('2026', true)];
      if (String(dir) === '/fake/pan/agents/agent-pan-2/codex-home/sessions/2026') return [makeDirent('06', true)];
      if (String(dir) === '/fake/pan/agents/agent-pan-2/codex-home/sessions/2026/06') return [makeDirent('17', true)];
      if (String(dir) === '/fake/pan/agents/agent-pan-2/codex-home/sessions/2026/06/17')
        return [makeDirent('rollout-abc.jsonl', false)];
      return [];
    });

    vi.mocked(parseCodexSessionCostEventsSync)
      .mockReturnValueOnce(events.slice(0, 1))
      .mockReturnValueOnce(events);

    const { dbLayer, busLayer, archiveLayer, insertedValues } = makeTestLayer();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer), Layer.provide(busLayer), Layer.provide(archiveLayer),
    );

    const first = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'codex' })).pipe(Effect.provide(layer)),
    );
    const second = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'codex' })).pipe(Effect.provide(layer)),
    );

    expect(first).toMatchObject({ imported: 1, skipped: [] });
    expect(second).toMatchObject({ imported: 1, skipped: [] });
    expect(insertedValues).toHaveLength(2);
    expect(insertedValues.map((row) => (row as Record<string, unknown>).requestId)).toEqual([
      'codex:sess-abc:0',
      'codex:sess-abc:1',
    ]);
  });

  it('reports unknown-model codex sessions while preserving their events', async () => {
    const warnSpy = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const agentDir = '/fake/pan/agents';
    const rolloutFile = '/fake/pan/agents/agent-pan-2/codex-home/sessions/2026/06/17/rollout-abc.jsonl';
    const [event] = makeCodexCostEvents(rolloutFile);

    vi.mocked(readdirSync).mockImplementation((dir, _opts) => {
      if (String(dir) === agentDir) return [makeDirent('agent-pan-2', true)];
      if (String(dir) === '/fake/pan/agents/agent-pan-2/codex-home/sessions') return [makeDirent('2026', true)];
      if (String(dir) === '/fake/pan/agents/agent-pan-2/codex-home/sessions/2026') return [makeDirent('06', true)];
      if (String(dir) === '/fake/pan/agents/agent-pan-2/codex-home/sessions/2026/06') return [makeDirent('17', true)];
      if (String(dir) === '/fake/pan/agents/agent-pan-2/codex-home/sessions/2026/06/17')
        return [makeDirent('rollout-abc.jsonl', false)];
      return [];
    });
    vi.mocked(parseCodexSessionCostEventsSync).mockReturnValue([{ ...event!, model: 'unknown', cost: 0 }]);

    const { dbLayer, busLayer, archiveLayer, insertedValues } = makeTestLayer();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer), Layer.provide(busLayer), Layer.provide(archiveLayer),
    );

    const result = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'codex' })).pipe(Effect.provide(layer)),
    );

    expect(result).toMatchObject({ imported: 1, skipped: [{ file: rolloutFile, reason: 'unknown-model' }] });
    expect(insertedValues).toHaveLength(1);
    expect((insertedValues[0] as Record<string, unknown>).model).toBe('unknown');
    expect(warnSpy).toHaveBeenCalledTimes(1);
    expect(warnSpy).toHaveBeenCalledWith(`[cost-reconcile] skipped ${rolloutFile}: unknown-model`);
  });
});

describe('CostWriter.reconcile — non-pi/codex source', () => {
  it('returns { imported: 0 } for source: "claude" (no filesystem walk)', async () => {
    const { dbLayer, busLayer, archiveLayer } = makeTestLayer();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer), Layer.provide(busLayer), Layer.provide(archiveLayer),
    );

    const result = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'claude' })).pipe(Effect.provide(layer)),
    );

    expect(result).toMatchObject({
      imported: 0,
      skipped: [],
      sessionsScanned: 0,
      eventsImported: 0,
      duplicatesSkipped: 0,
      errors: [],
      earliestEventTs: null,
      latestEventTs: null,
    });
    // Filesystem mocks must not have been called for a non-pi/codex source
    expect(vi.mocked(existsSync)).not.toHaveBeenCalled();
  });
});
