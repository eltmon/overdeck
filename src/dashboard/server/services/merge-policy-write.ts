/**
 * PAN-4753 WI-8: write an issue's merge policy (plan R9).
 *
 * `POST /api/merge-train/policy/:issueId` sets the issue policy to `auto`,
 * `hold` or `default` by writing the tracker labels `auto-merge` and
 * `hold-for-uat`. Overdeck stores no copy: the labels are the policy, and the
 * scheduler, the board and the auto-merge policy map read them from the
 * cached tracker row.
 *
 *   - `auto`    removes `hold-for-uat`, adds `auto-merge`;
 *   - `hold`    removes `auto-merge`, adds `hold-for-uat`;
 *   - `default` removes both (follow the project).
 *
 * Only a GitHub-tracked issue carries the labels. `IssueLifecycle.addLabel` is
 * a silent no-op for other trackers, and a Linear project with a
 * `github_repo` would resolve the id to an unrelated GitHub issue, so any
 * project whose tracker is not `github`, or an id that does not resolve to a
 * GitHub issue, gets a 501 before any label call.
 *
 * Both labels are operator grant labels: the agent `gh` shim refuses to write
 * them (`launcher-git-guard.ts`), and this route keeps the `admin` default of
 * `route-scopes.ts` (it has no row there), which no agent token holds.
 *
 * After the write the cached tracker row is patched with the new labels and
 * the board cache is dropped, so the next read sees the policy without
 * waiting for the tracker poll.
 */
import { Effect } from 'effect';

import { AUTO_MERGE_LABEL, HOLD_FOR_UAT_LABEL, autoMergeFromLabels } from '../../../lib/cloister/auto-merge-eligibility.js';
import { projectAutoMergeDefault, shouldHoldForUat } from '../../../lib/cloister/auto-merge-policy.js';
import {
  isHighPriorityMerge,
  issueDroppedFromBatch,
  issueTrainOn,
  mergeRouteFor,
  type MergeRoute,
} from '../../../lib/cloister/merge-route.js';
import { isFlywheelRequireUatBeforeMerge } from '../../../lib/overdeck/control-settings.js';
import { tryResolveProjectTrackerType } from '../../../lib/project-tracker-type.js';
import { getProjectSync, resolveProjectFromIssueSync, type ProjectConfig } from '../../../lib/projects.js';
import { resolveGitHubIssue } from '../../../lib/tracker-utils.js';
import { IssueLifecycle } from './issue-lifecycle.js';
import { getSharedIssueService } from './issue-service-singleton.js';
import { invalidateMergeTrainBoardCache } from './merge-train-board.js';

export type MergePolicyWrite = 'auto' | 'hold' | 'default';

export function isMergePolicyWrite(value: unknown): value is MergePolicyWrite {
  return value === 'auto' || value === 'hold' || value === 'default';
}

/** The label calls for a policy: removals first, then the one addition. */
export function labelWritesFor(policy: MergePolicyWrite): { remove: string[]; add: string | null } {
  switch (policy) {
    case 'auto': return { remove: [HOLD_FOR_UAT_LABEL], add: AUTO_MERGE_LABEL };
    case 'hold': return { remove: [AUTO_MERGE_LABEL], add: HOLD_FOR_UAT_LABEL };
    case 'default': return { remove: [AUTO_MERGE_LABEL, HOLD_FOR_UAT_LABEL], add: null };
  }
}

/** The issue's labels once the policy's writes have landed. */
export function labelsAfterPolicy(labels: readonly string[], policy: MergePolicyWrite): string[] {
  const { remove, add } = labelWritesFor(policy);
  const kept = labels.filter((label) => !remove.includes(label) && label !== add);
  return add ? [...kept, add] : kept;
}

export interface MergePolicyWriteDeps {
  resolveProject: (issueId: string) => { projectKey: string; config: ProjectConfig } | null;
  isGitHubIssue: (issueId: string) => boolean;
  /** The cached tracker row's labels; null when the cache does not hold the issue. */
  cachedLabels: (issueId: string) => readonly string[] | null;
  patchCachedLabels: (issueId: string, labels: string[]) => void;
  invalidateBoard: () => void;
  globalRequireUat: () => boolean;
  trainOn: (issueId: string) => boolean;
  droppedFromBatch: (issueId: string) => boolean;
}

export interface MergePolicyWriteResult {
  status: number;
  body: Record<string, unknown>;
}

function defaultDeps(): MergePolicyWriteDeps {
  return {
    resolveProject: (issueId) => {
      const resolved = resolveProjectFromIssueSync(issueId);
      const config = resolved ? getProjectSync(resolved.projectKey) : null;
      return resolved && config ? { projectKey: resolved.projectKey, config } : null;
    },
    isGitHubIssue: (issueId) => resolveGitHubIssue(issueId).isGitHub,
    cachedLabels: (issueId) => getSharedIssueService().getTrackerIssue(issueId)?.labels ?? null,
    // Strings are the normalized label shape of every cached tracker row.
    patchCachedLabels: (issueId, labels) => getSharedIssueService().patchIssue(issueId, { labels }),
    invalidateBoard: invalidateMergeTrainBoardCache,
    globalRequireUat: isFlywheelRequireUatBeforeMerge,
    trainOn: issueTrainOn,
    droppedFromBatch: issueDroppedFromBatch,
  };
}

/** Set the issue's merge policy through its tracker labels. */
export function writeIssueMergePolicy(
  issueId: string,
  policy: MergePolicyWrite,
  deps: MergePolicyWriteDeps = defaultDeps(),
) {
  return Effect.gen(function* () {
    const project = deps.resolveProject(issueId);
    if (!project) {
      return { status: 404, body: { error: `No registered project for ${issueId}` } } satisfies MergePolicyWriteResult;
    }
    const tracker = tryResolveProjectTrackerType(project.config);
    if (tracker !== 'github' || !deps.isGitHubIssue(issueId)) {
      return {
        status: 501,
        body: { error: `This tracker does not carry merge-policy labels; set auto-merge or hold-for-uat on the issue in ${tracker ?? 'its tracker'}` },
      } satisfies MergePolicyWriteResult;
    }

    const lifecycle = yield* IssueLifecycle;
    const { remove, add } = labelWritesFor(policy);
    for (const label of remove) yield* lifecycle.removeLabel(issueId, label);
    if (add) yield* lifecycle.addLabel(issueId, add);

    const before = deps.cachedLabels(issueId);
    const labels = labelsAfterPolicy(before ?? [], policy);
    // Patch only a row the cache holds: a miss would make `patchIssue` refresh
    // a whole tracker. The next tracker poll converges either way.
    const refreshed = before !== null;
    if (refreshed) deps.patchCachedLabels(issueId, labels);
    deps.invalidateBoard();

    const heldForUat = shouldHoldForUat(
      autoMergeFromLabels(labels),
      projectAutoMergeDefault(project.config),
      deps.globalRequireUat(),
    );
    const trainOn = deps.trainOn(issueId);
    const highPriority = isHighPriorityMerge({ labels });
    const route: MergeRoute = mergeRouteFor({
      heldForUat,
      trainOn,
      highPriority,
      droppedFromBatch: !heldForUat && trainOn && !highPriority && deps.droppedFromBatch(issueId),
    });
    return {
      status: 200,
      body: { issueId, policy, effectivePolicy: heldForUat ? 'hold' : 'auto', route, refreshed },
    } satisfies MergePolicyWriteResult;
  });
}
