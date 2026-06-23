/**
 * Silent-bug detector for the overdeck timestamp-unit standardization (PAN-1961).
 *
 * The corruption is SILENT: no STRICT tables, so a wrong-unit value is stored, not
 * rejected. "typecheck + tests green" cannot prove the fix — so this test reads the
 * RAW stored integer and asserts its MAGNITUDE: epoch-milliseconds is ~1.7e12,
 * epoch-seconds is ~1.7e9. A `> 1e12` guard catches a seconds value instantly.
 *
 * Standard: all overdeck timestamps are integer epoch-MILLISECONDS (`mode:'timestamp_ms'`).
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { Effect, Layer } from 'effect';

import { createEventStore } from '../../../../src/dashboard/server/event-store.js';
import { Db, EventBus, MemoryFiles, MemorySearch, type FtsStatement } from '../../../../src/lib/overdeck/infra.js';
import { openDatabase, type SqliteDatabase } from '../../../../src/lib/database/driver.js';
import { overdeckIssues, type IssueId, type Stage } from '../../../../src/lib/overdeck/issues.js';
import { EventBusLive } from '../../../../src/lib/overdeck/infra.js';
import { upsertReviewStatusSync } from '../../../../src/lib/overdeck/review-status-sync.js';
import { createConversation, markConversationEnded, updateLastAttached, archiveConversation, setConversationClaudeSessionId, setFavorite } from '../../../../src/lib/overdeck/conversations.js';
import { upsertDiscoveredSession, updateEnrichment, insertEmbedding } from '../../../../src/lib/overdeck/discovered-sessions.js';
import { appendGitOperationSync } from '../../../../src/lib/overdeck/git-activity.js';
import { upsert as upsertFlywheelBug, markFixed as markFlywheelBugFixed } from '../../../../src/lib/overdeck/flywheel-substrate-bugs.js';
import { insertCostEventSync } from '../../../../src/lib/overdeck/cost-sync.js';
import { claimTranscriptRange, commitTranscriptRange } from '../../../../src/lib/overdeck/transcript-checkpoint-sync.js';
import { MemoryWriter, MemoryWriterLive } from '../../../../src/lib/overdeck/memory.js';
import {
  setupOverdeckTestDb,
  teardownOverdeckTestDb,
  saveOverdeckAgentStateSync,
  type OverdeckTestDb,
} from '../../../helpers/overdeck-test-db.js';

const MS_FLOOR = 1_000_000_000_000; // 1e12 — below this is seconds (or 1970), above is plausible ms
const NOW_SLOP_MS = 60_000;

function expectMillis(value: unknown, before = Date.now()): void {
  expect(typeof value).toBe('number');
  expect(value as number).toBeGreaterThan(MS_FLOOR);
  expect(Math.abs((value as number) - before)).toBeLessThan(NOW_SLOP_MS);
}

function expectExactlyMillis(value: unknown, expected: Date): void {
  expect(value).toBe(expected.getTime());
  expect(value as number).toBeGreaterThan(MS_FLOOR);
}

function fakeMemoryLayer(dbLayer: Layer.Layer<Db>) {
  const memoryFiles = Layer.succeed(
    MemoryFiles,
    MemoryFiles.of({
      appendObservation: () => Effect.succeed({ jsonlPath: '/tmp/observations.jsonl', byteOffset: 0 }),
      upsertMarkdown: () => Effect.void,
      readStatus: () => Effect.succeed(null),
      writeStatus: () => Effect.void,
      readResetMarkers: () => Effect.succeed([]),
      writeResetMarker: () => Effect.void,
      listObservationFiles: () => Effect.succeed([]),
      readObservationsFile: () => Effect.succeed([]),
      findByteOffset: () => Effect.succeed(0),
    }),
  );
  const memorySearch = Layer.succeed(
    MemorySearch,
    MemorySearch.of({
      statement: <T>(_projectId: string, statement: FtsStatement) =>
        Effect.sync(() => {
          const db = memorySearchDb;
          if (statement.method === 'exec') {
            db.exec(statement.sql);
            return undefined as T;
          }
          if (statement.method === 'get') return db.prepare(statement.sql).get(...(statement.params ?? [])) as T;
          if (statement.method === 'all') return db.prepare(statement.sql).all(...(statement.params ?? [])) as T;
          db.prepare(statement.sql).run(...(statement.params ?? []));
          return undefined as T;
        }),
      transaction: (_projectId: string, statements: ReadonlyArray<FtsStatement>) =>
        Effect.sync(() => {
          const db = memorySearchDb;
          return statements.map((statement) => {
            if (statement.method === 'exec') {
              db.exec(statement.sql);
              return undefined;
            }
            if (statement.method === 'get') return db.prepare(statement.sql).get(...(statement.params ?? []));
            if (statement.method === 'all') return db.prepare(statement.sql).all(...(statement.params ?? []));
            return db.prepare(statement.sql).run(...(statement.params ?? []));
          });
        }),
    }),
  );
  const bus = Layer.succeed(
    EventBus,
    EventBus.of({
      emit: () => Effect.succeed(1),
      readFrom: () => Effect.succeed([]),
      getLatestSequence: Effect.succeed(0),
      stream: Effect.never as never,
    }),
  );
  return MemoryWriterLive.pipe(Layer.provide(Layer.mergeAll(dbLayer, memoryFiles, memorySearch, bus)));
}

let memorySearchDb: SqliteDatabase;

describe('overdeck timestamp units — integer epoch-milliseconds (PAN-1961)', () => {
  let odb: OverdeckTestDb;
  beforeEach(() => {
    odb = setupOverdeckTestDb();
    memorySearchDb = openDatabase(':memory:');
    memorySearchDb.exec(`
      CREATE TABLE reset_markers (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        from_timestamp INTEGER NOT NULL,
        reason TEXT,
        created_at INTEGER NOT NULL
      );
    `);
  });
  afterEach(() => {
    memorySearchDb.close();
    teardownOverdeckTestDb(odb);
  });

  it('Drizzle resolver writes issues.updated_at as epoch MILLISECONDS, not seconds', async () => {
    const before = Date.now();
    await Effect.runPromise(
      Db.pipe(
        Effect.flatMap((db) =>
          Effect.promise(() =>
            db.q
              .insert(overdeckIssues)
              .values({ id: 'PAN-TS-1' as IssueId, stage: 'working' as Stage, blockers: [], updatedAt: new Date() })
              .then(() => {}),
          ),
        ),
        Effect.provide(odb.dbLayer),
      ),
    );
    const row = odb.raw().prepare('SELECT updated_at FROM issues WHERE id = ?').get('PAN-TS-1') as { updated_at: number };
    expect(row.updated_at).toBeGreaterThan(MS_FLOOR);
    expect(Math.abs(row.updated_at - before)).toBeLessThan(60_000);
  });

  it('raw agent-state path writes agents.updated_at as epoch MILLISECONDS', () => {
    const before = Date.now();
    saveOverdeckAgentStateSync({
      id: 'agent-pan-9001',
      issueId: 'PAN-9001',
      workspace: '/tmp/ws',
      role: 'work',
      model: 'x',
      status: 'running',
      startedAt: new Date().toISOString(),
    } as Parameters<typeof saveOverdeckAgentStateSync>[0]);
    const row = odb.raw().prepare('SELECT updated_at FROM agents WHERE id = ?').get('agent-pan-9001') as { updated_at: number };
    expect(row.updated_at).toBeGreaterThan(MS_FLOOR);
    expect(Math.abs(row.updated_at - before)).toBeLessThan(60_000);
  });

  it('the two write paths agree on unit for the same column (no seconds/millis collision)', async () => {
    // issues.updated_at is written by both the Drizzle resolver and the raw sync path.
    await Effect.runPromise(
      Db.pipe(
        Effect.flatMap((db) =>
          Effect.promise(() =>
            db.q.insert(overdeckIssues).values({ id: 'PAN-TS-2' as IssueId, stage: 'working' as Stage, blockers: [], updatedAt: new Date() }).then(() => {}),
          ),
        ),
        Effect.provide(odb.dbLayer),
      ),
    );
    saveOverdeckAgentStateSync({
      id: 'agent-pan-9002', issueId: 'PAN-TS-3', workspace: '/tmp/ws', role: 'work', model: 'x',
      status: 'running', startedAt: new Date().toISOString(),
    } as Parameters<typeof saveOverdeckAgentStateSync>[0]);
    const a = odb.raw().prepare('SELECT updated_at FROM issues WHERE id = ?').get('PAN-TS-2') as { updated_at: number };
    const b = odb.raw().prepare('SELECT updated_at FROM issues WHERE id = ?').get('PAN-TS-3') as { updated_at: number };
    // Same column, two writers — both must be in the ms range (within ~5 min of each other).
    expect(a.updated_at).toBeGreaterThan(MS_FLOOR);
    expect(b.updated_at).toBeGreaterThan(MS_FLOOR);
    expect(Math.abs(a.updated_at - b.updated_at)).toBeLessThan(300_000);
  });

  it('schema declares audited timestamp columns as integer', () => {
    const expected: Record<string, string[]> = {
      events: ['timestamp'],
      status_history: ['timestamp'],
      conversations: ['created_at', 'archived_at', 'ended_at', 'last_attached_at'],
      conversation_files: ['created_at'],
      favorites: ['created_at'],
      transcripts: ['first_ts', 'last_ts', 'file_mtime', 'scanned_at'],
      discovered_sessions: ['first_ts', 'last_ts', 'enriched_at', 'file_mtime', 'scanned_at'],
      session_embeddings: ['created_at'],
      git_operations: ['ts'],
      flywheel_substrate_bugs: ['filed_at', 'fix_merged_at', 'updated_at'],
      app_settings: ['updated_at'],
      issue_policy: ['updated_at'],
      merge_sets: ['created_at', 'updated_at'],
      merge_queue: ['queued_at', 'started_at'],
      pending_auto_merges: ['scheduled_merge_at', 'scheduled_at', 'merged_at', 'cancelled_at'],
      uat_generations: ['stack_started_at', 'cleaned_at', 'created_at', 'updated_at'],
      cost_events: ['ts'],
      transcript_checkpoints: ['claim_expires_at', 'last_mid_turn_at', 'updated_at'],
    };

    for (const [table, columns] of Object.entries(expected)) {
      const rows = odb.raw().prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string; type: string }>;
      const byName = new Map(rows.map((row) => [row.name, row.type.toLowerCase()]));
      for (const column of columns) {
        expect(byName.get(column), `${table}.${column}`).toBe('integer');
      }
    }
  });

  it('event store writes events.timestamp as epoch MILLISECONDS', () => {
    const before = Date.now();
    const store = createEventStore(odb.raw() as never);
    store.append({ type: 'test.event', payload: { ok: true } } as never);
    const row = odb.raw().prepare('SELECT timestamp FROM events WHERE type = ?').get('test.event') as { timestamp: number };
    expectMillis(row.timestamp, before);
  });

  it('overdeck EventBus writes events.timestamp as epoch MILLISECONDS', async () => {
    const before = Date.now();
    await Effect.runPromise(
      EventBus.pipe(
        Effect.flatMap((bus) => bus.emit({ type: 'test.eventbus', payload: { ok: true } })),
        Effect.provide(EventBusLive),
        Effect.provide(odb.dbLayer),
      ),
    );
    const row = odb.raw().prepare('SELECT timestamp FROM events WHERE type = ?').get('test.eventbus') as { timestamp: number };
    expectMillis(row.timestamp, before);
  });

  it('review status history writes status_history.timestamp as epoch MILLISECONDS', () => {
    const at = new Date();
    upsertReviewStatusSync({
      issueId: 'PAN-TS-4',
      reviewStatus: 'passed',
      testStatus: 'pending',
      updatedAt: at.toISOString(),
      history: [{ type: 'review', status: 'passed', timestamp: at.toISOString() }],
    } as Parameters<typeof upsertReviewStatusSync>[0]);
    const row = odb.raw().prepare('SELECT timestamp FROM status_history WHERE issue_id = ?').get('PAN-TS-4') as { timestamp: number };
    expectExactlyMillis(row.timestamp, at);
  });

  it('memory writer writes reset_markers timestamps as epoch MILLISECONDS', async () => {
    const from = new Date();
    await Effect.runPromise(
      MemoryWriter.pipe(
        Effect.flatMap((writer) => writer.createResetMarker({
          projectId: 'overdeck',
          scope: 'issue',
          scopeId: 'PAN-TS-5',
          fromTimestamp: from.toISOString(),
          reason: 'test',
        })),
        Effect.provide(fakeMemoryLayer(odb.dbLayer)),
      ),
    );
    const row = memorySearchDb.prepare('SELECT from_timestamp, created_at FROM reset_markers WHERE scope_id = ?').get('PAN-TS-5') as {
      from_timestamp: number;
      created_at: number;
    };
    expectExactlyMillis(row.from_timestamp, from);
    expectMillis(row.created_at);
  });

  it('conversation writers store conversation timestamps as epoch MILLISECONDS', () => {
    const before = Date.now();
    createConversation({ name: 'timestamp-test', tmuxSession: 'conv-timestamp-test', cwd: '/tmp' });
    markConversationEnded('timestamp-test');
    updateLastAttached('timestamp-test');
    archiveConversation('timestamp-test');
    setConversationClaudeSessionId('timestamp-test', 'claude-session-ts');
    setFavorite('conversation', 'timestamp-test');

    const conv = odb.raw().prepare(
      'SELECT id, created_at, archived_at, ended_at, last_attached_at FROM conversations WHERE name = ?',
    ).get('timestamp-test') as { id: string; created_at: number; archived_at: number; ended_at: number; last_attached_at: number };
    expectMillis(conv.created_at, before);
    expectMillis(conv.archived_at, before);
    expectMillis(conv.ended_at, before);
    expectMillis(conv.last_attached_at, before);

    const file = odb.raw().prepare('SELECT created_at FROM conversation_files WHERE conversation_id = ?').get(conv.id) as { created_at: number };
    expectMillis(file.created_at, before);
    const favorite = odb.raw().prepare('SELECT created_at FROM favorites WHERE item_id = ?').get('timestamp-test') as { created_at: number };
    expectMillis(favorite.created_at, before);
  });

  it('discovered-session writers store timestamps as epoch MILLISECONDS', () => {
    const first = new Date();
    const last = new Date(first.getTime() + 1_000);
    const fileMtime = new Date(first.getTime() + 2_000);
    const session = upsertDiscoveredSession({
      jsonlPath: '/tmp/timestamp-session.jsonl',
      firstTs: first.toISOString(),
      lastTs: last.toISOString(),
      fileMtime: fileMtime.toISOString(),
      tags: ['x'],
    });
    updateEnrichment(session.id, { enrichmentLevel: 1, enrichmentModel: 'm', summary: 's' });
    insertEmbedding(session.id, 'm', new Float32Array([1, 0]));

    const row = odb.raw().prepare(
      'SELECT first_ts, last_ts, file_mtime, scanned_at, enriched_at FROM discovered_sessions WHERE id = ?',
    ).get(session.id) as { first_ts: number; last_ts: number; file_mtime: number; scanned_at: number; enriched_at: number };
    expectExactlyMillis(row.first_ts, first);
    expectExactlyMillis(row.last_ts, last);
    expectExactlyMillis(row.file_mtime, fileMtime);
    expectMillis(row.scanned_at);
    expectMillis(row.enriched_at);

    const embedding = odb.raw().prepare('SELECT created_at FROM session_embeddings WHERE session_id = ?').get(session.id) as { created_at: number };
    expectMillis(embedding.created_at);
  });

  it('git operation writer stores git_operations.ts as epoch MILLISECONDS', () => {
    const at = new Date();
    appendGitOperationSync({ operation: 'push', status: 'success', ts: at.toISOString() });
    const row = odb.raw().prepare('SELECT ts FROM git_operations WHERE operation = ?').get('push') as { ts: number };
    expectExactlyMillis(row.ts, at);
  });

  it('flywheel substrate bug writers store timestamps as epoch MILLISECONDS', () => {
    const filedAt = new Date();
    const mergedAt = new Date(filedAt.getTime() + 1_000);
    upsertFlywheelBug({
      issueId: 'PAN-TS-6',
      filedAt: filedAt.toISOString(),
      filedBy: 'agent',
      updatedAt: filedAt.toISOString(),
    });
    markFlywheelBugFixed('PAN-TS-6', 'abc123', mergedAt.toISOString());
    const row = odb.raw().prepare(
      'SELECT filed_at, fix_merged_at, updated_at FROM flywheel_substrate_bugs WHERE issue_id = ?',
    ).get('PAN-TS-6') as { filed_at: number; fix_merged_at: number; updated_at: number };
    expectExactlyMillis(row.filed_at, filedAt);
    expectExactlyMillis(row.fix_merged_at, mergedAt);
    expectExactlyMillis(row.updated_at, mergedAt);
  });

  it('cost event writer stores cost_events.ts as epoch MILLISECONDS', () => {
    const at = new Date();
    insertCostEventSync({
      ts: at.toISOString(),
      issueId: 'PAN-TS-7',
      input: 1,
      output: 2,
      cacheRead: 3,
      cacheWrite: 4,
      cost: 0.01,
      requestId: 'req-ts-7',
    } as Parameters<typeof insertCostEventSync>[0]);
    const row = odb.raw().prepare('SELECT ts FROM cost_events WHERE request_id = ?').get('req-ts-7') as { ts: number };
    expectExactlyMillis(row.ts, at);
  });

  it('transcript checkpoint writers store checkpoint timestamps as epoch MILLISECONDS', () => {
    const now = new Date();
    const claim = claimTranscriptRange({
      sessionId: 'session-ts-8',
      expectedFromOffset: 0,
      toOffset: 10,
      transcriptPath: '/tmp/transcript.jsonl',
      identity: { projectId: 'p', workspaceId: 'w', issueId: 'PAN-TS-8' },
      trigger: 'poller',
      now,
    });
    expect(claim.status).toBe('claimed');
    commitTranscriptRange({
      sessionId: 'session-ts-8',
      expectedFromOffset: 0,
      toOffset: 10,
      consumedOffset: 10,
      transcriptPath: '/tmp/transcript.jsonl',
      identity: { projectId: 'p', workspaceId: 'w', issueId: 'PAN-TS-8' },
      trigger: 'poller',
      now,
    });
    const row = odb.raw().prepare(
      'SELECT claim_expires_at, last_mid_turn_at, updated_at FROM transcript_checkpoints WHERE session_id = ?',
    ).get('session-ts-8') as { claim_expires_at: number | null; last_mid_turn_at: number; updated_at: number };
    expect(row.claim_expires_at).toBeNull();
    expectExactlyMillis(row.last_mid_turn_at, now);
    expectExactlyMillis(row.updated_at, now);
  });
});
