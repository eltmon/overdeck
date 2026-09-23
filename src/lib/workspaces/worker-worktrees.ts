/**
 * Worker worktree residue (PAN-3920, reviews of #4027).
 *
 * `pan worker run` gives each non-read-only worker a git worktree at
 * `<workspace>/.swarm/worker-<n>/` on branch `<feature-branch>-worker-<n>`.
 * Nothing removes them while the issue is open: a stopped worker's parent may
 * still need its work (`--stop-after-report` keeps the worktree).
 *
 * Worktrees are removed (`git worktree remove --force`, then `git worktree
 * prune`) only when the caller is deleting the issue workspace itself; a kept
 * workspace keeps its worker worktrees, uncommitted changes included.
 *
 * Branches follow one rule on every path: a worker branch exists only on this
 * machine, so it is deleted only when its tip is already contained in the
 * default branch (local or remote-tracking) or in the feature branch while that
 * still exists. Anything else is kept, with its unmerged commit count logged.
 * A branch still checked out in a kept worktree is kept too. Async git only.
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

interface WorktreeEntry {
  path: string;
  branch: string | null;
}

function parseWorktrees(porcelain: string): WorktreeEntry[] {
  const entries: WorktreeEntry[] = [];
  let current: WorktreeEntry | null = null;
  for (const raw of porcelain.split('\n')) {
    const line = raw.trim();
    if (line.startsWith('worktree ')) {
      current = { path: line.slice('worktree '.length), branch: null };
      entries.push(current);
    } else if (current && line.startsWith('branch refs/heads/')) {
      current.branch = line.slice('branch refs/heads/'.length);
    }
  }
  return entries;
}

/**
 * The refs a worker branch must already be contained in to be deleted: the
 * default branch (from `origin/HEAD`, else `main`/`master`), its
 * remote-tracking ref, and the feature branch when it still exists.
 */
async function containmentBases(projectPath: string, featureBranch: string, run: RunGit): Promise<string[]> {
  const candidates = new Set<string>();
  const originHead = (await run(['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD'], projectPath).catch(() => '')).trim();
  if (originHead) {
    candidates.add(originHead);
    candidates.add(originHead.replace(/^origin\//, ''));
  }
  for (const name of ['main', 'origin/main', 'master', 'origin/master', featureBranch]) candidates.add(name);
  const bases: string[] = [];
  for (const ref of candidates) {
    if (await succeeds(run, ['rev-parse', '--verify', '--quiet', `${ref}^{commit}`], projectPath)) bases.push(ref);
  }
  return bases;
}

export async function reapWorkerWorktrees(
  projectPath: string,
  issueId: string,
  options: { removeWorktrees: boolean },
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
  const workerWorktrees = parseWorktrees(listing).filter((entry) => worktreePattern.test(entry.path));
  const checkedOut = new Map<string, string>();
  for (const entry of workerWorktrees) {
    if (options.removeWorktrees) {
      if (await succeeds(run, ['worktree', 'remove', '--force', entry.path], projectPath)) {
        actions.push(`removed worker worktree ${entry.path}`);
        continue;
      }
      actions.push(`failed to remove worker worktree ${entry.path}`);
    }
    if (entry.branch) checkedOut.set(entry.branch, entry.path);
  }
  if (options.removeWorktrees) await run(['worktree', 'prune'], projectPath).catch(() => '');

  const refs = await run(
    ['for-each-ref', '--format=%(refname:short)', `refs/heads/${featureBranch}-worker-*`],
    projectPath,
  ).catch(() => '');
  const branches = refs.split('\n').map((line) => line.trim()).filter((line) => branchPattern.test(line));
  if (branches.length === 0) return actions;
  const bases = await containmentBases(projectPath, featureBranch, run);

  for (const branch of branches) {
    const inWorktree = checkedOut.get(branch);
    if (inWorktree) {
      actions.push(`kept worker branch ${branch}: checked out in ${inWorktree}`);
      continue;
    }
    let contained = false;
    for (const base of bases) {
      if (await succeeds(run, ['merge-base', '--is-ancestor', branch, base], projectPath)) {
        contained = true;
        break;
      }
    }
    if (!contained) {
      const count = bases.length > 0
        ? (await run(['rev-list', '--count', branch, '--not', ...bases], projectPath).catch(() => '?')).trim()
        : 'an unknown number of';
      actions.push(`kept worker branch ${branch}: ${count} unmerged commit(s)`);
      continue;
    }
    if (await succeeds(run, ['branch', '-D', branch], projectPath)) {
      actions.push(`deleted worker branch ${branch}`);
    } else {
      actions.push(`failed to delete worker branch ${branch}`);
    }
  }
  return actions;
}
