/**
 * Is the checkout `pan sync` distributes from current? (PAN-3881)
 *
 * `resolveSyncSourcesRoot()` deliberately prefers the primary checkout's
 * `sync-sources/` over a frozen deployment generation's (PAN-3327). When that
 * checkout is behind its upstream, or sits on a feature branch, every sync
 * silently distributes an old tree: merged deletions come back and merged rule
 * changes revert. This check says so. It only warns — it never pulls, resets,
 * or switches branches, because the checkout may hold unpushed or uncommitted
 * work that only the operator can reconcile.
 */
import { execFile } from 'child_process';
import { promisify } from 'util';

const execFileAsync = promisify(execFile);

const FETCH_TIMEOUT_MS = 15_000;
const GIT_TIMEOUT_MS = 5_000;

export interface SyncSourceFreshness {
  /** Top level of the git checkout that holds the sync sources. */
  checkout: string;
  /** Current branch, or null when HEAD is detached. */
  branch: string | null;
  /** The remote's default branch (e.g. `main`). */
  defaultBranch: string;
  /** The ref compared against (e.g. `origin/main`), or null when none resolves. */
  upstream: string | null;
  /** Commits on `upstream` that the checkout does not have. */
  behind: number;
  /** Commits in the checkout that `upstream` does not have. */
  ahead: number;
  /** True when refreshing `upstream` from the remote failed (offline, auth). */
  fetchFailed: boolean;
  /** Operator-facing warnings; empty when the checkout is current. */
  warnings: string[];
}

export interface SyncSourceFreshnessDeps {
  /** Skip `git fetch` (compare against the last-fetched remote ref). */
  skipFetch?: boolean;
}

async function git(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<string> {
  const { stdout } = await execFileAsync('git', ['-C', cwd, ...args], {
    encoding: 'utf-8',
    timeout,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return stdout.trim();
}

async function gitOrNull(cwd: string, args: string[]): Promise<string | null> {
  try {
    const out = await git(cwd, args);
    return out.length > 0 ? out : null;
  } catch {
    return null;
  }
}

/**
 * Inspect the git checkout containing `sourcesRoot`. Returns null when the
 * sources are not in a git checkout (a published npm install), which has no
 * upstream to fall behind.
 */
export async function checkSyncSourceFreshness(
  sourcesRoot: string,
  deps: SyncSourceFreshnessDeps = {},
): Promise<SyncSourceFreshness | null> {
  const checkout = await gitOrNull(sourcesRoot, ['rev-parse', '--show-toplevel']);
  if (!checkout) return null;

  const branch = await gitOrNull(checkout, ['symbolic-ref', '--quiet', '--short', 'HEAD']);
  const originHead = await gitOrNull(checkout, ['symbolic-ref', '--quiet', '--short', 'refs/remotes/origin/HEAD']);
  const defaultBranch = originHead?.startsWith('origin/') ? originHead.slice('origin/'.length) : 'main';

  let upstream = branch
    ? await gitOrNull(checkout, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}'])
    : null;
  if (!upstream) {
    const fallback = `origin/${defaultBranch}`;
    upstream = (await gitOrNull(checkout, ['rev-parse', '--verify', '--quiet', `refs/remotes/${fallback}`]))
      ? fallback
      : null;
  }

  let fetchFailed = false;
  if (upstream && !deps.skipFetch) {
    const slash = upstream.indexOf('/');
    const remote = slash > 0 ? upstream.slice(0, slash) : 'origin';
    const remoteBranch = slash > 0 ? upstream.slice(slash + 1) : upstream;
    try {
      await git(checkout, ['fetch', '--quiet', remote, remoteBranch], FETCH_TIMEOUT_MS);
    } catch {
      fetchFailed = true;
    }
  }

  let behind = 0;
  let ahead = 0;
  if (upstream) {
    const counts = await gitOrNull(checkout, ['rev-list', '--left-right', '--count', `HEAD...${upstream}`]);
    const [aheadStr, behindStr] = (counts ?? '0 0').split(/\s+/);
    ahead = Number(aheadStr) || 0;
    behind = Number(behindStr) || 0;
  }

  const warnings: string[] = [];
  if (branch === null) {
    warnings.push(`sync sources checkout ${checkout} has a detached HEAD, not the default branch '${defaultBranch}'.`);
  } else if (branch !== defaultBranch) {
    warnings.push(`sync sources checkout ${checkout} is on branch '${branch}', not the default branch '${defaultBranch}'.`);
  }
  if (behind > 0 && upstream) {
    warnings.push(
      `sync sources checkout ${checkout} is ${behind} commit${behind === 1 ? '' : 's'} behind ${upstream}`
      + (ahead > 0 ? ` (and ${ahead} ahead)` : '')
      + '; merged skill, rule, agent, and hook changes (including deletions) will not be distributed.',
    );
  }
  if (fetchFailed && upstream) {
    warnings.push(`could not fetch ${upstream}; the behind count uses the last-fetched copy.`);
  }

  return { checkout, branch, defaultBranch, upstream, behind, ahead, fetchFailed, warnings };
}
