/**
 * Item worktrees under an issue workspace (moved from `pan spawn`, PAN-3920 D14).
 *
 * `<workspace>/.swarm/<item>/` is a git worktree on its own branch
 * `<feature-branch>-<item>`, cut from the issue's feature branch. `pan spawn`
 * uses it for an xBRIEF item with a `files_scope`; `pan worker run` uses it for
 * every worker that is not read-only. Async git only: the worker library is
 * reachable from the dashboard server.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

/**
 * Create (or reuse) `<workspacePath>/.swarm/<itemId>/`. The branch matters: a
 * detached worktree orphans everything the worker commits. An existing
 * worktree is reused as is.
 */
export async function createItemWorktree(workspacePath: string, itemId: string): Promise<string> {
  const path = join(workspacePath, '.swarm', itemId);
  if (existsSync(path)) return path;

  const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: workspacePath });
  const featureBranch = stdout.trim();
  // A sibling, not a child: `feature/pan-9/worker-1` cannot coexist with the
  // branch `feature/pan-9` (git refuses to lock the ref under an existing ref).
  const itemBranch = `${featureBranch}-${itemId}`;

  const branchExists = await execFileAsync(
    'git',
    ['rev-parse', '--verify', '--quiet', `refs/heads/${itemBranch}`],
    { cwd: workspacePath },
  ).then(() => true, () => false);

  await execFileAsync(
    'git',
    branchExists
      ? ['worktree', 'add', path, itemBranch]
      : ['worktree', 'add', '-b', itemBranch, path, featureBranch],
    { cwd: workspacePath },
  );
  return path;
}

/** The branch an item worktree was cut on (`<feature-branch>-<item>`), or null when it cannot be read. */
export async function worktreeBranch(path: string): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], { cwd: path });
    const branch = stdout.trim();
    return branch && branch !== 'HEAD' ? branch : null;
  } catch {
    return null;
  }
}
