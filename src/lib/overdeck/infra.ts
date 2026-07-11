import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join } from 'node:path';

import { Context, Effect, Layer, Queue, Stream } from 'effect';
import { asc, gt, sql } from 'drizzle-orm';
import { drizzle, type RemoteCallback, type SqliteRemoteDatabase } from 'drizzle-orm/sqlite-proxy';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import {
  openDatabase,
  type SqliteDatabase,
  type SqliteRow,
  type SqliteScalar,
} from '../database/driver.js';
import {
  readIssueRecordSync,
  writeIssueRecordSync,
  type PanIssueRecord,
} from '../pan-dir/record.js';
import type { ProjectConfig } from '../projects.js';
import { packageRoot, getOverdeckHome } from '../paths.js';
import { sessionExists as tmuxSessionExists, killSession as tmuxKillSession, getAgentSessions } from '../tmux.js';
import { getOverdeckDatabasePath, OVERDECK_MIGRATION_PATH } from './paths.js';

export const overdeckEvents = sqliteTable('events', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp_ms' }).notNull(),
  payload: text('payload', { mode: 'json' }).$type<unknown | null>(),
});

const overdeckSchema = {
  events: overdeckEvents,
};

export type OverdeckDrizzleDatabase = SqliteRemoteDatabase<typeof overdeckSchema>;

export interface DbServiceShape {
  readonly q: OverdeckDrizzleDatabase;
  readonly path: string;
}

export class Db extends Context.Service<Db, DbServiceShape>()('overdeck/Db') {}

let overdeckDbSync: { path: string; db: SqliteDatabase } | null = null;

function runOverdeckMigrationSync(db: SqliteDatabase): void {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'agents'`)
    .get();
  if (row) return;

  const migration = readFileSync(OVERDECK_MIGRATION_PATH, 'utf8');
  for (const statement of migration.split('--> statement-breakpoint')) {
    const trimmed = statement.trim();
    if (trimmed) db.exec(trimmed);
  }
}

/**
 * Idempotent schema top-ups for databases created before a field/index existed
 * in the init migration. The init migration only runs on a fresh database.
 * PAN-2220: the conversation ledger-cost query joins cost_events on session_id;
 * without this index SQLite builds an automatic index on every query (~76ms → 7ms).
 */
function ensureRuntimeIndexesSync(db: SqliteDatabase): void {
  try { db.exec('ALTER TABLE `discovered_sessions` ADD COLUMN `harness` text'); } catch { /* already exists or table absent */ }
  try { db.exec("UPDATE `discovered_sessions` SET `harness` = 'claude-code' WHERE `harness` IS NULL"); } catch { /* table absent */ }
  try { db.exec('ALTER TABLE `review_status` ADD COLUMN `release_status` text'); } catch { /* already exists or table absent */ }
  try { db.exec('ALTER TABLE `review_status` ADD COLUMN `release_notes` text'); } catch { /* already exists or table absent */ }
  db.exec('CREATE INDEX IF NOT EXISTS `cost_session_id_idx` ON `cost_events` (`session_id`)');
  // PAN-2507: preemptive-scheduler yield attribution on agents. The init
  // migration only runs on a fresh DB, so existing overdeck.db files need these
  // columns added idempotently here.
  try { db.exec('ALTER TABLE `agents` ADD COLUMN `yielded_by_scheduler` integer'); } catch { /* already exists or table absent */ }
  // PAN-2585: PAN-1862 discovery-fork state — was state.json-only (write-only under
  // the DB-first reader), which blinded the discovery-ready signal and its backstop.
  try { db.exec('ALTER TABLE `agents` ADD COLUMN `review_discovery_pending` integer'); } catch { /* already exists or table absent */ }
  try { db.exec('ALTER TABLE `agents` ADD COLUMN `review_context_manifest_path` text'); } catch { /* already exists or table absent */ }
  try { db.exec('ALTER TABLE `agents` ADD COLUMN `review_discovery_ready_at` integer'); } catch { /* already exists or table absent */ }
  try { db.exec('ALTER TABLE `agents` ADD COLUMN `review_convoy_forked_at` integer'); } catch { /* already exists or table absent */ }
  try { db.exec('ALTER TABLE `agents` ADD COLUMN `review_fork_cache_checked` integer'); } catch { /* already exists or table absent */ }
  try { db.exec('ALTER TABLE `agents` ADD COLUMN `review_forked_from_parent` integer'); } catch { /* already exists or table absent */ }
  try { db.exec('ALTER TABLE `agents` ADD COLUMN `yielded_at` integer'); } catch { /* already exists or table absent */ }
  try { db.exec('ALTER TABLE `agents` ADD COLUMN `last_yield_resume_at` integer'); } catch { /* already exists or table absent */ }
}

export function getOverdeckDatabaseSync(dbPath = getOverdeckDatabasePath()): SqliteDatabase {
  if (overdeckDbSync?.path === dbPath) {
    return overdeckDbSync.db;
  }

  if (overdeckDbSync) {
    overdeckDbSync.db.close();
    overdeckDbSync = null;
  }

  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const db = openDatabase(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  runOverdeckMigrationSync(db);
  ensureRuntimeIndexesSync(db);
  overdeckDbSync = { path: dbPath, db };
  return db;
}

export function closeOverdeckDatabaseSync(): void {
  overdeckDbSync?.db.close();
  overdeckDbSync = null;
}

function rowValues(row: SqliteRow | undefined): SqliteScalar[] {
  return row ? Object.values(row) : [];
}

function createDrizzleNodeSqliteDatabase(raw: SqliteDatabase): OverdeckDrizzleDatabase {
  const callback: RemoteCallback = async (sql, params, method) => {
    const statement = raw.prepare(sql);

    if (method === 'run') {
      statement.run(params);
      return { rows: [] };
    }

    if (method === 'get') {
      return { rows: rowValues(statement.get(params)) };
    }

    return { rows: statement.all(params).map((row) => rowValues(row)) };
  };

  return drizzle(callback, { schema: overdeckSchema });
}

export function makeDbLive(dbPath = getOverdeckDatabasePath()): Layer.Layer<Db> {
  return Layer.effect(
    Db,
    Effect.acquireRelease(
      Effect.sync(() => {
        const raw = openDatabase(dbPath);
        raw.exec('PRAGMA foreign_keys = ON');
        return raw;
      }),
      (raw) => Effect.sync(() => raw.close()),
    ).pipe(
      Effect.map((raw) =>
        Db.of({
          q: createDrizzleNodeSqliteDatabase(raw),
          path: dbPath,
        }),
      ),
    ),
  );
}

export const DbLive = makeDbLive();

export interface OverdeckEventInput {
  readonly type: string;
  readonly payload?: unknown;
  readonly timestamp?: Date | number;
}

export interface StoredOverdeckEvent {
  readonly sequence: number;
  readonly type: string;
  readonly timestamp: Date;
  readonly payload: unknown;
}

export interface EventBusServiceShape {
  readonly emit: (event: OverdeckEventInput) => Effect.Effect<number>;
  readonly readFrom: (fromSequence: number) => Effect.Effect<ReadonlyArray<StoredOverdeckEvent>>;
  readonly getLatestSequence: Effect.Effect<number>;
  readonly stream: Stream.Stream<StoredOverdeckEvent>;
}

export class EventBus extends Context.Service<EventBus, EventBusServiceShape>()('overdeck/EventBus') {}

function eventTimestampMillis(timestamp: OverdeckEventInput['timestamp']): number {
  if (timestamp instanceof Date) {
    return timestamp.getTime();
  }
  return timestamp ?? Date.now();
}

function parsePayload(payload: string | null | undefined): unknown {
  if (payload == null) {
    return null;
  }
  return JSON.parse(payload);
}

function readEventRow(row: {
  sequence: number;
  type: string;
  timestamp: number;
  payload?: string | null;
}): StoredOverdeckEvent {
  return {
    sequence: row.sequence,
    type: row.type,
    timestamp: new Date(row.timestamp),
    payload: parsePayload(row.payload),
  };
}

export const EventBusLive = Layer.effect(
  EventBus,
  Effect.gen(function* () {
    const db = yield* Db;
    const queue = yield* Queue.unbounded<StoredOverdeckEvent>();

    return EventBus.of({
      emit: (event) =>
        Effect.promise(async () => {
          const timestamp = eventTimestampMillis(event.timestamp);
          const payload = event.payload ?? null;
          const [inserted] = await db.q.insert(overdeckEvents).values({
            type: event.type,
            timestamp: new Date(timestamp),
            payload,
          }).returning({
            sequence: overdeckEvents.sequence,
            type: overdeckEvents.type,
            timestamp: overdeckEvents.timestamp,
            payload: overdeckEvents.payload,
          });
          if (!inserted) {
            throw new Error(`Failed to insert overdeck event ${event.type}.`);
          }
          const stored = readEventRow({
            sequence: inserted.sequence,
            type: inserted.type,
            timestamp: inserted.timestamp.getTime(),
            payload: JSON.stringify(inserted.payload ?? null),
          });
          Effect.runSync(Queue.offer(queue, stored));
          return stored.sequence;
        }),
      readFrom: (fromSequence) =>
        Effect.promise(async () =>
          (await db.q
            .select()
            .from(overdeckEvents)
            .where(gt(overdeckEvents.sequence, fromSequence))
            .orderBy(asc(overdeckEvents.sequence)))
            .map((row) => readEventRow({
              sequence: row.sequence,
              type: row.type,
              timestamp: row.timestamp.getTime(),
              payload: JSON.stringify(row.payload ?? null),
            })),
        ),
      getLatestSequence: Effect.promise(async () => {
        const [row] = await db.q
          .select({ sequence: sql<number>`COALESCE(MAX(${overdeckEvents.sequence}), 0)` })
          .from(overdeckEvents);
        return Number(row?.sequence ?? 0);
      }),
      stream: Stream.fromQueue(queue),
    });
  }),
);

export interface RecordsServiceShape {
  readonly writeIssue: (project: ProjectConfig, issueId: string, record: PanIssueRecord) => Effect.Effect<string>;
  readonly readIssue: (project: ProjectConfig, issueId: string) => Effect.Effect<PanIssueRecord | null>;
  readonly readSpec: (planRef: string) => Effect.Effect<unknown>;
  readonly writeAgentIdentity: (issueId: string, opts: { harness: string; model: string }) => Effect.Effect<void>;
}

export class Records extends Context.Service<Records, RecordsServiceShape>()('overdeck/Records') {}

export const RecordsLive = Layer.succeed(
  Records,
  Records.of({
    writeIssue: (project, issueId, record) => Effect.sync(() => writeIssueRecordSync(project, issueId, record)),
    readIssue: (project, issueId) => Effect.sync(() => readIssueRecordSync(project, issueId)),
    readSpec: (planRef) =>
      Effect.sync(() => {
        const path = isAbsolute(planRef) ? planRef : join(packageRoot, planRef);
        return JSON.parse(readFileSync(path, 'utf8')) as unknown;
      }),
    writeAgentIdentity: (_issueId, _opts) => Effect.void,
  }),
);

export interface TmuxServiceShape {
  readonly sessionExists: (sessionName: string) => Effect.Effect<boolean>;
  readonly killSession: (sessionName: string) => Effect.Effect<void>;
  readonly readRuntimeJson: (agentId: string) => Effect.Effect<unknown>;
  /** Returns session names of all active agent-* tmux sessions. Never fails — returns [] on error. */
  readonly listSessions: () => Effect.Effect<ReadonlyArray<string>>;
}

export class Tmux extends Context.Service<Tmux, TmuxServiceShape>()('overdeck/Tmux') {}

export const TmuxLive = Layer.succeed(
  Tmux,
  Tmux.of({
    sessionExists: (name) =>
      tmuxSessionExists(name).pipe(Effect.catch(() => Effect.succeed(false))),
    killSession: (name) =>
      tmuxKillSession(name).pipe(Effect.catch(() => Effect.void)),
    readRuntimeJson: (agentId) =>
      Effect.promise(async () => {
        try {
          const path = join(getOverdeckHome(), 'agents', agentId, 'runtime.json');
          const text = await readFile(path, 'utf8');
          return JSON.parse(text) as unknown;
        } catch {
          return null;
        }
      }),
    listSessions: () =>
      getAgentSessions().pipe(
        Effect.map((sessions) => sessions.map((s) => s.name)),
        Effect.catch(() => Effect.succeed([] as readonly string[])),
      ),
  }),
);

export interface ForgeServiceShape {
  readonly merge: (input: unknown) => Effect.Effect<unknown>;
  readonly approve: (input: unknown) => Effect.Effect<unknown>;
}

export class Forge extends Context.Service<Forge, ForgeServiceShape>()('overdeck/Forge') {}

export interface ProjectsServiceShape {
  readonly list: () => Effect.Effect<ReadonlyArray<ProjectConfig>>;
  readonly get: (projectId: string) => Effect.Effect<ProjectConfig | null>;
  readonly resolveIssue: (issueId: string) => Effect.Effect<ProjectConfig | null>;
}

export class Projects extends Context.Service<Projects, ProjectsServiceShape>()('overdeck/Projects') {}

export interface CostArchiveServiceShape {
  readonly append: (event: unknown) => Effect.Effect<void>;
}

export class CostArchive extends Context.Service<CostArchive, CostArchiveServiceShape>()('overdeck/CostArchive') {}

function costArchivePath(): string {
  return join(getOverdeckHome(), 'costs', 'events.jsonl');
}

function archiveKey(event: { requestId?: unknown; sourceFile?: unknown; source?: unknown }): string | null {
  if (typeof event.requestId === 'string' && event.requestId.length > 0) return `request:${event.requestId}`;
  const source = typeof event.sourceFile === 'string'
    ? event.sourceFile
    : typeof event.source === 'string'
      ? event.source
      : null;
  return source ? `source:${source}` : null;
}

function toCostArchiveEvent(event: Record<string, unknown>): Record<string, unknown> {
  const ts = event.ts instanceof Date
    ? event.ts.toISOString()
    : typeof event.ts === 'string'
      ? event.ts
      : new Date().toISOString();

  return {
    ts,
    type: 'cost',
    agentId: typeof event.agentId === 'string' ? event.agentId : 'unknown',
    issueId: typeof event.issueId === 'string' ? event.issueId : 'UNKNOWN',
    sessionType: typeof event.sessionType === 'string' ? event.sessionType : 'unknown',
    provider: typeof event.provider === 'string' ? event.provider : 'unknown',
    model: typeof event.model === 'string' ? event.model : 'unknown',
    input: typeof event.input === 'number' ? event.input : 0,
    output: typeof event.output === 'number' ? event.output : 0,
    cacheRead: typeof event.cacheRead === 'number' ? event.cacheRead : 0,
    cacheWrite: typeof event.cacheWrite === 'number' ? event.cacheWrite : 0,
    cost: typeof event.cost === 'number' ? event.cost : 0,
    ...(typeof event.requestId === 'string' ? { requestId: event.requestId } : {}),
    ...(typeof event.sessionId === 'string' ? { sessionId: event.sessionId } : {}),
    ...(typeof event.sourceFile === 'string' ? { source: event.sourceFile } : {}),
    ...(Array.isArray(event.warnings) ? { warnings: event.warnings } : {}),
  };
}

export const CostArchiveLive = Layer.succeed(
  CostArchive,
  CostArchive.of((() => {
    let seen: Set<string> | null = null;

    const loadSeen = () => {
      if (seen) return seen;
      seen = new Set<string>();
      const path = costArchivePath();
      if (!existsSync(path)) return seen;
      const content = readFileSync(path, 'utf8');
      for (const line of content.split('\n')) {
        if (!line.trim()) continue;
        try {
          const parsed = JSON.parse(line) as Record<string, unknown>;
          const key = archiveKey(parsed);
          if (key) seen.add(key);
        } catch {
          // Ignore malformed historical lines; readers do the same.
        }
      }
      return seen;
    };

    return {
      append: (event) => Effect.sync(() => {
        const normalized = toCostArchiveEvent(event as Record<string, unknown>);
        const key = archiveKey(normalized);
        const archiveSeen = loadSeen();
        if (key && archiveSeen.has(key)) return;

        const path = costArchivePath();
        mkdirSync(dirname(path), { recursive: true });
        if (!existsSync(path)) writeFileSync(path, '', 'utf8');
        appendFileSync(path, `${JSON.stringify(normalized)}\n`, 'utf8');
        if (key) archiveSeen.add(key);
      }),
    };
  })()),
);

export type FtsStatement = Readonly<{
  method?: 'all' | 'exec' | 'get' | 'run';
  sql: string;
  params?: ReadonlyArray<unknown>;
}>;

export interface MemorySearchServiceShape {
  readonly statement: <T>(projectId: string, statement: FtsStatement) => Effect.Effect<T>;
  readonly transaction: (
    projectId: string,
    statements: ReadonlyArray<FtsStatement>,
  ) => Effect.Effect<ReadonlyArray<unknown>>;
}

export class MemorySearch extends Context.Service<MemorySearch, MemorySearchServiceShape>()('overdeck/MemorySearch') {}

export interface MemoryFilesServiceShape {
  readonly appendObservation: (observation: unknown) => Effect.Effect<{ jsonlPath: string; byteOffset: number }>;
  readonly upsertMarkdown: (observation: unknown) => Effect.Effect<void>;
  readonly readStatus: (projectId: string, issueId: string) => Effect.Effect<unknown | null>;
  readonly writeStatus: (projectId: string, issueId: string, status: unknown) => Effect.Effect<void>;
  readonly readResetMarkers: (projectId: string) => Effect.Effect<ReadonlyArray<unknown>>;
  readonly writeResetMarker: (projectId: string, marker: unknown) => Effect.Effect<void>;
  readonly listObservationFiles: (projectId: string) => Effect.Effect<ReadonlyArray<string>>;
  readonly readObservationsFile: (path: string) => Effect.Effect<ReadonlyArray<unknown>>;
  readonly findByteOffset: (path: string, id: string) => Effect.Effect<number>;
}

export class MemoryFiles extends Context.Service<MemoryFiles, MemoryFilesServiceShape>()('overdeck/MemoryFiles') {}
