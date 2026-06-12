/**
 * Real wiring for the merge-train reconciler (PAN-1691). Lazy-loaded from
 * merge-train.ts only when the global merge-train flag is on, so it
 * is never imported during normal operation or the gating unit tests.
 *
 * This is pure I/O — git rebase/force-push and agent spawn — and is exercised
 * only with the flag on against a real merge, so it is not unit-tested. The
 * decision logic it feeds (`reconcileStaleSiblings`) and the flag gating
 * (`runMergeTrainReconcile`) are.
 */
import { join } from 'path';
import { promisify } from 'util';
import { exec } from 'child_process';
import { getAllReviewStatusesFromDb } from '../database/review-status-db.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { spawnRun } from '../agents.js';
import type { ReconcileDeps, RebaseStatus } from './merge-train-reconciler.js';

const execAsync = promisify(exec);

function workspacePathFor(issueId: string): string | null {
  const project = resolveProjectFromIssueSync(issueId);
  if (!project) return null;
  return join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
}

export function buildRealReconcileDeps(): ReconcileDeps {
  return {
    getReadySiblings: (mergedIssueId) => {
      const merged = mergedIssueId.toUpperCase();
      return Object.values(getAllReviewStatusesFromDb())
        .filter(
          (rs) =>
            rs.readyForMerge === true &&
            rs.mergeStatus !== 'merged' &&
            rs.issueId.toUpperCase() !== merged,
        )
        .map((rs) => rs.issueId);
    },

    rebaseSibling: async (issueId): Promise<{ status: RebaseStatus }> => {
      const ws = workspacePathFor(issueId);
      if (!ws) return { status: 'up-to-date' };
      const run = (cmd: string) => execAsync(cmd, { cwd: ws });

      await run('git fetch origin main');
      const { stdout } = await run('git rev-list --count HEAD..origin/main');
      if (stdout.trim() === '0') return { status: 'up-to-date' };

      try {
        await run('git rebase origin/main');
        await run('git push --force-with-lease');
        return { status: 'clean' };
      } catch {
        await run('git rebase --abort').catch(() => {});
        return { status: 'conflict' };
      }
    },

    reDispatchVerification: async (issueId) => {
      // The branch HEAD moved after the rebase — re-run review on the new HEAD.
      await spawnRun(issueId, 'review', {
        prompt:
          'Your branch was automatically rebased onto the latest main after another feature merged. ' +
          'Re-review on the new HEAD and confirm the issue is still correct and ready to merge.',
      });
    },

    dispatchConflictResolver: async (issueId, mergedIssueId) => {
      await spawnRun(issueId, 'work', {
        prompt: [
          `Your feature branch could not be cleanly rebased onto the latest main because ${mergedIssueId} just merged and conflicts with your changes.`,
          '',
          `Resolve the rebase conflict WITHOUT degrading either feature:`,
          `1. Read what ${mergedIssueId} changed (git log/diff on origin/main) AND what your issue (${issueId}) intended.`,
          `2. Rebase your branch onto origin/main and resolve each conflict so BOTH features' intent is preserved.`,
          `3. Build, run tests, commit, and push, then re-request review.`,
          '',
          `Do not blindly accept one side of a conflict — understand both changesets first.`,
        ].join('\n'),
      });
    },
  };
}
