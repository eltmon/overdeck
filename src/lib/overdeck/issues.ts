import { Context, Effect, Layer, Schema } from 'effect';
import { eq } from 'drizzle-orm';
import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { Db, Records } from './infra.js';

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
  updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull(),
});

/**
 * PAN-3903: the pipeline read door is `./pipeline-view.js`, deliberately NOT a
 * method on this resolver and deliberately NOT re-exported here.
 *
 * The door has to answer a cloister patrol, which is plain sync code that
 * cannot take an Effect dependency. Importing it from this module pulls
 * `review-status.js` — and the `cloister/feedback-target.js` subgraph behind it
 * — into every importer of `IssuesResolver`, and `overdeck/control-settings.js`
 * already imports this file. That closes a cycle the circular-dependency guard
 * rejects and that Node's strict ESM refuses at boot (Bun tolerates it, so a
 * green typecheck proves nothing). Keeping the door a leaf module is what makes
 * one implementation reachable from both the patrols and the dashboard.
 */

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
  mergeReady: Schema.optional(Schema.Boolean),
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

function mergeReady(issue: Issue): boolean {
  return issue.reviewOutcome === 'passed'
    && (issue.testOutcome === 'passed' || issue.testOutcome === 'skipped')
    && issue.verificationOutcome !== 'failed'
    && issue.stage !== 'merging'
    && issue.stage !== 'verifying_on_main'
    && issue.stage !== 'closed'
    && issue.blockers.length === 0;
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
        return filter.mergeReady === undefined
          ? issues
          : issues.filter((issue) => mergeReady(issue) === filter.mergeReady);
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

