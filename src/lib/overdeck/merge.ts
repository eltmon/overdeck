import { Context, Effect, Layer, Schema } from 'effect';
import { and, eq, inArray } from 'drizzle-orm';
import { integer, real, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { HttpApi, HttpApiBuilder, HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';

import { Db, EventBus, Forge } from './infra.js';
import { IssueId } from './issues.js';

// ── Local Drizzle table definitions ──────────────────────────────────────────
// Each domain owns its own local table defs (NOT imported from overdeck-schema.ts).
// No FK declarations — the FK to issues.id lives only in the compiled schema.

const mergeSets = sqliteTable('merge_sets', {
  issueId:       text('issue_id').primaryKey(),
  projectKey:    text('project_key').notNull(),
  projectPath:   text('project_path').notNull(),
  workspaceType: text('workspace_type').notNull(),
  status:        text('status').notNull(),
  createdAt:     integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt:     integer('updated_at', { mode: 'timestamp' }).notNull(),
});

const mergeSetRepos = sqliteTable('merge_set_repos', {
  id:                 integer('id').primaryKey({ autoIncrement: true }),
  issueId:            text('issue_id').notNull(),
  repoKey:            text('repo_key').notNull(),
  repoPath:           text('repo_path').notNull(),
  forge:              text('forge').notNull(),
  sourceBranch:       text('source_branch').notNull(),
  targetBranch:       text('target_branch').notNull(),
  artifactUrl:        text('artifact_url'),
  artifactId:         text('artifact_id'),
  reviewStatus:       text('review_status').notNull(),
  testStatus:         text('test_status').notNull(),
  rebaseStatus:       text('rebase_status').notNull(),
  verificationStatus: text('verification_status').notNull(),
  mergeStatus:        text('merge_status').notNull(),
  mergeOrder:         integer('merge_order').notNull(),
  required:           integer('required', { mode: 'boolean' }).notNull(),
});

const mergeQueue = sqliteTable('merge_queue', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  issueId:    text('issue_id').notNull(),
  projectKey: text('project_key').notNull(),
  status:     text('status').notNull(),
  position:   integer('position').notNull(),
  createdAt:  integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt:  integer('updated_at', { mode: 'timestamp' }).notNull(),
});

const pendingAutoMerges = sqliteTable('pending_auto_merges', {
  id:               integer('id').primaryKey({ autoIncrement: true }),
  issueId:          text('issue_id').notNull(),
  prUrl:            text('pr_url').notNull(),
  prNumber:         integer('pr_number'),
  projectKey:       text('project_key').notNull(),
  forge:            text('forge').notNull(),
  status:           text('status').notNull(),
  scheduledMergeAt: integer('scheduled_merge_at', { mode: 'timestamp' }).notNull(),
  scheduledAt:      integer('scheduled_at', { mode: 'timestamp' }).notNull(),
  mergedAt:         integer('merged_at', { mode: 'timestamp' }),
  failureReason:    text('failure_reason'),
  cancelledAt:      integer('cancelled_at', { mode: 'timestamp' }),
  cancelledBy:      text('cancelled_by'),
});

const uatGenerations = sqliteTable('uat_generations', {
  name:           text('name').primaryKey(),
  worktreePath:   text('worktree_path').notNull(),
  projectRoot:    text('project_root').notNull(),
  baseSha:        text('base_sha').notNull(),
  status:         text('status').notNull(),
  stackStartedAt: integer('stack_started_at', { mode: 'timestamp' }),
  cleanedAt:      integer('cleaned_at', { mode: 'timestamp' }),
  createdAt:      integer('created_at', { mode: 'timestamp' }).notNull(),
  updatedAt:      integer('updated_at', { mode: 'timestamp' }).notNull(),
});

const uatGenerationMembers = sqliteTable('uat_generation_members', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  uatName:    text('uat_name').notNull(),
  issueId:    text('issue_id').notNull(),
  role:       text('role').notNull(),
  title:      text('title'),
  branch:     text('branch'),
  headSha:    text('head_sha'),
  mergeOrder: integer('merge_order'),
  pr:         integer('pr'),
  prUrl:      text('pr_url'),
  reason:     text('reason'),
});

const uatGenerationResolutions = sqliteTable('uat_generation_resolutions', {
  id:         integer('id').primaryKey({ autoIncrement: true }),
  uatName:    text('uat_name').notNull(),
  issueIds:   text('issue_ids', { mode: 'json' }).notNull(),
  files:      text('files', { mode: 'json' }).notNull(),
  commitSha:  text('commit_sha').notNull(),
});

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
export const GateStatus = Schema.Literals([
  'pending', 'running', 'passed', 'failed', 'blocked', 'skipped',
]);
export type GateStatus = typeof GateStatus.Type;
export const RebaseStatus = Schema.Literals([
  'pending', 'requested', 'running', 'passed', 'failed', 'blocked', 'skipped',
]);
export const RepoMergeStatus = Schema.Literals([
  'pending', 'ready', 'merging', 'merged', 'failed', 'blocked', 'skipped',
]);
export const WorkspaceType = Schema.Literals(['monorepo', 'polyrepo']);
export const QueueEntryStatus = Schema.Literals([
  'queued', 'processing', 'completed', 'failed',
]);
export const AutoMergeStatus = Schema.Literals([
  'pending', 'merging', 'blocked', 'failed', 'merged', 'cancelled',
]);
export const UatStatus = Schema.Literals([
  'assembling', 'ready', 'superseded', 'invalidated', 'promoted', 'failed',
]);
export type UatStatus = typeof UatStatus.Type;
export const UatMemberRole = Schema.Literals(['member', 'held_out']);

// ── Entities ──────────────────────────────────────────────────────────────────

export const MergeSetRepo = Schema.Struct({
  repoKey:            RepoKey,
  repoPath:           Schema.String,
  forge:              Schema.String,
  sourceBranch:       Schema.String,
  targetBranch:       Schema.String,
  artifactUrl:        Schema.NullOr(Schema.String),
  artifactId:         Schema.NullOr(Schema.String),
  reviewStatus:       GateStatus,
  testStatus:         GateStatus,
  rebaseStatus:       RebaseStatus,
  verificationStatus: GateStatus,
  mergeStatus:        RepoMergeStatus,
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

export const QueueView = Schema.Struct({
  projectKey:  ProjectKey,
  current:     Schema.NullOr(IssueId),
  queue:       Schema.Array(IssueId),
  queueLength: Schema.Number,
});
export type QueueView = typeof QueueView.Type;

export const AutoMerge = Schema.Struct({
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

export const UatMember = Schema.Struct({
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

export const UatResolution = Schema.Struct({
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

export const AutoMergeFilter = Schema.Struct({
  active:   Schema.optional(Schema.Boolean),
  problems: Schema.optional(Schema.Boolean),
});
export type AutoMergeFilter = typeof AutoMergeFilter.Type;

export const UatGenerationFilter = Schema.Struct({
  projectRoot: Schema.optional(Schema.String),
  statuses:    Schema.optional(Schema.Array(UatStatus)),
});
export type UatGenerationFilter = typeof UatGenerationFilter.Type;

// ── Errors ────────────────────────────────────────────────────────────────────

export class MergeSetNotFound extends Schema.TaggedErrorClass<MergeSetNotFound>()(
  'MergeSetNotFound', { issueId: IssueId },
) {}

export class NotReadyForMerge extends Schema.TaggedErrorClass<NotReadyForMerge>()(
  'NotReadyForMerge', {
    issueId:      IssueId,
    reviewStatus: GateStatus,
    testStatus:   GateStatus,
  },
) {}

export class MergeInProgress extends Schema.TaggedErrorClass<MergeInProgress>()(
  'MergeInProgress', { issueId: IssueId },
) {}

export class AutoMergeNotFound extends Schema.TaggedErrorClass<AutoMergeNotFound>()(
  'AutoMergeNotFound', { issueId: IssueId },
) {}

export class UatGenerationNotFound extends Schema.TaggedErrorClass<UatGenerationNotFound>()(
  'UatGenerationNotFound', { name: UatName },
) {}

export class UatNotPromotable extends Schema.TaggedErrorClass<UatNotPromotable>()(
  'UatNotPromotable', { name: UatName, status: UatStatus },
) {}

export class ForgeMergeFailed extends Schema.TaggedErrorClass<ForgeMergeFailed>()(
  'ForgeMergeFailed', {
    issueId: IssueId,
    repoKey: RepoKey,
    detail:  Schema.String,
  },
) {}

// ── readyForMerge — exported predicate (AC1: test=skipped counts as passing) ─

export function readyForMerge(repo: MergeSetRepo): boolean {
  return (
    repo.reviewStatus === 'passed' &&
    (repo.testStatus === 'passed' || repo.testStatus === 'skipped')
  );
}

// ── Pure helpers (stubs — full implementations ship in workspace-xz2qp) ──────

type MergeSetRow = typeof mergeSets.$inferSelect;
type MergeSetRepoRow = typeof mergeSetRepos.$inferSelect;
type MergeQueueRow = typeof mergeQueue.$inferSelect;
type PendingAutoMergeRow = typeof pendingAutoMerges.$inferSelect;
type UatGenerationRow = typeof uatGenerations.$inferSelect;
type UatMemberRow = typeof uatGenerationMembers.$inferSelect;
type UatResolutionRow = typeof uatGenerationResolutions.$inferSelect;

function reduceQueues(rows: MergeQueueRow[]): QueueView[] {
  const byProject = new Map<string, { current: string | null; queue: string[] }>();
  for (const row of rows) {
    if (!byProject.has(row.projectKey))
      byProject.set(row.projectKey, { current: null, queue: [] });
    const entry = byProject.get(row.projectKey)!;
    if (row.status === 'processing') entry.current = row.issueId;
    else entry.queue.push(row.issueId);
  }
  return Array.from(byProject.entries()).map(([projectKey, entry]) => ({
    projectKey: projectKey as ProjectKey,
    current:    entry.current as IssueId | null,
    queue:      entry.queue as IssueId[],
    queueLength: entry.queue.length + (entry.current ? 1 : 0),
  }));
}

// ── MergeResolver — read door ─────────────────────────────────────────────────

export class MergeResolver extends Context.Service<MergeResolver, {
  readonly getMergeSet:        (id: IssueId)             => Effect.Effect<MergeSet, MergeSetNotFound>;
  readonly listQueues:         ()                         => Effect.Effect<ReadonlyArray<QueueView>>;
  readonly listAutoMerges:     (f: AutoMergeFilter)      => Effect.Effect<ReadonlyArray<AutoMerge>>;
  readonly listBlockers:       ()                         => Effect.Effect<ReadonlyArray<AutoMerge>>;
  readonly listUatGenerations: (f: UatGenerationFilter)  => Effect.Effect<ReadonlyArray<UatGeneration>>;
}>()('overdeck/MergeResolver') {}

// Build typed entities directly from DB rows (no Schema.decodeUnknown needed)
function buildMergeSet(set: MergeSetRow, repos: MergeSetRepoRow[]): MergeSet {
  return {
    issueId:       set.issueId       as IssueId,
    projectKey:    set.projectKey    as ProjectKey,
    projectPath:   set.projectPath,
    workspaceType: set.workspaceType as 'monorepo' | 'polyrepo',
    status:        set.status        as MergeSet['status'],
    repos:         repos.map((r) => ({
      repoKey:            r.repoKey            as RepoKey,
      repoPath:           r.repoPath,
      forge:              r.forge,
      sourceBranch:       r.sourceBranch,
      targetBranch:       r.targetBranch,
      artifactUrl:        r.artifactUrl        ?? null,
      artifactId:         r.artifactId         ?? null,
      reviewStatus:       r.reviewStatus       as MergeSetRepo['reviewStatus'],
      testStatus:         r.testStatus         as MergeSetRepo['testStatus'],
      rebaseStatus:       r.rebaseStatus       as MergeSetRepo['rebaseStatus'],
      verificationStatus: r.verificationStatus as MergeSetRepo['verificationStatus'],
      mergeStatus:        r.mergeStatus        as MergeSetRepo['mergeStatus'],
      mergeOrder:         r.mergeOrder,
      required:           r.required,
    })),
    createdAt: set.createdAt,
    updatedAt: set.updatedAt,
  };
}

function buildAutoMerge(row: PendingAutoMergeRow): AutoMerge {
  return {
    id:               row.id,
    issueId:          row.issueId          as IssueId,
    prUrl:            row.prUrl,
    prNumber:         row.prNumber         ?? null,
    projectKey:       row.projectKey       as ProjectKey,
    forge:            row.forge,
    status:           row.status           as AutoMerge['status'],
    scheduledMergeAt: row.scheduledMergeAt,
    scheduledAt:      row.scheduledAt,
    mergedAt:         row.mergedAt         ?? null,
    failureReason:    row.failureReason    ?? null,
    cancelledAt:      row.cancelledAt      ?? null,
    cancelledBy:      row.cancelledBy      ?? null,
  };
}

function buildUatGeneration(
  gen: UatGenerationRow,
  members: UatMemberRow[],
  resolutions: UatResolutionRow[],
): UatGeneration {
  return {
    name:           gen.name           as UatName,
    worktreePath:   gen.worktreePath,
    projectRoot:    gen.projectRoot,
    baseSha:        gen.baseSha,
    status:         gen.status         as UatGeneration['status'],
    stackStartedAt: gen.stackStartedAt ?? null,
    cleanedAt:      gen.cleanedAt      ?? null,
    createdAt:      gen.createdAt,
    updatedAt:      gen.updatedAt,
    members:  members.filter((m) => m.role === 'member').map((m) => ({
      issueId:    m.issueId    as IssueId,
      role:       m.role       as 'member' | 'held_out',
      title:      m.title      ?? null,
      branch:     m.branch     ?? null,
      headSha:    m.headSha    ?? null,
      mergeOrder: m.mergeOrder ?? null,
      pr:         m.pr         ?? null,
      prUrl:      m.prUrl      ?? null,
      reason:     m.reason     ?? null,
    })),
    heldOut: members.filter((m) => m.role === 'held_out').map((m) => ({
      issueId:    m.issueId    as IssueId,
      role:       m.role       as 'member' | 'held_out',
      title:      m.title      ?? null,
      branch:     m.branch     ?? null,
      headSha:    m.headSha    ?? null,
      mergeOrder: m.mergeOrder ?? null,
      pr:         m.pr         ?? null,
      prUrl:      m.prUrl      ?? null,
      reason:     m.reason     ?? null,
    })),
    resolutions: resolutions.map((r) => ({
      id:        r.id,
      issueIds:  (r.issueIds as string[]).map((id) => id as IssueId),
      files:     r.files as string[],
      commitSha: r.commitSha,
    })),
  };
}

export const MergeResolverLive = Layer.effect(
  MergeResolver,
  Effect.gen(function* () {
    const { q } = yield* Db;

    const getMergeSet = (id: IssueId): Effect.Effect<MergeSet, MergeSetNotFound> =>
      Effect.gen(function* () {
        const [set] = yield* Effect.promise(() =>
          q.select().from(mergeSets).where(eq(mergeSets.issueId, id)),
        );
        if (!set) return yield* Effect.fail(new MergeSetNotFound({ issueId: id }));
        const repos = yield* Effect.promise(() =>
          q.select().from(mergeSetRepos).where(eq(mergeSetRepos.issueId, id)),
        );
        return buildMergeSet(set, repos);
      });

    const listQueues = (): Effect.Effect<ReadonlyArray<QueueView>> =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          q.select().from(mergeQueue)
            .where(inArray(mergeQueue.status, ['queued', 'processing']))
            .orderBy(mergeQueue.position),
        );
        return reduceQueues(rows);
      });

    const listAutoMerges = (f: AutoMergeFilter): Effect.Effect<ReadonlyArray<AutoMerge>> =>
      Effect.gen(function* () {
        const want = f.problems
          ? ['blocked', 'failed']
          : ['pending', 'merging'];
        const rows = yield* Effect.promise(() =>
          q.select().from(pendingAutoMerges)
            .where(inArray(pendingAutoMerges.status, want))
            .orderBy(pendingAutoMerges.scheduledMergeAt),
        );
        return rows.map(buildAutoMerge);
      });

    const listBlockers = (): Effect.Effect<ReadonlyArray<AutoMerge>> =>
      listAutoMerges({ problems: true });

    const listUatGenerations = (f: UatGenerationFilter): Effect.Effect<ReadonlyArray<UatGeneration>> =>
      Effect.gen(function* () {
        const gens = yield* Effect.promise(() =>
          f.statuses
            ? q.select().from(uatGenerations)
                .where(inArray(uatGenerations.status, [...f.statuses]))
            : q.select().from(uatGenerations),
        );
        return yield* Effect.forEach(gens, (g) =>
          Effect.gen(function* () {
            const members = yield* Effect.promise(() =>
              q.select().from(uatGenerationMembers)
                .where(eq(uatGenerationMembers.uatName, g.name)),
            );
            const resolutions = yield* Effect.promise(() =>
              q.select().from(uatGenerationResolutions)
                .where(eq(uatGenerationResolutions.uatName, g.name)),
            );
            return buildUatGeneration(g, members, resolutions);
          }),
        );
      });

    return MergeResolver.of({
      getMergeSet,
      listQueues,
      listAutoMerges,
      listBlockers,
      listUatGenerations,
    });
  }),
);

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

export const MergeWriterLive = Layer.effect(
  MergeWriter,
  Effect.gen(function* () {
    const { q }  = yield* Db;
    const bus    = yield* EventBus;
    const forge  = yield* Forge;
    const now    = () => new Date();

    // ── merge: readiness-gated, queue-serialized, per-repo polyrepo merge ──
    const merge = (id: IssueId) =>
      Effect.gen(function* () {
        const resolver = yield* MergeResolver;
        const set = yield* resolver.getMergeSet(id);

        // Gate 1: all required repos must be review-passed AND test-passed-or-skipped (AC1)
        const requiredRepos = set.repos.filter((r) => r.required);
        const failing = requiredRepos.find((r) => !readyForMerge(r));
        if (failing)
          return yield* Effect.fail(
            new NotReadyForMerge({
              issueId:      id,
              reviewStatus: failing.reviewStatus,
              testStatus:   failing.testStatus,
            }),
          );

        // Gate 2: no other issue holds the per-project sequential lock
        const [processing] = yield* Effect.promise(() =>
          q.select().from(mergeQueue)
            .where(
              and(
                eq(mergeQueue.projectKey, set.projectKey),
                eq(mergeQueue.status, 'processing'),
              ),
            ),
        );
        if (processing && processing.issueId !== id)
          return yield* Effect.fail(new MergeInProgress({ issueId: id }));

        // Optimistic status update (stub — full upsert impl in workspace-xz2qp)
        yield* Effect.promise(() =>
          q.insert(mergeSets)
            .values({ ...set, status: 'merging', updatedAt: now() })
            .onConflictDoUpdate({
              target: mergeSets.issueId,
              set:    { status: 'merging', updatedAt: now() },
            }),
        );

        // Delegate to Forge (GitHub/GitLab)
        yield* forge.merge({ issueId: id, repos: set.repos });

        // Mark completed
        yield* Effect.promise(() =>
          q.insert(mergeSets)
            .values({ ...set, status: 'merged', updatedAt: now() })
            .onConflictDoUpdate({
              target: mergeSets.issueId,
              set:    { status: 'merged', updatedAt: now() },
            }),
        );

        yield* bus.emit({ type: 'merge.completed', payload: { issueId: id } });
        return yield* resolver.getMergeSet(id);
      });

    // ── approveForge: forge approve — post merge approval ──
    const approveForge = (id: IssueId) =>
      Effect.gen(function* () {
        const resolver = yield* MergeResolver;
        const set = yield* resolver.getMergeSet(id);
        yield* forge.approve({ issueId: id, repos: set.repos });
        yield* bus.emit({ type: 'merge.forge_approved', payload: { issueId: id } });
        return yield* resolver.getMergeSet(id);
      });

    // ── rebaseOntoMain: rebase feature branch onto main (stub — full impl workspace-xz2qp) ──
    const rebaseOntoMain = (id: IssueId) =>
      Effect.gen(function* () {
        const resolver = yield* MergeResolver;
        const set = yield* resolver.getMergeSet(id);
        // forge.rebase is not in ForgeServiceShape yet — stub until workspace-xz2qp
        yield* bus.emit({ type: 'merge.rebased', payload: { issueId: id } });
        return set;
      });

    // ── mergeNext: advance the per-project sequential lock to the queue head ──
    const mergeNext = (projectKey: ProjectKey) =>
      Effect.gen(function* () {
        const [head] = yield* Effect.promise(() =>
          q.select().from(mergeQueue)
            .where(
              and(
                eq(mergeQueue.projectKey, projectKey),
                eq(mergeQueue.status, 'queued'),
              ),
            )
            .orderBy(mergeQueue.position)
            .limit(1),
        );
        if (!head) return null;
        return yield* merge(head.issueId as IssueId);
      });

    // ── scheduleAutoMerge: idempotent cooldown insert (AC2: no auto_merge column) ──
    const scheduleAutoMerge = (input: {
      issueId: IssueId;
      prUrl: string;
      prNumber?: number;
      projectKey: ProjectKey;
      forge?: string;
      scheduledMergeAt: Date;
    }): Effect.Effect<AutoMerge> =>
      Effect.gen(function* () {
        // Idempotent: if active schedule exists, return it unchanged
        const [existing] = yield* Effect.promise(() =>
          q.select().from(pendingAutoMerges)
            .where(
              and(
                eq(pendingAutoMerges.issueId, input.issueId),
                inArray(pendingAutoMerges.status, ['pending', 'merging']),
              ),
            ),
        );
        if (existing) return buildAutoMerge(existing);

        yield* Effect.promise(() =>
          q.insert(pendingAutoMerges).values({
            issueId:          input.issueId,
            prUrl:            input.prUrl,
            prNumber:         input.prNumber ?? null,
            projectKey:       input.projectKey,
            forge:            input.forge ?? 'github',
            status:           'pending',
            scheduledMergeAt: input.scheduledMergeAt,
            scheduledAt:      now(),
            mergedAt:         null,
            failureReason:    null,
            cancelledAt:      null,
            cancelledBy:      null,
          }).onConflictDoNothing(),
        );
        const [inserted] = yield* Effect.promise(() =>
          q.select().from(pendingAutoMerges)
            .where(
              and(
                eq(pendingAutoMerges.issueId, input.issueId),
                eq(pendingAutoMerges.status, 'pending'),
              ),
            )
            .orderBy(pendingAutoMerges.id)
            .limit(1),
        );
        yield* bus.emit({ type: 'merge.auto_scheduled', payload: { issueId: input.issueId } });
        return buildAutoMerge(inserted);
      });

    // ── cancelAutoMerge: operator cancel in the cooldown window ──
    const cancelAutoMerge = (id: IssueId, cancelledBy: string): Effect.Effect<AutoMerge, AutoMergeNotFound> =>
      Effect.gen(function* () {
        const [row] = yield* Effect.promise(() =>
          q.select().from(pendingAutoMerges)
            .where(
              and(
                eq(pendingAutoMerges.issueId, id),
                inArray(pendingAutoMerges.status, ['pending', 'merging']),
              ),
            ),
        );
        if (!row) return yield* Effect.fail(new AutoMergeNotFound({ issueId: id }));

        yield* Effect.promise(() =>
          q.update(pendingAutoMerges)
            .set({
              status:      'cancelled',
              cancelledAt: now(),
              cancelledBy,
            })
            .where(eq(pendingAutoMerges.id, row.id)),
        );

        const [updated] = yield* Effect.promise(() =>
          q.select().from(pendingAutoMerges)
            .where(eq(pendingAutoMerges.id, row.id)),
        );
        yield* bus.emit({ type: 'merge.auto_cancelled', payload: { issueId: id, cancelledBy } });
        return buildAutoMerge(updated);
      });

    // ── assembleUat: assemble batch generation (stub — full impl workspace-xz2qp) ──
    const assembleUat = (_opts: { force?: boolean }) =>
      Effect.gen(function* () {
        yield* bus.emit({ type: 'merge.uat_assembled', payload: { count: 0 } });
        return [] as ReadonlyArray<UatGeneration>;
      });

    // ── startUatStack: bring up live stack for a ready/superseded generation ──
    const startUatStack = (name: UatName): Effect.Effect<UatGeneration, UatGenerationNotFound | UatNotPromotable> =>
      Effect.gen(function* () {
        const [gen] = yield* Effect.promise(() =>
          q.select().from(uatGenerations)
            .where(eq(uatGenerations.name, name)),
        );
        if (!gen) return yield* Effect.fail(new UatGenerationNotFound({ name }));
        if (gen.status !== 'ready' && gen.status !== 'superseded')
          return yield* Effect.fail(
            new UatNotPromotable({ name, status: gen.status as UatStatus }),
          );

        yield* Effect.promise(() =>
          q.update(uatGenerations)
            .set({ stackStartedAt: now(), updatedAt: now() })
            .where(eq(uatGenerations.name, name)),
        );
        const [updated] = yield* Effect.promise(() =>
          q.select().from(uatGenerations).where(eq(uatGenerations.name, name)),
        );
        const members = yield* Effect.promise(() =>
          q.select().from(uatGenerationMembers).where(eq(uatGenerationMembers.uatName, name)),
        );
        const resolutions = yield* Effect.promise(() =>
          q.select().from(uatGenerationResolutions).where(eq(uatGenerationResolutions.uatName, name)),
        );
        yield* bus.emit({ type: 'merge.uat_stack_started', payload: { name } });
        return buildUatGeneration(updated, members, resolutions);
      });

    // ── promoteUat: promote tested batch to main ──
    const promoteUat = (name: UatName): Effect.Effect<UatGeneration, UatGenerationNotFound | UatNotPromotable> =>
      Effect.gen(function* () {
        const [gen] = yield* Effect.promise(() =>
          q.select().from(uatGenerations).where(eq(uatGenerations.name, name)),
        );
        if (!gen) return yield* Effect.fail(new UatGenerationNotFound({ name }));
        if (gen.status !== 'ready' && gen.status !== 'superseded')
          return yield* Effect.fail(
            new UatNotPromotable({ name, status: gen.status as UatStatus }),
          );

        yield* Effect.promise(() =>
          q.update(uatGenerations)
            .set({ status: 'promoted', updatedAt: now() })
            .where(eq(uatGenerations.name, name)),
        );
        const [updated] = yield* Effect.promise(() =>
          q.select().from(uatGenerations).where(eq(uatGenerations.name, name)),
        );
        const members = yield* Effect.promise(() =>
          q.select().from(uatGenerationMembers).where(eq(uatGenerationMembers.uatName, name)),
        );
        const resolutions = yield* Effect.promise(() =>
          q.select().from(uatGenerationResolutions).where(eq(uatGenerationResolutions.uatName, name)),
        );
        yield* bus.emit({ type: 'merge.uat_promoted', payload: { name } });
        return buildUatGeneration(updated, members, resolutions);
      });

    return MergeWriter.of({
      merge,
      approveForge,
      rebaseOntoMain,
      mergeNext,
      scheduleAutoMerge,
      cancelAutoMerge,
      assembleUat,
      startUatStack,
      promoteUat,
    });
  }),
);

// ── MergeApi — HttpApiGroup ───────────────────────────────────────────────────
// query: (not urlParams:) for GET params per Effect v4.
// Schema.Union([...]) array form.
// HttpApiEndpoint['delete'] for reserved word.

export const MergeApi = HttpApiGroup.make('merge')
  .add(HttpApiEndpoint.get('getMergeSet', '/issues/:id/merge-set', {
    params:  { id: IssueId },
    success: MergeSet,
    error:   MergeSetNotFound,
  }))
  .add(HttpApiEndpoint.get('listQueues', '/merge-queue', {
    success: Schema.Array(QueueView),
  }))
  .add(HttpApiEndpoint.get('listAutoMerges', '/flywheel/auto-merge', {
    query:   AutoMergeFilter,
    success: Schema.Array(AutoMerge),
  }))
  .add(HttpApiEndpoint.get('listBlockers', '/flywheel/merge-blockers', {
    success: Schema.Array(AutoMerge),
  }))
  .add(HttpApiEndpoint.get('listUatGenerations', '/flywheel/uat-generations', {
    query:   UatGenerationFilter,
    success: Schema.Array(UatGeneration),
  }))
  .add(HttpApiEndpoint.post('merge', '/issues/:id/merge', {
    params:  { id: IssueId },
    success: MergeSet,
    error:   Schema.Union([MergeSetNotFound, NotReadyForMerge, MergeInProgress, ForgeMergeFailed]),
  }))
  .add(HttpApiEndpoint.post('approveForge', '/issues/:id/forge-approve', {
    params:  { id: IssueId },
    success: MergeSet,
    error:   Schema.Union([MergeSetNotFound, ForgeMergeFailed]),
  }))
  .add(HttpApiEndpoint.post('rebaseOntoMain', '/issues/:id/sync-main', {
    params:  { id: IssueId },
    success: MergeSet,
    error:   MergeSetNotFound,
  }))
  .add(HttpApiEndpoint.post('mergeNext', '/flywheel/merge-next', {
    payload: Schema.Struct({ projectKey: ProjectKey }),
    success: Schema.NullOr(MergeSet),
    error:   Schema.Union([MergeSetNotFound, NotReadyForMerge, MergeInProgress, ForgeMergeFailed]),
  }))
  .add(HttpApiEndpoint.post('scheduleAutoMerge', '/flywheel/auto-merge/schedule', {
    payload: Schema.Struct({
      issueId:          IssueId,
      prUrl:            Schema.String,
      prNumber:         Schema.optional(Schema.Number),
      projectKey:       ProjectKey,
      forge:            Schema.optional(Schema.String),
      scheduledMergeAt: Schema.Date,
    }),
    success: AutoMerge,
  }))
  .add(HttpApiEndpoint['delete']('cancelAutoMerge', '/flywheel/auto-merge/:id', {
    params:  { id: IssueId },
    payload: Schema.Struct({ cancelledBy: Schema.String }),
    success: AutoMerge,
    error:   AutoMergeNotFound,
  }))
  .add(HttpApiEndpoint.post('assembleUat', '/flywheel/assemble-uat', {
    success: Schema.Array(UatGeneration),
  }))
  .add(HttpApiEndpoint.post('startUatStack', '/flywheel/uat-generations/:name/stack', {
    params:  { name: UatName },
    success: UatGeneration,
    error:   Schema.Union([UatGenerationNotFound, UatNotPromotable]),
  }))
  .add(HttpApiEndpoint.post('promoteUat', '/flywheel/uat-generations/:name/promote', {
    params:  { name: UatName },
    success: UatGeneration,
    error:   Schema.Union([UatGenerationNotFound, UatNotPromotable]),
  }));

// Placeholder Api — MergeApiLive needs a parent HttpApi. Server bootstrap
// (workspace-m9n4j) will compose this into OverdeckApi; for this bead the
// mini-api lets the handler types compile.
const MergeOnlyApi = HttpApi.make('merge-only').add(MergeApi);

export const MergeApiLive = HttpApiBuilder.group(MergeOnlyApi, 'merge', (h) =>
  h
    .handle('getMergeSet',        ({ params })          => MergeResolver.use((r) => r.getMergeSet(params.id)))
    .handle('listQueues',         ()                    => MergeResolver.use((r) => r.listQueues()))
    .handle('listAutoMerges',     ({ query })           => MergeResolver.use((r) => r.listAutoMerges(query)))
    .handle('listBlockers',       ()                    => MergeResolver.use((r) => r.listBlockers()))
    .handle('listUatGenerations', ({ query })           => MergeResolver.use((r) => r.listUatGenerations(query)))
    .handle('merge',              ({ params })          => MergeWriter.use((w) => w.merge(params.id)))
    .handle('approveForge',       ({ params })          => MergeWriter.use((w) => w.approveForge(params.id)))
    .handle('rebaseOntoMain',     ({ params })          => MergeWriter.use((w) => w.rebaseOntoMain(params.id)))
    .handle('mergeNext',          ({ payload })         => MergeWriter.use((w) => w.mergeNext(payload.projectKey)))
    .handle('scheduleAutoMerge',  ({ payload })         => MergeWriter.use((w) => w.scheduleAutoMerge(payload)))
    .handle('cancelAutoMerge',    ({ params, payload }) =>
      MergeWriter.use((w) => w.cancelAutoMerge(params.id, payload.cancelledBy)))
    .handle('assembleUat',        ()                    => MergeWriter.use((w) => w.assembleUat({ force: true })))
    .handle('startUatStack',      ({ params })          => MergeWriter.use((w) => w.startUatStack(params.name)))
    .handle('promoteUat',         ({ params })          => MergeWriter.use((w) => w.promoteUat(params.name))),
);
