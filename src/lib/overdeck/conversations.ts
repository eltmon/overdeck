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
import { randomUUID } from 'node:crypto';

import { Context, Effect, Layer, Schema, Stream } from 'effect';
import { and, eq, isNotNull, isNull } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';

import { Db, EventBus } from './infra.js';

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
  createdAt:           integer('created_at', { mode: 'timestamp' }).notNull(),
  archivedAt:          integer('archived_at', { mode: 'timestamp' }),
  handoffDocPath:      text('handoff_doc_path'),
  handoffTargetConvId: text('handoff_target_conv_id'),
  clearedToConvId:     text('cleared_to_conv_id'),
});

const conversationFilesTable = sqliteTable('conversation_files', {
  id:             integer('id').primaryKey({ autoIncrement: true }),
  conversationId: text('conversation_id').notNull(),
  harness:        text('harness').notNull(),
  locator:        text('locator').notNull(),
  createdAt:      integer('created_at', { mode: 'timestamp' }).notNull(),
});

const favoritesTable = sqliteTable('favorites', {
  type:      text('type').notNull(),
  itemId:    text('item_id').notNull(),
  createdAt: integer('created_at', { mode: 'timestamp' }).notNull(),
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
  firstTs:         integer('first_ts', { mode: 'timestamp' }),
  lastTs:          integer('last_ts', { mode: 'timestamp' }),
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
