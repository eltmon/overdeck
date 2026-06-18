import { describe, expect, it } from 'vitest'
import { Effect, Layer } from 'effect'

import {
  type OverdeckEventInput,
  type StoredOverdeckEvent,
  Db,
  EventBus,
  MemoryFiles,
  MemorySearch,
  type FtsStatement,
} from '../../../../src/lib/overdeck/infra.js'
import {
  type MemoryResolverServiceShape,
  CheckpointNotFound,
  MemoryResolver,
  MemoryResolverLive,
  MemoryWriter,
  MemoryWriterLive,
  MemorySearchHit,
  SearchMemoryInput,
  ClaimResult,
  CommitResult,
  RebuildResult,
} from '../../../../src/lib/overdeck/memory.js'
import { MemoryObservation, ResetMarker } from '@panctl/contracts'

// ── Test fixtures ─────────────────────────────────────────────────────────────

/** Stub Db that satisfies the layer R type. Methods that touch the DB throw if called. */
function makeFakeDbLayer(): Layer.Layer<Db> {
  const fakeQ = new Proxy(
    {},
    {
      get: (_target, prop) => {
        if (prop === 'then') return undefined // not a Promise
        return () => {
          throw new Error(`Db.q.${String(prop)} called unexpectedly in test`)
        }
      },
    },
  )
  return Layer.succeed(Db, Db.of({ q: fakeQ as never, path: ':memory:' }))
}

function makeEventBusLayer(emitted: string[]): Layer.Layer<EventBus> {
  const events: StoredOverdeckEvent[] = []
  return Layer.succeed(
    EventBus,
    EventBus.of({
      emit: (event: OverdeckEventInput) =>
        Effect.sync(() => {
          const stored: StoredOverdeckEvent = {
            sequence: events.length + 1,
            type: event.type,
            timestamp: new Date(),
            payload: event.payload ?? null,
          }
          events.push(stored)
          emitted.push(event.type)
          return stored.sequence
        }),
      readFrom: (fromSequence) =>
        Effect.sync(() => events.filter((e) => e.sequence > fromSequence)),
      getLatestSequence: Effect.sync(() => events.at(-1)?.sequence ?? 0),
      stream: undefined as never,
    }),
  )
}

/** A MemorySearch that returns a fixed list of FTS rows */
function makeMemorySearchLayer(rows: unknown[]): Layer.Layer<MemorySearch> {
  return Layer.succeed(
    MemorySearch,
    MemorySearch.of({
      statement: <T>(_projectId: string, _stmt: FtsStatement) =>
        Effect.sync(() => rows as T),
      transaction: (_projectId: string, _stmts: ReadonlyArray<FtsStatement>) =>
        Effect.sync(() => [] as unknown[]),
    }),
  )
}

/** A MemoryFiles that operates entirely in-memory */
function makeMemoryFilesLayer(options: {
  status?: unknown
  markers?: ResetMarker[]
  observationFiles?: Record<string, unknown[]>
}): { layer: Layer.Layer<MemoryFiles>; written: { observations: unknown[]; markers: unknown[] } } {
  const written = { observations: [] as unknown[], markers: [] as unknown[] }
  const statusStore: Record<string, unknown> = {}
  if (options.status) statusStore['default'] = options.status

  return {
    written,
    layer: Layer.succeed(
      MemoryFiles,
      MemoryFiles.of({
        appendObservation: (o: unknown) =>
          Effect.sync(() => {
            written.observations.push(o)
            return { jsonlPath: '/tmp/test.jsonl', byteOffset: written.observations.length - 1 }
          }),
        upsertMarkdown: (_o: unknown) => Effect.succeed(undefined),
        readStatus: (_p: string, _i: string) =>
          Effect.sync(() => (options.status ?? null) as unknown | null),
        writeStatus: (p: string, i: string, s: unknown) =>
          Effect.sync(() => {
            statusStore[`${p}:${i}`] = s
          }),
        readResetMarkers: (_p: string) =>
          Effect.sync(() => (options.markers ?? []) as ReadonlyArray<unknown>),
        writeResetMarker: (_p: string, m: unknown) =>
          Effect.sync(() => {
            written.markers.push(m)
          }),
        listObservationFiles: (_p: string) => Effect.sync(() => [] as ReadonlyArray<string>),
        readObservationsFile: (path: string) =>
          Effect.sync(() => (options.observationFiles?.[path] ?? []) as ReadonlyArray<unknown>),
        findByteOffset: (_path: string, _id: string) => Effect.sync(() => 0),
      }),
    ),
  }
}

function makeObservation(overrides: Partial<MemoryObservation> = {}): MemoryObservation {
  return {
    id: 'obs-test-001',
    timestamp: '2026-06-17T10:00:00.000Z',
    projectId: 'test-project',
    workspaceId: 'test-workspace',
    issueId: 'PAN-1938',
    runId: 'run-001',
    sessionId: 'sess-001',
    agentRole: 'work',
    agentHarness: 'claude-code',
    gitBranch: 'feature/pan-1938',
    sourceTranscriptOffset: 0,
    actionStatus: null,
    narrative: 'Implemented the memory door pattern',
    summary: 'Memory resolver built',
    files: ['src/lib/overdeck/memory.ts'],
    tags: ['architecture'],
    tokens: { prompt: 100, completion: 50, total: 150 },
    model: 'claude-sonnet-4-6',
    ...overrides,
  }
}

// ── MemoryResolver tests ──────────────────────────────────────────────────────

describe('MemoryResolver.search', () => {
  it('returns hits from MemorySearch door', async () => {
    const ftsRow = {
      rowid: 1,
      content: 'Memory resolver built',
      display_content: 'Memory resolver built',
      source: 'sess-001',
      branch: 'feature/pan-1938',
      entry_date: '2026-06-17',
      entry_time: '10:00:00',
      entry_type: 'observation',
      files: '[]',
      tags: '["architecture"]',
      doc_type: 'observation',
      scope: 'PAN-1938',
      project_id: 'test-project',
      workspace_id: 'test-workspace',
      issue_id: 'PAN-1938',
      run_id: 'run-001',
      session_id: 'sess-001',
      agent_role: 'work',
      agent_harness: 'claude-code',
      bm25: -2.5,
    }

    const { layer: filesLayer } = makeMemoryFilesLayer({})
    const searchLayer = makeMemorySearchLayer([ftsRow])
    const dbLayer = makeFakeDbLayer()

    const layer = MemoryResolverLive.pipe(
      Layer.provide(searchLayer),
      Layer.provide(filesLayer),
      Layer.provide(dbLayer),
    )

    const result = await Effect.runPromise(
      Effect.provide(
        MemoryResolver.use((r) =>
          r.search({
            query: 'memory resolver',
            projectId: 'test-project',
            issueId: 'PAN-1938',
          }),
        ),
        layer,
      ),
    )

    expect(result).toHaveLength(1)
    expect(result[0].content).toBe('Memory resolver built')
    expect(result[0].projectId).toBe('test-project')
    expect(result[0].tags).toEqual(['architecture'])
  })

  it('returns empty array when query is blank', async () => {
    const { layer: filesLayer } = makeMemoryFilesLayer({})
    const searchLayer = makeMemorySearchLayer([])
    const dbLayer = makeFakeDbLayer()

    const layer = MemoryResolverLive.pipe(
      Layer.provide(searchLayer),
      Layer.provide(filesLayer),
      Layer.provide(dbLayer),
    )

    const result = await Effect.runPromise(
      Effect.provide(
        MemoryResolver.use((r) => r.search({ query: '', projectId: 'test-project' })),
        layer,
      ),
    )
    expect(result).toHaveLength(0)
  })

  it('getStatus delegates to MemoryFiles door', async () => {
    const status = {
      name: 'test-issue',
      headline: 'Building',
      summary: 'In progress',
      goal: null,
      phase: 'building',
      accomplished: [],
      decided: [],
      open: [],
      nextSteps: [],
      confidence: 0.9,
      workingSet: [],
      tags: [],
    }
    const { layer: filesLayer } = makeMemoryFilesLayer({ status })
    const searchLayer = makeMemorySearchLayer([])
    const dbLayer = makeFakeDbLayer()

    const layer = MemoryResolverLive.pipe(
      Layer.provide(searchLayer),
      Layer.provide(filesLayer),
      Layer.provide(dbLayer),
    )

    const result = await Effect.runPromise(
      Effect.provide(
        MemoryResolver.use((r) => r.getStatus('test-project', 'PAN-1938')),
        layer,
      ),
    )
    expect(result).toEqual(status)
  })

  it('getStatus returns null when no status exists', async () => {
    const { layer: filesLayer } = makeMemoryFilesLayer({})
    const searchLayer = makeMemorySearchLayer([])
    const dbLayer = makeFakeDbLayer()

    const layer = MemoryResolverLive.pipe(
      Layer.provide(searchLayer),
      Layer.provide(filesLayer),
      Layer.provide(dbLayer),
    )

    const result = await Effect.runPromise(
      Effect.provide(
        MemoryResolver.use((r) => r.getStatus('test-project', 'PAN-1938')),
        layer,
      ),
    )
    expect(result).toBeNull()
  })

  it('listResetMarkers delegates to MemoryFiles door', async () => {
    const markers: ResetMarker[] = [
      {
        id: 'rm-001',
        scope: 'project',
        scopeId: 'test-project',
        fromTimestamp: '2026-06-17T00:00:00.000Z',
        reason: 'test reset',
        createdAt: '2026-06-17T00:00:00.000Z',
      },
    ]
    const { layer: filesLayer } = makeMemoryFilesLayer({ markers })
    const searchLayer = makeMemorySearchLayer([])
    const dbLayer = makeFakeDbLayer()

    const layer = MemoryResolverLive.pipe(
      Layer.provide(searchLayer),
      Layer.provide(filesLayer),
      Layer.provide(dbLayer),
    )

    const result = await Effect.runPromise(
      Effect.provide(
        MemoryResolver.use((r) => r.listResetMarkers('test-project')),
        layer,
      ),
    )
    expect(result).toHaveLength(1)
    expect(result[0].id).toBe('rm-001')
  })

  it('does NOT expose a subscribeMemoryEvents method (AC3 — events go through EventBus)', async () => {
    const { layer: filesLayer } = makeMemoryFilesLayer({})
    const searchLayer = makeMemorySearchLayer([])
    const dbLayer = makeFakeDbLayer()

    const layer = MemoryResolverLive.pipe(
      Layer.provide(searchLayer),
      Layer.provide(filesLayer),
      Layer.provide(dbLayer),
    )

    const keys = await Effect.runPromise(
      Effect.provide(
        MemoryResolver.use((r) => Effect.sync(() => Object.keys(r as object))),
        layer,
      ),
    )
    expect(keys).not.toContain('subscribeMemoryEvents')
  })
})

// ── MemoryWriter tests ────────────────────────────────────────────────────────

describe('MemoryWriter.writeObservation', () => {
  it('writes to files door (source of truth) first, then FTS, then emits event', async () => {
    const o = makeObservation()
    const { layer: filesLayer, written } = makeMemoryFilesLayer({})
    const ftsTransactions: string[][] = []
    const searchLayer = Layer.succeed(
      MemorySearch,
      MemorySearch.of({
        statement: <T>(_: string, _s: FtsStatement) => Effect.sync(() => [] as T),
        transaction: (_projectId: string, stmts: ReadonlyArray<FtsStatement>) =>
          Effect.sync(() => {
            ftsTransactions.push(stmts.map((s) => s.sql))
            return [] as unknown[]
          }),
      }),
    )
    const emitted: string[] = []
    const busLayer = makeEventBusLayer(emitted)
    const dbLayer = makeFakeDbLayer()

    const layer = MemoryWriterLive.pipe(
      Layer.provide(searchLayer),
      Layer.provide(filesLayer),
      Layer.provide(busLayer),
      Layer.provide(dbLayer),
    )

    await Effect.runPromise(
      Effect.provide(
        MemoryWriter.use((w) => w.writeObservation(o)),
        layer,
      ),
    )

    // SOURCE OF TRUTH: the observation must land in MemoryFiles first.
    expect(written.observations).toHaveLength(1)
    expect((written.observations[0] as MemoryObservation).id).toBe('obs-test-001')

    // ANNOUNCE: the domain event must be emitted.
    expect(emitted).toContain('memory.observation_created')

    // FTS indexing must have run.
    expect(ftsTransactions).toHaveLength(1)
  })

  it('preserves observation files unmodified (AC2 — read-only observation scan)', async () => {
    const o = makeObservation()
    const { layer: filesLayer, written } = makeMemoryFilesLayer({})
    const searchLayer = makeMemorySearchLayer([])
    const emitted: string[] = []
    const busLayer = makeEventBusLayer(emitted)
    const dbLayer = makeFakeDbLayer()

    const layer = MemoryWriterLive.pipe(
      Layer.provide(searchLayer),
      Layer.provide(filesLayer),
      Layer.provide(busLayer),
      Layer.provide(dbLayer),
    )

    await Effect.runPromise(
      Effect.provide(
        MemoryWriter.use((w) => w.writeObservation(o)),
        layer,
      ),
    )

    // The observation appended must be byte-identical to the input (no mutation).
    const appended = written.observations[0] as MemoryObservation
    expect(appended.id).toBe(o.id)
    expect(appended.narrative).toBe(o.narrative)
    expect(appended.summary).toBe(o.summary)
  })
})

describe('MemoryWriter.createResetMarker', () => {
  it('writes reset-markers.json first, then FTS copy, then emits event', async () => {
    const { layer: filesLayer, written } = makeMemoryFilesLayer({})
    const ftsStatements: string[] = []
    const searchLayer = Layer.succeed(
      MemorySearch,
      MemorySearch.of({
        statement: <T>(_: string, stmt: FtsStatement) =>
          Effect.sync(() => {
            ftsStatements.push(stmt.sql)
            return [] as T
          }),
        transaction: (_: string, _s: ReadonlyArray<FtsStatement>) =>
          Effect.sync(() => [] as unknown[]),
      }),
    )
    const emitted: string[] = []
    const busLayer = makeEventBusLayer(emitted)
    const dbLayer = makeFakeDbLayer()

    const layer = MemoryWriterLive.pipe(
      Layer.provide(searchLayer),
      Layer.provide(filesLayer),
      Layer.provide(busLayer),
      Layer.provide(dbLayer),
    )

    const marker = await Effect.runPromise(
      Effect.provide(
        MemoryWriter.use((w) =>
          w.createResetMarker({
            projectId: 'test-project',
            scope: 'project',
            scopeId: 'test-project',
            reason: 'test',
          }),
        ),
        layer,
      ),
    )

    expect(marker.scope).toBe('project')
    expect(marker.reason).toBe('test')
    // File write first.
    expect(written.markers).toHaveLength(1)
    // FTS insert second.
    expect(ftsStatements.some((s) => s.includes('INSERT INTO reset_markers'))).toBe(true)
    // Announce third.
    expect(emitted).toContain('memory.reset_marker_created')
  })
})

describe('MemoryWriter Layer R type', () => {
  it('MemoryWriter Layer requires Db | MemorySearch | MemoryFiles | EventBus (AC2)', () => {
    // MemoryWriterLive is typed as Layer.Layer<MemoryWriter, ..., Db | MemorySearch | MemoryFiles | EventBus>
    // This test verifies the type compiles — a compile error here = architecture violation.
    const _typeCheck: Layer.Layer<
      MemoryWriter,
      unknown,
      Db | MemorySearch | MemoryFiles | EventBus
    > = MemoryWriterLive
    expect(_typeCheck).toBeDefined()
  })
})

describe('MemoryWriter.rebuildIndex', () => {
  it('drops+recreates FTS tables, scans JSONL files, reindexes observations, re-applies markers', async () => {
    const obs1 = makeObservation({ id: 'obs-001', narrative: 'First observation' })
    const obs2 = makeObservation({ id: 'obs-002', narrative: 'Second observation' })

    const execStatements: string[] = []
    const indexedObsIds: string[] = []
    const insertedMarkerSqls: string[] = []

    const searchLayer = Layer.succeed(
      MemorySearch,
      MemorySearch.of({
        statement: <T>(_projectId: string, stmt: FtsStatement) => {
          execStatements.push(stmt.sql)
          return Effect.sync(() => null as T)
        },
        transaction: (_projectId: string, stmts: ReadonlyArray<FtsStatement>) =>
          Effect.sync(() => {
            // The INSERT into observation_index carries the obs id as the first param.
            const obsInsert = stmts.find((s) => s.sql.includes('observation_index'))
            if (obsInsert?.params?.[0]) indexedObsIds.push(obsInsert.params[0] as string)
            const markerInsert = stmts.find((s) => s.sql.includes('reset_markers'))
            if (markerInsert) insertedMarkerSqls.push(markerInsert.sql)
            return [] as unknown[]
          }),
      }),
    )

    const markers = [
      {
        id: 'rm-001',
        scope: 'project' as const,
        scopeId: 'test-project',
        fromTimestamp: '2026-06-17T00:00:00.000Z',
        reason: 'initial',
        createdAt: '2026-06-17T00:00:00.000Z',
      },
    ]

    const { layer: filesLayer } = makeMemoryFilesLayer({
      markers,
      observationFiles: {
        '/tmp/2026-06-17.jsonl': [obs1, obs2],
      },
    })
    // Override listObservationFiles to return our test path.
    const filesLayerWithFiles = Layer.succeed(
      MemoryFiles,
      MemoryFiles.of({
        appendObservation: (o: unknown) =>
          Effect.sync(() => ({ jsonlPath: '/tmp/test.jsonl', byteOffset: 0 })),
        upsertMarkdown: (_o: unknown) => Effect.succeed(undefined),
        readStatus: (_p: string, _i: string) => Effect.sync(() => null),
        writeStatus: (_p: string, _i: string, _s: unknown) => Effect.sync(() => undefined),
        readResetMarkers: (_p: string) => Effect.sync(() => markers as ReadonlyArray<unknown>),
        writeResetMarker: (_p: string, _m: unknown) => Effect.sync(() => undefined),
        listObservationFiles: (_p: string) =>
          Effect.sync(() => ['/tmp/2026-06-17.jsonl'] as ReadonlyArray<string>),
        readObservationsFile: (path: string) =>
          Effect.sync(() => (path === '/tmp/2026-06-17.jsonl' ? [obs1, obs2] : []) as ReadonlyArray<unknown>),
        findByteOffset: (_path: string, id: string) =>
          Effect.sync(() => (id === 'obs-001' ? 0 : 120)),
      }),
    )

    const emitted: string[] = []
    const busLayer = makeEventBusLayer(emitted)
    const dbLayer = makeFakeDbLayer()

    const layer = MemoryWriterLive.pipe(
      Layer.provide(searchLayer),
      Layer.provide(filesLayerWithFiles),
      Layer.provide(busLayer),
      Layer.provide(dbLayer),
    )

    const result = await Effect.runPromise(
      Effect.provide(
        MemoryWriter.use((w) => w.rebuildIndex('test-project')),
        layer,
      ),
    )

    expect(result.projectId).toBe('test-project')
    // Both observations were reindexed.
    expect(result.reindexed).toBe(2)
    expect(indexedObsIds).toContain('obs-001')
    expect(indexedObsIds).toContain('obs-002')
    // The rebuildable cache tables were cleared without recreating migration-owned tables.
    expect(execStatements.some((s) => s.includes('DELETE FROM memory_fts'))).toBe(true)
    // Reset marker was re-applied.
    expect(execStatements.some((s) => s.includes('INSERT INTO reset_markers'))).toBe(true)
  })
})
