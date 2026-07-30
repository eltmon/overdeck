/**
 * Terminal-issue resolution through the canonical issues read door.
 *
 * `pan admin db rebuild-workspaces` needs to know which issues are finished so
 * it can archive their workspace rows (PAN-3286 FR-14). Review fix: it must ask
 * `IssuesResolver` rather than reading `issues.stage` itself — a second read
 * path would let rebuild archival drift from the rest of the pipeline whenever
 * resolver policy, decoding, or the source of truth changes.
 *
 * This module is the thin async bridge for non-Effect callers (the CLI): it
 * builds the resolver over the live `Db`/`Records` layers, lists through it, and
 * returns plain data. It performs no SQL of its own.
 */
import { Effect, Layer } from 'effect';
import { IssuesResolver, IssuesResolverLive, type Issue, type Stage } from './issues.js';
import { makeDbLive, RecordsLive } from './infra.js';

/**
 * Stages that mean "this issue is finished, its worktree is no longer live
 * work". `verifying_on_main` counts because the merge has already landed.
 */
export const TERMINAL_STAGES: ReadonlySet<Stage> = new Set<Stage>([
  'verifying_on_main',
  'closed',
  'cancelled',
]);

export function isTerminalStage(stage: Stage | string | null | undefined): boolean {
  return stage !== null && stage !== undefined && TERMINAL_STAGES.has(stage as Stage);
}

/** Every issue whose stage is terminal, read through `IssuesResolver`. */
export function listTerminalIssues(): Effect.Effect<ReadonlyArray<Issue>, never, IssuesResolver> {
  return IssuesResolver.use((resolver) => resolver.list({})).pipe(
    Effect.map((issues) => issues.filter((issue) => isTerminalStage(issue.stage))),
  );
}

/**
 * The set of terminal issue ids, for plain-async callers. Uppercased ids as the
 * issues table stores them; compare case-insensitively at the call site if the
 * other side's casing is not guaranteed.
 */
export async function resolveTerminalIssueIds(): Promise<ReadonlySet<string>> {
  const layer = IssuesResolverLive.pipe(Layer.provide(Layer.mergeAll(makeDbLive(), RecordsLive)));
  const issues = await Effect.runPromise(Effect.scoped(Effect.provide(listTerminalIssues(), layer)));
  return new Set(issues.map((issue) => issue.id));
}
