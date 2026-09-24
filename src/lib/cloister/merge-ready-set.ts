/**
 * The merge-ready set, computed rather than stored (PAN-3917, FR-9).
 *
 * Merge readiness used to be a boolean on a `review_status` row that three
 * patrols raced to set and clear. It is now a question with one answer: the
 * forge says the PR is approved, its checks are green, and it is mergeable.
 *
 * The candidate list comes from the durable pipeline lenses (tracker issue
 * state, git branches, open/merged PRs), which are themselves derived. Both
 * halves are injectable so callers and tests never shell out.
 */
import { resolvePipelineMembership } from '../pipeline-membership.js';
import type { ProjectConfig } from '../projects.js';
import type { gatherProjectLensSignalsForProjects } from '../pipeline-membership-gather.js';
import { evaluateIssueMergeGate, type MergeGateDeps } from './merge-gate.js';

export interface MergeCandidateDeps extends MergeGateDeps {
  listProjects?: () => Promise<Array<{ key: string; config: ProjectConfig }>>;
  gather?: typeof gatherProjectLensSignalsForProjects;
}

/**
 * Every in-flight issue that has an open PR. Loaded lazily so a caller that
 * injects its own sources never pulls the tracker/git gather graph in.
 */
export async function listInFlightIssuesWithPr(deps: MergeCandidateDeps = {}): Promise<string[]> {
  const listProjects = deps.listProjects
    ?? (await import('../projects.js')).listProjectsAsync;
  const gather = deps.gather
    ?? (await import('../pipeline-membership-gather.js')).gatherProjectLensSignalsForProjects;

  const projects = await listProjects();
  const gathered = await gather(projects.map(({ config }) => config));

  const candidates: string[] = [];
  for (const { signals } of gathered) {
    for (const signal of signals ?? []) {
      if (!signal.hasOpenPr) continue;
      if (resolvePipelineMembership(signal).bucket !== 'in_flight') continue;
      candidates.push(signal.issueId.toUpperCase());
    }
  }
  return [...new Set(candidates)];
}

/**
 * The issues whose PRs the forge says are ready to merge right now, judged by
 * the one merge gate (`merge-gate.ts`): approved, green, mergeable, the CI
 * test job passed in a `verification.tests: ci` project (#4021), and no failed
 * required UAT at the head (#4036).
 */
export async function getMergeReadyIssues(deps: MergeCandidateDeps = {}): Promise<string[]> {
  const ready: string[] = [];
  for (const issueId of await listInFlightIssuesWithPr(deps)) {
    if ((await evaluateIssueMergeGate(issueId, deps)).ready) ready.push(issueId);
  }
  return ready;
}
