import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { Effect, Layer } from 'effect';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';

import { Db, EventBus, CostArchive } from '../infra.js';
import { CostWriter, CostWriterLive } from '../cost.js';

const originalOverdeckHome = process.env.OVERDECK_HOME;

function makeDir(prefix: string): string {
  return mkdtempSync(join(tmpdir(), prefix));
}

function writeCodexRollout(root: string, cwd: string, name = 'rollout-test.jsonl'): string {
  const dayDir = join(root, '2026', '06', '17');
  mkdirSync(dayDir, { recursive: true });
  const file = join(dayDir, name);
  const rows = [
    { type: 'session_meta', timestamp: '2026-06-17T10:00:00Z', payload: { id: `thread-${name}`, cwd } },
    { type: 'turn_context', timestamp: '2026-06-17T10:00:01Z', payload: { turn_id: 't1', model: 'gpt-5.5' } },
    { type: 'event_msg', timestamp: '2026-06-17T10:00:02Z', payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 1200, cached_input_tokens: 200, output_tokens: 80, total_tokens: 1280 } } } },
  ];
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return file;
}

function writePiSession(file: string, sessionId: string, messageId: string, model = 'kimi-k2', provider: string | null = 'custom'): string {
  mkdirSync(dirname(file), { recursive: true });
  const rows = [
    { type: 'session', version: 3, id: sessionId, timestamp: '2026-06-18T12:00:00Z' },
    {
      type: 'message',
      id: messageId,
      parentId: null,
      timestamp: '2026-06-18T12:00:02Z',
      message: {
        role: 'assistant',
        ...(provider == null ? {} : { provider }),
        model,
        usage: {
          input: 900,
          output: 70,
          cacheRead: 120,
          cacheWrite: 15,
          cost: {
            input: 0.001,
            output: 0.002,
            cacheRead: 0.0001,
            cacheWrite: 0.0002,
            total: 0.0033,
          },
        },
      },
    },
  ];
  writeFileSync(file, rows.map((row) => JSON.stringify(row)).join('\n') + '\n');
  return file;
}

function makeTestLayer() {
  type Row = { id: number; sourceFile: string | null; requestId?: string | null; [k: string]: unknown };
  const rows: Row[] = [];
  let nextId = 1;
  const insertedValues: unknown[] = [];

  const filterRows = (cond: unknown): Row[] => {
    const chunks = (cond as { queryChunks?: Array<{ name?: string; value?: unknown; constructor?: { name?: string } }> })?.queryChunks;
    const column = chunks?.find((chunk) => typeof chunk?.name === 'string')?.name;
    const value = chunks?.find((chunk) => chunk?.constructor?.name === 'Param')?.value;
    if (column === 'request_id') {
      return rows.filter((row) => row.requestId === value);
    }
    if (column === 'source_file') {
      return rows.filter((row) => row.sourceFile === value);
    }
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
              rows.push({ id: nextId++, ...(vals as Row) });
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
  const archiveLayer = Layer.succeed(CostArchive, CostArchive.of({ append: () => Effect.void }));
  const layer = CostWriterLive.pipe(
    Layer.provide(dbLayer),
    Layer.provide(busLayer),
    Layer.provide(archiveLayer),
  );

  return { layer, insertedValues };
}

describe('CostWriter.reconcile — codex extra roots', () => {
  let overdeckHome: string;

  beforeEach(() => {
    overdeckHome = makeDir('pan-cost-roots-home-');
    process.env.OVERDECK_HOME = overdeckHome;
  });

  afterEach(() => {
    rmSync(overdeckHome, { recursive: true, force: true });
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
  });

  it('imports a global codex rollout with cwd-derived issue attribution once', async () => {
    const codexHome = makeDir('pan-cost-codex-');
    const sessionRoot = join(codexHome, 'sessions');
    const rollout = writeCodexRollout(sessionRoot, '/home/eltmon/Projects/overdeck/workspaces/feature-pan-1234');
    const { layer, insertedValues } = makeTestLayer();

    try {
      const first = await Effect.runPromise(
        CostWriter.use((writer) => writer.reconcile({ source: 'codex', extraRoots: [sessionRoot] })).pipe(Effect.provide(layer)),
      );
      const second = await Effect.runPromise(
        CostWriter.use((writer) => writer.reconcile({ source: 'codex', extraRoots: [sessionRoot] })).pipe(Effect.provide(layer)),
      );

      expect(first).toMatchObject({
        imported: 1,
        sessionsScanned: 1,
        eventsImported: 1,
        duplicatesSkipped: 0,
        errors: [],
        earliestEventTs: '2026-06-17T10:00:02.000Z',
        latestEventTs: '2026-06-17T10:00:02.000Z',
      });
      expect(second).toMatchObject({
        imported: 0,
        sessionsScanned: 1,
        eventsImported: 0,
        duplicatesSkipped: 0,
        cacheSkipped: 1,
      });
      expect(insertedValues).toHaveLength(1);
      expect(insertedValues[0]).toMatchObject({
        issueId: 'PAN-1234',
        agentId: 'codex-global',
        sessionType: 'codex',
        model: 'gpt-5.5',
        input: 1200,
        output: 80,
        cacheRead: 200,
        sourceFile: rollout,
      });
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  });

  it('falls back to UNKNOWN for global codex rollouts whose cwd has no issue id', async () => {
    const codexHome = makeDir('pan-cost-codex-');
    const sessionRoot = join(codexHome, 'sessions');
    writeCodexRollout(sessionRoot, '/home/eltmon/Projects/overdeck/main', 'rollout-no-issue.jsonl');
    const { layer, insertedValues } = makeTestLayer();

    try {
      await Effect.runPromise(
        CostWriter.use((writer) => writer.reconcile({ source: 'codex', extraRoots: [sessionRoot] })).pipe(Effect.provide(layer)),
      );

      expect(insertedValues).toHaveLength(1);
      expect(insertedValues[0]).toMatchObject({
        issueId: 'UNKNOWN',
        agentId: 'codex-global',
      });
    } finally {
      rmSync(codexHome, { recursive: true, force: true });
    }
  });
});

describe('CostWriter.reconcile — pi extra roots', () => {
  let overdeckHome: string;

  beforeEach(() => {
    overdeckHome = makeDir('pan-cost-roots-home-');
    process.env.OVERDECK_HOME = overdeckHome;
  });

  afterEach(() => {
    rmSync(overdeckHome, { recursive: true, force: true });
    if (originalOverdeckHome === undefined) delete process.env.OVERDECK_HOME;
    else process.env.OVERDECK_HOME = originalOverdeckHome;
  });

  it('imports global pi and legacy pi roots with issue attribution exactly once', async () => {
    const piHome = makeDir('pan-cost-pi-');
    const globalRoot = join(piHome, '.pi', 'agent', 'sessions');
    const legacyRoot = join(piHome, '.panopticon', 'agents');
    const globalSession = writePiSession(
      join(globalRoot, '--home-eltmon-Projects-overdeck-workspaces-feature-pan-1788--', 'global.jsonl'),
      'pi-global-session',
      'global-message',
    );
    const legacySession = writePiSession(
      join(legacyRoot, 'agent-pan-913', 'sessions', 'legacy.jsonl'),
      'pi-legacy-session',
      'legacy-message',
      'claude-3-5-sonnet',
      null,
    );
    const { layer, insertedValues } = makeTestLayer();

    try {
      const opts = {
        source: 'ohmypi' as const,
        extraRootSpecs: [
          { kind: 'ohmypi-global' as const, root: globalRoot },
          { kind: 'ohmypi-legacy-agents' as const, root: legacyRoot },
        ],
      };
      const first = await Effect.runPromise(
        CostWriter.use((writer) => writer.reconcile(opts)).pipe(Effect.provide(layer)),
      );
      const second = await Effect.runPromise(
        CostWriter.use((writer) => writer.reconcile(opts)).pipe(Effect.provide(layer)),
      );

      expect(first).toMatchObject({
        imported: 2,
        sessionsScanned: 2,
        eventsImported: 2,
        duplicatesSkipped: 0,
        errors: [],
        earliestEventTs: '2026-06-18T12:00:02.000Z',
        latestEventTs: '2026-06-18T12:00:02.000Z',
      });
      expect(second).toMatchObject({
        imported: 0,
        sessionsScanned: 2,
        eventsImported: 0,
        duplicatesSkipped: 2,
      });
      expect(insertedValues).toHaveLength(2);
      expect(insertedValues).toEqual(expect.arrayContaining([
        expect.objectContaining({
          issueId: 'PAN-1788',
          agentId: 'pi-global',
          sessionType: 'ohmypi',
          provider: 'custom',
          model: 'kimi-k2',
          input: 900,
          output: 70,
          cacheRead: 120,
          cacheWrite: 15,
          cost: 0.0033,
          requestId: 'ohmypi:pi-global-session:global-message',
          sourceFile: globalSession,
        }),
        expect.objectContaining({
          issueId: 'PAN-913',
          agentId: 'agent-pan-913',
          sessionType: 'ohmypi',
          provider: 'anthropic',
          model: 'claude-3-5-sonnet',
          input: 900,
          output: 70,
          cacheRead: 120,
          cacheWrite: 15,
          cost: 0.0033,
          requestId: 'ohmypi:pi-legacy-session:legacy-message',
          sourceFile: legacySession,
        }),
      ]));
    } finally {
      rmSync(piHome, { recursive: true, force: true });
    }
  });
});
