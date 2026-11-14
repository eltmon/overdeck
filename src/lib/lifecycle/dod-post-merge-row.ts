/** DoD row 5 (post-merge lifecycle). Extracted from dod-gate.ts (PAN-5225) so row 5 can grow without pushing dod-gate.ts over the file-size ceiling. */

import type { CanonicalState } from '../../core/state-mapping.js';
import { Effect } from 'effect';
import { listRunningAgents, type AgentState } from '../agents.js';
import { isAlive, isConfirmedDead, type LivenessVerdict } from '../agents/liveness.js';
import { getAutoCloseOutCanonicalState } from './auto-close-out-canonical-state.js';
import { PullRequestReadError, readPullRequestWithRetry } from './dod-pr-read.js';
import { fetchIssuePullRequest } from '../overdeck/pull-requests.js';
import { readForgeMergeVerdict, type RepoLandingEvidence } from './dod-forge-merge.js';
import { dodRowResult as result, type DodRowResult } from './dod.js';
import type { LifecycleContext } from './types.js';

type Awaitable<T> = T | Promise<T>;

export interface PostMergeRowDeps {
  readCanonicalState: (ctx: LifecycleContext) => Promise<CanonicalState | null>;
  /** The PR's own merge timestamp — the forge owns "merged", not a record. */
  readMergedAt: (issueId: string) => Awaitable<string | undefined>;
  listAgents: () => Awaitable<Array<Pick<AgentState, 'id' | 'issueId' | 'role' | 'status'>>>;
  /**
   * PAN-4324: the stored status is a spawn-time snapshot, so a claimed-live
   * row is confirmed with the liveness oracle before it blocks the row.
   */
  isAlive: (agentId: string) => Promise<LivenessVerdict>;
}

/**
 * Row 5's secondary signal. A failed read stays `undefined` (PAN-4821): the
 * row's evidence is the canonical state, and a missing mergedAt can only turn
 * a pass into a miss. The helper has already logged the failure.
 */
export async function readPullRequestMergedAt(issueId: string): Promise<string | undefined> {
  try {
    return (await readPullRequestWithRetry(fetchIssuePullRequest, issueId))?.mergedAt;
  } catch (error) {
    if (error instanceof PullRequestReadError) return undefined;
    throw error;
  }
}

export const defaultPostMergeRowDeps: PostMergeRowDeps = {
  readCanonicalState: async ctx => {
    return getAutoCloseOutCanonicalState(ctx.issueId) as Promise<CanonicalState | null>;
  },
  readMergedAt: readPullRequestMergedAt,
  listAgents: async () => Effect.runPromise(listRunningAgents()),
  isAlive: agentId => isAlive(agentId),
};

/** The subset of row 4's result that row 5 reads: never the full merged row. */
export type PostMergeMergedEvidence = Partial<DodRowResult> & { evidence?: 'branch-containment'; containedStrikeHead?: string };

export async function checkPostMergeRow(
  ctx: LifecycleContext,
  merged?: PostMergeMergedEvidence,
  deps: PostMergeRowDeps = defaultPostMergeRowDeps,
  landing?: { forgeMerge?: () => Promise<RepoLandingEvidence> },
): Promise<DodRowResult> {
  try {
    const canonicalState = await deps.readCanonicalState(ctx);
    const mergedAt = await deps.readMergedAt(ctx.issueId);
    const issueId = ctx.issueId.toUpperCase();
    // PAN-4324: stored status is a spawn-time snapshot — nothing writes
    // 'stopped' back when a work/planning agent exits on its own — so a
    // claimed-live row is confirmed with the liveness oracle before it
    // blocks the row.
    const claimedLive = (await deps.listAgents()).filter(agent =>
      agent.issueId.toUpperCase() === issueId &&
      (agent.role === 'work' || agent.role === 'plan') &&
      (agent.status === 'starting' || agent.status === 'running'),
    );
    const verdicts = await Promise.all(claimedLive.map(agent =>
      deps.isAlive(agent.id).catch((): LivenessVerdict => ({ alive: false, reason: 'runtime-indeterminate' })),
    ));
    const runningAgents = claimedLive.filter((_, index) => verdicts[index]!.alive);
    const indeterminateAgents = claimedLive.filter((_, index) =>
      !verdicts[index]!.alive && !isConfirmedDead(verdicts[index]!));
    const exitedAgents = claimedLive.filter((_, index) => isConfirmedDead(verdicts[index]!));
    const blockingAgents = [...runningAgents, ...indeterminateAgents];
    const stateObserved = canonicalState
      ? `canonical state: ${canonicalState}`
      : `canonical state unavailable; PR mergedAt: ${mergedAt ?? 'not merged'}`;
    const blockingParts = [
      runningAgents.length > 0 ? `running agents: ${runningAgents.map(agent => agent.id).join(', ')}` : '',
      indeterminateAgents.length > 0 ? `liveness indeterminate: ${indeterminateAgents.map(agent => agent.id).join(', ')}` : '',
    ].filter(Boolean);
    const exitedNote = exitedAgents.length > 0
      ? ` (stored running, not live: ${exitedAgents.map(agent => agent.id).join(', ')})`
      : '';
    const agentsObserved = blockingParts.length > 0
      ? blockingParts.join('; ')
      : `no running work/planning agents${exitedNote}`;
    // PAN-3188 (row 5): terminal canonical states settle this row. 'done'
    // proves the post-merge lifecycle already ran to close-out; 'canceled'
    // makes it moot. Requiring the transient verifying_on_main marker here
    // wedges every re-evaluated terminal issue (the 11 closed issues that
    // blocked close-out sweeps on 'canonical state: done').
    if (canonicalState === 'done') {
      return result(
        'post-merge',
        blockingAgents.length === 0 ? 'pass' : 'miss',
        `terminal canonical state: done — the post-merge lifecycle already ran to close-out; ${agentsObserved}`,
      );
    }
    if (canonicalState === 'canceled') {
      return result(
        'post-merge',
        blockingAgents.length === 0 ? 'skip' : 'miss',
        `terminal canonical state: canceled — post-merge lifecycle not applicable; ${agentsObserved}`,
      );
    }
    const lifecycleObserved = canonicalState === 'verifying_on_main' || Boolean(mergedAt);
    // PAN-3180: `postMergeLifecycle()` is the work-agent handoff — it pauses the
    // work/planning agents, stops the workspace stack, and applies
    // `verifying-on-main`. A strike has no work agent to pause and lands through
    // an operator-merged PR (PAN-3973), so the marker this row looks for may never
    // be written and its absence proves nothing. What a strike does still owe is
    // quiescence, so a live work/planning agent remains a real miss.
    if (!lifecycleObserved && merged?.containedStrikeHead) {
      return result(
        'post-merge',
        blockingAgents.length === 0 ? 'skip' : 'miss',
        `strike landing (strike/${ctx.issueId.toLowerCase()} contained in main) — the work-agent post-merge handoff is not the strike path's lifecycle; ${stateObserved}; ${agentsObserved}`,
      );
    }
    if (!lifecycleObserved && merged?.evidence === 'branch-containment') {
      return result(
        'post-merge',
        blockingAgents.length === 0 ? 'pass' : 'miss',
        `non-PR landing (branch-containment evidence) — post-merge lifecycle not applicable; ${agentsObserved}`,
      );
    }
    // PAN-5225: a non-GitHub-tracked issue has no canonical state and no PR mergedAt;
    // complete merged forge artifacts are its mergedAt.
    if (!lifecycleObserved && landing?.forgeMerge) {
      const verdict = await readForgeMergeVerdict(landing.forgeMerge);
      if (verdict.kind === 'complete') {
        return result(
          'post-merge',
          blockingAgents.length === 0 ? 'pass' : 'miss',
          `${stateObserved}; ${verdict.text} — merged forge artifacts stand in for the PR mergedAt on a non-GitHub-tracked issue; ${agentsObserved}`,
        );
      }
    }
    return result(
      'post-merge',
      lifecycleObserved && blockingAgents.length === 0 ? 'pass' : 'miss',
      `${stateObserved}; ${agentsObserved}`,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return result('post-merge', 'miss', `post-merge evidence unavailable: ${message}`);
  }
}
