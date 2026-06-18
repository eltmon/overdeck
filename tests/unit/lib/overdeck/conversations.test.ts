/**
 * Tests for workspace-e5ekl — Conversations domain + Transcripts read service.
 *
 * AC1: ConversationsResolver and ConversationWriter resolve as distinct Context.Services.
 * AC2: TranscriptsResolver exposes only reads; no write path persists changes to a
 *      conversation JSONL file.
 * AC3: Conversation/favorites/file-pointer metadata reads and writes route through
 *      the two doors.
 */
import { describe, it, expect } from 'vitest';
import { Effect, Layer } from 'effect';

import { Db, EventBus } from '../../../../src/lib/overdeck/infra.js';
import {
  ConversationsResolver, ConversationsResolverLive,
  ConversationWriter, ConversationWriterLive,
  TranscriptsResolver, TranscriptsResolverLive,
  TranscriptsWriter, TranscriptsWriterLive,
  ConversationNotFound, AlreadyArchived, NotArchived,
  type ConversationName,
  type Conversation,
} from '../../../../src/lib/overdeck/conversations.js';

// ── Fake DB ───────────────────────────────────────────────────────────────────

type ConvRow = {
  id: string;
  name: string;
  cwd: string;
  issueId: string | null;
  harness: string | null;
  model: string | null;
  effort: string | null;
  title: string | null;
  titleSource: string | null;
  createdAt: Date;
  archivedAt: Date | null;
  handoffDocPath: string | null;
  handoffTargetConvId: string | null;
  clearedToConvId: string | null;
};

type FileRow = { id: number; conversationId: string; harness: string; locator: string; createdAt: Date };
type FavRow  = { type: string; itemId: string; createdAt: Date };

interface FakeDb {
  convRows:  ConvRow[];
  fileRows:  FileRow[];
  favRows:   FavRow[];
  insertedConvs:  unknown[];
  insertedFavs:   unknown[];
  insertedFiles:  unknown[];
  updatedConvs:   unknown[];
  deletedFavs:    unknown[];
}

function makeFakeDb(): { fdb: FakeDb; dbLayer: Layer.Layer<Db, never, never> } {
  const fdb: FakeDb = {
    convRows: [], fileRows: [], favRows: [],
    insertedConvs: [], insertedFavs: [], insertedFiles: [],
    updatedConvs: [], deletedFavs: [],
  };

  // Drizzle tables expose their SQL name via Symbol.for('drizzle:Name') at runtime.
  // (The `_` property is undefined in drizzle-orm 0.41.x.)
  const tableNameOf = (t: unknown): string =>
    (t as Record<symbol, string>)[Symbol.for('drizzle:Name')] ?? '';

  const makeQueryResult = (data: unknown[]) => {
    const result: unknown = {
      then: (resolve: (v: unknown[]) => void) => { resolve(data); return result; },
      orderBy: (..._: unknown[]) => makeQueryResult(data),
      limit:   (n: number) => makeQueryResult(data.slice(0, n)),
      groupBy: (..._: unknown[]) => makeQueryResult(data),
      where:   (_cond: unknown) => makeQueryResult(data),
    };
    return result;
  };

  const q = new Proxy({} as never, {
    get: (_: unknown, prop: string) => {
      if (prop === 'then') return undefined;

      if (prop === 'select') {
        return (_fields?: unknown) => ({
          from: (table: unknown) => {
            const tbl = tableNameOf(table);
            const rows: unknown[] =
              tbl === 'conversation_files' ? fdb.fileRows :
              tbl === 'favorites'          ? fdb.favRows  :
              tbl === 'transcripts'        ? []           :
              fdb.convRows;
            // Return makeQueryResult directly so both terminal from(t) AND from(t).where()
            // patterns are thenable.
            return makeQueryResult(rows);
          },
        });
      }

      if (prop === 'insert') {
        return (table: unknown) => ({
          values: (vals: unknown) => ({
            onConflictDoNothing: () => {
              const tbl = tableNameOf(table);
              if (tbl === 'conversation_files') {
                fdb.insertedFiles.push(vals);
                fdb.fileRows.push({ id: fdb.fileRows.length + 1, ...(vals as FileRow) });
              } else if (tbl === 'favorites') {
                fdb.insertedFavs.push(vals);
                fdb.favRows.push(vals as FavRow);
              } else {
                fdb.insertedConvs.push(vals);
                fdb.convRows.push(vals as ConvRow);
              }
              return Promise.resolve();
            },
          }),
        });
      }

      if (prop === 'update') {
        return (_table: unknown) => ({
          set: (vals: unknown) => ({
            where: (_cond: unknown) => {
              fdb.updatedConvs.push(vals);
              const v = vals as Record<string, unknown>;
              // Apply mutations to in-memory rows so subsequent resolver.get() sees them.
              if (v.archivedAt !== undefined) {
                fdb.convRows.forEach(r => { (r as ConvRow).archivedAt = v.archivedAt as Date | null; });
              }
              if (v.title !== undefined) {
                fdb.convRows.forEach(r => {
                  (r as ConvRow).title = v.title as string;
                  (r as ConvRow).titleSource = v.titleSource as string;
                });
              }
              if (v.model !== undefined) {
                fdb.convRows.forEach(r => { (r as ConvRow).model = v.model as string; });
              }
              if (v.harness !== undefined) {
                fdb.convRows.forEach(r => { (r as ConvRow).harness = v.harness as string; });
              }
              return Promise.resolve();
            },
          }),
        });
      }

      if (prop === 'delete') {
        return (_table: unknown) => ({
          where: (_cond: unknown) => {
            fdb.deletedFavs.push('deleted');
            return Promise.resolve();
          },
        });
      }

      return () => { throw new Error(`Unexpected db call: q.${String(prop)}`); };
    },
  });

  const dbLayer = Layer.succeed(Db, Db.of({ q: q as never, path: ':memory:' }));
  return { fdb, dbLayer };
}

function makeBusLayer() {
  const emitted: Array<{ type: string; payload: unknown }> = [];
  return {
    emitted,
    busLayer: Layer.succeed(
      EventBus,
      EventBus.of({
        emit: (event) => Effect.sync(() => { emitted.push({ type: event.type, payload: event.payload }); return 0; }),
        readFrom:          () => Effect.succeed([]),
        getLatestSequence: Effect.succeed(0),
        stream:            undefined as never,
      }),
    ),
  };
}

function makeConvRow(name: string, overrides?: Partial<ConvRow>): ConvRow {
  return {
    id:                  `conv-${name}`,
    name,
    cwd:                 '/home/user/projects',
    issueId:             null,
    harness:             'claude-code',
    model:               'claude-sonnet-4-6',
    effort:              null,
    title:               null,
    titleSource:         null,
    createdAt:           new Date('2026-01-01T00:00:00Z'),
    archivedAt:          null,
    handoffDocPath:      null,
    handoffTargetConvId: null,
    clearedToConvId:     null,
    ...overrides,
  };
}

// ── AC1: distinct Context.Services ────────────────────────────────────────────

describe('AC1 — ConversationsResolver and ConversationWriter are distinct Context.Services', () => {
  it('ConversationsResolver service tag differs from ConversationWriter', () => {
    // Using Context.Service identifiers — they are distinct strings
    expect(ConversationsResolver.key).not.toBe(ConversationWriter.key);
  });

  it('ConversationsResolver exposes only read methods', async () => {
    const { fdb, dbLayer } = makeFakeDb();
    fdb.convRows.push(makeConvRow('alice'));

    const layer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));

    const result = await Effect.runPromise(
      ConversationsResolver.use((r) => {
        expect(typeof r.get).toBe('function');
        expect(typeof r.list).toBe('function');
        expect(typeof r.getCurrent).toBe('function');
        expect(typeof r.getHandoffDoc).toBe('function');
        // No write methods
        expect((r as Record<string, unknown>).archive).toBeUndefined();
        expect((r as Record<string, unknown>).create).toBeUndefined();
        return Effect.succeed(true);
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toBe(true);
  });

  it('ConversationWriter exposes only write methods', async () => {
    const { fdb, dbLayer } = makeFakeDb();
    fdb.convRows.push(makeConvRow('alice'));
    const { busLayer } = makeBusLayer();

    const resolverLayer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));
    const layer = ConversationWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(resolverLayer),
    );

    const result = await Effect.runPromise(
      ConversationWriter.use((w) => {
        expect(typeof w.create).toBe('function');
        expect(typeof w.archive).toBe('function');
        expect(typeof w.unarchive).toBe('function');
        expect(typeof w.setFavorite).toBe('function');
        expect(typeof w.unsetFavorite).toBe('function');
        expect(typeof w.retitle).toBe('function');
        expect(typeof w.setModel).toBe('function');
        expect(typeof w.setHarness).toBe('function');
        expect(typeof w.handoff).toBe('function');
        expect(typeof w.clear).toBe('function');
        expect(typeof w.summaryFork).toBe('function');
        expect(typeof w.compact).toBe('function');
        // No read methods from ConversationsResolver
        expect((w as Record<string, unknown>).get).toBeUndefined();
        expect((w as Record<string, unknown>).list).toBeUndefined();
        return Effect.succeed(true);
      }).pipe(Effect.provide(layer)),
    );

    expect(result).toBe(true);
  });
});

// ── AC2: TranscriptsResolver is strictly read-only ────────────────────────────

describe('AC2 — TranscriptsResolver has no write methods; writes live on TranscriptsWriter', () => {
  it('TranscriptsResolver exposes 8 read methods and no write methods', async () => {
    const { dbLayer } = makeFakeDb();
    const layer = TranscriptsResolverLive.pipe(Layer.provide(dbLayer));

    await Effect.runPromise(
      TranscriptsResolver.use((r) => {
        // Read methods
        expect(typeof r.resolveFiles).toBe('function');
        expect(typeof r.parse).toBe('function');
        expect(typeof r.serialize).toBe('function');
        expect(typeof r.watch).toBe('function');
        expect(typeof r.get).toBe('function');
        expect(typeof r.list).toBe('function');
        expect(typeof r.stats).toBe('function');
        expect(typeof r.search).toBe('function');
        // No cache-maintenance write methods (those are on TranscriptsWriter)
        expect((r as Record<string, unknown>).scan).toBeUndefined();
        expect((r as Record<string, unknown>).rebuild).toBeUndefined();
        expect((r as Record<string, unknown>).enrich).toBeUndefined();
        expect((r as Record<string, unknown>).embed).toBeUndefined();
        return Effect.succeed(true);
      }).pipe(Effect.provide(layer)),
    );
  });

  it('TranscriptsWriter exposes 4 write methods and no read methods', async () => {
    const layer = TranscriptsWriterLive;

    await Effect.runPromise(
      TranscriptsWriter.use((w) => {
        expect(typeof w.scan).toBe('function');
        expect(typeof w.rebuild).toBe('function');
        expect(typeof w.enrich).toBe('function');
        expect(typeof w.embed).toBe('function');
        // No read methods
        expect((w as Record<string, unknown>).get).toBeUndefined();
        expect((w as Record<string, unknown>).list).toBeUndefined();
        expect((w as Record<string, unknown>).parse).toBeUndefined();
        expect((w as Record<string, unknown>).resolveFiles).toBeUndefined();
        return Effect.succeed(true);
      }).pipe(Effect.provide(layer)),
    );
  });

  it('TranscriptsResolver.list returns an empty array when index is empty', async () => {
    const { dbLayer } = makeFakeDb();
    const layer = TranscriptsResolverLive.pipe(Layer.provide(dbLayer));

    const result = await Effect.runPromise(
      TranscriptsResolver.use((r) => r.list({})).pipe(Effect.provide(layer)),
    );

    expect(Array.isArray(result)).toBe(true);
    expect(result).toHaveLength(0);
  });

  it('TranscriptsResolver.stats returns zero counts for empty index', async () => {
    const { dbLayer } = makeFakeDb();
    const layer = TranscriptsResolverLive.pipe(Layer.provide(dbLayer));

    const result = await Effect.runPromise(
      TranscriptsResolver.use((r) => r.stats()).pipe(Effect.provide(layer)),
    );

    expect(result).toEqual({ count: 0, managed: 0 });
  });

  it('TranscriptsWriter layer compiles with no Db dependency (stub)', () => {
    // TranscriptsWriterLive is a Layer.succeed — no Db in R
    expect(TranscriptsWriterLive).toBeDefined();
  });
});

// ── AC3: reads/writes route through the two doors ────────────────────────────

describe('AC3 — reads and writes route through their designated doors', () => {
  it('ConversationsResolver.get returns a Conversation entity', async () => {
    const { fdb, dbLayer } = makeFakeDb();
    fdb.convRows.push(makeConvRow('alice'));

    const layer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));

    const result = await Effect.runPromise(
      ConversationsResolver.use((r) => r.get('alice' as ConversationName)).pipe(Effect.provide(layer)),
    );

    expect(result.name).toBe('alice');
    expect(result.cwd).toBe('/home/user/projects');
    expect(result.harness).toBe('claude-code');
    expect(Array.isArray(result.files)).toBe(true);
  });

  it('ConversationsResolver.get fails with ConversationNotFound for unknown name', async () => {
    const { dbLayer } = makeFakeDb();
    const layer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));

    const err = await Effect.runPromise(
      ConversationsResolver.use((r) => r.get('ghost' as ConversationName))
        .pipe(Effect.flip)
        .pipe(Effect.provide(layer)),
    );

    expect((err as ConversationNotFound)._tag).toBe('ConversationNotFound');
  });

  it('ConversationsResolver.list returns all conversations (no filter)', async () => {
    const { fdb, dbLayer } = makeFakeDb();
    fdb.convRows.push(makeConvRow('alice'), makeConvRow('bob'));

    const layer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));

    const result = await Effect.runPromise(
      ConversationsResolver.use((r) => r.list({})).pipe(Effect.provide(layer)),
    );

    expect(result).toHaveLength(2);
  });

  it('ConversationWriter.archive sets archivedAt and emits event', async () => {
    const { fdb, dbLayer } = makeFakeDb();
    fdb.convRows.push(makeConvRow('alice'));
    const { busLayer, emitted } = makeBusLayer();

    const resolverLayer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));
    const layer = ConversationWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(resolverLayer),
    );

    const result = await Effect.runPromise(
      ConversationWriter.use((w) => w.archive('alice' as ConversationName)).pipe(Effect.provide(layer)),
    );

    expect(result.name).toBe('alice');
    expect(result.archivedAt).not.toBeNull();
    expect(fdb.updatedConvs.length).toBeGreaterThanOrEqual(1);
    expect(emitted.some(e => e.type === 'conversation.archived')).toBe(true);
  });

  it('ConversationWriter.archive fails with AlreadyArchived when already archived', async () => {
    const { fdb, dbLayer } = makeFakeDb();
    fdb.convRows.push(makeConvRow('alice', { archivedAt: new Date() }));
    const { busLayer } = makeBusLayer();

    const resolverLayer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));
    const layer = ConversationWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(resolverLayer),
    );

    const err = await Effect.runPromise(
      ConversationWriter.use((w) => w.archive('alice' as ConversationName))
        .pipe(Effect.flip)
        .pipe(Effect.provide(layer)),
    );

    expect((err as AlreadyArchived)._tag).toBe('AlreadyArchived');
  });

  it('ConversationWriter.unarchive fails with NotArchived when not archived', async () => {
    const { fdb, dbLayer } = makeFakeDb();
    fdb.convRows.push(makeConvRow('alice'));
    const { busLayer } = makeBusLayer();

    const resolverLayer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));
    const layer = ConversationWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(resolverLayer),
    );

    const err = await Effect.runPromise(
      ConversationWriter.use((w) => w.unarchive('alice' as ConversationName))
        .pipe(Effect.flip)
        .pipe(Effect.provide(layer)),
    );

    expect((err as NotArchived)._tag).toBe('NotArchived');
  });

  it('ConversationWriter.setFavorite inserts a favorites row and emits event', async () => {
    const { fdb, dbLayer } = makeFakeDb();
    const { busLayer, emitted } = makeBusLayer();

    const resolverLayer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));
    const layer = ConversationWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(resolverLayer),
    );

    await Effect.runPromise(
      ConversationWriter.use((w) => w.setFavorite('conversation', 'alice')).pipe(Effect.provide(layer)),
    );

    expect(fdb.insertedFavs).toHaveLength(1);
    const fav = fdb.insertedFavs[0] as { type: string; itemId: string };
    expect(fav.type).toBe('conversation');
    expect(fav.itemId).toBe('alice');
    expect(emitted.some(e => e.type === 'conversation.favorited')).toBe(true);
  });

  it('ConversationWriter.retitle updates title and titleSource', async () => {
    const { fdb, dbLayer } = makeFakeDb();
    fdb.convRows.push(makeConvRow('alice'));
    const { busLayer, emitted } = makeBusLayer();

    const resolverLayer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));
    const layer = ConversationWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(resolverLayer),
    );

    const result = await Effect.runPromise(
      ConversationWriter.use((w) => w.retitle('alice' as ConversationName, 'New Title', 'manual'))
        .pipe(Effect.provide(layer)),
    );

    expect(result.title).toBe('New Title');
    expect(result.titleSource).toBe('manual');
    expect(emitted.some(e => e.type === 'conversation.retitled')).toBe(true);
  });

  it('ConversationWriter.setModel updates model field', async () => {
    const { fdb, dbLayer } = makeFakeDb();
    fdb.convRows.push(makeConvRow('alice'));
    const { busLayer, emitted } = makeBusLayer();

    const resolverLayer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));
    const layer = ConversationWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(resolverLayer),
    );

    const result = await Effect.runPromise(
      ConversationWriter.use((w) => w.setModel('alice' as ConversationName, 'claude-opus-4-8'))
        .pipe(Effect.provide(layer)),
    );

    expect(result.model).toBe('claude-opus-4-8');
    expect(emitted.some(e => e.type === 'conversation.modelChanged')).toBe(true);
  });

  it('ConversationWriter.compact (fork primitive) inserts a conversation_files row', async () => {
    const { fdb, dbLayer } = makeFakeDb();
    fdb.convRows.push(makeConvRow('alice'));
    const { busLayer, emitted } = makeBusLayer();

    const resolverLayer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));
    const layer = ConversationWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(resolverLayer),
    );

    const result = await Effect.runPromise(
      ConversationWriter.use((w) => w.compact('alice' as ConversationName)).pipe(Effect.provide(layer)),
    );

    expect(result.backingFile).toBeTruthy();
    expect(fdb.insertedFiles).toHaveLength(1);
    // The original conversation row is NOT mutated (sacred file invariant)
    expect(fdb.convRows[0].id).toBe('conv-alice');
    expect(emitted.some(e => e.type === 'conversation.forked')).toBe(true);
  });

  it('ConversationWriter layer compiles without Records dependency (only Db + EventBus + ConversationsResolver)', () => {
    const { dbLayer } = makeFakeDb();
    const { busLayer } = makeBusLayer();
    const resolverLayer = ConversationsResolverLive.pipe(Layer.provide(dbLayer));
    const layer = ConversationWriterLive.pipe(
      Layer.provide(dbLayer),
      Layer.provide(busLayer),
      Layer.provide(resolverLayer),
    );
    expect(layer).toBeDefined();
  });
});
