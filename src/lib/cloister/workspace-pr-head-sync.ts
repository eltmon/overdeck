/**
 * Workspace branch sync for verification (PAN-4810).
 *
 * Verification used to merge `origin/<target>` into the workspace as it stood.
 * That assumed the work agent commits in the workspace, so the workspace holds
 * the newest copy of the branch. Commits also reach a PR from elsewhere: a
 * handoff worktree, the merge train's sibling rebase, a GitHub suggestion. Then
 * verification checked a tree that was not the PR head, and the review push
 * after a pass was not a fast-forward, so no review followed.
 *
 * `syncWorkspaceToPrHead` runs first, per repo root, and brings the workspace
 * to `origin/<source>`:
 *
 *   - At the PR head, or ahead of it (unpushed commits or merges): no move.
 *   - Behind it: fast-forward.
 *   - Its only local-only commits are machine merges (no non-merge commit
 *     outside `origin/<source>` and `origin/<target>`): reset to the PR head.
 *     A dirty tracked tree refuses instead, because a reset would destroy it.
 *   - Both sides have real commits: refuse. The refusal becomes a failed
 *     `sync-target-branch` check routed to the agent; nothing verifies silently.
 *
 * A root on another branch (detached, untouched polyrepo sub-repo) or whose
 * branch is not on origin yet is left as it is. A move is journaled as
 * `workspace.synced-to-pr-head`.
 *
 * `syncSingleRepo` (the merge of `origin/<target>`) lives here too.
 */
import { exec, execFile } from 'child_process';
import { basename } from 'path';
import { promisify } from 'util';

import { resolveWorkspaceRepoRoots, type WorkspaceRepoRoot } from '../project-repos.js';
import { appendPipelineEntry } from './pipeline-journal.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

export interface SyncResult {
  repoDir: string;
  repoName: string;
  targetBranch: string;
  success: boolean;
  alreadyUpToDate?: boolean;
  hasConflicts?: boolean;
  conflictLines?: string;
  errorOutput?: string;
}

export async function syncSingleRepo(gitDir: string, targetBranch: string): Promise<SyncResult> {
  const repoName = basename(gitDir);
  try {
    await execAsync(`git fetch origin ${targetBranch}`, { cwd: gitDir, encoding: 'utf-8', timeout: 30000 });
    const mergeResult = await execAsync(`git merge origin/${targetBranch} --no-edit`, {
      cwd: gitDir,
      encoding: 'utf-8',
      timeout: 60000,
    });
    const mergeOut = (mergeResult.stdout || '') + (mergeResult.stderr || '');
    const alreadyUpToDate = mergeOut.includes('Already up to date') || mergeOut.includes('Already up-to-date');
    return { repoDir: gitDir, repoName, targetBranch, success: true, alreadyUpToDate };
  } catch (caught) {
    const mergeErr = caught as { stdout?: string; stderr?: string; message?: string };
    const mergeOut = (mergeErr.stdout || '') + (mergeErr.stderr || '');
    const hasConflicts = mergeOut.includes('CONFLICT') || mergeOut.includes('Merge conflict');

    if (hasConflicts) {
      try { await execAsync('git merge --abort', { cwd: gitDir, encoding: 'utf-8' }); } catch {}
      const conflictLines = mergeOut
        .split('\n')
        .filter((line: string) => line.startsWith('CONFLICT'))
        .map((line: string) => line.replace(/^CONFLICT \([^)]+\): /, '').replace(/Merge conflict in /, ''))
        .join('\n  - ');
      return { repoDir: gitDir, repoName, targetBranch, success: false, hasConflicts: true, conflictLines };
    }

    const rawOutput = mergeOut || mergeErr.message || '(no output)';
    const errorOutput = rawOutput.length > 3000 ? rawOutput.slice(0, 3000) + '\n...(truncated)' : rawOutput;
    return { repoDir: gitDir, repoName, targetBranch, success: false, errorOutput };
  }
}

export type PrHeadSync =
  | { kind: 'at-pr-head' }
  | { kind: 'ahead' }
  | { kind: 'not-on-branch'; current: string }
  | { kind: 'no-pr-branch' }
  | { kind: 'moved'; mode: 'fast-forward' | 'reset'; from: string; to: string }
  | { kind: 'refused'; reason: 'diverged' | 'dirty-workspace' | 'fetch-failed' | 'git-failed'; detail: string };

/** Runs git with argv in `cwd`; resolves trimmed stdout; rejects on a non-zero exit. */
export type PrHeadGit = (cwd: string, args: string[]) => Promise<string>;

const defaultGit: PrHeadGit = async (cwd, args) =>
  (await execFileAsync('git', args, { cwd, encoding: 'utf-8', timeout: 60_000 })).stdout.trim();

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

/** Bring one repo root to its PR head (`origin/<source>`), or say why not. Never throws. */
export async function syncWorkspaceToPrHead(
  dir: string,
  source: string,
  target: string,
  git: PrHeadGit = defaultGit,
): Promise<PrHeadSync> {
  try {
    const current = await git(dir, ['branch', '--show-current']);
    if (current !== source) return { kind: 'not-on-branch', current };
    try {
      await git(dir, ['fetch', 'origin', target, `+refs/heads/${source}:refs/remotes/origin/${source}`]);
    } catch (err) {
      const listed = await git(dir, ['ls-remote', '--heads', 'origin', source]).catch(() => null);
      if (listed === '') return { kind: 'no-pr-branch' };
      return { kind: 'refused', reason: 'fetch-failed', detail: `could not fetch ${source} from origin: ${errorMessage(err)}` };
    }
    const remote = `refs/remotes/origin/${source}`;
    const head = await git(dir, ['rev-parse', 'HEAD']);
    const prHead = await git(dir, ['rev-parse', remote]);
    if (head === prHead) return { kind: 'at-pr-head' };
    const isAncestor = (a: string, b: string) =>
      git(dir, ['merge-base', '--is-ancestor', a, b]).then(() => true, () => false);
    if (await isAncestor(remote, 'HEAD')) return { kind: 'ahead' };

    const behind = await isAncestor('HEAD', remote);
    if (!behind) {
      const localOnly = await git(dir, ['rev-list', '--no-merges', 'HEAD', `^${remote}`, `^refs/remotes/origin/${target}`]);
      if (localOnly) {
        const shas = localOnly.split('\n').map((sha) => sha.slice(0, 12));
        return {
          kind: 'refused',
          reason: 'diverged',
          detail: `the workspace and the PR head ${prHead.slice(0, 12)} both have commits the other lacks; `
            + `local-only commits: ${shas.join(', ')}. Push them to ${source} (merge origin/${source} first), `
            + 'or drop them, so the workspace matches the PR head.',
        };
      }
    }
    if (await git(dir, ['status', '--porcelain', '--untracked-files=no'])) {
      return {
        kind: 'refused',
        reason: 'dirty-workspace',
        detail: `the workspace is at ${head.slice(0, 12)}, the PR head is ${prHead.slice(0, 12)}, and the workspace has `
          + 'uncommitted changes to tracked files. Commit and push them, or discard them, so it can move to the PR head.',
      };
    }
    if (behind) await git(dir, ['merge', '--ff-only', remote]);
    else await git(dir, ['reset', '--hard', remote]);
    return { kind: 'moved', mode: behind ? 'fast-forward' : 'reset', from: head, to: prHead };
  } catch (err) {
    return { kind: 'refused', reason: 'git-failed', detail: `could not move to ${source}: ${errorMessage(err)}` };
  }
}

/**
 * Bring every repo root of the workspace to its PR head before verification.
 * Returns one failed `SyncResult` per refused root, for the runner's
 * `sync-target-branch` failure path. Never throws.
 */
export async function syncWorkspaceRootsToPrHead(
  issueId: string,
  workspacePath: string,
  logPrefix: string,
  deps: { roots?: WorkspaceRepoRoot[]; git?: PrHeadGit; journal?: typeof appendPipelineEntry } = {},
): Promise<SyncResult[]> {
  let roots: WorkspaceRepoRoot[];
  try {
    roots = deps.roots ?? resolveWorkspaceRepoRoots(issueId, workspacePath);
  } catch {
    return [];
  }
  const journal = deps.journal ?? appendPipelineEntry;
  const failures: SyncResult[] = [];
  for (const root of roots) {
    const outcome = await syncWorkspaceToPrHead(root.dir, root.sourceBranch, root.targetBranch, deps.git);
    const repoName = root.isPolyrepo ? root.repoKey : basename(root.dir);
    if (outcome.kind === 'moved') {
      console.log(`[${logPrefix}] ${repoName}: moved ${outcome.from.slice(0, 12)} → PR head ${outcome.to.slice(0, 12)} (${outcome.mode})`);
      journal(workspacePath, {
        type: 'workspace.synced-to-pr-head',
        issueId,
        source: logPrefix,
        data: { branch: root.sourceBranch, from: outcome.from, to: outcome.to, mode: outcome.mode, ...(root.isPolyrepo ? { repo: root.repoKey } : {}) },
      });
    } else if (outcome.kind === 'refused') {
      console.log(`[${logPrefix}] ${repoName}: not moved to the PR head (${outcome.reason}): ${outcome.detail}`);
      failures.push({
        repoDir: root.dir,
        repoName,
        targetBranch: root.sourceBranch,
        success: false,
        errorOutput: `Verification checks the PR head, and the workspace is not at it (${outcome.reason}): ${outcome.detail}`,
      });
    }
  }
  return failures;
}
