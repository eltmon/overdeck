import { Context, Effect, Schema } from 'effect';
import { real } from 'drizzle-orm/sqlite-core';

import { getOverdeckDatabase } from './infra.js';
import { IssueId } from './issues.js';

// ── Local Drizzle table definitions ──────────────────────────────────────────
// Each domain owns its own local table defs (NOT imported from overdeck-schema.ts).
// No FK declarations — the FK to issues.id lives only in the compiled schema.

// ── Branded ids ───────────────────────────────────────────────────────────────

export const ProjectKey = Schema.String.pipe(Schema.brand('ProjectKey'));
export type ProjectKey = typeof ProjectKey.Type;

export const RepoKey = Schema.String.pipe(Schema.brand('RepoKey'));
export type RepoKey = typeof RepoKey.Type;

export const UatName = Schema.String.pipe(Schema.brand('UatName'));
export type UatName = typeof UatName.Type;

// ── State literal unions ──────────────────────────────────────────────────────

export const MergeSetStatus = Schema.Literals([
  'draft', 'reviewing', 'ready', 'merging', 'merged', 'failed',
]);
const GateStatus = Schema.Literals([
  'pending', 'running', 'passed', 'failed', 'blocked', 'skipped',
]);
export type GateStatus = typeof GateStatus.Type;
export const RebaseStatus = Schema.Literals([
  'pending', 'requested', 'running', 'passed', 'failed', 'blocked', 'skipped',
]);
const RepoMergeStatus = Schema.Literals([
  'pending', 'ready', 'merging', 'merged', 'failed', 'blocked', 'skipped',
]);
const WorkspaceType = Schema.Literals(['monorepo', 'polyrepo']);
const AutoMergeStatus = Schema.Literals([
  'pending', 'merging', 'blocked', 'failed', 'merged', 'cancelled',
]);
const UatStatus = Schema.Literals([
  'assembling', 'ready', 'superseded', 'invalidated', 'promoted', 'failed',
]);
export type UatStatus = typeof UatStatus.Type;
const UatMemberRole = Schema.Literals(['member', 'held_out']);

// ── Entities ──────────────────────────────────────────────────────────────────

export const MergeSetRepo = Schema.Struct({
  repoKey:            RepoKey,
  repoPath:           Schema.String,
  forge:              Schema.String,
  sourceBranch:       Schema.String,
  targetBranch:       Schema.String,
  artifactUrl:        Schema.NullOr(Schema.String),
  artifactId:         Schema.NullOr(Schema.String),
  repoReview:         GateStatus,
  repoTests:          GateStatus,
  rebaseStatus:       RebaseStatus,
  repoVerification: GateStatus,
  repoMerge:          RepoMergeStatus,
  mergeOrder:         Schema.Number,
  required:           Schema.Boolean,
});
export type MergeSetRepo = typeof MergeSetRepo.Type;

export const MergeSet = Schema.Struct({
  issueId:       IssueId,
  projectKey:    ProjectKey,
  projectPath:   Schema.String,
  workspaceType: WorkspaceType,
  status:        MergeSetStatus,
  repos:         Schema.Array(MergeSetRepo),
  createdAt:     Schema.Date,
  updatedAt:     Schema.Date,
});
export type MergeSet = typeof MergeSet.Type;

const QueueView = Schema.Struct({
  projectKey:  ProjectKey,
  current:     Schema.NullOr(IssueId),
  queue:       Schema.Array(IssueId),
  queueLength: Schema.Number,
});
export type QueueView = typeof QueueView.Type;

const AutoMerge = Schema.Struct({
  id:               Schema.Number,
  issueId:          IssueId,
  prUrl:            Schema.String,
  prNumber:         Schema.NullOr(Schema.Number),
  projectKey:       ProjectKey,
  forge:            Schema.String,
  status:           AutoMergeStatus,
  scheduledMergeAt: Schema.Date,
  scheduledAt:      Schema.Date,
  mergedAt:         Schema.NullOr(Schema.Date),
  failureReason:    Schema.NullOr(Schema.String),
  cancelledAt:      Schema.NullOr(Schema.Date),
  cancelledBy:      Schema.NullOr(Schema.String),
});
export type AutoMerge = typeof AutoMerge.Type;

const UatMember = Schema.Struct({
  issueId:    IssueId,
  role:       UatMemberRole,
  title:      Schema.NullOr(Schema.String),
  branch:     Schema.NullOr(Schema.String),
  headSha:    Schema.NullOr(Schema.String),
  mergeOrder: Schema.NullOr(Schema.Number),
  pr:         Schema.NullOr(Schema.Number),
  prUrl:      Schema.NullOr(Schema.String),
  reason:     Schema.NullOr(Schema.String),
});

const UatResolution = Schema.Struct({
  id:        Schema.Number,
  issueIds:  Schema.Array(IssueId),
  files:     Schema.Array(Schema.String),
  commitSha: Schema.String,
});

export const UatGeneration = Schema.Struct({
  name:           UatName,
  worktreePath:   Schema.String,
  projectRoot:    Schema.String,
  baseSha:        Schema.String,
  status:         UatStatus,
  members:        Schema.Array(UatMember),
  heldOut:        Schema.Array(UatMember),
  resolutions:    Schema.Array(UatResolution),
  stackStartedAt: Schema.NullOr(Schema.Date),
  cleanedAt:      Schema.NullOr(Schema.Date),
  createdAt:      Schema.Date,
  updatedAt:      Schema.Date,
});
export type UatGeneration = typeof UatGeneration.Type;

const AutoMergeFilter = Schema.Struct({
  active:   Schema.optional(Schema.Boolean),
  problems: Schema.optional(Schema.Boolean),
});
export type AutoMergeFilter = typeof AutoMergeFilter.Type;

const UatGenerationFilter = Schema.Struct({
  projectRoot: Schema.optional(Schema.String),
  statuses:    Schema.optional(Schema.Array(UatStatus)),
});
export type UatGenerationFilter = typeof UatGenerationFilter.Type;

// ── Errors ────────────────────────────────────────────────────────────────────

class MergeSetNotFound extends Schema.TaggedErrorClass<MergeSetNotFound>()(
  'MergeSetNotFound', { issueId: IssueId },
) {}

class NotReadyForMerge extends Schema.TaggedErrorClass<NotReadyForMerge>()(
  'NotReadyForMerge', {
    issueId:    IssueId,
    repoReview: GateStatus,
    repoTests:  GateStatus,
  },
) {}

class MergeInProgress extends Schema.TaggedErrorClass<MergeInProgress>()(
  'MergeInProgress', { issueId: IssueId },
) {}

class AutoMergeNotFound extends Schema.TaggedErrorClass<AutoMergeNotFound>()(
  'AutoMergeNotFound', { issueId: IssueId },
) {}

class UatGenerationNotFound extends Schema.TaggedErrorClass<UatGenerationNotFound>()(
  'UatGenerationNotFound', { name: UatName },
) {}

class UatNotPromotable extends Schema.TaggedErrorClass<UatNotPromotable>()(
  'UatNotPromotable', { name: UatName, status: UatStatus },
) {}

class ForgeMergeFailed extends Schema.TaggedErrorClass<ForgeMergeFailed>()(
  'ForgeMergeFailed', {
    issueId: IssueId,
    repoKey: RepoKey,
    detail:  Schema.String,
  },
) {}

// ── mergeReady — exported predicate (AC1: test=skipped counts as passing) ────

export function mergeReady(repo: MergeSetRepo): boolean {
  return (
    // PAN-1862 (FR-16): review=skipped (mode none) passes like review=passed.
    (repo.repoReview === 'passed' || repo.repoReview === 'skipped') &&
    (repo.repoTests === 'passed' || repo.repoTests === 'skipped')
  );
}

// ── Pure helpers (stubs — full implementations ship in workspace-xz2qp) ──────

// ── MergeResolver — read door ─────────────────────────────────────────────────

export class MergeResolver extends Context.Service<MergeResolver, {
  readonly getMergeSet:        (id: IssueId)             => Effect.Effect<MergeSet, MergeSetNotFound>;
  readonly listQueues:         ()                         => Effect.Effect<ReadonlyArray<QueueView>>;
  readonly listAutoMerges:     (f: AutoMergeFilter)      => Effect.Effect<ReadonlyArray<AutoMerge>>;
  readonly listBlockers:       ()                         => Effect.Effect<ReadonlyArray<AutoMerge>>;
  readonly listUatGenerations: (f: UatGenerationFilter)  => Effect.Effect<ReadonlyArray<UatGeneration>>;
}>()('overdeck/MergeResolver') {}

// ── MergeWriter — write door ──────────────────────────────────────────────────

export class MergeWriter extends Context.Service<MergeWriter, {
  readonly merge:             (id: IssueId) =>
    Effect.Effect<MergeSet, MergeSetNotFound | NotReadyForMerge | MergeInProgress | ForgeMergeFailed, MergeResolver>;
  readonly approveForge:      (id: IssueId) =>
    Effect.Effect<MergeSet, MergeSetNotFound | ForgeMergeFailed, MergeResolver>;
  readonly rebaseOntoMain:    (id: IssueId) =>
    Effect.Effect<MergeSet, MergeSetNotFound, MergeResolver>;
  readonly mergeNext:         (projectKey: ProjectKey) =>
    Effect.Effect<MergeSet | null, MergeSetNotFound | NotReadyForMerge | MergeInProgress | ForgeMergeFailed, MergeResolver>;
  readonly scheduleAutoMerge: (input: {
    issueId: IssueId;
    prUrl: string;
    prNumber?: number;
    projectKey: ProjectKey;
    forge?: string;
    scheduledMergeAt: Date;
  }) => Effect.Effect<AutoMerge>;
  readonly cancelAutoMerge: (id: IssueId, cancelledBy: string) =>
    Effect.Effect<AutoMerge, AutoMergeNotFound>;
  readonly assembleUat:   (opts: { force?: boolean }) =>
    Effect.Effect<ReadonlyArray<UatGeneration>>;
  readonly startUatStack: (name: UatName) =>
    Effect.Effect<UatGeneration, UatGenerationNotFound | UatNotPromotable>;
  readonly promoteUat:    (name: UatName) =>
    Effect.Effect<UatGeneration, UatGenerationNotFound | UatNotPromotable>;
}>()('overdeck/MergeWriter') {}

// ── Sync helpers for merge-queue (used by synchronous call sites) ────────────

export interface MergeQueueEntry {
  id: number;
  projectKey: string;
  issueId: string;
  position: number;
  queuedAt: string;
  startedAt: string | null;
  status: 'queued' | 'processing' | 'completed' | 'failed';
}

function overdeckDb() {
  return getOverdeckDatabase();
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Enqueue an issue for merge. Returns the queue position. */
export function enqueueMerge(projectKey: string, issueId: string): number {
  const db = overdeckDb();
  const normalized = issueId.toUpperCase();
  const existing = db.prepare(
    `SELECT position FROM merge_queue WHERE issue_id = ? AND status IN ('queued', 'processing')`,
  ).get(normalized) as { position: number } | undefined;
  if (existing) return existing.position;

  const maxRow = db.prepare(
    `SELECT COALESCE(MAX(position), 0) AS max_pos FROM merge_queue WHERE project_key = ? AND status IN ('queued', 'processing')`,
  ).get(projectKey) as { max_pos: number };
  const position = maxRow.max_pos + 1;

  db.prepare(
    `INSERT INTO merge_queue (project_key, issue_id, position, queued_at, status) VALUES (?, ?, ?, ?, 'queued')`,
  ).run(projectKey, normalized, position, nowIso());
  return position;
}

/** Toggle whether a queued merge is the project's current processing entry. */
export function markMergeProcessing(projectKey: string, issueId: string, processing = true): void {
  overdeckDb().prepare(
    `UPDATE merge_queue SET status = ?, started_at = ? WHERE project_key = ? AND issue_id = ? AND status = ?`,
  ).run(processing ? 'processing' : 'queued', processing ? nowIso() : null, projectKey, issueId.toUpperCase(), processing ? 'queued' : 'processing');
}

/** Get the currently processing merge for a project, or null. */
export function getCurrentMerge(projectKey: string): string | null {
  const row = overdeckDb().prepare(
    `SELECT issue_id FROM merge_queue WHERE project_key = ? AND status = 'processing' ORDER BY position ASC LIMIT 1`,
  ).get(projectKey) as { issue_id: string } | undefined;
  return row?.issue_id ?? null;
}

/** Advance the queue for a project after the current issue completes. */
export function dequeueMerge(projectKey: string, completedIssueId?: string): string | null {
  const db = overdeckDb();
  if (completedIssueId) {
    db.prepare(`DELETE FROM merge_queue WHERE project_key = ? AND issue_id = ?`).run(
      projectKey,
      completedIssueId.toUpperCase(),
    );
  }
  const next = db.prepare(
    `SELECT issue_id FROM merge_queue WHERE project_key = ? AND status = 'queued' ORDER BY position ASC LIMIT 1`,
  ).get(projectKey) as { issue_id: string } | undefined;
  return next?.issue_id ?? null;
}

/**
 * Drop an issue's waiting queue entry, leaving a merge already processing
 * alone. #4066 review: an operator's auto-merge cancel removes any queued
 * merge of the issue, so the queue cannot start what the operator stopped.
 * Returns the number of entries removed.
 */
export function removeQueuedMerge(issueId: string): number {
  return overdeckDb().prepare(
    `DELETE FROM merge_queue WHERE issue_id = ? AND status = 'queued'`,
  ).run(issueId.toUpperCase()).changes;
}

/** Get all active queues across all projects. */
export function getAllActiveQueues(): Array<{
  projectKey: string;
  current: string | null;
  queue: string[];
  queueLength: number;
}> {
  const rows = overdeckDb().prepare(
    `SELECT project_key, issue_id, status
     FROM merge_queue
     WHERE status IN ('queued', 'processing')
     ORDER BY project_key, position ASC`,
  ).all() as Array<{ project_key: string; issue_id: string; status: string }>;

  const byProject = new Map<string, { current: string | null; queue: string[] }>();
  for (const row of rows) {
    let entry = byProject.get(row.project_key);
    if (!entry) {
      entry = { current: null, queue: [] };
      byProject.set(row.project_key, entry);
    }
    if (row.status === 'processing') {
      entry.current = row.issue_id;
    } else {
      entry.queue.push(row.issue_id);
    }
  }

  return [...byProject.entries()].map(([projectKey, data]) => ({
    projectKey,
    current: data.current,
    queue: data.queue,
    queueLength: data.queue.length,
  }));
}

