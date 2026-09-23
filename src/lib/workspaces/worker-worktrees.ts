/**
 * Worker worktree residue (PAN-3920, review of #4027).
 *
 * `pan worker run` gives each non-read-only worker a git worktree at
 * `<workspace>/.swarm/worker-<n>/` on branch `<feature-branch>-worker-<n>`.
 * Nothing removes them while the issue is open: a stopped worker's parent may
 * still need its work (`--stop-after-report` keeps the worktree). When the
 * issue is torn down (close-out, close, approve, reap) or its residue is
 * reaped, they go: `git worktree remove --force`, then `git worktree prune`,
 * then the branches.
 *
 * Branch deletion has two modes. `all` deletes every worker branch of the
 * issue (the caller has already decided the issue's branches go). `merged`
 * deletes only a worker branch with no work of its own: an ancestor of the
 * feature branch or of the primary checkout's HEAD. Async git only.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

export type RunGit = (args: string[], cwd: string) => Promise<string>;

const defaultRunGit: RunGit = async (args, cwd) => (await execFileAsync('git', args, { cwd })).stdout;

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

async function succeeds(run: RunGit, args: string[], cwd: string): Promise<boolean> {
  return run(args, cwd).then(() => true, () => false);
}

export async function reapWorkerWorktrees(
  projectPath: string,
  issueId: string,
  options: { deleteBranches: 'all' | 'merged' },
  run: RunGit = defaultRunGit,
): Promise<string[]> {
  const actions: string[] = [];
  const issueLower = issueId.toLowerCase();
  const featureBranch = `feature/${issueLower}`;
  const worktreePattern = new RegExp(`/workspaces/feature-${escapeRegExp(issueLower)}/\\.swarm/worker-\\d+$`);
  const branchPattern = new RegExp(`^${escapeRegExp(featureBranch)}-worker-\\d+$`);

  let listing = '';
  try {
    listing = await run(['worktree', 'list', '--porcelain'], projectPath);
  } catch {
    return actions; // Not a repository, or git unavailable: nothing to reap.
  }
  const worktrees = listing
    .split('\n')
    .filter((line) => line.startsWith('worktree '))
    .map((line) => line.slice('worktree '.length).trim())
    .filter((path) => worktreePattern.test(path));
  for (const path of worktrees) {
    if (await succeeds(run, ['worktree', 'remove', '--force', path], projectPath)) {
      actions.push(`removed worker worktree ${path}`);
    } else {
      actions.push(`failed to remove worker worktree ${path}`);
    }
  }
  await run(['worktree', 'prune'], projectPath).catch(() => '');

  const refs = await run(
    ['for-each-ref', '--format=%(refname:short)', `refs/heads/${featureBranch}-worker-*`],
    projectPath,
  ).catch(() => '');
  for (const branch of refs.split('\n').map((line) => line.trim()).filter((line) => branchPattern.test(line))) {
    if (options.deleteBranches === 'merged') {
      const contained = await succeeds(run, ['merge-base', '--is-ancestor', branch, featureBranch], projectPath)
        || await succeeds(run, ['merge-base', '--is-ancestor', branch, 'HEAD'], projectPath);
      if (!contained) {
        actions.push(`kept worker branch ${branch}: it has commits of its own`);
        continue;
      }
    }
    if (await succeeds(run, ['branch', '-D', branch], projectPath)) {
      actions.push(`deleted worker branch ${branch}`);
    } else {
      actions.push(`failed to delete worker branch ${branch}`);
    }
  }
  return actions;
}
