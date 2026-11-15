/**
 * The polyrepo merge queue (PAN-3657, PAN-4753 WI-4): orders a polyrepo
 * project's ready set per member repo. A polyrepo root is not a git repo, so
 * the monorepo builder (`computeMergeQueueFromCandidates`, git at the project
 * root) cannot order it. The UAT reconciler and the `/api/merge-train/*` queue
 * routes both order through here.
 *
 * A member repo whose refs could not be refreshed makes the whole queue
 * unknown: {@link orderPolyrepoQueue} throws {@link PolyrepoRefsUnavailableError}
 * rather than return a shorter queue, because an empty or shortened ready set
 * is authoritative to the reconciler (it would invalidate the live batch).
 */
import { Effect } from 'effect';
import { layer as nodeServicesLayer } from '@effect/platform-node/NodeServices';

import type { PolyrepoMergeQueueItem } from '../../../lib/flywheel-merge-order.js';
import type { ReadyIssue } from '../../../lib/overdeck/ready-set.js';
import { resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { resolveProjectReposFromResolvedIssue, type ResolvedProjectRepo } from '../../../lib/project-repos.js';

/** Some member repos' refs could not be refreshed; the queue is unknown, not empty. */
export class PolyrepoRefsUnavailableError extends Error {
  constructor(readonly repoPaths: readonly string[]) {
    super(`could not refresh refs in ${repoPaths.join(', ')}`);
    this.name = 'PolyrepoRefsUnavailableError';
  }
}

/**
 * Member repos configured for an issue in a polyrepo project. Resolution goes
 * through the canonical repo resolver, which collapses monorepo to one
 * synthetic entry — so this is the same door the rest of the pipeline uses.
 */
export function resolveReposForIssue(issueId: string): ResolvedProjectRepo[] {
  const resolvedProject = resolveProjectFromIssueSync(issueId);
  if (!resolvedProject) return [];
  return resolveProjectReposFromResolvedIssue(issueId, resolvedProject) ?? [];
}

/** The ready set ordered per member repo, each item with its repo contributions. */
export async function orderPolyrepoQueue(
  projectPath: string,
  candidates: readonly ReadyIssue[],
  options: { onExcluded?: (issueId: string, reason: string) => void } = {},
): Promise<PolyrepoMergeQueueItem[]> {
  if (candidates.length === 0) return [];
  const { computePolyrepoMergeQueueFromCandidates, resolveMergeQueuePrUrl } =
    await import('../../../lib/flywheel-merge-order.js');
  const reposByIssue = new Map(candidates.map((c) => [c.issueId, resolveReposForIssue(c.issueId)]));
  let unavailableRepos: readonly string[] = [];
  const queue = await Effect.runPromise(
    computePolyrepoMergeQueueFromCandidates(candidates, reposByIssue, projectPath, {
      getPrUrl: resolveMergeQueuePrUrl,
      ...(options.onExcluded ? { onExcluded: options.onExcluded } : {}),
      onRefreshUnavailable: (repoPaths) => { unavailableRepos = repoPaths; },
    }).pipe(Effect.provide(nodeServicesLayer)),
  );
  if (unavailableRepos.length > 0) throw new PolyrepoRefsUnavailableError(unavailableRepos);
  return queue;
}
