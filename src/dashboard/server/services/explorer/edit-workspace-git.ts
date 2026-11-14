/**
 * Commit and push for edit workspaces (PAN-5191 WI-F3).
 *
 * `commitAll` stages every change and commits it as the operator identity
 * (`git config --global user.name/user.email`, parent D-10). Repository hooks
 * run: there is no `--no-verify`, and a refused commit or push returns the
 * tail of git's stderr so the dialog can show it (D-F6).
 *
 * `pushHead` pushes HEAD to a named remote branch with the explorer git
 * runner, not `gitPush`: the edit branch does not exist on the remote yet, and
 * the direct path sets upstream (D-F5).
 */
import { homedir } from 'node:os';
import { EditWorkspaceError } from './edit-workspace-errors.js';
import { runGit } from './git-exec.js';

const STDERR_TAIL = 4000;
const ADD_TIMEOUT_MS = 30_000;
const COMMIT_TIMEOUT_MS = 120_000;
const PUSH_TIMEOUT_MS = 180_000;

export interface OperatorIdentity {
  name: string;
  email: string;
}

export interface EditGitDeps {
  runGit?: typeof runGit;
  operatorIdentity?: (git: typeof runGit) => Promise<OperatorIdentity | null>;
}

/** The last `max` characters of `text`, trimmed. */
export function tail(text: string, max = STDERR_TAIL): string {
  const trimmed = text.trim();
  return trimmed.length <= max ? trimmed : trimmed.slice(trimmed.length - max);
}

/** The global git identity, or null when either value is unset. */
export async function operatorIdentity(git: typeof runGit = runGit): Promise<OperatorIdentity | null> {
  const read = async (key: string): Promise<string | null> => {
    const result = await git(homedir(), ['config', '--global', key]);
    const value = result.stdout.toString('utf8').trim();
    return result.code === 0 && value !== '' ? value : null;
  };
  const [name, email] = await Promise.all([read('user.name'), read('user.email')]);
  return name && email ? { name, email } : null;
}

/**
 * Stages and commits every change with `message`. Resolves
 * `{ committed: false }` when nothing is staged but the branch is already
 * ahead of `baseRef`; rejects NOTHING_TO_COMMIT when it is not.
 */
export async function commitAll(
  cwd: string,
  message: string,
  baseRef: string,
  deps: EditGitDeps = {},
): Promise<{ committed: boolean }> {
  const git = deps.runGit ?? runGit;
  const identityOf = deps.operatorIdentity ?? operatorIdentity;

  const add = await git(cwd, ['add', '-A'], { timeoutMs: ADD_TIMEOUT_MS });
  if (add.code !== 0) throw new EditWorkspaceError('COMMIT_REFUSED', 422, `Staging the changes failed: ${tail(add.stderr)}`);

  const staged = await git(cwd, ['diff', '--cached', '--quiet']);
  if (staged.code === 0) {
    const ahead = await git(cwd, ['rev-list', '--count', `${baseRef}..HEAD`]);
    const count = ahead.code === 0 ? Number(ahead.stdout.toString('utf8').trim()) : 0;
    if (!(count > 0)) throw new EditWorkspaceError('NOTHING_TO_COMMIT', 409, 'There are no changes to commit.');
    return { committed: false };
  }
  if (staged.code !== 1) {
    throw new EditWorkspaceError('COMMIT_REFUSED', 422, `Reading the staged changes failed: ${tail(staged.stderr)}`);
  }

  const identity = await identityOf(git);
  const identityArgs = identity ? ['-c', `user.name=${identity.name}`, '-c', `user.email=${identity.email}`] : [];
  const commit = await git(cwd, [...identityArgs, 'commit', '-q', '-m', message], { timeoutMs: COMMIT_TIMEOUT_MS });
  if (commit.code !== 0 || commit.timedOut) {
    const reason = commit.timedOut ? 'the commit timed out' : tail(commit.stderr);
    throw new EditWorkspaceError('COMMIT_REFUSED', 422, `The commit was refused: ${reason}`);
  }
  return { committed: true };
}

/** Pushes HEAD to `refs/heads/<targetBranch>` on origin. */
export async function pushHead(
  cwd: string,
  targetBranch: string,
  opts: { setUpstream: boolean },
  deps: EditGitDeps = {},
): Promise<void> {
  const git = deps.runGit ?? runGit;
  const args = ['push', ...(opts.setUpstream ? ['--set-upstream'] : []), 'origin', `HEAD:refs/heads/${targetBranch}`];
  const push = await git(cwd, args, { timeoutMs: PUSH_TIMEOUT_MS });
  if (push.code !== 0 || push.timedOut) {
    const reason = push.timedOut ? 'the push timed out' : tail(push.stderr);
    throw new EditWorkspaceError('PUSH_FAILED', 502, `Pushing ${targetBranch} failed: ${reason}`);
  }
}

export async function headSha(cwd: string, git: typeof runGit = runGit): Promise<string> {
  const result = await git(cwd, ['rev-parse', 'HEAD']);
  if (result.code !== 0) throw new Error(`git rev-parse HEAD failed: ${tail(result.stderr)}`);
  return result.stdout.toString('utf8').trim();
}

/** True when `git status --porcelain` prints nothing. */
export async function isClean(cwd: string, git: typeof runGit = runGit): Promise<boolean> {
  const result = await git(cwd, ['status', '--porcelain']);
  if (result.code !== 0) throw new Error(`git status failed: ${tail(result.stderr)}`);
  return result.stdout.toString('utf8').trim() === '';
}
