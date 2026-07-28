import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Effect, Fiber, Stream } from 'effect';

vi.mock('../../../../src/lib/pan-dir/auto-commit.js', () => ({
  queueAutoCommit: vi.fn(),
  flushAutoCommits: vi.fn(() => Effect.succeed({ committed: false, reason: 'no pending' })),
}));

import { createOverdeckDatabase, OVERDECK_TABLE_COUNT } from '../../../../scripts/create-overdeck-db.js';
import { openDatabase } from '../../../../src/lib/database/driver.js';
import {
  CostArchive,
  Db,
  EventBus,
  EventBusLive,
  Forge,
  makeDbLive,
  MemoryFiles,
  MemorySearch,
  overdeckEvents,
  Projects,
  Records,
  RecordsLive,
  Tmux,
} from '../../../../src/lib/overdeck/infra.js';
import { RECORD_SCHEMA_VERSION, type PanIssueRecord } from '../../../../src/lib/pan-dir/record.js';
import type { ProjectConfig } from '../../../../src/lib/projects.js';

let tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'pan-overdeck-infra-'));
  tempDirs.push(dir);
  return dir;
}

function makeDbPath(): string {
  const dbPath = join(makeTempDir(), 'overdeck.db');
  createOverdeckDatabase({ dbPath });
  return dbPath;
}

function sampleRecord(issueId: string): PanIssueRecord {
  return {
    issueId,
    schemaVersion: RECORD_SCHEMA_VERSION,
    pipeline: {
      issueId,
      reviewStatus: 'pending',
      testStatus: 'pending',
      readyForMerge: false,
      updatedAt: '2026-06-17T00:00:00.000Z',
    },
    closeOut: {
      usage: { byStage: {}, totals: {} },
      merges: [],
      ranOn: 'test',
    },
  };
}

afterEach(() => {
  for (const dir of tempDirs) {
    rmSync(dir, { recursive: true, force: true });
  }
  tempDirs = [];
});

describe('overdeck infra', () => {
  it('resolves Db as a Drizzle-over-node-sqlite service', async () => {
    const dbPath = makeDbPath();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const db = yield* Db;
        const events = yield* Effect.promise(() => db.q.select().from(overdeckEvents));
        return { path: db.path, query: db.q, events };
      }).pipe(Effect.provide(makeDbLive(dbPath))),
    );

    expect(result.path).toBe(dbPath);
    expect(result.query).toBeDefined();
    expect(result.events).toEqual([]);

    const raw = openDatabase(dbPath);
    try {
      const tableCount = raw.prepare(`
        SELECT COUNT(*) AS count
        FROM sqlite_master
        WHERE type = 'table'
          AND name NOT LIKE 'sqlite_%'
      `).get<{ count: number }>()?.count;
      expect(tableCount).toBe(OVERDECK_TABLE_COUNT);
    } finally {
      raw.close();
    }
  });

  it('emits, reads, and streams events through EventBusLive', async () => {
    const dbPath = makeDbPath();

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const bus = yield* EventBus;
        const streamFiber = yield* Effect.forkChild(Stream.runCollect(Stream.take(bus.stream, 1)));
        const sequence = yield* bus.emit({
          type: 'test.event',
          timestamp: new Date('2026-06-17T12:00:00.000Z'),
          payload: { issueId: 'PAN-1938' },
        });
        const streamEvents = yield* Fiber.join(streamFiber);
        const events = yield* bus.readFrom(0);
        const latest = yield* bus.getLatestSequence;
        return { sequence, events, latest, streamEvents: Array.from(streamEvents) };
      }).pipe(
        Effect.provide(EventBusLive),
        Effect.provide(makeDbLive(dbPath)),
      ),
    );

    expect(result.sequence).toBe(1);
    expect(result.latest).toBe(1);
    expect(result.events).toEqual([
      {
        sequence: 1,
        type: 'test.event',
        timestamp: new Date('2026-06-17T12:00:00.000Z'),
        payload: { issueId: 'PAN-1938' },
      },
    ]);
    expect(result.streamEvents.map((event) => event.type)).toEqual(['test.event']);
  });

  it('writes and reads git-backed issue records through RecordsLive', async () => {
    const project: ProjectConfig = {
      name: 'Test Project',
      path: makeTempDir(),
      issue_prefix: 'PAN',
    };

    const result = await Effect.runPromise(
      Effect.gen(function* () {
        const records = yield* Records;
        const path = yield* records.writeIssue(project, 'PAN-1938', sampleRecord('PAN-1938'));
        const record = yield* records.readIssue(project, 'PAN-1938');
        const spec = yield* records.readSpec('package.json');
        return { path, record, spec };
      }).pipe(Effect.provide(RecordsLive)),
    );

    expect(result.path).toBe(join(project.path, '.pan', 'records', 'pan-1938.json'));
    expect(JSON.parse(readFileSync(result.path, 'utf8')).issueId).toBe('PAN-1938');
    expect(result.record?.issueId).toBe('PAN-1938');
    expect(result.record?.schemaVersion).toBe(RECORD_SCHEMA_VERSION);
    expect(result.spec).toMatchObject({ name: '@overdeck/core' });
  });

  it('exports the domain infra tags whose Live layers are supplied by owning domains', () => {
    expect(Tmux.key).toBe('overdeck/Tmux');
    expect(Forge.key).toBe('overdeck/Forge');
    expect(Projects.key).toBe('overdeck/Projects');
    expect(CostArchive.key).toBe('overdeck/CostArchive');
    expect(MemorySearch.key).toBe('overdeck/MemorySearch');
    expect(MemoryFiles.key).toBe('overdeck/MemoryFiles');
  });
});

/**
 * PAN-3092: the at-most-once append claims its key in `event_idempotency`, which
 * lives in overdeck.db. Hand-built test databases that pre-create the table
 * prove nothing about the shipping path — this exercises the real schema door,
 * including the case that matters most in the field: an EXISTING database, where
 * the init migration short-circuits on `agents` and only a runtime top-up runs.
 */
describe('event_idempotency reaches overdeck.db through the real schema door (PAN-3092)', () => {
  function tableExists(dbPath: string): boolean {
    const raw = openDatabase(dbPath);
    try {
      return !!raw.prepare(
        `SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'event_idempotency'`,
      ).get();
    } finally {
      raw.close();
    }
  }

  it('creates the table on a fresh database', async () => {
    const { getOverdeckDatabaseSync, closeOverdeckDatabaseSync } =
      await import('../../../../src/lib/overdeck/infra.js');
    const dbPath = join(makeTempDir(), 'overdeck.db');

    getOverdeckDatabaseSync(dbPath);
    closeOverdeckDatabaseSync();

    expect(tableExists(dbPath)).toBe(true);
  });

  it('tops up an existing database whose init migration already ran', async () => {
    const { getOverdeckDatabaseSync, closeOverdeckDatabaseSync } =
      await import('../../../../src/lib/overdeck/infra.js');
    const dbPath = join(makeTempDir(), 'overdeck.db');

    // Build a production-shaped database, then drop the table to model every
    // installation that predates it. `agents` is present, so the init migration
    // returns early and only the runtime top-up can restore it.
    getOverdeckDatabaseSync(dbPath);
    closeOverdeckDatabaseSync();
    const raw = openDatabase(dbPath);
    raw.exec('DROP TABLE event_idempotency');
    expect(!!raw.prepare(`SELECT name FROM sqlite_master WHERE name = 'agents'`).get()).toBe(true);
    raw.close();
    expect(tableExists(dbPath)).toBe(false);

    getOverdeckDatabaseSync(dbPath);
    closeOverdeckDatabaseSync();

    expect(tableExists(dbPath)).toBe(true);
  });

  it('lets appendOnce succeed against a database opened the production way', async () => {
    const { getOverdeckDatabaseSync, closeOverdeckDatabaseSync } =
      await import('../../../../src/lib/overdeck/infra.js');
    const { createEventStore } = await import('../../../../src/dashboard/server/event-store.js');
    const dbPath = join(makeTempDir(), 'overdeck.db');

    const db = getOverdeckDatabaseSync(dbPath);
    try {
      const store = createEventStore(db as never);
      const event = {
        type: 'activity.entry',
        timestamp: new Date().toISOString(),
        payload: { id: 'verdict-fallback:PAN-3092:gen-1' },
      };

      // The exact production call that returned HTTP 500 with the table missing.
      expect(store.appendOnce(event as never, 'episode-1').outcome).toBe('appended');
      expect(store.appendOnce(event as never, 'episode-1').outcome).toBe('duplicate');
    } finally {
      closeOverdeckDatabaseSync();
    }
  });
});
