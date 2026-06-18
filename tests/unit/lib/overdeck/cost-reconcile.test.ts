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
  };
});

vi.mock('../../../../src/lib/cost-parsers/pi-parser.js', () => ({
  parsePiSessionSync: vi.fn(),
}));

vi.mock('../../../../src/lib/cost-parsers/codex-parser.js', () => ({
  parseCodexSessionSync: vi.fn(),
}));

vi.mock('../../../../src/lib/paths.js', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../../../src/lib/paths.js')>();
  return {
    ...actual,
    getPanopticonHome: vi.fn(() => '/fake/pan'),
    PANOPTICON_HOME:   '/fake/pan',
    AGENTS_DIR:        '/fake/pan/agents',
  };
});

import { existsSync, readdirSync } from 'node:fs';
import { parsePiSessionSync } from '../../../../src/lib/cost-parsers/pi-parser.js';
import { parseCodexSessionSync } from '../../../../src/lib/cost-parsers/codex-parser.js';
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

  const makeQueryResult = (data: unknown[]) => {
    const result: unknown = {
      then: (resolve: (v: unknown[]) => void) => { resolve(data); return result; },
      orderBy: (..._: unknown[]) => makeQueryResult(data),
      limit:   (n: number) => makeQueryResult(data.slice(0, n)),
      groupBy: (..._: unknown[]) => makeQueryResult(data),
      where:   (_cond: unknown) => makeQueryResult(rows),  // return all rows (sourceFile dedup works)
    };
    return result;
  };

  const q = new Proxy({} as never, {
    get: (_: unknown, prop: string) => {
      if (prop === 'then') return undefined;

      if (prop === 'select') {
        return (_fields?: unknown) => ({
          from: (_table: unknown) => ({
            where:   (_cond: unknown) => makeQueryResult(rows),
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
  const archiveLayer = Layer.succeed(
    CostArchive,
    CostArchive.of({ append: () => Effect.sync(() => undefined) }),
  );

  return { dbLayer, busLayer, archiveLayer, insertedValues, rows };
}

function makeSessionUsage(sessionFile: string, model = 'claude-sonnet-4-6') {
  return {
    sessionId:    'sess-abc',
    sessionFile,
    startTime:    '2026-06-17T10:00:00Z',
    endTime:      '2026-06-17T10:05:00Z',
    model,
    usage:        { inputTokens: 1000, outputTokens: 500, cacheReadTokens: 200 },
    cost:         0.05,
    cost_v2:      0.04,
    messageCount: 3,
  };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('CostWriter.reconcile — pi source', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(parsePiSessionSync).mockReturnValue(null);
  });

  afterEach(() => vi.clearAllMocks());

  it('returns { imported: 0 } when no agent directories exist', async () => {
    vi.mocked(existsSync).mockReturnValue(false);  // agents dir absent

    const { dbLayer, busLayer, archiveLayer } = makeTestLayer();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer), Layer.provide(busLayer), Layer.provide(archiveLayer),
    );

    const result = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'pi' })).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ imported: 0 });
  });

  it('imports one pi session and returns { imported: 1 }', async () => {
    const agentDir = '/fake/pan/agents';
    const sessionFile = '/fake/pan/agents/agent-1/sessions/sess.jsonl';

    vi.mocked(readdirSync).mockImplementation((dir, _opts) => {
      if (String(dir) === agentDir)
        return [makeDirent('agent-1', true)];
      if (String(dir) === '/fake/pan/agents/agent-1/sessions')
        return [makeDirent('sess.jsonl', false)];
      return [];
    });

    vi.mocked(parsePiSessionSync).mockReturnValue(makeSessionUsage(sessionFile));

    const { dbLayer, busLayer, archiveLayer, insertedValues } = makeTestLayer();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer), Layer.provide(busLayer), Layer.provide(archiveLayer),
    );

    const result = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'pi' })).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ imported: 1 });
    expect(insertedValues).toHaveLength(1);
    const row = insertedValues[0] as Record<string, unknown>;
    expect(row.agentId).toBe('agent-1');
    expect(row.sessionType).toBe('pi');
    expect(row.sourceFile).toBe(sessionFile);
    expect(row.cost).toBe(0.04);  // cost_v2 preferred over cost
  });

  it('skips a session already in the DB (dedup by sourceFile)', async () => {
    const agentDir = '/fake/pan/agents';
    const sessionFile = '/fake/pan/agents/agent-1/sessions/sess.jsonl';

    vi.mocked(readdirSync).mockImplementation((dir, _opts) => {
      if (String(dir) === agentDir) return [makeDirent('agent-1', true)];
      if (String(dir) === '/fake/pan/agents/agent-1/sessions') return [makeDirent('sess.jsonl', false)];
      return [];
    });

    vi.mocked(parsePiSessionSync).mockReturnValue(makeSessionUsage(sessionFile));

    const { dbLayer, busLayer, archiveLayer, rows, insertedValues } = makeTestLayer();

    // Pre-seed DB with the existing sourceFile row so checkDuplicate returns true
    rows.push({ id: 1, sourceFile: sessionFile });

    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer), Layer.provide(busLayer), Layer.provide(archiveLayer),
    );

    const result = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'pi' })).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ imported: 0 });
    expect(insertedValues).toHaveLength(0);  // nothing new inserted
  });
});

describe('CostWriter.reconcile — codex source', () => {
  beforeEach(() => {
    vi.mocked(existsSync).mockReturnValue(true);
    vi.mocked(readdirSync).mockReturnValue([]);
    vi.mocked(parseCodexSessionSync).mockReturnValue(null);
  });

  afterEach(() => vi.clearAllMocks());

  it('imports one codex session and returns { imported: 1 }', async () => {
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

    vi.mocked(parseCodexSessionSync).mockReturnValue(makeSessionUsage(rolloutFile, 'gpt-4o'));

    const { dbLayer, busLayer, archiveLayer, insertedValues } = makeTestLayer();
    const layer = CostWriterLive.pipe(
      Layer.provide(dbLayer), Layer.provide(busLayer), Layer.provide(archiveLayer),
    );

    const result = await Effect.runPromise(
      CostWriter.use((w) => w.reconcile({ source: 'codex' })).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ imported: 1 });
    expect(insertedValues).toHaveLength(1);
    const row = insertedValues[0] as Record<string, unknown>;
    expect(row.agentId).toBe('agent-2');
    expect(row.sessionType).toBe('codex');
    expect(row.model).toBe('gpt-4o');
    expect(row.sourceFile).toBe(rolloutFile);
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

    expect(result).toEqual({ imported: 0 });
    // Filesystem mocks must not have been called for a non-pi/codex source
    expect(vi.mocked(existsSync)).not.toHaveBeenCalled();
  });
});
