import { existsSync } from 'fs';
import { join } from 'path';
import { Effect } from 'effect';
import { getReviewStatusSync, loadReviewStatuses, setReviewStatusSync, type ReviewStatus } from '../review-status.js';
import { logDeaconEventSync } from '../persistent-logger.js';
import { isIssueClosed } from './issue-closed.js';
import {
  describeRunningAgents,
  releaseAdvancingSlot,
  tryReserveAdvancingSlot,
} from './concurrency.js';
import { ciRetryMap } from './deacon-merge.js';
import { tryYieldForAdvancingDispatch } from './preemption.js';

const BLOCKED_REVIEW_MISSING_ANCHOR_LOG_INTERVAL_MS = 60 * 60 * 1000;
const blockedReviewMissingAnchorLogs = new Map<string, number>();
const blockedReviewDriftObservations = new Map<
  string,
  { reviewedAnchor: string; currentAnchor: string }
>();

function uniformReviewerVerdictAnchor(status: ReviewStatus): string | undefined {
  const verdicts = Object.values(status.reviewerVerdicts ?? {});
  if (verdicts.length === 0) return undefined;
  const anchors = verdicts
    .map(verdict => verdict?.atCommit)
    .filter((anchor): anchor is string => Boolean(anchor));
  if (anchors.length !== verdicts.length) return undefined;
  return anchors.every(anchor => anchor === anchors[0]) ? anchors[0] : undefined;
}

/**
 * Detect issues where the agent pushed new commits after a review verdict.
 *
 * Passed reviews are invalidated immediately when the reviewed tree changes.
 * Blocked reviews use the same drift evaluator, but require two consecutive
 * patrols at the same new HEAD before re-dispatching so a work agent that is
 * still pushing per-item commits does not start review mid-rework.
 */
export async function checkPostReviewCommits(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const statuses = loadReviewStatuses();
    const { resolveProjectFromIssueSync } = await import('../projects.js');

    for (const [issueId, status] of Object.entries(statuses)) {
      const isBlocked = status.reviewStatus === 'blocked';
      if (!isBlocked) blockedReviewDriftObservations.delete(issueId);

      if (status.mergeStatus === 'merged') {
        blockedReviewDriftObservations.delete(issueId);
        continue;
      }
      if (!isBlocked && status.reviewStatus !== 'passed' && !status.readyForMerge) continue;

      const reviewedAnchor = status.reviewedAtCommit
        ?? (isBlocked ? uniformReviewerVerdictAnchor(status) : undefined);
      if (!reviewedAnchor) {
        blockedReviewDriftObservations.delete(issueId);
        if (isBlocked) {
          const now = Date.now();
          const lastLoggedAt = blockedReviewMissingAnchorLogs.get(issueId) ?? 0;
          if (now - lastLoggedAt >= BLOCKED_REVIEW_MISSING_ANCHOR_LOG_INTERVAL_MS) {
            blockedReviewMissingAnchorLogs.set(issueId, now);
            logDeaconEventSync(
              `checkPostReviewCommits: ${issueId} blocked without anchor — cannot detect drift`,
            );
          }
        }
        continue;
      }
      if (await isIssueClosed(issueId)) {
        blockedReviewDriftObservations.delete(issueId);
        console.log(`[deacon] ${issueId}: skipping review re-dispatch — issue is closed`);
        continue;
      }

      const project = resolveProjectFromIssueSync(issueId);
      if (!project) continue;
      const workspacePath = join(
        project.projectPath,
        'workspaces',
        `feature-${issueId.toLowerCase()}`,
      );
      if (!existsSync(workspacePath)) continue;

      const { formatAnchorShort, rehydrateHeadAnchor } = await import('../git-utils.js');
      const { evaluateWorkspaceAnchorDrift } = await import('../workspace-anchor-drift.js');
      const verdict = await evaluateWorkspaceAnchorDrift(
        issueId,
        workspacePath,
        rehydrateHeadAnchor(reviewedAnchor),
      );
      if (verdict.kind === 'unreadable' || verdict.kind === 'current') {
        blockedReviewDriftObservations.delete(issueId);
        continue;
      }

      if (verdict.kind === 'benign') {
        blockedReviewDriftObservations.delete(issueId);
        setReviewStatusSync(issueId, { reviewedAtCommit: verdict.currentAnchor });
        console.log(`[deacon] Benign post-review HEAD move for ${issueId}: ${formatAnchorShort(reviewedAnchor)} → ${formatAnchorShort(verdict.currentAnchor)} — review/test preserved`);
        continue;
      }

      const currentHead = verdict.currentAnchor;
      if (isBlocked) {
        const priorObservation = blockedReviewDriftObservations.get(issueId);
        if (
          !priorObservation
          || priorObservation.reviewedAnchor !== reviewedAnchor
          || priorObservation.currentAnchor !== currentHead
        ) {
          blockedReviewDriftObservations.set(issueId, {
            reviewedAnchor,
            currentAnchor: currentHead,
          });
          continue;
        }
        blockedReviewDriftObservations.delete(issueId);
      }

      console.log(
        `[deacon] Post-review commit detected for ${issueId}: ` +
        `was ${formatAnchorShort(reviewedAnchor)}, now ${formatAnchorShort(currentHead)} — resetting review`,
      );
      if (isBlocked) {
        setReviewStatusSync(issueId, {
          reviewStatus: 'pending',
          readyForMerge: false,
          reviewedAtCommit: undefined,
          reviewRetryCount: 0,
          recoveryStartedAt: undefined,
        });
      } else {
        setReviewStatusSync(issueId, {
          reviewStatus: 'pending',
          testStatus: 'pending',
          readyForMerge: false,
          reviewedAtCommit: undefined,
          reviewNotes: undefined,
          testNotes: undefined,
          // Reset merge retry counter so checkFailedMergeRetry can retry again after
          // the work agent pushes a fix (e.g. to address a CI check failure).
          mergeRetryCount: 0,
          // PAN-794: new commits open a fresh recovery cycle — stale infra
          // failures from the previous cycle must not poison the breaker budget.
          reviewRetryCount: 0,
          recoveryStartedAt: undefined,
        });
      }
      // Also clear the CI transient retry counter so the next merge attempt
      // starts fresh. Without this, ciRetryMap retains count=6 from the previous
      // CI failure cycle, permanently blocking transient retries for this issue.
      ciRetryMap.delete(issueId);
      if (!isBlocked) {
        actions.push(`Reset review for ${issueId}: new commits after review passed (${formatAnchorShort(reviewedAnchor)} → ${formatAnchorShort(currentHead)})`);
      }

      // Redispatch a fresh review convoy. Re-read status to guard against races
      // with other dispatch paths (HTTP request-review, manual CLI) that may have
      // already picked up the work between the reset above and now.
      const freshStatus = getReviewStatusSync(issueId);
      // PAN-2507: also a blocked advancing (review) dispatch — try to yield an
      // idle work agent before deferring. (This 7th site was not in the PRD's
      // six-site enumeration but is the same `!tryReserveAdvancingSlot()` shape.)
      if (freshStatus?.reviewStatus === 'pending' && !tryReserveAdvancingSlot() && !(await tryYieldForAdvancingDispatch('review', issueId))) {
        // PAN-1665: at the ceiling — status is already reset to pending above, so
        // the orphan-review path will re-dispatch on a later patrol once a slot frees.
        actions.push(`Deferred post-review re-dispatch for ${issueId} — advancing-role concurrency ceiling reached`);
        logDeaconEventSync(`checkPostReviewCommits: deferred review for ${issueId} — advancing ceiling reached (PAN-1665) — ${describeRunningAgents()}`);
      } else if (freshStatus?.reviewStatus === 'pending') {
        const { spawnReviewRoleForIssue } = await import('./review-agent.js');
        const branch = `feature/${issueId.toLowerCase()}`;
        const dispatchResult = await Effect.runPromise(spawnReviewRoleForIssue({
          issueId,
          workspace: workspacePath,
          branch,
          force: true,
        }));
        if (dispatchResult.gated) {
          releaseAdvancingSlot();
          actions.push(`Deferred post-review re-dispatch for ${issueId} — ${dispatchResult.message}`);
          console.log(`[deacon] Deferred post-review re-dispatch for ${issueId}: ${dispatchResult.message}`);
        } else if (dispatchResult.success) {
          const action = isBlocked
            ? `Re-dispatched review for ${issueId}: rework commit after BLOCKED verdict (${formatAnchorShort(reviewedAnchor)} → ${formatAnchorShort(currentHead)})`
            : `Re-dispatched review for ${issueId}`;
          actions.push(action);
          console.log(`[deacon] ${action}`);
        } else {
          actions.push(`Failed to re-dispatch review for ${issueId}: ${dispatchResult.error || dispatchResult.message}`);
          console.error(`[deacon] Failed to re-dispatch review for ${issueId}:`, dispatchResult.error || dispatchResult.message);
        }
      }
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error in checkPostReviewCommits:', msg);
  }

  return actions;
}
