/**
 * clean-planning — Remove ephemeral .planning/ artifacts from main after merge.
 *
 * After a feature branch merges to main, ephemeral planning files
 * (STATE.md, PRD.md, PLANNING_PROMPT.md, .planning-complete, feedback/)
 * land on main and pollute new workspaces that inherit them.
 *
 * This module removes those files from the git index and working tree
 * with a dedicated commit, so new workspaces start clean.
 *
 * Idempotent — if none of the target files are tracked, returns skipped.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import type { LifecycleContext, StepResult } from './types.js';
import { stepOk, stepSkipped, stepFailed } from './types.js';

const execAsync = promisify(exec);

/** Ephemeral planning files to remove from main after merge */
const EPHEMERAL_PLANNING_FILES = [
  '.planning/STATE.md',
  '.planning/PRD.md',
  '.planning/WORKSPACE.md',
  '.planning/PLANNING_PROMPT.md',
  '.planning/PLANNING_PROMPT.md.archived',
  '.planning/plan.vbrief.json',
  '.planning/.planning-complete',
];

/**
 * Remove ephemeral planning artifacts from main after a feature branch merge.
 *
 * Uses `git rm` to remove tracked files from both the index and working tree,
 * then commits the deletion. Untracked files are silently skipped.
 */
export async function cleanPlanningArtifacts(
  ctx: LifecycleContext,
): Promise<StepResult> {
  const step = 'clean-planning';
  const { issueId, projectPath } = ctx;

  try {
    // Build the list of files git is currently tracking in .planning/
    // that match our ephemeral set. We include feedback/ glob separately.
    let trackedFiles: string[] = [];

    // Check individual ephemeral files
    for (const file of EPHEMERAL_PLANNING_FILES) {
      try {
        const { stdout } = await execAsync(
          `git ls-files -- ${file}`,
          { cwd: projectPath, encoding: 'utf-8' },
        );
        if (stdout.trim()) {
          trackedFiles.push(file);
        }
      } catch {
        // git ls-files failure is non-fatal
      }
    }

    // Check feedback/ directory
    try {
      const { stdout } = await execAsync(
        `git ls-files -- .planning/feedback/`,
        { cwd: projectPath, encoding: 'utf-8' },
      );
      if (stdout.trim()) {
        trackedFiles.push('.planning/feedback/');
      }
    } catch {
      // Non-fatal
    }

    if (trackedFiles.length === 0) {
      return stepSkipped(step, ['No tracked ephemeral planning files found on main']);
    }

    // Remove tracked files from index and working tree
    const fileArgs = trackedFiles.map(f => `"${f}"`).join(' ');
    await execAsync(
      `git rm -rf --ignore-unmatch ${fileArgs}`,
      { cwd: projectPath, encoding: 'utf-8' },
    );

    // Check if anything was actually staged for deletion
    try {
      await execAsync('git diff --cached --quiet', { cwd: projectPath, encoding: 'utf-8' });
      // Nothing staged — files may have already been removed
      return stepSkipped(step, ['No staged deletions after git rm (already clean)']);
    } catch {
      // There are staged changes — commit them
      await execAsync(
        `git commit -m "chore: remove ephemeral planning state after ${issueId} merge"`,
        { cwd: projectPath, encoding: 'utf-8' },
      );
    }

    return stepOk(step, [
      `Removed ${trackedFiles.length} ephemeral planning file(s) from main`,
      `Files: ${trackedFiles.join(', ')}`,
    ]);
  } catch (err) {
    return stepFailed(step, `Failed to clean planning artifacts: ${(err as Error).message}`);
  }
}
