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
import { getOverdeckDatabasePath } from './paths.js';

export const overdeckEvents = sqliteTable('events', {
  sequence: integer('sequence').primaryKey({ autoIncrement: true }),
  type: text('type').notNull(),
  timestamp: integer('timestamp', { mode: 'timestamp' }).notNull(),
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
}

export class Records extends Context.Service<Records, RecordsServiceShape>()('overdeck/Records') {}

export const RecordsLive = Layer.succeed(
  Records,
  Records.of({
    writeIssue: (project, issueId, record) => Effect.sync(() => writeIssueRecordSync(project, issueId, record)),
    readIssue: (project, issueId) => Effect.sync(() => readIssueRecordSync(project, issueId)),
  }),
);

export interface TmuxServiceShape {
  readonly sessionExists: (sessionName: string) => Effect.Effect<boolean>;
}

export class Tmux extends Context.Service<Tmux, TmuxServiceShape>()('overdeck/Tmux') {}

export interface ForgeServiceShape {
  readonly merge: (input: unknown) => Effect.Effect<unknown>;
  readonly approve: (input: unknown) => Effect.Effect<unknown>;
}

export class Forge extends Context.Service<Forge, ForgeServiceShape>()('overdeck/Forge') {}

export interface ProjectsServiceShape {
  readonly list: () => Effect.Effect<ReadonlyArray<ProjectConfig>>;
  readonly get: (projectId: string) => Effect.Effect<ProjectConfig | null>;
}

export class Projects extends Context.Service<Projects, ProjectsServiceShape>()('overdeck/Projects') {}

export interface CostArchiveServiceShape {
  readonly append: (event: unknown) => Effect.Effect<void>;
}

export class CostArchive extends Context.Service<CostArchive, CostArchiveServiceShape>()('overdeck/CostArchive') {}

export type FtsStatement = Readonly<{
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
