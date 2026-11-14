/**
 * Removal of an edit workspace (PAN-5191 WI-F4, D-F9, D-F10).
 *
 * Order: `git worktree remove`, then `git branch -D <edit branch>`, then (when
 * asked and the branch was pushed) `git push origin --delete <edit branch>`,
 * then the registry row. Only the worktree removal can fail the call: once
 * the worktree is gone, a failed branch or remote delete is logged and
 * ignored. Git runs with `cwd` = the primary checkout only for these three
 * commands, none of which touches its working tree or index (NFR-2).
 */
import { deleteWorkspace } from '../../../../lib/workspaces/writer.js';
import type { WorkspaceRow } from '../../../../lib/workspaces/types.js';
import { EditWorkspaceError } from './edit-workspace-errors.js';
import { tail } from './edit-workspace-git.js';
import { EDIT_BRANCH } from './edit-workspace.js';
import { runGit } from './git-exec.js';

const REMOVE_TIMEOUT_MS = 60_000;

export interface RemoveEditWorkspaceDeps {
  runGit?: typeof runGit;
  deleteWorkspace?: (id: string) => Promise<void>;
}

export async function removeEditWorkspace(
  target: { row: WorkspaceRow; primaryPath: string },
  opts: { force: boolean; deleteRemoteBranch: boolean },
  deps: RemoveEditWorkspaceDeps = {},
): Promise<void> {
  const { row, primaryPath } = target;
  const branch = row.branchName ?? '';
  if (!EDIT_BRANCH.test(branch)) {
    throw new EditWorkspaceError('NOT_AN_EDIT_WORKSPACE', 409, `Workspace ${row.name} is not an explorer edit workspace.`);
  }
  const git = deps.runGit ?? runGit;
  const removeRow = deps.deleteWorkspace ?? deleteWorkspace;

  const remove = await git(primaryPath, ['worktree', 'remove', ...(opts.force ? ['--force'] : []), '--', row.path], {
    timeoutMs: REMOVE_TIMEOUT_MS,
  });
  if (remove.code !== 0 || remove.timedOut) {
    const reason = remove.timedOut ? 'git worktree remove timed out' : tail(remove.stderr);
    throw new EditWorkspaceError('REMOVE_FAILED', 409, `Removing edit workspace ${row.name} failed: ${reason}`);
  }

  const deleteBranch = await git(primaryPath, ['branch', '-D', branch]);
  if (deleteBranch.code !== 0) console.warn(`[explorer-edit] branch -D failed: ${tail(deleteBranch.stderr)}`);

  if (opts.deleteRemoteBranch) {
    const pushed = await git(primaryPath, ['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`]);
    if (pushed.code === 0) {
      const push = await git(primaryPath, ['push', 'origin', '--delete', branch], { timeoutMs: REMOVE_TIMEOUT_MS });
      if (push.code !== 0) console.warn(`[explorer-edit] push --delete ${branch} failed: ${tail(push.stderr)}`);
    }
  }

  await removeRow(row.id);
}
