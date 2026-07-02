/**
 * Conversations domain — ConversationsResolver (read door) + ConversationWriter (write door)
 * + TranscriptsResolver (shared read door over JSONL index) + TranscriptsWriter (cache-maint).
 *
 * Critical invariant: the backing session files (claude/pi/codex JSONL) are SACRED.
 * ConversationWriter touches only the DB and creates NEW backing files via forkNewFile;
 * it NEVER mutates, truncates, appends-to, or deletes an existing one.
 * TranscriptsResolver has no write methods at all — mechanically enforced by the surface.
 *
 * Writer durability diverges from Issues: conversations have NO git mirror.
 * The DB row IS the source of truth (schema 90-96). ConversationWriter has no Records dep.
 */

import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';

import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';

import type { RuntimeName } from '../runtimes/types.js';
import { getOverdeckHome } from '../paths.js';
import { Db, EventBus, getOverdeckDatabaseSync } from './infra.js';
import { ensureDiscoveredSessionsSchema } from './discovered-sessions.js';

// ── Local Drizzle table definitions ──────────────────────────────────────────
// Mirror locked schema (docs/overdeck-remodel/overdeck-schema.ts:97-163).
// No FK or index annotations here — those live in the compiled migration only.

const conversationsTable = sqliteTable('conversations', {
  id:                  text('id').primaryKey(),
  name:                text('name').notNull(),
  cwd:                 text('cwd').notNull(),
  issueId:             text('issue_id'),
  harness:             text('harness'),
  model:               text('model'),
  effort:              text('effort'),
  title:               text('title'),
  titleSource:         text('title_source'),
  createdAt:           integer('created_at', { mode: 'timestamp_ms' }).notNull(),
  archivedAt:          integer('archived_at', { mode: 'timestamp_ms' }),
  handoffDocPath:      text('handoff_doc_path'),
  handoffTargetConvId: text('handoff_target_conv_id'),
  clearedToConvId:     text('cleared_to_conv_id'),
  tmuxSession:         text('tmux_session'),
  status:              text('status').notNull().default('active'),
  endedAt:             integer('ended_at', { mode: 'timestamp_ms' }),
  lastAttachedAt:      integer('last_attached_at', { mode: 'timestamp_ms' }),
  sessionFile:         text('session_file'),
  totalCost:           real('total_cost').default(0),
  totalTokens:         integer('total_tokens').default(0),
  forkStatus:          text('fork_status'),
  forkError:           text('fork_error'),
  forkRetryCount:      integer('fork_retry_count').notNull().default(0),
  forkRequest:         text('fork_request'),
  forkFallbackReason:  text('fork_fallback_reason'),
  deliveryMethod:      text('delivery_method'),
  spawnError:          text('spawn_error'),
});

const conversationFilesTable = sqliteTable('conversation_files', {
  id:             integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id').notNull(),
  harness:        text('harness').notNull(),
  locator:        text('locator').notNull(),
  createdAt:      integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

const favoritesTable = sqliteTable('favorites', {
  type:      text('type').notNull(),
  itemId:    text('item_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
});

const transcriptsTable = sqliteTable('transcripts', {
  backingFilePath: text('backing_file_path').primaryKey(),
  sessionId:       text('session_id'),
  harness:         text('harness'),
  workspacePath:   text('workspace_path'),
  messageCount:    integer('message_count'),
  models:          text('models', { mode: 'json' }).$type<string[] | null>(),
  tokenInput:      integer('token_input'),
  tokenOutput:     integer('token_output'),
  firstTs:         integer('first_ts', { mode: 'timestamp_ms' }),
  lastTs:          integer('last_ts', { mode: 'timestamp_ms' }),
  panIssueId:      text('pan_issue_id'),
  panAgentId:      text('pan_agent_id'),
});

// ── Entity schemas ────────────────────────────────────────────────────────────

export const ConversationId   = Schema.String.pipe(Schema.brand('ConversationId'));
export type  ConversationId   = typeof ConversationId.Type;

export const ConversationName = Schema.String.pipe(Schema.brand('ConversationName'));
export type  ConversationName = typeof ConversationName.Type;

export const Harness     = Schema.Literals(['claude-code', 'pi', 'codex', 'kimi']);
export type  Harness     = typeof Harness.Type;

export const TitleSource = Schema.Literals(['manual', 'auto', 'ai', 'default']);
export type  TitleSource = typeof TitleSource.Type;

export const FavoriteType = Schema.Literals(['conversation', 'project']);
export type  FavoriteType = typeof FavoriteType.Type;

export const BackingFile = Schema.Struct({
  harness:   Harness,
  locator:   Schema.String,
  createdAt: Schema.Date,
});
export type BackingFile = typeof BackingFile.Type;

export const Conversation = Schema.Struct({
  id:                  ConversationId,
  name:                ConversationName,
  cwd:                 Schema.String,
  issueId:             Schema.NullOr(Schema.String),
  harness:             Schema.NullOr(Harness),
  model:               Schema.NullOr(Schema.String),
  effort:              Schema.NullOr(Schema.String),
  title:               Schema.NullOr(Schema.String),
  titleSource:         Schema.NullOr(TitleSource),
  createdAt:           Schema.Date,
  archivedAt:          Schema.NullOr(Schema.Date),
  handoffDocPath:      Schema.NullOr(Schema.String),
  handoffTargetConvId: Schema.NullOr(ConversationId),
  clearedToConvId:     Schema.NullOr(ConversationId),
  files:               Schema.Array(BackingFile),
});
export type Conversation = typeof Conversation.Type;

export const ConversationFilter = Schema.Struct({
  archived: Schema.optional(Schema.Boolean),
  issueId:  Schema.optional(Schema.String),
});
export type ConversationFilter = typeof ConversationFilter.Type;

export const ParsedTranscript = Schema.Struct({
  messages:     Schema.Array(Schema.Unknown),
  messageCount: Schema.Number,
  models:       Schema.Array(Schema.String),
  firstTs:      Schema.NullOr(Schema.Date),
  lastTs:       Schema.NullOr(Schema.Date),
});
export type ParsedTranscript = typeof ParsedTranscript.Type;

export const TranscriptSubject = Schema.Union([Conversation, ConversationName]);
export type  TranscriptSubject = typeof TranscriptSubject.Type;

export const Transcript = Schema.Struct({
  backingFilePath: Schema.String,
  sessionId:       Schema.NullOr(Schema.String),
  harness:         Schema.NullOr(Harness),
  workspacePath:   Schema.NullOr(Schema.String),
  messageCount:    Schema.NullOr(Schema.Number),
  models:          Schema.NullOr(Schema.Array(Schema.String)),
  tokenInput:      Schema.NullOr(Schema.Number),
  tokenOutput:     Schema.NullOr(Schema.Number),
  firstTs:         Schema.NullOr(Schema.Date),
  lastTs:          Schema.NullOr(Schema.Date),
  panIssueId:      Schema.NullOr(Schema.String),
  panAgentId:      Schema.NullOr(Schema.String),
});
export type Transcript = typeof Transcript.Type;

// ── Error types ───────────────────────────────────────────────────────────────

export class ConversationNotFound extends Schema.TaggedErrorClass<ConversationNotFound>()(
  'ConversationNotFound', { name: ConversationName },
) {}

export class AlreadyArchived extends Schema.TaggedErrorClass<AlreadyArchived>()(
  'AlreadyArchived', { name: ConversationName },
) {}

export class NotArchived extends Schema.TaggedErrorClass<NotArchived>()(
  'NotArchived', { name: ConversationName },
) {}

// ── Internal sync decoders (known-shape DB rows) ──────────────────────────────

const decodeConversation = Schema.decodeUnknownSync(Conversation);
const decodeTranscript   = Schema.decodeUnknownSync(Transcript);
const decodeBackingFile  = Schema.decodeUnknownSync(BackingFile);

// ── Row type aliases ───────────────────────────────────────────────────────────

type ConvRow  = typeof conversationsTable.$inferSelect;
type FileRow  = typeof conversationFilesTable.$inferSelect;
type TransRow = typeof transcriptsTable.$inferSelect;

// ── Internal row mappers ───────────────────────────────────────────────────────

function rowToBackingFile(r: FileRow): BackingFile {
  return decodeBackingFile({ harness: r.harness, locator: r.locator, createdAt: r.createdAt });
}

function rowToConversation(row: ConvRow, files: FileRow[]): Conversation {
  return decodeConversation({
    id:                  row.id,
    name:                row.name,
    cwd:                 row.cwd,
    issueId:             row.issueId ?? null,
    harness:             row.harness ?? null,
    model:               row.model ?? null,
    effort:              row.effort ?? null,
    title:               row.title ?? null,
    titleSource:         row.titleSource ?? null,
    createdAt:           row.createdAt,
    archivedAt:          row.archivedAt ?? null,
    handoffDocPath:      row.handoffDocPath ?? null,
    handoffTargetConvId: row.handoffTargetConvId ?? null,
    clearedToConvId:     row.clearedToConvId ?? null,
    files:               files.map(rowToBackingFile),
  });
}

function rowToTranscript(r: TransRow): Transcript {
  return decodeTranscript({
    backingFilePath: r.backingFilePath,
    sessionId:       r.sessionId ?? null,
    harness:         r.harness ?? null,
    workspacePath:   r.workspacePath ?? null,
    messageCount:    r.messageCount ?? null,
    models:          r.models ?? null,
    tokenInput:      r.tokenInput ?? null,
    tokenOutput:     r.tokenOutput ?? null,
    firstTs:         r.firstTs ?? null,
    lastTs:          r.lastTs ?? null,
    panIssueId:      r.panIssueId ?? null,
    panAgentId:      r.panAgentId ?? null,
  });
}

// ── ConversationsResolver — read door ─────────────────────────────────────────

export class ConversationsResolver extends Context.Service<ConversationsResolver, {
  readonly get:           (name: ConversationName) => Effect.Effect<Conversation, ConversationNotFound>;
  readonly list:          (f: ConversationFilter)  => Effect.Effect<ReadonlyArray<Conversation>>;
  readonly getCurrent:    ()                        => Effect.Effect<Conversation, ConversationNotFound>;
  readonly getHandoffDoc: (name: ConversationName)  => Effect.Effect<string, ConversationNotFound>;
}>()('overdeck/ConversationsResolver') {}

export const ConversationsResolverLive = Layer.effect(
  ConversationsResolver,
  Effect.gen(function* () {
    const db = yield* Db;

    const withFiles = (row: ConvRow): Effect.Effect<Conversation> =>
      Effect.gen(function* () {
        const files = yield* Effect.promise(() =>
          db.q.select().from(conversationFilesTable).where(eq(conversationFilesTable.conversationId, row.id)),
        );
        return rowToConversation(row, files);
      });

    const get = (name: ConversationName): Effect.Effect<Conversation, ConversationNotFound> =>
      Effect.gen(function* () {
        const [row] = yield* Effect.promise(() =>
          db.q.select().from(conversationsTable).where(eq(conversationsTable.name, name)),
        );
        if (!row) return yield* Effect.fail(new ConversationNotFound({ name }));
        return yield* withFiles(row);
      });

    const list = (f: ConversationFilter): Effect.Effect<ReadonlyArray<Conversation>> =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() => {
          const base = db.q.select().from(conversationsTable);
          const conds = [];
          if (f.archived === true)  conds.push(isNotNull(conversationsTable.archivedAt));
          if (f.archived === false) conds.push(isNull(conversationsTable.archivedAt));
          if (f.issueId)            conds.push(eq(conversationsTable.issueId, f.issueId));
          return conds.length > 0 ? base.where(and(...conds)) : base;
        });
        return yield* Effect.forEach(rows, withFiles);
      });

    const getCurrent = (): Effect.Effect<Conversation, ConversationNotFound> =>
      Effect.fail(new ConversationNotFound({ name: '' as ConversationName }));

    const getHandoffDoc = (name: ConversationName): Effect.Effect<string, ConversationNotFound> =>
      Effect.gen(function* () {
        const conv = yield* get(name);
        if (!conv.handoffDocPath) return yield* Effect.fail(new ConversationNotFound({ name }));
        return yield* Effect.promise(() => readFile(conv.handoffDocPath!, 'utf-8'));
      });

    return ConversationsResolver.of({ get, list, getCurrent, getHandoffDoc });
  }),
);

// ── TranscriptsResolver — shared read door (JSONL index + sacred file reads) ──
// Read-only: no method writes a backing file or the transcripts index.

export class TranscriptsResolver extends Context.Service<TranscriptsResolver, {
  readonly resolveFiles: (subject: TranscriptSubject) => Effect.Effect<ReadonlyArray<string>>;
  readonly parse:        (subject: TranscriptSubject) => Effect.Effect<ParsedTranscript>;
  readonly serialize:    (subject: TranscriptSubject) => Effect.Effect<string>;
  readonly watch:        (subject: TranscriptSubject) => Stream.Stream<ParsedTranscript>;
  readonly get:          (key: string)             => Effect.Effect<Transcript>;
  readonly list:         (f: ConversationFilter)   => Effect.Effect<ReadonlyArray<Transcript>>;
  readonly stats:        ()                        => Effect.Effect<{ count: number; managed: number }>;
  readonly search:       (query: string)           => Effect.Effect<ReadonlyArray<Transcript>>;
}>()('overdeck/TranscriptsResolver') {}

export const TranscriptsResolverLive = Layer.effect(
  TranscriptsResolver,
  Effect.gen(function* () {
    const db = yield* Db;

    const resolveFiles = (_subject: TranscriptSubject): Effect.Effect<ReadonlyArray<string>> =>
      Effect.succeed([]);

    const parse = (_subject: TranscriptSubject): Effect.Effect<ParsedTranscript> =>
      Effect.succeed({ messages: [], messageCount: 0, models: [], firstTs: null, lastTs: null });

    const serialize = (_subject: TranscriptSubject): Effect.Effect<string> =>
      Effect.succeed('');

    const watch = (_subject: TranscriptSubject): Stream.Stream<ParsedTranscript> =>
      Stream.empty;

    const get = (key: string): Effect.Effect<Transcript> =>
      Effect.gen(function* () {
        const [row] = yield* Effect.promise(() =>
          db.q.select().from(transcriptsTable).where(eq(transcriptsTable.backingFilePath, key)),
        );
        if (!row) return yield* Effect.die(`Transcript not found: ${key}`);
        return rowToTranscript(row);
      });

    const list = (_f: ConversationFilter): Effect.Effect<ReadonlyArray<Transcript>> =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() => db.q.select().from(transcriptsTable));
        return rows.map(rowToTranscript);
      });

    const stats = (): Effect.Effect<{ count: number; managed: number }> =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() => db.q.select().from(transcriptsTable));
        return {
          count:   rows.length,
          managed: rows.filter(r => r.panAgentId != null).length,
        };
      });

    const search = (_query: string): Effect.Effect<ReadonlyArray<Transcript>> =>
      Effect.succeed([]);

    return TranscriptsResolver.of({ resolveFiles, parse, serialize, watch, get, list, stats, search });
  }),
);

// ── TranscriptsWriter — cache-maintenance write door ─────────────────────────
// Mutates the `transcripts` index (rebuilt from JSONL); NEVER writes a sacred file.

export class TranscriptsWriter extends Context.Service<TranscriptsWriter, {
  readonly scan:    (dirs?: ReadonlyArray<string>) => Effect.Effect<{ scanned: number }>;
  readonly rebuild: (dirs?: ReadonlyArray<string>) => Effect.Effect<{ scanned: number }>;
  readonly enrich:  (ids?: ReadonlyArray<string>)  => Effect.Effect<{ enriched: number }>;
  readonly embed:   (ids?: ReadonlyArray<string>)  => Effect.Effect<{ embedded: number }>;
}>()('overdeck/TranscriptsWriter') {}

export const TranscriptsWriterLive = Layer.succeed(
  TranscriptsWriter,
  TranscriptsWriter.of({
    scan:    (_dirs?) => Effect.succeed({ scanned: 0 }),
    rebuild: (_dirs?) => Effect.succeed({ scanned: 0 }),
    enrich:  (_ids?)  => Effect.succeed({ enriched: 0 }),
    embed:   (_ids?)  => Effect.succeed({ embedded: 0 }),
  }),
);

// ── ConversationWriter — write door ───────────────────────────────────────────
// Writes ONLY the DB (conversations / favorites / conversation_files tables) and
// creates NEW backing files via the fork primitive. NEVER mutates an existing file.
// NO Records dependency — the DB row IS the source of truth (no git mirror).

export class ConversationWriter extends Context.Service<ConversationWriter, {
  readonly create: (opts: {
    name: ConversationName; cwd: string; model?: string; effort?: string;
    harness?: Harness; issueId?: string; title?: string;
  }) => Effect.Effect<Conversation>;
  readonly archive:       (name: ConversationName) => Effect.Effect<Conversation, ConversationNotFound | AlreadyArchived>;
  readonly unarchive:     (name: ConversationName) => Effect.Effect<Conversation, ConversationNotFound | NotArchived>;
  readonly setFavorite:   (type: 'conversation' | 'project', itemId: string) => Effect.Effect<void>;
  readonly unsetFavorite: (type: 'conversation' | 'project', itemId: string) => Effect.Effect<void>;
  readonly retitle:       (name: ConversationName, title: string, source: 'manual' | 'auto' | 'ai') =>
    Effect.Effect<Conversation, ConversationNotFound>;
  readonly setModel:   (name: ConversationName, model: string)    => Effect.Effect<Conversation, ConversationNotFound>;
  readonly setHarness: (name: ConversationName, harness: Harness) => Effect.Effect<Conversation, ConversationNotFound>;
  readonly handoff:     (source: ConversationName, target: ConversationName, docPath: string) =>
    Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound>;
  readonly clear:       (source: ConversationName) =>
    Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound>;
  readonly summaryFork: (source: ConversationName, opts: { mode: 'summary' | 'plain'; model?: string }) =>
    Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound>;
  readonly compact:     (name: ConversationName) =>
    Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound>;
}>()('overdeck/ConversationWriter') {}

export const ConversationWriterLive = Layer.effect(
  ConversationWriter,
  Effect.gen(function* () {
    const db       = yield* Db;
    const bus      = yield* EventBus;
    const resolver = yield* ConversationsResolver;
    const now      = () => new Date();

    const create = (opts: {
      name: ConversationName; cwd: string; model?: string; effort?: string;
      harness?: Harness; issueId?: string; title?: string;
    }): Effect.Effect<Conversation> =>
      Effect.gen(function* () {
        const id = randomUUID() as unknown as ConversationId;
        const ts = now();
        yield* Effect.promise(() =>
          db.q.insert(conversationsTable).values({
            id,
            name:        opts.name,
            cwd:         opts.cwd,
            issueId:     opts.issueId ?? null,
            harness:     opts.harness ?? null,
            model:       opts.model ?? null,
            effort:      opts.effort ?? null,
            title:       opts.title ?? null,
            titleSource: opts.title ? 'manual' : null,
            createdAt:   ts,
          }).onConflictDoNothing(),
        );
        yield* bus.emit({ type: 'conversation.created', payload: { name: opts.name } });
        return decodeConversation({
          id, name: opts.name, cwd: opts.cwd,
          issueId: opts.issueId ?? null, harness: opts.harness ?? null,
          model: opts.model ?? null, effort: opts.effort ?? null,
          title: opts.title ?? null, titleSource: opts.title ? 'manual' : null,
          createdAt: ts, archivedAt: null,
          handoffDocPath: null, handoffTargetConvId: null, clearedToConvId: null,
          files: [],
        });
      });

    const archive = (name: ConversationName): Effect.Effect<Conversation, ConversationNotFound | AlreadyArchived> =>
      Effect.gen(function* () {
        const conv = yield* resolver.get(name);
        if (conv.archivedAt) return yield* Effect.fail(new AlreadyArchived({ name }));
        yield* Effect.promise(() =>
          db.q.update(conversationsTable).set({ archivedAt: now() }).where(eq(conversationsTable.name, name)),
        );
        yield* Effect.promise(() =>
          db.q.delete(favoritesTable).where(
            and(eq(favoritesTable.type, 'conversation'), eq(favoritesTable.itemId, name)),
          ),
        );
        yield* bus.emit({ type: 'conversation.archived', payload: { name } });
        return yield* resolver.get(name);
      });

    const unarchive = (name: ConversationName): Effect.Effect<Conversation, ConversationNotFound | NotArchived> =>
      Effect.gen(function* () {
        const conv = yield* resolver.get(name);
        if (!conv.archivedAt) return yield* Effect.fail(new NotArchived({ name }));
        yield* Effect.promise(() =>
          db.q.update(conversationsTable).set({ archivedAt: null }).where(eq(conversationsTable.name, name)),
        );
        yield* bus.emit({ type: 'conversation.unarchived', payload: { name } });
        return yield* resolver.get(name);
      });

    const setFavorite = (type: 'conversation' | 'project', itemId: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          db.q.insert(favoritesTable).values({ type, itemId, createdAt: now() }).onConflictDoNothing(),
        );
        yield* bus.emit({ type: 'conversation.favorited', payload: { type, itemId } });
      });

    const unsetFavorite = (type: 'conversation' | 'project', itemId: string): Effect.Effect<void> =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          db.q.delete(favoritesTable).where(
            and(eq(favoritesTable.type, type), eq(favoritesTable.itemId, itemId)),
          ),
        );
        yield* bus.emit({ type: 'conversation.unfavorited', payload: { type, itemId } });
      });

    const retitle = (name: ConversationName, title: string, source: 'manual' | 'auto' | 'ai'):
      Effect.Effect<Conversation, ConversationNotFound> =>
      Effect.gen(function* () {
        yield* resolver.get(name);
        yield* Effect.promise(() =>
          db.q.update(conversationsTable).set({ title, titleSource: source }).where(eq(conversationsTable.name, name)),
        );
        yield* bus.emit({ type: 'conversation.retitled', payload: { name, title, source } });
        return yield* resolver.get(name);
      });

    const setModel = (name: ConversationName, model: string):
      Effect.Effect<Conversation, ConversationNotFound> =>
      Effect.gen(function* () {
        yield* resolver.get(name);
        yield* Effect.promise(() =>
          db.q.update(conversationsTable).set({ model }).where(eq(conversationsTable.name, name)),
        );
        yield* bus.emit({ type: 'conversation.modelChanged', payload: { name, model } });
        return yield* resolver.get(name);
      });

    const setHarness = (name: ConversationName, harness: Harness):
      Effect.Effect<Conversation, ConversationNotFound> =>
      Effect.gen(function* () {
        yield* resolver.get(name);
        yield* Effect.promise(() =>
          db.q.update(conversationsTable).set({ harness }).where(eq(conversationsTable.name, name)),
        );
        yield* bus.emit({ type: 'conversation.harnessChanged', payload: { name, harness } });
        return yield* resolver.get(name);
      });

    // The fork primitive — the ONLY mechanism that creates a new backing file.
    // Creates a fresh UUID locator, registers a conversation_files pointer, records lineage.
    // NEVER opens an existing file for write.
    const forkNewFile = (
      source: ConversationName,
      kind: 'handoff' | 'clear' | 'summary' | 'plain' | 'harness-switch' | 'compaction',
      opts?: { docPath?: string },
    ): Effect.Effect<{ conversation: Conversation; backingFile: string }, ConversationNotFound> =>
      Effect.gen(function* () {
        const conv = yield* resolver.get(source);
        const newLocator = randomUUID();
        yield* Effect.promise(() =>
          db.q.insert(conversationFilesTable).values({
            conversationId: conv.id,
            harness:        conv.harness ?? 'claude-code',
            locator:        newLocator,
            createdAt:      now(),
          }).onConflictDoNothing(),
        );
        if (kind === 'handoff') {
          yield* Effect.promise(() =>
            db.q.update(conversationsTable).set({
              handoffDocPath:      opts?.docPath ?? null,
              handoffTargetConvId: conv.id,
            }).where(eq(conversationsTable.name, source)),
          );
        } else if (kind === 'clear') {
          yield* Effect.promise(() =>
            db.q.update(conversationsTable)
              .set({ clearedToConvId: conv.id })
              .where(eq(conversationsTable.name, source)),
          );
        }
        yield* bus.emit({ type: 'conversation.forked', payload: { source, kind } });
        return { conversation: conv, backingFile: newLocator };
      });

    const handoff = (source: ConversationName, _target: ConversationName, docPath: string) =>
      forkNewFile(source, 'handoff', { docPath });

    const clear = (source: ConversationName) =>
      forkNewFile(source, 'clear');

    const summaryFork = (source: ConversationName, opts: { mode: 'summary' | 'plain'; model?: string }) =>
      forkNewFile(source, opts.mode === 'summary' ? 'summary' : 'plain');

    const compact = (name: ConversationName) =>
      forkNewFile(name, 'compaction');

    return ConversationWriter.of({
      create, archive, unarchive, setFavorite, unsetFavorite,
      retitle, setModel, setHarness,
      handoff, clear, summaryFork, compact,
    });
  }),
);

// ── ConversationsApi — HttpApiGroup (controller declarations) ─────────────────
// Handlers wire in at bootstrap; R = ConversationsResolver | TranscriptsResolver |
// ConversationWriter, never Db directly.

export const ConversationsApi = HttpApiGroup.make('conversations')
  .add(HttpApiEndpoint.get('list', '/conversations', {
    success: Schema.Array(Conversation),
  }))
  .add(HttpApiEndpoint.get('get', '/conversations/:name', {
    params:  Schema.Struct({ name: ConversationName }),
    success: Conversation,
    error:   ConversationNotFound,
  }))
  .add(HttpApiEndpoint.get('getHandoffDoc', '/conversations/:name/handoff-doc', {
    params:  Schema.Struct({ name: ConversationName }),
    success: Schema.String,
    error:   ConversationNotFound,
  }))
  .add(HttpApiEndpoint.post('create', '/conversations', {
    success: Conversation,
  }))
  .add(HttpApiEndpoint.post('archive', '/conversations/:name/archive', {
    params:  Schema.Struct({ name: ConversationName }),
    success: Conversation,
    error:   [ConversationNotFound, AlreadyArchived],
  }))
  .add(HttpApiEndpoint.post('unarchive', '/conversations/:name/unarchive', {
    params:  Schema.Struct({ name: ConversationName }),
    success: Conversation,
    error:   [ConversationNotFound, NotArchived],
  }));

// ── Legacy-compatible sync door ──────────────────────────────────────────────
//
// These exports keep the current dashboard/CLI call sites synchronous while
// moving the storage boundary to overdeck.db. They must not call the legacy
// panopticon.db conversation helpers.

export type LegacyTitleSource = 'auto' | 'ai' | 'ai-refined' | 'manual' | 'default';

export interface ForkRequest {
  parentConversationName: string;
  sessionId: string;
  forkMode: 'summary' | 'plain' | 'handoff';
  summaryModel?: string;
  localSummaryOnly: boolean;
  includeThinkingInSummary?: boolean;
  summaryHarness?: RuntimeName;
  handoffFocus?: string;
  handoffAuthor: 'source' | 'external';
  handoffAuthorModel?: string;
  handoffAuthorHarness?: RuntimeName;
}

export interface LegacyConversation {
  id: number;
  name: string;
  tmuxSession: string;
  status: 'active' | 'ended';
  cwd: string;
  issueId: string | null;
  createdAt: string;
  endedAt: string | null;
  lastAttachedAt: string | null;
  claudeSessionId: string | null;
  title: string | null;
  titleSource: LegacyTitleSource | null;
  titleSeed: string | null;
  totalCost: number;
  totalTokens: number;
  archivedAt: string | null;
  model: string | null;
  effort: string | null;
  forkStatus: string | null;
  forkError: string | null;
  harness: RuntimeName | null;
  deliveryMethod: 'auto' | 'channels' | 'tmux' | null;
  spawnError: string | null;
  handoffDocPath: string | null;
  handoffTargetConvId: number | null;
  forkFallbackReason: string | null;
  clearedToConvId: number | null;
  forkRequest: string | null;
  forkRetryCount: number;
}

export interface ArchivedConversationWithEnrichment {
  id: number;
  name: string;
  cwd: string;
  issueId: string | null;
  createdAt: string;
  claudeSessionId: string | null;
  title: string | null;
  totalCost: number;
  archivedAt: string;
  model: string | null;
  discoveredJsonlPath: string | null;
  discoveredWorkspacePath: string | null;
  messageCount: number | null;
  firstTs: string | null;
  lastTs: string | null;
  primaryModel: string | null;
  tokenInput: number | null;
  tokenOutput: number | null;
  estimatedCost: number | null;
  toolsUsed: string | null;
  filesTouched: string | null;
  tags: string | null;
  summary: string | null;
  enrichmentLevel: number | null;
  enrichmentFailed: number | null;
}

export interface ArchivedConversationListOptions {
  workspacePath?: string;
  primaryModel?: string;
  unmanaged?: boolean;
  since?: string;
  before?: string;
  after?: string;
  minCost?: number;
  maxCost?: number;
  minMessages?: number;
  issueId?: string;
  enriched?: boolean;
  notEnriched?: boolean;
  enrichmentLevel?: number;
  enrichmentLevelLessThan?: number;
  tags?: string[];
  tools?: string[];
  files?: string[];
  limit?: number;
  offset?: number;
}

export type LegacyFavoriteType = 'conversation';

interface LegacyConversationRow {
  legacy_id: number;
  id: string;
  name: string;
  cwd: string;
  issue_id: string | null;
  harness: string | null;
  model: string | null;
  effort: string | null;
  title: string | null;
  title_source: string | null;
  created_at: number | Date;
  archived_at: number | Date | null;
  handoff_doc_path: string | null;
  handoff_target_conv_id: string | null;
  cleared_to_conv_id: string | null;
  claude_session_id: string | null;
  tmux_session: string | null;
  status: string | null;
  ended_at: number | null;
  last_attached_at: number | null;
  session_file: string | null;
  total_cost: number | null;
  total_tokens: number | null;
  fork_status: string | null;
  fork_error: string | null;
  fork_retry_count: number | null;
  fork_request: string | null;
  fork_fallback_reason: string | null;
  delivery_method: string | null;
  spawn_error: string | null;
}

const LEGACY_CONVERSATION_SELECT = `
  SELECT
    c.rowid AS legacy_id,
    c.id,
    c.name,
    c.cwd,
    c.issue_id,
    c.harness,
    c.model,
    c.effort,
    c.title,
    c.title_source,
    c.created_at,
    c.archived_at,
    c.handoff_doc_path,
    c.handoff_target_conv_id,
    c.cleared_to_conv_id,
    c.tmux_session,
    c.status,
    c.ended_at,
    c.last_attached_at,
    c.session_file,
    c.total_cost,
    c.total_tokens,
    c.fork_status,
    c.fork_error,
    c.fork_retry_count,
    c.fork_request,
    c.fork_fallback_reason,
    c.delivery_method,
    c.spawn_error,
    (
      SELECT cf.locator
      FROM conversation_files cf
      WHERE cf.conversation_id = c.id
      ORDER BY (cf.harness = 'claude-code') DESC, cf.created_at ASC, cf.id ASC
      LIMIT 1
    ) AS claude_session_id
  FROM conversations c
`;

const AGENT_CONVERSATION_PREFIXES = ['agent-', 'planning-', 'specialist-'];

export function isAgentConversationName(name: string): boolean {
  return AGENT_CONVERSATION_PREFIXES.some((p) => name.startsWith(p));
}

/**
 * Live Claude session id for a conversation — consistent across every consumer (PAN-1866).
 *
 * Work-agent / specialist conversations rotate Claude sessions, but the DB only records the
 * FIRST session (the oldest conversation_files locator), so the stored id is stale by
 * construction. The agent folder's session.id is the authoritative live session — it is what
 * `claude --resume` actually runs. So for agent conversations resolve from the filesystem
 * (session.id, then sessions.json), falling back to the DB value; for human conversation-panel
 * sessions the DB value is canonical. Applied at the read door (rowToLegacyConversation) so the
 * CLI, panel, teardown, and frontend all observe the same id.
 *
 * Read inline (not via lib/agents.ts) to avoid the agents <-> conversations import cycle.
 */
export function resolveLiveSessionId(conv: {
  name: string;
  tmuxSession: string;
  claudeSessionId: string | null;
}): string | null {
  if (!isAgentConversationName(conv.name)) return conv.claudeSessionId;
  const agentDir = join(getOverdeckHome(), 'agents', conv.tmuxSession);
  try {
    const sid = readFileSync(join(agentDir, 'session.id'), 'utf8').trim();
    if (sid) return sid;
  } catch { /* no session.id yet */ }
  try {
    const arr: unknown = JSON.parse(readFileSync(join(agentDir, 'sessions.json'), 'utf8'));
    if (Array.isArray(arr) && arr.length > 0) {
      const last = arr[arr.length - 1];
      if (typeof last === 'string' && last.trim()) return last.trim();
    }
  } catch { /* no/invalid sessions.json */ }
  return conv.claudeSessionId;
}

function overdeckDb() {
  return getOverdeckDatabaseSync();
}

function toIso(value: number | Date | null | undefined): string | null {
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  return new Date(value).toISOString();
}

function toMillis(value: Date | string | number = new Date()): number {
  if (value instanceof Date) return value.getTime();
  if (typeof value === 'number') return value;
  return new Date(value).getTime();
}

/** Map a raw DB harness string to a canonical RuntimeName, normalizing legacy 'pi' to 'ohmypi' on read. */
export function normalizeHarness(harness: string | null): RuntimeName | null {
  if (harness === 'pi' || harness === 'ohmypi') return 'ohmypi';
  if (harness === 'claude-code' || harness === 'codex') return harness;
  return null;
}

function legacyRowIdForConversationId(id: string | null): number | null {
  if (!id) return null;
  const row = overdeckDb()
    .prepare(`SELECT rowid AS id FROM conversations WHERE id = ?`)
    .get(id) as { id: number } | undefined;
  return row?.id ?? null;
}

function conversationUuidForLegacyId(id: number): string | null {
  const row = overdeckDb()
    .prepare(`SELECT id FROM conversations WHERE rowid = ?`)
    .get(id) as { id: string } | undefined;
  return row?.id ?? null;
}

function rowToLegacyConversation(row: LegacyConversationRow): LegacyConversation {
  const archivedAt = toIso(row.archived_at);
  return {
    id: row.legacy_id,
    name: row.name,
    tmuxSession: row.tmux_session ?? `conv-${row.name}`,
    status: (row.status ?? (archivedAt ? 'ended' : 'active')) as 'active' | 'ended',
    cwd: row.cwd,
    issueId: row.issue_id ?? null,
    createdAt: toIso(row.created_at) ?? new Date(0).toISOString(),
    endedAt: toIso(row.ended_at) ?? archivedAt,
    lastAttachedAt: toIso(row.last_attached_at),
    claudeSessionId: resolveLiveSessionId({
      name: row.name,
      tmuxSession: row.tmux_session ?? `conv-${row.name}`,
      claudeSessionId: row.claude_session_id ?? null,
    }),
    title: row.title ?? null,
    titleSource: (row.title_source as LegacyTitleSource | null) ?? null,
    titleSeed: row.title ?? null,
    totalCost: row.total_cost ?? 0,
    totalTokens: row.total_tokens ?? 0,
    archivedAt,
    model: row.model ?? null,
    effort: row.effort ?? null,
    forkStatus: row.fork_status ?? null,
    forkError: row.fork_error ?? null,
    harness: normalizeHarness(row.harness),
    deliveryMethod: (row.delivery_method as 'auto' | 'channels' | 'tmux' | null) ?? null,
    spawnError: row.spawn_error ?? null,
    handoffDocPath: row.handoff_doc_path ?? null,
    handoffTargetConvId: legacyRowIdForConversationId(row.handoff_target_conv_id),
    forkFallbackReason: row.fork_fallback_reason ?? null,
    clearedToConvId: legacyRowIdForConversationId(row.cleared_to_conv_id),
    forkRequest: row.fork_request ?? null,
    forkRetryCount: row.fork_retry_count ?? 0,
  };
}

function getConversationByUuid(id: string): LegacyConversation | null {
  const row = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT} WHERE c.id = ?`)
    .get(id) as LegacyConversationRow | undefined;
  return row ? rowToLegacyConversation(row) : null;
}

function getConversationUuidByName(name: string): string | null {
  const row = overdeckDb()
    .prepare(`SELECT id FROM conversations WHERE name = ?`)
    .get(name) as { id: string } | undefined;
  return row?.id ?? null;
}

/**
 * Aggregate each conversation's cost + token usage from the canonical `cost_events`
 * ledger, keyed by session id and joined through `conversation_files`. This is the
 * source of truth for conversation cost: `conversations.total_cost` is only a
 * denormalized cache written when a conversation is opened (via the /messages
 * route), so it reads stale/zero for any conversation not opened since the
 * overdeck.db cutover. The list reads from this ledger so it shows live costs
 * without requiring each conversation to be opened first.
 *
 * Returns a map of conversation id → { cost, tokens }. A conversation predating the
 * ledger has no rows and is simply absent — callers fall back to the cached
 * `total_cost` column for those.
 */
export function getConversationLedgerCosts(): Map<string, { cost: number; tokens: number }> {
  // Keyed by the conversation's rowid, because that is the public `id`
  // {@link LegacyConversation.id} carries (c.rowid AS legacy_id), not the uuid.
  // cost_events.session_id matches conversation_files.locator; a conversation may
  // have several locators (relaunch/clear), so we sum across all of them.
  const rows = overdeckDb()
    .prepare(
      `SELECT c.rowid AS cid,
              COALESCE(SUM(ce.cost), 0) AS cost,
              COALESCE(SUM(ce.input + ce.output + ce.cache_read + ce.cache_write), 0) AS tokens
       FROM cost_events ce
       JOIN conversation_files cf ON cf.locator = ce.session_id
       JOIN conversations c ON c.id = cf.conversation_id
       GROUP BY c.rowid`,
    )
    .all() as { cid: number; cost: number; tokens: number }[];
  const map = new Map<string, { cost: number; tokens: number }>();
  for (const r of rows) map.set(String(r.cid), { cost: r.cost ?? 0, tokens: r.tokens ?? 0 });
  return map;
}

export function listConversations(options?: { limit?: number; offset?: number }): LegacyConversation[] {
  let sql = `${LEGACY_CONVERSATION_SELECT}
    WHERE c.archived_at IS NULL
      AND c.name NOT LIKE 'agent-%'
      AND c.name NOT LIKE 'planning-%'
      AND c.name NOT LIKE 'specialist-%'
    ORDER BY c.created_at DESC`;
  const params: number[] = [];
  if (options?.limit !== undefined) {
    sql += ' LIMIT ?';
    params.push(options.limit);
  }
  if (options?.offset !== undefined) {
    sql += ' OFFSET ?';
    params.push(options.offset);
  }
  const rows = overdeckDb().prepare(sql).all(...params) as LegacyConversationRow[];
  return rows.map(rowToLegacyConversation);
}

export function getConversationByName(name: string): LegacyConversation | null {
  const row = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT} WHERE c.name = ?`)
    .get(name) as LegacyConversationRow | undefined;
  return row ? rowToLegacyConversation(row) : null;
}

export function getConversationById(id: number): LegacyConversation | null {
  const row = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT} WHERE c.rowid = ?`)
    .get(id) as LegacyConversationRow | undefined;
  return row ? rowToLegacyConversation(row) : null;
}

export function getConversationByClaudeSessionId(claudeSessionId: string): LegacyConversation | null {
  const row = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT}
      WHERE EXISTS (
        SELECT 1 FROM conversation_files cf
        WHERE cf.conversation_id = c.id AND cf.locator = ?
      )`)
    .get(claudeSessionId) as LegacyConversationRow | undefined;
  return row ? rowToLegacyConversation(row) : null;
}

export function getConversationByTmuxSession(tmuxSession: string): LegacyConversation | null {
  const name = tmuxSession.startsWith('conv-') ? tmuxSession.slice(5) : tmuxSession;
  const row = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT}
      WHERE c.name = ? AND c.archived_at IS NULL
      ORDER BY c.created_at DESC
      LIMIT 1`)
    .get(name) as LegacyConversationRow | undefined;
  return row ? rowToLegacyConversation(row) : null;
}

export function listArchivedConversations(): LegacyConversation[] {
  const rows = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT}
      WHERE c.archived_at IS NOT NULL
      ORDER BY c.archived_at DESC, c.created_at DESC`)
    .all() as LegacyConversationRow[];
  return rows.map(rowToLegacyConversation);
}

function matchesArchivedOptions(conv: ArchivedConversationWithEnrichment, options: ArchivedConversationListOptions): boolean {
  if (options.workspacePath !== undefined && conv.cwd !== options.workspacePath) return false;
  if (options.primaryModel !== undefined && conv.primaryModel !== options.primaryModel && conv.model !== options.primaryModel) return false;
  if (options.issueId !== undefined && conv.issueId !== options.issueId) return false;
  if (options.since !== undefined && (conv.lastTs ?? conv.archivedAt) < options.since) return false;
  if (options.before !== undefined && (conv.lastTs ?? conv.archivedAt) >= options.before) return false;
  if (options.after !== undefined && (conv.firstTs ?? conv.createdAt) < options.after) return false;
  if (options.minCost !== undefined && (conv.estimatedCost ?? conv.totalCost) < options.minCost) return false;
  if (options.maxCost !== undefined && (conv.estimatedCost ?? conv.totalCost) > options.maxCost) return false;
  if (options.minMessages !== undefined && (conv.messageCount ?? 0) < options.minMessages) return false;
  if (options.unmanaged === true) return false;
  return true;
}

export function listArchivedConversationsWithEnrichment(options: ArchivedConversationListOptions = {}): ArchivedConversationWithEnrichment[] {
  ensureDiscoveredSessionsSchema();
  const db = overdeckDb();

  const conditions: string[] = ['c.archived_at IS NOT NULL'];
  const params: unknown[] = [];

  const lastTs = `COALESCE(ds.last_ts, c.archived_at)`;
  const firstTs = `COALESCE(ds.first_ts, c.created_at)`;
  const primaryModel = `COALESCE(ds.primary_model, c.model)`;
  const estimatedCost = `COALESCE(ds.estimated_cost, c.total_cost)`;
  const messageCount = `COALESCE(ds.message_count, 0)`;
  const enrichmentLevel = `COALESCE(ds.enrichment_level, 0)`;

  if (options.workspacePath !== undefined) { conditions.push('c.cwd = ?'); params.push(options.workspacePath); }
  if (options.primaryModel !== undefined) { conditions.push(`${primaryModel} = ?`); params.push(options.primaryModel); }
  if (options.issueId !== undefined) { conditions.push('c.issue_id = ?'); params.push(options.issueId); }
  if (options.since !== undefined) { conditions.push(`${lastTs} >= ?`); params.push(toMillis(options.since)); }
  if (options.before !== undefined) { conditions.push(`${lastTs} < ?`); params.push(toMillis(options.before)); }
  if (options.after !== undefined) { conditions.push(`${firstTs} >= ?`); params.push(toMillis(options.after)); }
  if (options.minCost !== undefined) { conditions.push(`${estimatedCost} >= ?`); params.push(options.minCost); }
  if (options.maxCost !== undefined) { conditions.push(`${estimatedCost} <= ?`); params.push(options.maxCost); }
  if (options.minMessages !== undefined) { conditions.push(`${messageCount} >= ?`); params.push(options.minMessages); }
  if (options.unmanaged === true) { conditions.push('0 = 1'); }
  if (options.enriched === true) { conditions.push(`${enrichmentLevel} > 0`); }
  if (options.notEnriched === true) { conditions.push(`${enrichmentLevel} = 0`); }
  if (options.enrichmentLevel !== undefined) { conditions.push(`${enrichmentLevel} = ?`); params.push(options.enrichmentLevel); }
  if (options.enrichmentLevelLessThan !== undefined) { conditions.push(`${enrichmentLevel} < ?`); params.push(options.enrichmentLevelLessThan); }
  if (options.tags?.length) {
    for (const tag of options.tags) {
      conditions.push(`EXISTS (SELECT 1 FROM discovered_session_tags dst WHERE dst.session_id = ds.id AND dst.tag = ?)`);
      params.push(tag);
    }
  }
  if (options.tools?.length) {
    for (const tool of options.tools) {
      conditions.push(`EXISTS (SELECT 1 FROM discovered_session_tools dstool WHERE dstool.session_id = ds.id AND dstool.tool = ?)`);
      params.push(tool);
    }
  }
  if (options.files?.length) {
    for (const file of options.files) {
      conditions.push(`EXISTS (SELECT 1 FROM discovered_session_files dsfile WHERE dsfile.session_id = ds.id AND dsfile.file_path = ?)`);
      params.push(file);
    }
  }

  const safeLimit = Number.isFinite(options.limit) && options.limit! >= 0 ? options.limit! : undefined;
  const safeOffset = Number.isFinite(options.offset) && options.offset! >= 0 ? options.offset! : undefined;
  const limitClause = safeLimit !== undefined ? 'LIMIT ?' : safeOffset !== undefined ? 'LIMIT -1' : '';
  const offsetClause = safeOffset !== undefined ? 'OFFSET ?' : '';
  if (safeLimit !== undefined) params.push(safeLimit);
  if (safeOffset !== undefined) params.push(safeOffset);

  const where = `WHERE ${conditions.join(' AND ')}`;
  const sql = `
    SELECT
      c.rowid AS legacy_id,
      c.id AS uuid,
      c.name,
      c.cwd,
      c.issue_id,
      c.created_at,
      (
        SELECT cf.locator FROM conversation_files cf
        WHERE cf.conversation_id = c.id
        ORDER BY (cf.harness = 'claude-code') DESC, cf.created_at ASC, cf.id ASC
        LIMIT 1
      ) AS claude_session_id,
      c.title,
      c.total_cost,
      c.archived_at,
      c.model,
      ds.jsonl_path AS discovered_jsonl_path,
      ds.workspace_path AS discovered_workspace_path,
      ds.message_count,
      ds.first_ts,
      ds.last_ts,
      ds.primary_model,
      ds.token_input,
      ds.token_output,
      ds.estimated_cost,
      ds.tools_used,
      ds.files_touched,
      ds.tags,
      ds.summary,
      ds.enrichment_level,
      ds.enrichment_failed
    FROM conversations c
    LEFT JOIN discovered_sessions ds ON ds.session_id = (
      SELECT cf.locator FROM conversation_files cf
      WHERE cf.conversation_id = c.id
      ORDER BY (cf.harness = 'claude-code') DESC, cf.created_at ASC, cf.id ASC
      LIMIT 1
    )
    ${where}
    ORDER BY c.archived_at DESC, c.created_at DESC
    ${limitClause} ${offsetClause}
  `;

  type RawRow = {
    legacy_id: number; uuid: string; name: string; cwd: string; issue_id: string | null;
    created_at: number; claude_session_id: string | null; title: string | null;
    total_cost: number | null; archived_at: number | null; model: string | null;
    discovered_jsonl_path: string | null; discovered_workspace_path: string | null;
    message_count: number | null; first_ts: number | null; last_ts: number | null;
    primary_model: string | null; token_input: number | null; token_output: number | null;
    estimated_cost: number | null; tools_used: string | null; files_touched: string | null;
    tags: string | null; summary: string | null; enrichment_level: number | null;
    enrichment_failed: number | null;
  };

  const rawRows = db.prepare(sql).all(...params) as RawRow[];

  return rawRows.map((r): ArchivedConversationWithEnrichment => ({
    id: r.legacy_id,
    name: r.name,
    cwd: r.cwd,
    issueId: r.issue_id ?? null,
    createdAt: toIso(r.created_at) ?? new Date(0).toISOString(),
    claudeSessionId: r.claude_session_id ?? null,
    title: r.title ?? null,
    totalCost: r.total_cost ?? 0,
    archivedAt: toIso(r.archived_at) ?? toIso(r.created_at) ?? new Date(0).toISOString(),
    model: r.model ?? null,
    discoveredJsonlPath: r.discovered_jsonl_path ?? null,
    discoveredWorkspacePath: r.discovered_workspace_path ?? r.cwd,
    messageCount: r.message_count ?? null,
    firstTs: toIso(r.first_ts),
    lastTs: toIso(r.last_ts),
    primaryModel: r.primary_model ?? r.model ?? null,
    tokenInput: r.token_input ?? null,
    tokenOutput: r.token_output ?? null,
    estimatedCost: r.estimated_cost ?? null,
    toolsUsed: r.tools_used ?? null,
    filesTouched: r.files_touched ?? null,
    tags: r.tags ?? null,
    summary: r.summary ?? null,
    enrichmentLevel: r.enrichment_level ?? null,
    enrichmentFailed: r.enrichment_failed ?? null,
  }));
}

export function listArchivedConversationNames(): string[] {
  return listArchivedConversations().map((conv) => conv.name);
}

export function createConversation(opts: {
  name: string;
  tmuxSession: string;
  cwd: string;
  issueId?: string;
  claudeSessionId?: string;
  title?: string;
  titleSource?: LegacyTitleSource;
  titleSeed?: string;
  model?: string;
  effort?: string;
  forkStatus?: string;
  harness?: RuntimeName;
  deliveryMethod?: 'auto' | 'channels' | 'tmux';
}): LegacyConversation {
  const db = overdeckDb();
  const id = randomUUID();
  const now = toMillis();

  db.transaction(() => {
    db.prepare(`DELETE FROM conversation_files WHERE conversation_id IN (SELECT id FROM conversations WHERE name = ?)`).run(opts.name);
    db.prepare(`DELETE FROM conversations WHERE name = ?`).run(opts.name);
    db.prepare(`
      INSERT INTO conversations
        (id, name, cwd, issue_id, harness, model, effort, title, title_source, created_at, archived_at,
         tmux_session, status, fork_status, fork_retry_count, delivery_method, spawn_error)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, 'active', ?, 0, ?, ?)
    `).run(
      id,
      opts.name,
      opts.cwd,
      opts.issueId ?? null,
      opts.harness ?? null,
      opts.model ?? null,
      opts.effort ?? null,
      opts.title ?? null,
      opts.titleSource ?? (opts.title ? 'auto' : null),
      now,
      opts.tmuxSession ?? null,
      opts.forkStatus ?? null,
      opts.deliveryMethod ?? null,
      null,  // spawn_error starts null
    );
    if (opts.claudeSessionId) {
      db.prepare(`
        INSERT OR IGNORE INTO conversation_files (conversation_id, harness, locator, created_at)
        VALUES (?, ?, ?, ?)
      `).run(id, opts.harness ?? 'claude-code', opts.claudeSessionId, now);
    }
  })();

  const conv = getConversationByUuid(id);
  if (!conv) throw new Error(`Failed to create conversation ${opts.name}`);
  return conv;
}

export function markConversationEnded(name: string): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET ended_at = ?, status = 'ended' WHERE name = ?`)
    .run(Date.now(), name);
}

// PAN-1972: resurrect a conversation the liveness poller previously latched to
// 'ended'. tmux is the liveness oracle — when a session + harness are observed
// alive, the row must read 'active'. The `status != 'active'` guard makes this a
// true no-op (no needless write) when the row is already correct.
export function markConversationRunning(name: string): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET status = 'active', ended_at = NULL WHERE name = ? AND status != 'active'`)
    .run(name);
}

export function markConversationActive(name: string): void {
  overdeckDb().prepare(`UPDATE conversations SET archived_at = NULL WHERE name = ?`).run(name);
}

export function reactivateConversationForSpawn(opts: {
  name: string;
  tmuxSession: string;
  cwd: string;
  issueId?: string;
  claudeSessionId?: string;
  model?: string;
  harness?: RuntimeName;
}): void {
  const db = overdeckDb();
  const now = toMillis();
  const id = getConversationUuidByName(opts.name);
  if (!id) return;
  db.prepare(`
    UPDATE conversations
    SET cwd = ?, issue_id = ?, model = ?, harness = ?, archived_at = NULL
    WHERE id = ?
  `).run(opts.cwd, opts.issueId ?? null, opts.model ?? null, opts.harness ?? null, id);
  if (opts.claudeSessionId) {
    db.prepare(`
      INSERT OR IGNORE INTO conversation_files (conversation_id, harness, locator, created_at)
      VALUES (?, ?, ?, ?)
    `).run(id, opts.harness ?? 'claude-code', opts.claudeSessionId, now);
  }
}

export function updateLastAttached(name: string): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET last_attached_at = ? WHERE name = ?`)
    .run(Date.now(), name);
}

export function markAllEndedOnStartup(): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET status = 'ended', ended_at = COALESCE(ended_at, ?) WHERE status = 'active'`)
    .run(Date.now());
}

export function updateConversationTitle(name: string, title: string, titleSource?: LegacyTitleSource): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET title = ?, title_source = COALESCE(?, title_source) WHERE name = ?`)
    .run(title, titleSource ?? null, name);
}

export function archiveConversation(name: string): void {
  const db = overdeckDb();
  db.prepare(`UPDATE conversations SET archived_at = ? WHERE name = ?`).run(toMillis(), name);
  db.prepare(`DELETE FROM favorites WHERE type = 'conversation' AND item_id = ?`).run(name);
}

export function unarchiveConversation(name: string): void {
  overdeckDb().prepare(`UPDATE conversations SET archived_at = NULL WHERE name = ?`).run(name);
}

export function updateConversationCost(name: string, totalCost: number, totalTokens?: number): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET total_cost = ?, total_tokens = COALESCE(?, total_tokens) WHERE name = ?`)
    .run(totalCost, totalTokens ?? null, name);
}

export function setConversationModel(name: string, model: string): void {
  overdeckDb().prepare(`UPDATE conversations SET model = ? WHERE name = ?`).run(model, name);
}

export function setConversationEffort(name: string, effort: string | null): void {
  overdeckDb().prepare(`UPDATE conversations SET effort = ? WHERE name = ?`).run(effort, name);
}

export function setConversationHarness(name: string, harness: RuntimeName): void {
  overdeckDb().prepare(`UPDATE conversations SET harness = ? WHERE name = ?`).run(harness, name);
}

export function setConversationClaudeSessionId(name: string, claudeSessionId: string): void {
  const db = overdeckDb();
  const id = getConversationUuidByName(name);
  if (!id) return;
  const harness = getConversationByName(name)?.harness ?? 'claude-code';
  db.prepare(`
    INSERT OR IGNORE INTO conversation_files (conversation_id, harness, locator, created_at)
    VALUES (?, ?, ?, ?)
  `).run(id, harness, claudeSessionId, toMillis());
}

export function updateConversationDeliveryMethod(name: string, method: 'auto' | 'channels' | 'tmux' | null): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET delivery_method = ? WHERE name = ?`)
    .run(method, name);
}

export function backfillConversationModel(name: string, model: string): void {
  overdeckDb().prepare(`UPDATE conversations SET model = ? WHERE name = ? AND model IS NULL`).run(model, name);
}

export function updateForkStatus(name: string, status: string | null, error?: string): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET fork_status = ?, fork_error = ? WHERE name = ?`)
    .run(status, error ?? null, name);
}

export function getStuckForks(): LegacyConversation[] {
  const rows = overdeckDb()
    .prepare(`${LEGACY_CONVERSATION_SELECT} WHERE c.fork_status IS NOT NULL AND c.fork_status != 'failed' ORDER BY c.created_at ASC`)
    .all() as LegacyConversationRow[];
  return rows.map(rowToLegacyConversation);
}

export function setForkRequest(name: string, json: string): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET fork_request = ? WHERE name = ?`)
    .run(json, name);
}

export function incrementForkRetryCount(name: string): number {
  const db = overdeckDb();
  db.prepare(`UPDATE conversations SET fork_retry_count = fork_retry_count + 1 WHERE name = ?`).run(name);
  const row = db.prepare(`SELECT fork_retry_count FROM conversations WHERE name = ?`).get(name) as
    | { fork_retry_count: number }
    | undefined;
  return row?.fork_retry_count ?? 0;
}

export function updateConversationForkFallbackReason(name: string, reason: string | null): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET fork_fallback_reason = ? WHERE name = ?`)
    .run(reason, name);
}

export function recordConversationHandoff(sourceName: string, targetName: string, docPath: string): LegacyConversation {
  const targetId = getConversationUuidByName(targetName);
  const target = targetId ? getConversationByUuid(targetId) : null;
  if (!targetId || !target) throw new Error(`Handoff target conversation ${targetName} not found`);
  const db = overdeckDb();
  db.prepare(`UPDATE conversations SET handoff_doc_path = ? WHERE id = ?`).run(docPath, targetId);
  db.prepare(`UPDATE conversations SET handoff_target_conv_id = ? WHERE name = ?`).run(targetId, sourceName);
  return getConversationByUuid(targetId) ?? target;
}

export function setClearedToConvId(name: string, convId: number): void {
  const targetUuid = conversationUuidForLegacyId(convId);
  overdeckDb().prepare(`UPDATE conversations SET cleared_to_conv_id = ? WHERE name = ?`).run(targetUuid, name);
}

export function hasOtherActiveConversationOnTmuxSession(_tmuxSession: string, _excludeName: string): boolean {
  return false;
}

export function updateSpawnError(name: string, error: string | null): void {
  overdeckDb().prepare(`UPDATE conversations SET spawn_error = ? WHERE name = ?`).run(error, name);
}

export function clearStuckForks(): number {
  return 0;
}

export function canReplaceTitle(conv: LegacyConversation): boolean {
  if (conv.titleSource === 'manual') return false;
  return conv.titleSource === 'default' || conv.titleSource === 'auto';
}

export function listFavoritedIds(type: LegacyFavoriteType): string[] {
  const rows = overdeckDb()
    .prepare(`SELECT item_id FROM favorites WHERE type = ?`)
    .all(type) as Array<{ item_id: string }>;
  return rows.map((row) => row.item_id);
}

export function setFavorite(type: LegacyFavoriteType, itemId: string): void {
  overdeckDb()
    .prepare(`INSERT OR IGNORE INTO favorites (type, item_id, created_at) VALUES (?, ?, ?)`)
    .run(type, itemId, toMillis());
}

export function removeFavorite(type: LegacyFavoriteType, itemId: string): void {
  overdeckDb().prepare(`DELETE FROM favorites WHERE type = ? AND item_id = ?`).run(type, itemId);
}

export interface ImportLegacyConversationMapped {
  name: string;
  tmuxSession: string | null;
  status: 'active' | 'ended';
  cwd: string;
  createdAt: number;
  endedAt: number | null;
  lastAttachedAt: number | null;
  sessionFile: string | null;
  claudeSessionId: string | null;
  title: string | null;
  titleSource: string | null;
  titleSeed: string | null;
  totalCost: number;
  totalTokens: number;
  archivedAt: number | null;
  model: string | null;
  effort: string | null;
  forkStatus: string | null;
  forkError: string | null;
  harness: string | null;
  deliveryMethod: string | null;
  spawnError: string | null;
  handoffDocPath: string | null;
  forkFallbackReason: string | null;
  forkRequest: string | null;
  forkRetryCount: number;
}

export function importLegacyConversation(mapped: ImportLegacyConversationMapped): { uuid: string } {
  const db = overdeckDb();
  const uuid = randomUUID();
  db.transaction(() => {
    db.prepare(`
      INSERT OR IGNORE INTO conversations
        (id, name, cwd, harness, model, effort, title, title_source, created_at, archived_at,
         tmux_session, status, ended_at, last_attached_at, session_file, total_cost, total_tokens,
         fork_status, fork_error, fork_retry_count, fork_request, fork_fallback_reason,
         delivery_method, spawn_error, handoff_doc_path, handoff_target_conv_id, cleared_to_conv_id)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL)
    `).run(
      uuid,
      mapped.name,
      mapped.cwd,
      mapped.harness,
      mapped.model,
      mapped.effort,
      mapped.title,
      mapped.titleSource,
      mapped.createdAt,
      mapped.archivedAt,
      mapped.tmuxSession ?? `conv-${mapped.name}`,
      mapped.status,
      mapped.endedAt,
      mapped.lastAttachedAt,
      mapped.sessionFile,
      mapped.totalCost,
      mapped.totalTokens,
      mapped.forkStatus,
      mapped.forkError,
      mapped.forkRetryCount,
      mapped.forkRequest,
      mapped.forkFallbackReason,
      mapped.deliveryMethod,
      mapped.spawnError,
      mapped.handoffDocPath,
    );
    if (mapped.claudeSessionId) {
      db.prepare(`
        INSERT OR IGNORE INTO conversation_files (conversation_id, harness, locator, created_at)
        VALUES (?, ?, ?, ?)
      `).run(uuid, mapped.harness ?? 'claude-code', mapped.claudeSessionId, mapped.createdAt);
    }
  })();
  return { uuid };
}

export function setImportedConversationLinks(
  uuid: string,
  links: { handoffTargetUuid: string | null; clearedToUuid: string | null },
): void {
  overdeckDb()
    .prepare(`UPDATE conversations SET handoff_target_conv_id = ?, cleared_to_conv_id = ? WHERE id = ?`)
    .run(links.handoffTargetUuid, links.clearedToUuid, uuid);
}
