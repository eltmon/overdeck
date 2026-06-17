import { Context, Effect, Layer, Schema } from 'effect';
import { eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';
import { HttpApiEndpoint, HttpApiGroup } from 'effect/unstable/httpapi';

import { Db, EventBus, Records } from './infra.js';
import type { ProjectConfig } from '../projects.js';
import type { PanIssueRecord } from '../pan-dir/record.js';

export const overdeckIssues = sqliteTable('issues', {
  id: text('id').primaryKey(),
  stage: text('stage').notNull(),
  reviewOutcome: text('review_outcome'),
  testOutcome: text('test_outcome'),
  verificationOutcome: text('verification_outcome'),
  verdictCommit: text('verdict_commit'),
  blockers: text('blockers', { mode: 'json' }).$type<Blocker[]>(),
  planRef: text('plan_ref'),
  prUrl: text('pr_url'),
  prNumber: integer('pr_number'),
  prHeadSha: text('pr_head_sha'),
  updatedAt: integer('updated_at', { mode: 'timestamp' }).notNull(),
});

export const IssueId = Schema.String.pipe(Schema.brand('IssueId'));
export type IssueId = typeof IssueId.Type;

export const Sha = Schema.String.pipe(Schema.brand('Sha'));
export type Sha = typeof Sha.Type;

export const Stage = Schema.Literals([
  'todo',
  'planning',
  'planned',
  'working',
  'in_review',
  'testing',
  'verifying',
  'merging',
  'verifying_on_main',
  'closed',
  'cancelled',
]);
export type Stage = typeof Stage.Type;

export const Outcome = Schema.Literals(['pending', 'passed', 'failed']);
export type Outcome = typeof Outcome.Type;

export const TestOutcome = Schema.Literals(['pending', 'passed', 'failed', 'skipped']);
export type TestOutcome = typeof TestOutcome.Type;

export const Blocker = Schema.Struct({
  kind: Schema.Literals(['merge_conflict', 'failing_check', 'review_block', 'other']),
  detail: Schema.String,
});
export type Blocker = typeof Blocker.Type;

export const Issue = Schema.Struct({
  id: IssueId,
  stage: Stage,
  reviewOutcome: Schema.NullOr(Outcome),
  testOutcome: Schema.NullOr(TestOutcome),
  verificationOutcome: Schema.NullOr(Outcome),
  verdictCommit: Schema.NullOr(Sha),
  blockers: Schema.Array(Blocker),
  planRef: Schema.NullOr(Schema.String),
  pr: Schema.NullOr(Schema.Struct({
    url: Schema.String,
    number: Schema.Number,
    headSha: Sha,
  })),
  updatedAt: Schema.Date,
});
export type Issue = typeof Issue.Type;

export const IssueFilter = Schema.Struct({
  stage: Schema.optional(Stage),
  readyForMerge: Schema.optional(Schema.Boolean),
});
export type IssueFilter = typeof IssueFilter.Type;

export class IssueNotFound extends Schema.TaggedErrorClass<IssueNotFound>()(
  'IssueNotFound',
  { id: IssueId },
) {}

export class IllegalTransition extends Schema.TaggedErrorClass<IllegalTransition>()(
  'IllegalTransition',
  { from: Stage, to: Stage },
) {}

type IssueRow = typeof overdeckIssues.$inferSelect;

const decodeIssue = Schema.decodeUnknownSync(Issue);

const LEGAL: Record<Stage, ReadonlyArray<Stage>> = {
  todo: ['planning', 'cancelled'],
  planning: ['planned', 'working', 'todo', 'cancelled'],
  planned: ['working', 'todo', 'cancelled'],
  working: ['in_review', 'todo', 'cancelled'],
  in_review: ['testing', 'working', 'cancelled'],
  testing: ['verifying', 'merging', 'working', 'cancelled'],
  verifying: ['merging', 'working', 'cancelled'],
  merging: ['verifying_on_main', 'working', 'cancelled'],
  verifying_on_main: ['closed', 'cancelled'],
  closed: ['todo'],
  cancelled: ['todo'],
};

function isLegalMove(from: Stage, to: Stage): boolean {
  return to === 'todo' || (LEGAL[from]?.includes(to) ?? false);
}

function outcomeForMove(
  from: Stage,
  to: Stage,
  hint?: 'skipped',
): Partial<Pick<Issue, 'reviewOutcome' | 'testOutcome' | 'verificationOutcome'>> {
  if (from === 'in_review' && to === 'testing') return { reviewOutcome: 'passed' };
  if (from === 'in_review' && to === 'working') return { reviewOutcome: 'failed' };
  if (from === 'testing' && to === 'verifying') return { testOutcome: hint === 'skipped' ? 'skipped' : 'passed' };
  if (from === 'testing' && to === 'merging') return { testOutcome: hint === 'skipped' ? 'skipped' : 'passed' };
  if (from === 'testing' && to === 'working') return { testOutcome: 'failed' };
  if (from === 'verifying' && to === 'merging') return { verificationOutcome: 'passed' };
  if (from === 'verifying' && to === 'working') return { verificationOutcome: 'failed' };
  if (to === 'working' || to === 'todo') {
    return { reviewOutcome: 'pending', testOutcome: 'pending', verificationOutcome: 'pending' };
  }
  return {};
}

function rowToIssue(row: IssueRow): Issue {
  return decodeIssue({
    id: row.id,
    stage: row.stage,
    reviewOutcome: row.reviewOutcome,
    testOutcome: row.testOutcome,
    verificationOutcome: row.verificationOutcome,
    verdictCommit: row.verdictCommit,
    blockers: row.blockers ?? [],
    planRef: row.planRef,
    pr: row.prUrl && row.prNumber && row.prHeadSha
      ? { url: row.prUrl, number: row.prNumber, headSha: row.prHeadSha }
      : null,
    updatedAt: row.updatedAt,
  });
}

function readyForMerge(issue: Issue): boolean {
  return issue.reviewOutcome === 'passed'
    && (issue.testOutcome === 'passed' || issue.testOutcome === 'skipped')
    && issue.verificationOutcome !== 'failed'
    && issue.stage !== 'merging'
    && issue.stage !== 'verifying_on_main'
    && issue.stage !== 'closed'
    && issue.blockers.length === 0;
}

function issueToRecord(issue: Issue, reason: string): PanIssueRecord {
  const updatedAt = issue.updatedAt.toISOString();
  return {
    issueId: issue.id,
    schemaVersion: 2,
    pipeline: {
      issueId: issue.id,
      reviewStatus: issue.reviewOutcome ?? 'pending',
      testStatus: issue.testOutcome ?? 'pending',
      verificationStatus: issue.verificationOutcome ?? 'pending',
      readyForMerge: readyForMerge(issue),
      prUrl: issue.pr?.url,
      prNumber: issue.pr?.number,
      prHeadSha: issue.pr?.headSha,
      blockerReasons: [...issue.blockers],
      updatedAt,
    },
    closeOut: {
      usage: { byStage: {}, totals: {} },
      merges: [],
      ranOn: reason,
    },
  };
}

export interface IssuesResolverServiceShape {
  readonly get: (id: IssueId) => Effect.Effect<Issue, IssueNotFound>;
  readonly list: (filter: IssueFilter) => Effect.Effect<ReadonlyArray<Issue>>;
  readonly getPlan: (id: IssueId) => Effect.Effect<unknown, IssueNotFound>;
}

export class IssuesResolver extends Context.Service<IssuesResolver, IssuesResolverServiceShape>()(
  'overdeck/IssuesResolver',
) {}

export const IssuesResolverLive = Layer.effect(
  IssuesResolver,
  Effect.gen(function* () {
    const db = yield* Db;
    const records = yield* Records;

    const get = (id: IssueId) =>
      Effect.gen(function* () {
        const [row] = yield* Effect.promise(() =>
          db.q.select().from(overdeckIssues).where(eq(overdeckIssues.id, id)),
        );
        if (!row) {
          return yield* Effect.fail(new IssueNotFound({ id }));
        }
        return rowToIssue(row);
      });

    const list = (filter: IssueFilter) =>
      Effect.gen(function* () {
        const rows = yield* Effect.promise(() =>
          filter.stage
            ? db.q.select().from(overdeckIssues).where(eq(overdeckIssues.stage, filter.stage))
            : db.q.select().from(overdeckIssues),
        );
        const issues = rows.map(rowToIssue);
        return filter.readyForMerge === undefined
          ? issues
          : issues.filter((issue) => readyForMerge(issue) === filter.readyForMerge);
      });

    const getPlan = (id: IssueId) =>
      Effect.gen(function* () {
        const issue = yield* get(id);
        return issue.planRef ? yield* records.readSpec(issue.planRef) : null;
      });

    return IssuesResolver.of({ get, list, getPlan });
  }),
);

export interface IssueWriterServiceShape {
  readonly advance: (
    id: IssueId,
    to: Stage,
    reason: string,
    hint?: 'skipped',
  ) => Effect.Effect<Issue, IssueNotFound | IllegalTransition, IssuesResolver>;
  readonly setPr: (
    id: IssueId,
    pr: Issue['pr'],
  ) => Effect.Effect<Issue, IssueNotFound, IssuesResolver>;
  readonly setBlockers: (
    id: IssueId,
    blockers: ReadonlyArray<Blocker>,
    reason: string,
  ) => Effect.Effect<Issue, IssueNotFound, IssuesResolver>;
}

export class IssueWriter extends Context.Service<IssueWriter, IssueWriterServiceShape>()('overdeck/IssueWriter') {}

export function makeIssueWriterLive(project: ProjectConfig = {
  name: 'overdeck',
  path: process.cwd(),
  issue_prefix: 'PAN',
}): Layer.Layer<IssueWriter, never, Db | Records | EventBus> {
  return Layer.effect(
    IssueWriter,
    Effect.gen(function* () {
      const db = yield* Db;
      const records = yield* Records;
      const bus = yield* EventBus;
      const now = () => new Date();

      const advance: IssueWriterServiceShape['advance'] = (id, to, reason, hint) =>
        Effect.gen(function* () {
          const resolver = yield* IssuesResolver;
          const issue = yield* resolver.get(id);
          if (!isLegalMove(issue.stage, to)) {
            return yield* Effect.fail(new IllegalTransition({ from: issue.stage, to }));
          }

          const next: Issue = { ...issue, ...outcomeForMove(issue.stage, to, hint), stage: to, updatedAt: now() };
          yield* records.writeIssue(project, id, issueToRecord(next, reason));
          yield* Effect.promise(() =>
            db.q.update(overdeckIssues).set({
              stage: next.stage,
              reviewOutcome: next.reviewOutcome,
              testOutcome: next.testOutcome,
              verificationOutcome: next.verificationOutcome,
              updatedAt: next.updatedAt,
            }).where(eq(overdeckIssues.id, id)).run(),
          );
          yield* bus.emit({ type: 'issue.advanced', payload: { id, from: issue.stage, to, reason } });
          return next;
        });

      const setPr: IssueWriterServiceShape['setPr'] = (id, pr) =>
        Effect.gen(function* () {
          const resolver = yield* IssuesResolver;
          const issue = yield* resolver.get(id);
          const next: Issue = { ...issue, pr, updatedAt: now() };
          yield* records.writeIssue(project, id, issueToRecord(next, 'pr-identity'));
          yield* Effect.promise(() =>
            db.q.update(overdeckIssues).set({
              prUrl: pr?.url ?? null,
              prNumber: pr?.number ?? null,
              prHeadSha: pr?.headSha ?? null,
              updatedAt: next.updatedAt,
            }).where(eq(overdeckIssues.id, id)).run(),
          );
          yield* bus.emit({ type: 'issue.pr_updated', payload: { id, pr } });
          return next;
        });

      const setBlockers: IssueWriterServiceShape['setBlockers'] = (id, blockers, reason) =>
        Effect.gen(function* () {
          const resolver = yield* IssuesResolver;
          const issue = yield* resolver.get(id);
          const next: Issue = { ...issue, blockers: [...blockers], updatedAt: now() };
          yield* records.writeIssue(project, id, issueToRecord(next, reason));
          yield* Effect.promise(() =>
            db.q.update(overdeckIssues).set({
              blockers: [...blockers],
              updatedAt: next.updatedAt,
            }).where(eq(overdeckIssues.id, id)).run(),
          );
          yield* bus.emit({ type: 'issue.blockers_changed', payload: { id, blockers, reason } });
          return next;
        });

      return IssueWriter.of({ advance, setPr, setBlockers });
    }),
  );
}

export const IssueWriterLive = makeIssueWriterLive();

export const IssuesApi = HttpApiGroup.make('issues')
  .add(HttpApiEndpoint.get('list', '/issues', {
    query: IssueFilter,
    success: Schema.Array(Issue),
  }))
  .add(HttpApiEndpoint.get('get', '/issues/:id', {
    params: { id: IssueId },
    success: Issue,
    error: IssueNotFound,
  }))
  .add(HttpApiEndpoint.get('getPlan', '/issues/:id/plan', {
    params: { id: IssueId },
    success: Schema.Unknown,
    error: IssueNotFound,
  }))
  .add(HttpApiEndpoint.post('advance', '/issues/:id/advance', {
    params: { id: IssueId },
    payload: Schema.Struct({
      to: Stage,
      reason: Schema.String,
      hint: Schema.optional(Schema.Literals(['skipped'])),
    }),
    success: Issue,
    error: [IssueNotFound, IllegalTransition],
  }))
  .add(HttpApiEndpoint.post('setBlockers', '/issues/:id/blockers', {
    params: { id: IssueId },
    payload: Schema.Struct({
      blockers: Schema.Array(Blocker),
      reason: Schema.String,
    }),
    success: Issue,
    error: IssueNotFound,
  }))
  .add(HttpApiEndpoint.post('setPr', '/issues/:id/pr', {
    params: { id: IssueId },
    payload: Schema.Struct({
      url: Schema.String,
      number: Schema.Number,
      headSha: Sha,
    }),
    success: Issue,
    error: IssueNotFound,
  }));

