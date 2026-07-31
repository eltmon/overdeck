/**
 * Workspace git state and fast-forward pull (PAN-3331).
 *
 * Two entry points:
 *   - getWorkspaceGitState(path, { fetch })  — branch/dirty/ahead/behind/remote log
 *   - pullWorkspaceFastForward(path)         — `git pull --ff-only`, guarded
 *
 * Correctness note: ahead/behind is computed against the checked-out branch's
 * OWN upstream (`@{u}`), falling back to `origin/HEAD` only when no upstream is
 * configured. The pre-existing issue-workspace helper compares against
 * `origin/HEAD` unconditionally, which reports the wrong "behind" for a feature
 * branch tracking its own remote branch.
 *
 * Every git invocation spawns through execFileAsync argument vectors — no shell
 * strings, no execSync (this module is reachable from dashboard routes).
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { ensureSyncGitQuiescent } from '../cloister/sync-main-git.js';
import type {
  PullResult,
  RemoteCommit,
  WorkspaceGitState,
} from './types.js';

const execFileAsync = promisify(execFile);

/** Field separator for the remote-commit log format (never appears in git output). */
const UNIT_SEP = '\x1f';

const REMOTE_COMMIT_LIMIT = 10;

const GIT_TIMEOUT_MS = 15_000;
const FETCH_TIMEOUT_MS = 30_000;

interface GitResult {
  ok: boolean;
  stdout: string;
  stderr: string;
}

/**
 * `git status` on a checkout with a large untracked tree (a stray node_modules,
 * a build output directory) can far exceed execFile's 1 MB default, and an
 * overflowed buffer surfaces as a command failure. That must not be mistaken
 * for a clean tree — see countDirtyFiles.
 */
const MAX_GIT_OUTPUT_BYTES = 16 * 1024 * 1024;

async function git(cwd: string, args: string[], timeout = GIT_TIMEOUT_MS): Promise<GitResult> {
  try {
    const { stdout, stderr } = await execFileAsync('git', args, {
      cwd,
      encoding: 'utf-8',
      timeout,
      maxBuffer: MAX_GIT_OUTPUT_BYTES,
    });
    return { ok: true, stdout: stdout.trim(), stderr: stderr.trim() };
  } catch (error) {
    const err = error as { stdout?: string; stderr?: string; message?: string };
    return {
      ok: false,
      stdout: (err.stdout ?? '').trim(),
      stderr: (err.stderr ?? err.message ?? '').trim(),
    };
  }
}

/** The branch's configured remote + remote branch name, when it tracks one. */
interface UpstreamInfo {
  /** Abbreviated tracking ref, e.g. `origin/feature/pan-3331`. */
  ref: string;
  /** Remote name, e.g. `origin`. */
  remote: string;
  /** Branch name on the remote, e.g. `feature/pan-3331`. */
  remoteBranch: string;
}

async function resolveUpstream(cwd: string, branch: string): Promise<UpstreamInfo | null> {
  const ref = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}']);
  if (!ref.ok || !ref.stdout) return null;

  const remote = await git(cwd, ['config', '--get', `branch.${branch}.remote`]);
  const merge = await git(cwd, ['config', '--get', `branch.${branch}.merge`]);
  if (!remote.ok || !remote.stdout) return null;

  const remoteBranch = merge.ok && merge.stdout
    ? merge.stdout.replace(/^refs\/heads\//, '')
    : branch;

  return { ref: ref.stdout, remote: remote.stdout, remoteBranch };
}

/** Does `origin/HEAD` resolve? Used as the fallback comparison ref. */
async function originHeadRef(cwd: string): Promise<string | null> {
  const result = await git(cwd, ['rev-parse', '--verify', '--quiet', 'origin/HEAD']);
  return result.ok && result.stdout ? 'origin/HEAD' : null;
}

/**
 * Dirty-file count, or null when git could not tell us. The distinction
 * matters: the pull guard must refuse on "unknown" rather than assume clean,
 * or a checkout whose status output failed — an overflowed buffer, a broken
 * index — would sail past the dirty-tree refusal the whole feature advertises.
 *
 * Line-counted rather than NUL-delimited on purpose. `--porcelain` C-quotes any
 * path with a special character, so no literal newline ever reaches this
 * output, and one line is one entry — whereas `-z` emits a rename as two
 * NUL-separated paths and would count it twice.
 */
async function countDirtyFiles(cwd: string): Promise<number | null> {
  const status = await git(cwd, ['status', '--porcelain']);
  if (!status.ok) return null;
  if (!status.stdout) return 0;
  return status.stdout.split('\n').filter((line) => line.length > 0).length;
}

async function countAheadBehind(cwd: string, ref: string): Promise<{ ahead: number; behind: number }> {
  const result = await git(cwd, ['rev-list', '--left-right', '--count', `HEAD...${ref}`]);
  if (!result.ok) return { ahead: 0, behind: 0 };
  const [left, right] = result.stdout.split(/\s+/);
  return {
    ahead: Number.parseInt(left ?? '0', 10) || 0,
    behind: Number.parseInt(right ?? '0', 10) || 0,
  };
}

async function listRemoteCommits(cwd: string, ref: string): Promise<RemoteCommit[]> {
  const format = ['%H', '%s', '%an', '%aI'].join(UNIT_SEP);
  const result = await git(cwd, [
    'log',
    `HEAD..${ref}`,
    `--format=${format}`,
    `-n`,
    String(REMOTE_COMMIT_LIMIT),
  ]);
  if (!result.ok || !result.stdout) return [];
  return result.stdout
    .split('\n')
    .filter((line) => line.length > 0)
    .map((line) => {
      const [sha, subject, author, date] = line.split(UNIT_SEP);
      return {
        sha: sha ?? '',
        subject: subject ?? '',
        author: author ?? '',
        date: date ?? '',
      };
    })
    .slice(0, REMOTE_COMMIT_LIMIT);
}

/**
 * Read the checkout's git state. Pass `{ fetch: true }` to refresh remote-tracking
 * refs first — callers are responsible for rate-limiting that (the dashboard route
 * holds a per-path last-fetch map).
 */
export async function getWorkspaceGitState(
  workspacePath: string,
  options: { fetch?: boolean } = {},
): Promise<WorkspaceGitState> {
  const headRef = await git(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  const detached = !headRef.ok || headRef.stdout === 'HEAD' || headRef.stdout === '';
  const branch = detached ? null : headRef.stdout;

  const upstream = branch ? await resolveUpstream(workspacePath, branch) : null;

  let fetchedAt: number | null = null;
  if (options.fetch) {
    const args = upstream
      ? ['fetch', upstream.remote, upstream.remoteBranch]
      : ['fetch', 'origin'];
    const fetched = await git(workspacePath, args, FETCH_TIMEOUT_MS);
    if (fetched.ok) fetchedAt = Date.now();
  }

  const comparisonRef = upstream?.ref ?? (await originHeadRef(workspacePath));

  const [dirtyFiles, counts, recentRemoteCommits] = await Promise.all([
    countDirtyFiles(workspacePath),
    comparisonRef ? countAheadBehind(workspacePath, comparisonRef) : Promise.resolve({ ahead: 0, behind: 0 }),
    comparisonRef ? listRemoteCommits(workspacePath, comparisonRef) : Promise.resolve([]),
  ]);

  return {
    branch,
    detached,
    // The card has no honest way to render "unknown", and it is only a display
    // number here — the pull guard reads the raw value and refuses on null.
    dirtyFiles: dirtyFiles ?? 0,
    ahead: counts.ahead,
    behind: counts.behind,
    hasUpstream: upstream !== null,
    upstreamRef: comparisonRef,
    recentRemoteCommits,
    fetchedAt,
  };
}

const NOT_FAST_FORWARD = /not possible to fast-forward|non-fast-forward|diverging branches|need to specify how to reconcile/i;

/**
 * Fast-forward the checkout onto its upstream. Never throws and never merges:
 * every unsafe condition comes back as a typed refusal the UI renders verbatim.
 */
export async function pullWorkspaceFastForward(workspacePath: string): Promise<PullResult> {
  const headRef = await git(workspacePath, ['rev-parse', '--abbrev-ref', 'HEAD']);
  if (!headRef.ok || headRef.stdout === 'HEAD' || headRef.stdout === '') {
    return { ok: false, reason: 'detached', detail: 'HEAD is detached — check out a branch before pulling.' };
  }
  const branch = headRef.stdout;

  const upstream = await resolveUpstream(workspacePath, branch);
  if (!upstream) {
    return {
      ok: false,
      reason: 'no-upstream',
      detail: `Branch ${branch} has no upstream configured.`,
    };
  }

  const dirtyFiles = await countDirtyFiles(workspacePath);
  // Fail closed on "git could not tell us". Treating an unreadable status as
  // clean would fast-forward over uncommitted work — the exact thing the dirty
  // refusal exists to prevent.
  if (dirtyFiles === null) {
    return {
      ok: false,
      reason: 'dirty',
      detail: 'Could not read the working tree status — refusing to pull over possible uncommitted work.',
    };
  }
  if (dirtyFiles > 0) {
    return {
      ok: false,
      reason: 'dirty',
      detail: `${dirtyFiles} uncommitted file${dirtyFiles === 1 ? '' : 's'} — commit or discard before pulling.`,
    };
  }

  try {
    // abortMerge: false — an in-flight merge/rebase is a refusal, never something we clean up.
    await ensureSyncGitQuiescent(workspacePath, false);
  } catch (error) {
    return {
      ok: false,
      reason: 'operation-in-progress',
      detail: error instanceof Error ? error.message : String(error),
    };
  }

  const pulled = await git(
    workspacePath,
    ['pull', '--ff-only', upstream.remote, upstream.remoteBranch],
    FETCH_TIMEOUT_MS,
  );
  if (!pulled.ok) {
    const output = `${pulled.stderr}\n${pulled.stdout}`;
    if (NOT_FAST_FORWARD.test(output)) {
      return {
        ok: false,
        reason: 'not-fast-forward',
        detail: `${branch} has diverged from ${upstream.ref} — resolve it in a terminal.`,
      };
    }
    return { ok: false, reason: 'error', detail: pulled.stderr || 'git pull failed' };
  }

  return { ok: true, state: await getWorkspaceGitState(workspacePath) };
}
