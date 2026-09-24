/**
 * The Memory domain: MemoryResolver (read door) + MemoryWriter (write door).
 *
 * Architecture: docs/overdeck-remodel/services/memory.md
 * The source of truth is the observation JSONL files under ~/.overdeck/memory/.
 * memory-search.db (per-project) is a rebuildable cache, reached through MemorySearch.
 * transcript_checkpoints (in overdeck.db) is the dedup-cursor cache, reached through Db.
 *
 * MemoryWriter.rebuildIndex is declared here but implemented in the memory-fts-rebuilder
 * bead (workspace-bmvls) to keep each bead scoped.
 */

import { stat } from 'node:fs/promises'

import { Context, Effect, Schema } from 'effect'

import {
  MemoryIdentity,
  MemoryObservation,
  MemoryStatus,
  ResetMarker,
  ResetMarkerScope,
} from '@overdeck/contracts'
import { type MemoryHealthSnapshot as HealthSnapshotType } from '../memory/health.js'

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
const ClaimResult = Schema.Union([
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

const CommitResult = Schema.Union([
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

const PromptTimeInput = Schema.Struct({
  prompt: Schema.String,
  identity: MemoryIdentity,
  surface: Schema.optional(Schema.String),
})
export type PromptTimeInput = typeof PromptTimeInput.Type

const PromptTimeResult = Schema.Struct({
  contextChunks: Schema.Array(Schema.String),
  hitCount: Schema.Number,
  tokensBudgeted: Schema.Number,
})
export type PromptTimeResult = typeof PromptTimeResult.Type

const ExtractDeltaInput = Schema.Struct({
  identity: MemoryIdentity,
  transcriptPath: Schema.String,
  trigger: Schema.Literals(['stop-hook', 'poller', 'reconciliation', 'manual']),
  toOffset: Schema.optional(Schema.Number),
})
export type ExtractDeltaInput = typeof ExtractDeltaInput.Type

const ExtractResult = Schema.Struct({
  extracted: Schema.Number,
  sessionId: Schema.String,
})
export type ExtractResult = typeof ExtractResult.Type

const ClaimInput = Schema.Struct({
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

const CommitInput = Schema.Struct({
  sessionId: Schema.String,
  consumedOffset: Schema.Number,
  transcriptPath: Schema.String,
  projectId: Schema.String,
  workspaceId: Schema.String,
  issueId: Schema.String,
})
export type CommitInput = typeof CommitInput.Type

const SummaryResult = Schema.Struct({
  path: Schema.String,
  date: Schema.String,
})
export type SummaryResult = typeof SummaryResult.Type

const RebuildResult = Schema.Struct({
  projectId: Schema.String,
  reindexed: Schema.Number,
})
export type RebuildResult = typeof RebuildResult.Type

const ResetMarkerInput = Schema.Struct({
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

class CheckpointNotFound extends Schema.TaggedErrorClass<CheckpointNotFound>()(
  'CheckpointNotFound',
  { sessionId: Schema.String },
) {}

// ── MemoryResolver — the read door ──────────────────────────────────────────

export interface MemoryResolverServiceShape {
  readonly search: (input: SearchMemoryInput) => Effect.Effect<ReadonlyArray<MemorySearchHit>>
  readonly getStatus: (projectId: string, workspaceId: string) => Effect.Effect<MemoryStatus | null>
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

  readonly rollupStatus: (projectId: string, workspaceId: string) => Effect.Effect<MemoryStatus | null>
  readonly generateSummary: (
    projectId: string,
    workspaceId: string,
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
