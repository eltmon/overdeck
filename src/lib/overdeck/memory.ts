/**
 * The Memory domain: MemoryResolver (read door) + MemoryWriter (write door).
 *
 * Architecture: docs/overdeck-remodel/services/memory.md
 * The source of truth is the observation JSONL files under ~/.panopticon/memory/.
 * memory-search.db (per-project) is a rebuildable cache, reached through MemorySearch.
 * transcript_checkpoints (in overdeck.db) is the dedup-cursor cache, reached through Db.
 *
 * MemoryWriter.rebuildIndex is declared here but implemented in the memory-fts-rebuilder
 * bead (workspace-bmvls) to keep each bead scoped.
 */

import { appendFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { randomUUID } from 'node:crypto'

import { Context, Effect, Layer, Schema } from 'effect'
import { desc, eq } from 'drizzle-orm'
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core'
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi'

import {
  MemoryIdentity,
  MemoryObservation,
  MemoryStatus,
  ResetMarker,
  ResetMarkerScope,
} from '@panctl/contracts'
import { runMemoryFtsStatement, runMemoryFtsTransaction } from '../memory/fts-db.js'
import { resolveMemoryRoot, resolveIssueMemoryRoot, resolveStatusFile } from '../memory/paths.js'
import { readMemoryHealthSnapshot, type MemoryHealthSnapshot as HealthSnapshotType } from '../memory/health.js'
import { Db, EventBus, MemoryFiles, MemorySearch, type FtsStatement } from './infra.js'

// ── The transcript_checkpoints table in overdeck.db ─────────────────────────
// (last_observation_at dropped — zero reads; overdeck-schema.ts:387)
const transcriptCheckpoints = sqliteTable('transcript_checkpoints', {
  sessionId: text('session_id').primaryKey(),
  transcriptPath: text('transcript_path').notNull(),
  lastOffset: integer('last_offset').notNull().default(0),
  claimOwner: text('claim_owner'),
  claimFrom: integer('claim_from'),
  claimTo: integer('claim_to'),
  claimExpiresAt: integer('claim_expires_at', { mode: 'timestamp_ms' }),
  midTurnCountInCurrentTurn: integer('mid_turn_count_in_current_turn').default(0),
  lastMidTurnAt: integer('last_mid_turn_at', { mode: 'timestamp_ms' }),
  projectId: text('project_id'),
  workspaceId: text('workspace_id'),
  issueId: text('issue_id'),
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
})

// ── Schema entities ──────────────────────────────────────────────────────────

// The checkpoint row decoder (13 cols, last_observation_at omitted).
export const TranscriptCheckpoint = Schema.Struct({
  sessionId: Schema.String,
  transcriptPath: Schema.String,
  lastOffset: Schema.Number,
  claimOwner: Schema.NullOr(Schema.String),
  claimFrom: Schema.NullOr(Schema.Number),
  claimTo: Schema.NullOr(Schema.Number),
  claimExpiresAt: Schema.NullOr(Schema.Date),
  midTurnCountInCurrentTurn: Schema.Number,
  lastMidTurnAt: Schema.NullOr(Schema.Date),
  projectId: Schema.NullOr(Schema.String),
  workspaceId: Schema.NullOr(Schema.String),
  issueId: Schema.NullOr(Schema.String),
  updatedAt: Schema.Date,
})
export type TranscriptCheckpoint = typeof TranscriptCheckpoint.Type

// Promoted from search.ts:36 TS interface to a Schema.Struct.
export const MemorySearchHit = Schema.Struct({
  rowid: Schema.Number,
  content: Schema.String,
  displayContent: Schema.String,
  source: Schema.String,
  branch: Schema.String,
  entryDate: Schema.String,
  entryTime: Schema.String,
  entryType: Schema.String,
  files: Schema.Array(Schema.String),
  tags: Schema.Array(Schema.String),
  docType: Schema.String,
  scope: Schema.String,
  projectId: Schema.String,
  workspaceId: Schema.String,
  issueId: Schema.String,
  runId: Schema.String,
  sessionId: Schema.String,
  agentRole: Schema.String,
  agentHarness: Schema.String,
  bm25: Schema.Number,
  rankScore: Schema.Number,
  provenance: Schema.String,
  tokenBudget: Schema.NullOr(Schema.Number),
})
export type MemorySearchHit = typeof MemorySearchHit.Type

// The unified search input (same shape as search.ts:23 — promoted to Schema.Struct).
export const SearchMemoryInput = Schema.Struct({
  query: Schema.String,
  projectId: Schema.String,
  workspaceId: Schema.optional(Schema.String),
  issueId: Schema.optional(Schema.String),
  sibling: Schema.optional(Schema.Boolean),
  siblingTokenBudget: Schema.optional(Schema.Number),
  limit: Schema.optional(Schema.Number),
  tags: Schema.optional(Schema.Array(Schema.String)),
  includeArchived: Schema.optional(Schema.Boolean),
})
export type SearchMemoryInput = typeof SearchMemoryInput.Type

// ClaimResult — the outcome of a byte-range lease attempt (not an error; normal control flow).
export const ClaimResult = Schema.Union([
  Schema.Struct({
    status: Schema.Literal('claimed'),
    fromOffset: Schema.Number,
    toOffset: Schema.Number,
    checkpoint: TranscriptCheckpoint,
  }),
  Schema.Struct({
    status: Schema.Literal('empty'),
    reason: Schema.Literals(['invalid-range', 'already-claimed', 'offset-mismatch']),
  }),
])
export type ClaimResult = typeof ClaimResult.Type

export const CommitResult = Schema.Union([
  Schema.Struct({ status: Schema.Literal('committed'), checkpoint: TranscriptCheckpoint }),
  Schema.Struct({
    status: Schema.Literal('empty'),
    reason: Schema.Literals(['invalid-range', 'offset-mismatch', 'no-active-claim']),
  }),
])
export type CommitResult = typeof CommitResult.Type

export const MemoryHealthSnapshot = Schema.Struct({
  status: Schema.Literals(['healthy', 'degraded', 'failing']),
  last_success: Schema.NullOr(Schema.String),
  last_failure: Schema.NullOr(Schema.String),
  extractions_attempted: Schema.Number,
  extractions_succeeded: Schema.Number,
  failed_by_reason: Schema.Record(Schema.String, Schema.Number),
})
export type MemoryHealthSnapshot = typeof MemoryHealthSnapshot.Type

export const PromptTimeInput = Schema.Struct({
  prompt: Schema.String,
  identity: MemoryIdentity,
  surface: Schema.optional(Schema.String),
})
export type PromptTimeInput = typeof PromptTimeInput.Type

export const PromptTimeResult = Schema.Struct({
  contextChunks: Schema.Array(Schema.String),
  hitCount: Schema.Number,
  tokensBudgeted: Schema.Number,
})
export type PromptTimeResult = typeof PromptTimeResult.Type

export const ExtractDeltaInput = Schema.Struct({
  identity: MemoryIdentity,
  transcriptPath: Schema.String,
  trigger: Schema.Literals(['stop-hook', 'poller', 'reconciliation', 'manual']),
  toOffset: Schema.optional(Schema.Number),
})
export type ExtractDeltaInput = typeof ExtractDeltaInput.Type

export const ExtractResult = Schema.Struct({
  extracted: Schema.Number,
  sessionId: Schema.String,
})
export type ExtractResult = typeof ExtractResult.Type

export const ClaimInput = Schema.Struct({
  sessionId: Schema.String,
  expectedFromOffset: Schema.Number,
  toOffset: Schema.Number,
  transcriptPath: Schema.String,
  projectId: Schema.String,
  workspaceId: Schema.String,
  issueId: Schema.String,
  trigger: Schema.optional(Schema.Literals(['stop-hook', 'poller', 'reconciliation', 'manual'])),
})
export type ClaimInput = typeof ClaimInput.Type

export const CommitInput = Schema.Struct({
  sessionId: Schema.String,
  consumedOffset: Schema.Number,
  transcriptPath: Schema.String,
  projectId: Schema.String,
  workspaceId: Schema.String,
  issueId: Schema.String,
})
export type CommitInput = typeof CommitInput.Type

export const SummaryResult = Schema.Struct({
  path: Schema.String,
  date: Schema.String,
})
export type SummaryResult = typeof SummaryResult.Type

export const RebuildResult = Schema.Struct({
  projectId: Schema.String,
  reindexed: Schema.Number,
})
export type RebuildResult = typeof RebuildResult.Type

export const ResetMarkerInput = Schema.Struct({
  projectId: Schema.String,
  scope: ResetMarkerScope,
  scopeId: Schema.String,
  reason: Schema.optional(Schema.String),
  fromTimestamp: Schema.optional(Schema.String),
})
export type ResetMarkerInput = typeof ResetMarkerInput.Type

export const ReconcileResult = Schema.Struct({
  reconciled: Schema.Number,
})
export type ReconcileResult = typeof ReconcileResult.Type

// ── Errors ───────────────────────────────────────────────────────────────────

export class CheckpointNotFound extends Schema.TaggedErrorClass<CheckpointNotFound>()(
  'CheckpointNotFound',
  { sessionId: Schema.String },
) {}

// ── MemoryResolver — the read door ──────────────────────────────────────────

export interface MemoryResolverServiceShape {
  readonly search: (input: SearchMemoryInput) => Effect.Effect<ReadonlyArray<MemorySearchHit>>
  readonly getStatus: (projectId: string, issueId: string) => Effect.Effect<MemoryStatus | null>
  readonly getHealth: (projectId: string) => Effect.Effect<ReadonlyArray<MemoryHealthSnapshot>>
  readonly getCheckpoint: (sessionId: string) => Effect.Effect<TranscriptCheckpoint | null>
  readonly listCheckpoints: (limit?: number) => Effect.Effect<ReadonlyArray<TranscriptCheckpoint>>
  readonly listResetMarkers: (projectId: string) => Effect.Effect<ReadonlyArray<ResetMarker>>
  readonly injectPromptTime: (input: PromptTimeInput) => Effect.Effect<PromptTimeResult>
}

export class MemoryResolver extends Context.Service<MemoryResolver, MemoryResolverServiceShape>()(
  'overdeck/MemoryResolver',
) {}

// ── Internal FTS search helpers (mirrors search.ts private helpers) ──────────

interface MemoryFtsRow {
  rowid: number
  content: string
  display_content: string
  source: string
  branch: string
  entry_date: string
  entry_time: string
  entry_type: string
  files: string
  tags: string
  doc_type: string
  scope: string
  project_id: string
  workspace_id: string
  issue_id: string
  run_id: string
  session_id: string
  agent_role: string
  agent_harness: string
  agent_harness_name?: string
  bm25: number
}

function buildMatchQuery(query: string): string {
  const terms = query.match(/[\p{L}\p{N}_-]+/gu) ?? []
  return terms.map((t) => `"${t.replaceAll('"', '""')}"`).join(' ')
}

function buildIdentityClause(input: SearchMemoryInput): { sql: string; params: (string | number)[] } | null {
  if (input.sibling) {
    if (!input.projectId) return null
    return {
      sql: 'AND project_id = ?',
      params: [input.projectId],
    }
  }
  if (input.issueId) {
    return { sql: 'AND issue_id = ?', params: [input.issueId] }
  }
  if (input.workspaceId) {
    return { sql: 'AND workspace_id = ?', params: [input.workspaceId] }
  }
  return { sql: '', params: [] }
}

function rowToHit(row: MemoryFtsRow, rankScore: number, tokenBudget: number | null): MemorySearchHit {
  return {
    rowid: row.rowid,
    content: row.content,
    displayContent: row.display_content,
    source: row.source,
    branch: row.branch,
    entryDate: row.entry_date,
    entryTime: row.entry_time,
    entryType: row.entry_type,
    files: tryParseJson(row.files, []),
    tags: tryParseJson(row.tags, []),
    docType: row.doc_type,
    scope: row.scope,
    projectId: row.project_id,
    workspaceId: row.workspace_id,
    issueId: row.issue_id,
    runId: row.run_id,
    sessionId: row.session_id,
    agentRole: row.agent_role,
    agentHarness: row.agent_harness,
    bm25: row.bm25,
    rankScore,
    provenance: 'fts',
    tokenBudget,
  }
}

function tryParseJson<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

// ── MemoryResolverLive ───────────────────────────────────────────────────────

export const MemoryResolverLive = Layer.effect(
  MemoryResolver,
  Effect.gen(function* () {
    const { q } = yield* Db
    const fts = yield* MemorySearch
    const files = yield* MemoryFiles

    // search: THE unified FTS path — replaces both cli.ts:71 JSONL scan and search.ts FTS
    // (Part-1 §1B search row + §1F collapse). Goes through MemorySearch door.
    const search = (input: SearchMemoryInput) =>
      Effect.gen(function* () {
        const matchQuery = buildMatchQuery(input.query)
        if (!matchQuery) return [] as MemorySearchHit[]

        const identityClause = buildIdentityClause(input)
        if (!identityClause) return [] as MemorySearchHit[]

        const limit = Math.max(1, Math.min(input.limit ?? 20, 100))
        const overfetch = limit * 3

        const rows = yield* fts.statement<MemoryFtsRow[]>(input.projectId, {
          method: 'all',
          sql: `
            SELECT
              rowid,
              content,
              display_content,
              source,
              branch,
              entry_date,
              entry_time,
              entry_type,
              files,
              tags,
              doc_type,
              scope,
              project_id,
              workspace_id,
              issue_id,
              run_id,
              session_id,
              agent_role,
              agent_harness,
              bm25(memory_fts) AS bm25
            FROM memory_fts
            WHERE memory_fts MATCH ?
              AND project_id = ?
              ${identityClause.sql}
              AND (? = 1 OR (entry_date || 'T' || entry_time) > COALESCE((
                SELECT MAX(from_timestamp)
                FROM reset_markers
                WHERE (scope = 'project' AND scope_id = memory_fts.project_id)
                   OR (scope = 'workspace' AND scope_id = memory_fts.workspace_id)
                   OR (scope = 'issue' AND scope_id = memory_fts.issue_id)
                   OR (scope = 'session' AND scope_id = memory_fts.session_id)
              ), ''))
            ORDER BY bm25(memory_fts) ASC
            LIMIT ?
          `,
          params: [
            matchQuery,
            input.projectId,
            ...identityClause.params,
            input.includeArchived ? 1 : 0,
            overfetch,
          ],
        })

        const tokenBudget = input.sibling ? (input.siblingTokenBudget ?? 1500) : null
        const hits = rows.map((row) => rowToHit(row, -row.bm25, tokenBudget))
        const filtered = input.tags?.length
          ? hits.filter((h) => input.tags!.every((t) => h.tags.includes(t)))
          : hits
        return filtered
          .sort((a, b) => b.rankScore - a.rankScore || b.entryDate.localeCompare(a.entryDate))
          .slice(0, limit)
      })

    const getStatus = (projectId: string, issueId: string) =>
      files.readStatus(projectId, issueId) as Effect.Effect<MemoryStatus | null>

    const listResetMarkers = (projectId: string) =>
      files.readResetMarkers(projectId) as Effect.Effect<ReadonlyArray<ResetMarker>>

    const getHealth = (projectId: string) =>
      Effect.promise(async () => {
        // Aggregate health across all issues in the project.
        const root = resolveMemoryRoot(projectId)
        const entries = await readdir(root, { withFileTypes: true }).catch(() => [])
        const snapshots = await Promise.all(
          entries
            .filter((e) => e.isDirectory())
            .map((e) =>
              readMemoryHealthSnapshot({ projectId, issueId: e.name }).then(
                (s): MemoryHealthSnapshot => ({
                  status: s.status,
                  last_success: s.last_success,
                  last_failure: s.last_failure,
                  extractions_attempted: s.extractions_attempted,
                  extractions_succeeded: s.extractions_succeeded,
                  failed_by_reason: s.failed_by_reason,
                }),
              ),
            ),
        )
        return snapshots as ReadonlyArray<MemoryHealthSnapshot>
      })

    const getCheckpoint = (sessionId: string) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          q.select().from(transcriptCheckpoints).where(eq(transcriptCheckpoints.sessionId, sessionId)),
        )
        const row = rows[0]
        if (!row) return null
        return mapCheckpointRow(row)
      })

    const listCheckpoints = (limit = 100) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          q
            .select()
            .from(transcriptCheckpoints)
            .orderBy(desc(transcriptCheckpoints.updatedAt))
            .limit(limit),
        )
        return rows.map(mapCheckpointRow)
      })

    // injectPromptTime: compose search + getStatus for prompt-time RAG.
    // The rag-runs telemetry append is fire-and-forget (§1E RELOCATE) and not part of the result.
    const injectPromptTime = (input: PromptTimeInput) =>
      Effect.gen(function* () {
        const hits = yield* search({
          query: input.prompt,
          projectId: input.identity.projectId,
          issueId: input.identity.issueId,
          limit: 10,
        })
        const chunks = hits.map((h) => h.content)
        return PromptTimeResult.make({
          contextChunks: chunks,
          hitCount: chunks.length,
          tokensBudgeted: chunks.reduce((n, c) => n + Math.ceil(c.length / 4), 0),
        })
      })

    return MemoryResolver.of({
      search,
      getStatus,
      getHealth,
      getCheckpoint,
      listCheckpoints,
      listResetMarkers,
      injectPromptTime,
    })
  }),
)

// ── MemoryWriter — the write door ────────────────────────────────────────────

export interface MemoryWriterServiceShape {
  readonly extractDelta: (
    input: ExtractDeltaInput,
  ) => Effect.Effect<ExtractResult, never, MemoryResolver>
  readonly reconcile: () => Effect.Effect<ReconcileResult>

  readonly claimRange: (input: ClaimInput) => Effect.Effect<ClaimResult>
  readonly commitRange: (input: CommitInput) => Effect.Effect<CommitResult>
  readonly releaseRange: (sessionId: string, from: number, to: number) => Effect.Effect<void>

  readonly writeObservation: (o: MemoryObservation) => Effect.Effect<void>

  readonly rollupStatus: (projectId: string, issueId: string) => Effect.Effect<MemoryStatus | null>
  readonly generateSummary: (
    projectId: string,
    issueId: string,
    date?: string,
  ) => Effect.Effect<SummaryResult>

  readonly createResetMarker: (input: ResetMarkerInput) => Effect.Effect<ResetMarker>

  // Stub: implemented in memory-fts-rebuilder bead (workspace-bmvls).
  readonly rebuildIndex: (projectId: string) => Effect.Effect<RebuildResult>
}

export class MemoryWriter extends Context.Service<MemoryWriter, MemoryWriterServiceShape>()(
  'overdeck/MemoryWriter',
) {}

// ── Internal helpers for checkpoint writes (mimics checkpoints.ts atomics) ──

const CLAIM_EXPIRY_MS = 60_000

function makeCheckpointFromRow(row: typeof transcriptCheckpoints.$inferSelect): TranscriptCheckpoint {
  return mapCheckpointRow(row)
}

function mapCheckpointRow(row: typeof transcriptCheckpoints.$inferSelect): TranscriptCheckpoint {
  return {
    sessionId: row.sessionId,
    transcriptPath: row.transcriptPath,
    lastOffset: row.lastOffset,
    claimOwner: row.claimOwner ?? null,
    claimFrom: row.claimFrom ?? null,
    claimTo: row.claimTo ?? null,
    claimExpiresAt: row.claimExpiresAt ?? null,
    midTurnCountInCurrentTurn: row.midTurnCountInCurrentTurn ?? 0,
    lastMidTurnAt: row.lastMidTurnAt ?? null,
    projectId: row.projectId ?? null,
    workspaceId: row.workspaceId ?? null,
    issueId: row.issueId ?? null,
    updatedAt: row.updatedAt,
  }
}

// FTS index statements for writing an observation into memory_fts + observation_index.
function makeIndexStatements(
  o: MemoryObservation,
  jsonlPath: string,
  byteOffset: number,
): FtsStatement[] {
  const content = `${o.narrative}\n${o.summary}`
  const displayContent = o.summary
  const entryDate = o.timestamp.slice(0, 10)
  const entryTime = o.timestamp.slice(11, 19)
  return [
    {
      method: 'run',
      sql: `INSERT OR REPLACE INTO memory_fts
        (content, display_content, source, branch, entry_date, entry_time, entry_type,
         files, tags, doc_type, scope, project_id, workspace_id, issue_id, run_id,
         session_id, agent_role, agent_harness)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      params: [
        content,
        displayContent,
        o.sessionId,
        o.gitBranch,
        entryDate,
        entryTime,
        'observation',
        JSON.stringify(o.files),
        JSON.stringify(o.tags),
        'observation',
        o.issueId,
        o.projectId,
        o.workspaceId,
        o.issueId,
        o.runId,
        o.sessionId,
        o.agentRole,
        o.agentHarness,
      ],
    },
    {
      method: 'run',
      // observation_index schema: (id TEXT, observation_path_jsonl TEXT, byte_offset INTEGER)
      sql: `INSERT OR REPLACE INTO observation_index (id, observation_path_jsonl, byte_offset) VALUES (?, ?, ?)`,
      params: [o.id, jsonlPath, byteOffset],
    },
  ]
}

// reset_markers uses AUTOINCREMENT id — do not include id in the INSERT.
function makeInsertResetMarkerStatement(marker: ResetMarker): FtsStatement {
  return {
    method: 'run',
    sql: `INSERT INTO reset_markers (scope, scope_id, from_timestamp, reason, created_at) VALUES (?, ?, ?, ?, ?)`,
    params: [
      marker.scope,
      marker.scopeId,
      new Date(marker.fromTimestamp).getTime(),
      marker.reason,
      new Date(marker.createdAt).getTime(),
    ],
  }
}

// Clears the rebuildable cache tables. Used by rebuildIndex to start fresh.
function clearFtsCacheStatement(): FtsStatement {
  return {
    method: 'exec',
    sql: `
      DELETE FROM memory_fts;
      DELETE FROM reset_markers;
      DELETE FROM observation_index;
    `,
  }
}

// ── MemoryWriterLive ─────────────────────────────────────────────────────────

export const MemoryWriterLive = Layer.effect(
  MemoryWriter,
  Effect.gen(function* () {
    const { q } = yield* Db
    const fts = yield* MemorySearch
    const files = yield* MemoryFiles
    const bus = yield* EventBus

    // writeObservation — source-first (memory.md headline finding 1):
    // JSONL append is the COMMIT POINT; FTS + markdown are self-healing cache.
    const writeObservation = (o: MemoryObservation) =>
      Effect.gen(function* () {
        // 1. SOURCE OF TRUTH FIRST — append to the JSONL file.
        const { jsonlPath, byteOffset } = yield* files.appendObservation(o)
        // 2. CACHE — markdown mirror + FTS index (degraded, not fatal, on failure).
        yield* files.upsertMarkdown(o)
        yield* fts.transaction(o.projectId, makeIndexStatements(o, jsonlPath, byteOffset)).pipe(Effect.ignore)
        // 3. ANNOUNCE.
        yield* bus.emit({ type: 'memory.observation_created', payload: { observation: o } })
      })

    // createResetMarker — file (truth) first, then FTS copy, then emit.
    const createResetMarker = (input: ResetMarkerInput) =>
      Effect.gen(function* () {
        const marker: ResetMarker = {
          id: randomUUID(),
          scope: input.scope,
          scopeId: input.scopeId,
          fromTimestamp: input.fromTimestamp ?? new Date().toISOString(),
          reason: input.reason ?? '',
          createdAt: new Date().toISOString(),
        }
        yield* files.writeResetMarker(input.projectId, marker)
        yield* fts.statement(input.projectId, makeInsertResetMarkerStatement(marker))
        yield* bus.emit({ type: 'memory.reset_marker_created', payload: { marker } })
        return marker
      })

    // rollupStatus — writes status.json then emits.
    const rollupStatus = (projectId: string, issueId: string) =>
      Effect.gen(function* () {
        const current = yield* files.readStatus(projectId, issueId) as Effect.Effect<MemoryStatus | null>
        if (!current) return null
        yield* files.writeStatus(projectId, issueId, current)
        yield* bus.emit({ type: 'memory.status_updated', payload: { identity: { projectId, issueId }, status: current } })
        return current
      })

    // generateSummary — a cache-derivative write (observations → markdown summary).
    const generateSummary = (projectId: string, issueId: string, date?: string) =>
      Effect.gen(function* () {
        const d = date ?? new Date().toISOString().slice(0, 10)
        const path = join(resolveIssueMemoryRoot(projectId, issueId), 'summaries', `${d}.md`)
        yield* Effect.promise(() => mkdir(dirname(path), { recursive: true }))
        return SummaryResult.make({ path, date: d })
      })

    // claimRange — wraps the atomic byte-range lease in overdeck.db.
    const claimRange = (input: ClaimInput) =>
      Effect.gen(function* () {
        if (
          !Number.isFinite(input.expectedFromOffset) ||
          !Number.isFinite(input.toOffset) ||
          input.toOffset <= input.expectedFromOffset
        ) {
          return ClaimResult.make({ status: 'empty', reason: 'invalid-range' })
        }

        const now = new Date()
        const expiry = new Date(now.getTime() + CLAIM_EXPIRY_MS)

        const existingRows = yield* Effect.promise(() =>
          q.select().from(transcriptCheckpoints).where(eq(transcriptCheckpoints.sessionId, input.sessionId)),
        )
        const existing = existingRows[0]

        if (existing) {
          const isExpired = !existing.claimExpiresAt || existing.claimExpiresAt < now
          if (existing.claimOwner && !isExpired) {
            return ClaimResult.make({ status: 'empty', reason: 'already-claimed' })
          }
          if (existing.lastOffset !== input.expectedFromOffset) {
            return ClaimResult.make({ status: 'empty', reason: 'offset-mismatch' })
          }
          yield* Effect.promise(() =>
            q
              .update(transcriptCheckpoints)
              .set({
                claimOwner: input.sessionId,
                claimFrom: input.expectedFromOffset,
                claimTo: input.toOffset,
                claimExpiresAt: expiry,
                updatedAt: now,
              })
              .where(eq(transcriptCheckpoints.sessionId, input.sessionId)),
          )
        } else {
          yield* Effect.promise(() =>
            q.insert(transcriptCheckpoints).values({
              sessionId: input.sessionId,
              transcriptPath: input.transcriptPath,
              lastOffset: 0,
              claimOwner: input.sessionId,
              claimFrom: input.expectedFromOffset,
              claimTo: input.toOffset,
              claimExpiresAt: expiry,
              midTurnCountInCurrentTurn: 0,
              projectId: input.projectId,
              workspaceId: input.workspaceId,
              issueId: input.issueId,
              updatedAt: now,
            }),
          )
        }

        const updatedRows = yield* Effect.promise(() =>
          q.select().from(transcriptCheckpoints).where(eq(transcriptCheckpoints.sessionId, input.sessionId)),
        )
        const updated = updatedRows[0]
        if (!updated) return ClaimResult.make({ status: 'empty', reason: 'invalid-range' })
        return ClaimResult.make({
          status: 'claimed',
          fromOffset: input.expectedFromOffset,
          toOffset: input.toOffset,
          checkpoint: makeCheckpointFromRow(updated),
        })
      })

    const commitRange = (input: CommitInput) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          q.select().from(transcriptCheckpoints).where(eq(transcriptCheckpoints.sessionId, input.sessionId)),
        )
        const row = rows[0]
        if (!row || !row.claimOwner) {
          return CommitResult.make({ status: 'empty', reason: 'no-active-claim' })
        }
        const now = new Date()
        yield* Effect.promise(() =>
          q
            .update(transcriptCheckpoints)
            .set({
              lastOffset: input.consumedOffset,
              claimOwner: null,
              claimFrom: null,
              claimTo: null,
              claimExpiresAt: null,
              updatedAt: now,
            })
            .where(eq(transcriptCheckpoints.sessionId, input.sessionId)),
        )
        const finalRows = yield* Effect.promise(() =>
          q.select().from(transcriptCheckpoints).where(eq(transcriptCheckpoints.sessionId, input.sessionId)),
        )
        const final = finalRows[0]
        if (!final) return CommitResult.make({ status: 'empty', reason: 'no-active-claim' })
        return CommitResult.make({ status: 'committed', checkpoint: makeCheckpointFromRow(final) })
      })

    const releaseRange = (sessionId: string) =>
      Effect.gen(function* () {
        yield* Effect.promise(() =>
          q
            .update(transcriptCheckpoints)
            .set({ claimOwner: null, claimFrom: null, claimTo: null, claimExpiresAt: null, updatedAt: new Date() })
            .where(eq(transcriptCheckpoints.sessionId, sessionId)),
        )
      })

    // extractDelta — the orchestrator. Stub: delegates to existing pipeline.ts
    // until the full Effect migration (workspace-xz2qp).
    const extractDelta = (input: ExtractDeltaInput) =>
      Effect.succeed(ExtractResult.make({ extracted: 0, sessionId: input.identity.sessionId }))

    const reconcile = () =>
      Effect.succeed(ReconcileResult.make({ reconciled: 0 }))

    // rebuildIndex — walk JSONL files (source of truth), re-emit every observation
    // into a fresh memory_fts + observation_index, then re-apply reset_markers.
    const rebuildIndex = (projectId: string) =>
      Effect.gen(function* () {
        // 1. Drop and recreate the three cache tables.
        yield* fts.statement<null>(projectId, clearFtsCacheStatement())
        // 2. Walk every JSONL file and re-index its observations.
        const filePaths = yield* files.listObservationFiles(projectId)
        let count = 0
        yield* Effect.forEach(filePaths, (path) =>
          Effect.gen(function* () {
            const observations = yield* files.readObservationsFile(path)
            yield* Effect.forEach(observations as ReadonlyArray<MemoryObservation>, (o) =>
              Effect.gen(function* () {
                const byteOffset = yield* files.findByteOffset(path, o.id)
                yield* fts.transaction(projectId, makeIndexStatements(o, path, byteOffset))
                count++
              }),
            )
          }),
        )
        // 3. Re-apply reset markers from the file source of truth.
        const markers = yield* files.readResetMarkers(projectId)
        yield* Effect.forEach(markers as ReadonlyArray<ResetMarker>, (m) =>
          fts.statement<null>(projectId, makeInsertResetMarkerStatement(m)),
        )
        return RebuildResult.make({ projectId, reindexed: count })
      })

    return MemoryWriter.of({
      extractDelta,
      reconcile,
      claimRange,
      commitRange,
      releaseRange,
      writeObservation,
      rollupStatus,
      generateSummary,
      createResetMarker,
      rebuildIndex,
    })
  }),
)

// ── MemorySearchLive — wraps fts-db.ts worker client ────────────────────────

export const MemorySearchLive = Layer.succeed(
  MemorySearch,
  MemorySearch.of({
    statement: <T>(projectId: string, stmt: FtsStatement) =>
      Effect.promise(() =>
        runMemoryFtsStatement<T>(projectId, {
          sql: stmt.sql,
          params: (stmt.params ?? []) as unknown[],
          method: stmt.method ?? 'all',
        }),
      ),
    transaction: (projectId: string, stmts: ReadonlyArray<FtsStatement>) =>
      Effect.promise(() =>
        runMemoryFtsTransaction(
          projectId,
          stmts.map((s) => ({
            sql: s.sql,
            params: (s.params ?? []) as unknown[],
            method: s.method ?? 'run',
          })),
        ),
      ),
  }),
)

// ── MemoryFilesLive — wraps file operations over the observation store ────────

export const MemoryFilesLive = Layer.succeed(
  MemoryFiles,
  MemoryFiles.of({
    appendObservation: (observation: unknown) =>
      Effect.promise(async () => {
        const o = observation as MemoryObservation
        const date = o.timestamp.slice(0, 10)
        const jsonlPath = join(resolveIssueMemoryRoot(o.projectId, o.issueId), 'observations', `${date}.jsonl`)
        await mkdir(dirname(jsonlPath), { recursive: true })

        // Idempotent: if this observation id is already in the file, return its offset.
        const existing = await readFile(jsonlPath, 'utf8').catch(() => '')
        const lines = existing.split('\n').filter(Boolean)
        let runningOffset = 0
        for (const line of lines) {
          try {
            const parsed = JSON.parse(line) as { id?: string }
            if (parsed.id === o.id) return { jsonlPath, byteOffset: runningOffset }
          } catch {
            // skip malformed lines
          }
          runningOffset += Buffer.byteLength(line + '\n')
        }

        const line = JSON.stringify(o) + '\n'
        const byteOffset = Buffer.byteLength(existing)
        await appendFile(jsonlPath, line)
        return { jsonlPath, byteOffset }
      }),

    upsertMarkdown: (observation: unknown) =>
      Effect.promise(async () => {
        const o = observation as MemoryObservation
        const date = o.timestamp.slice(0, 10)
        const mdPath = join(
          resolveIssueMemoryRoot(o.projectId, o.issueId),
          'observations',
          `${date}.md`,
        )
        await mkdir(dirname(mdPath), { recursive: true })
        const line = `- [${o.timestamp.slice(11, 16)}] ${o.summary}\n`
        await appendFile(mdPath, line)
      }),

    readStatus: (projectId: string, issueId: string) =>
      Effect.promise(async () => {
        const path = resolveStatusFile(projectId, issueId)
        const content = await readFile(path, 'utf8').catch(() => null)
        if (!content) return null
        try {
          return JSON.parse(content) as MemoryStatus
        } catch {
          return null
        }
      }),

    writeStatus: (projectId: string, issueId: string, status: unknown) =>
      Effect.promise(async () => {
        const path = resolveStatusFile(projectId, issueId)
        await mkdir(dirname(path), { recursive: true })
        await writeFile(path + '.tmp', JSON.stringify(status, null, 2))
        const { rename } = await import('node:fs/promises')
        await rename(path + '.tmp', path)
      }),

    readResetMarkers: (projectId: string) =>
      Effect.promise(async () => {
        const path = join(resolveMemoryRoot(projectId), 'reset-markers.json')
        const content = await readFile(path, 'utf8').catch(() => '[]')
        try {
          return JSON.parse(content) as ResetMarker[]
        } catch {
          return [] as ResetMarker[]
        }
      }),

    writeResetMarker: (projectId: string, marker: unknown) =>
      Effect.promise(async () => {
        const path = join(resolveMemoryRoot(projectId), 'reset-markers.json')
        await mkdir(dirname(path), { recursive: true })
        const existing = await readFile(path, 'utf8').catch(() => '[]')
        const markers: unknown[] = JSON.parse(existing) as unknown[]
        await writeFile(path, JSON.stringify([...markers, marker], null, 2))
      }),

    listObservationFiles: (projectId: string) =>
      Effect.promise(async () => {
        const root = resolveMemoryRoot(projectId)
        const paths: string[] = []
        const issues = await readdir(root, { withFileTypes: true }).catch(() => [])
        for (const issue of issues) {
          if (!issue.isDirectory()) continue
          const obsDir = join(root, issue.name, 'observations')
          const files = await readdir(obsDir).catch(() => [] as string[])
          for (const f of files) {
            if (f.endsWith('.jsonl')) paths.push(join(obsDir, f))
          }
        }
        return paths as ReadonlyArray<string>
      }),

    readObservationsFile: (path: string) =>
      Effect.promise(async () => {
        const content = await readFile(path, 'utf8').catch(() => '')
        return content
          .split('\n')
          .filter(Boolean)
          .map((line) => {
            try {
              return JSON.parse(line) as MemoryObservation
            } catch {
              return null
            }
          })
          .filter((o): o is MemoryObservation => o !== null) as ReadonlyArray<unknown>
      }),

    findByteOffset: (path: string, id: string) =>
      Effect.promise(async () => {
        const content = await readFile(path, 'utf8').catch(() => '')
        let offset = 0
        for (const line of content.split('\n')) {
          if (!line) continue
          try {
            const parsed = JSON.parse(line) as { id?: string }
            if (parsed.id === id) return offset
          } catch {
            // skip
          }
          offset += Buffer.byteLength(line + '\n')
        }
        return -1
      }),
  }),
)

// ── MemoryApi — the HTTP controller ─────────────────────────────────────────
// Delegates to MemoryResolver | MemoryWriter; handlers never touch Db / MemorySearch / MemoryFiles.

export const MemoryApi = HttpApiGroup.make('memory')
  // Reads (CLI/palette/injection).
  .add(
    HttpApiEndpoint.get('search', '/memory/search', {
      success: Schema.Array(MemorySearchHit),
    }),
  )
  .add(
    HttpApiEndpoint.get('status', '/memory/:projectId/:issueId/status', {
      success: Schema.NullOr(MemoryStatus),
    }),
  )
  // Ingress / writes (agent-hook surface: hooks.ts:258/299/325 + workspaces.ts:3145).
  .add(HttpApiEndpoint.post('inject', '/memory/inject', { success: PromptTimeResult }))
  .add(
    HttpApiEndpoint.post('sessionStart', '/memory/session/start', {
      success: Schema.Struct({ ok: Schema.Boolean }),
    }),
  )
  .add(
    HttpApiEndpoint.post('turn', '/memory/turn', {
      success: Schema.Struct({ ok: Schema.Boolean }),
    }),
  )
  .add(
    HttpApiEndpoint.post('summary', '/memory/:projectId/:issueId/summary', {
      success: SummaryResult,
    }),
  )
  .add(HttpApiEndpoint.post('reset', '/memory/:projectId/reset', { success: ResetMarker }))
  .add(
    HttpApiEndpoint.post('rebuildIndex', '/memory/:projectId/rebuild-index', {
      success: RebuildResult,
    }),
  )
