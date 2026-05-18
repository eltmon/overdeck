/**
 * Safety net for the workspace beads JSONL export.
 *
 * Workspace bd dolt databases occasionally lose state (see PAN-1158): a stale
 * dolt-server, port collision between sibling worktrees, or partial init can
 * leave `bd list` returning zero issues. The next `bd export` then faithfully
 * writes a zero-issue file (which bd v1.0.4 chooses not to materialise at all),
 * and git reports the previously-tracked `.beads/issues.jsonl` as deleted.
 *
 * That phantom deletion blocks every workspace path that checks `git status`
 * before doing real work (`pan review request`, `syncMainIntoWorkspace`'s
 * pre-flight auto-commit), and the worst case is the auto-commit catching it
 * and propagating the deletion onto the feature branch.
 *
 * `restoreTrackedBeadsExport()` is the recovery primitive: if the tracked
 * export is missing on disk, `git restore` it from the index. The real fix
 * lives in PAN-1158 (prevent the dolt DB from going empty in the first place
 * and refuse-empty in `bd export`). Until that lands, this primitive is the
 * safety net we wedge into the workspace flows that get hurt today.
 *
 * NOTE: PR #1155 introduces an inline copy of this helper in `bd-mutex.ts`.
 * Once both PRs land, the duplicate should be removed in favour of this file.
 */

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

export async function restoreTrackedBeadsExport(workspacePath: string): Promise<void> {
  try {
    const { stdout } = await execAsync('git status --porcelain -- .beads/issues.jsonl', {
      cwd: workspacePath,
      encoding: 'utf-8',
    });
    // git status --porcelain shows the index column (col 0) and worktree column (col 1).
    // - "_D" = working tree deleted (file removed but still in index)
    // - "D_" = staged deletion (already removed from index — `git restore --` alone
    //          is a no-op here because the index has nothing to restore from)
    // - "DD" = staged + worktree deletion
    // For any of these, restoring from HEAD into both the index AND worktree recovers
    // the tracked file in every case.
    const xy = stdout.split('\n').find((line) => line.endsWith(' .beads/issues.jsonl'));
    if (xy && (xy[0] === 'D' || xy[1] === 'D')) {
      await execAsync('git restore --source=HEAD --staged --worktree -- .beads/issues.jsonl', {
        cwd: workspacePath,
      });
    }
  } catch {
    // Best effort — never throw from the safety net.
  }
}
