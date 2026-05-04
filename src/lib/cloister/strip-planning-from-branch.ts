/**
 * strip-planning-from-branch — Remove ephemeral `.planning/` artifacts from a
 * feature branch before merging to main.
 *
 * Background (#888): `.planning/` files are tracked on feature branches so the
 * dashboard, agents, and review pipeline can read them throughout the workspace
 * lifecycle. They are NOT supposed to land on main — `cleanPlanningArtifacts`
 * removes them post-merge, but that runs AFTER the squash-merge has already
 * published the polluted commit. Other active workspaces then `pan sync-main`
 * the contamination, overwriting their own continue file and feedback.
 *
 * This module fixes the race by stripping `.planning/` from the feature branch
 * BEFORE `gh pr merge --squash` runs. The squash commit on main therefore never
 * contains `.planning/` paths in the first place.
 *
 * Uses `git rm --cached` so the worktree files survive (the workspace still
 * needs them until post-merge cleanup runs).
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export interface StripPlanningResult {
  success: boolean;
  pushed: boolean;
  newHead?: string;
  reason?: string;
}

/**
 * Strip tracked `.planning/` files from the tip of a feature branch and
 * force-push the cleanup commit. Idempotent — if no `.planning/` files are
 * tracked, returns success without pushing.
 *
 * MUST be called on a worktree currently checked out to `featureBranch`.
 *
 * @param workspacePath  Worktree path (must be on featureBranch)
 * @param featureBranch  Remote branch name (e.g. `feature/pan-123`)
 * @param issueId        Issue ID for logging/commit message
 */
export async function stripPlanningFromFeatureBranch(
  workspacePath: string,
  featureBranch: string,
  issueId: string,
): Promise<StripPlanningResult> {
  const execOpts = { cwd: workspacePath, encoding: 'utf-8' as const, timeout: 60_000 };
  const logPrefix = `[strip-planning] ${issueId}`;

  try {
    // Step 1: Find tracked .planning/ files.
    const { stdout: tracked } = await execAsync(
      'git ls-files -- .planning/',
      execOpts,
    );
    const trackedFiles = tracked.trim().split('\n').filter(Boolean);

    if (trackedFiles.length === 0) {
      console.log(`${logPrefix} No tracked .planning/ files — nothing to strip`);
      const { stdout: head } = await execAsync('git rev-parse HEAD', execOpts);
      return { success: true, pushed: false, newHead: head.trim() };
    }

    console.log(`${logPrefix} Stripping ${trackedFiles.length} tracked .planning/ file(s) from ${featureBranch}`);

    // Step 2: Remove from index only — keep worktree files for active workspace use.
    await execAsync(
      'git rm -r --cached --ignore-unmatch .planning/',
      execOpts,
    );

    // Step 3: Verify something was actually staged for removal.
    try {
      await execAsync('git diff --cached --quiet', execOpts);
      // No staged changes — files were already untracked between ls-files and rm.
      console.log(`${logPrefix} No staged changes after rm (already clean)`);
      const { stdout: head } = await execAsync('git rev-parse HEAD', execOpts);
      return { success: true, pushed: false, newHead: head.trim() };
    } catch {
      // Diff exited non-zero — there ARE staged changes, proceed to commit.
    }

    // Step 4: Commit the cleanup.
    await execAsync(
      `git commit -m "chore: strip ephemeral .planning/ artifacts before merge (${issueId})"`,
      execOpts,
    );

    // Step 5: Force-push (with lease) to the remote feature branch.
    await execAsync(
      `git push --force-with-lease origin HEAD:${featureBranch}`,
      execOpts,
    );

    const { stdout: newHead } = await execAsync('git rev-parse HEAD', execOpts);
    console.log(`${logPrefix} Pushed cleanup commit, new HEAD ${newHead.trim().slice(0, 8)}`);

    return { success: true, pushed: true, newHead: newHead.trim() };
  } catch (err: any) {
    const reason = `Failed to strip .planning/: ${err.message?.slice(0, 300) || 'unknown'}`;
    console.error(`${logPrefix} ${reason}`);
    return { success: false, pushed: false, reason };
  }
}
