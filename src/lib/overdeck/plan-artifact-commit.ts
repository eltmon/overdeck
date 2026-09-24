/**
 * Committing `.pan/` artifacts (PAN-3917 W9).
 *
 * No daemon commits .pan/ behind your back, and there is no state branch.
 * Whoever writes a planning
 * artifact commits it, on the branch it belongs to: per-issue artifacts (spec
 * promotion, drafts, continue files) on the issue's feature branch inside the
 * issue workspace; project-level artifacts (order books, notes, the parked
 * list, the backlog sequence) on `main` in the project's plan home. The backlog
 * sequence and order-book verbs push that commit too (`pushPlanArtifacts`,
 * PAN-3923, #4108), so the plan home does not drift ahead of origin.
 *
 * Async git only — this runs from the CLI and from server-reachable code.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { relative, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

export interface CommitPlanArtifactsOptions {
  /** The checkout whose `.pan/` holds the artifacts (a workspace, or the plan home). */
  readonly cwd: string;
  /** Paths to stage. Absolute, or relative to `cwd`. Defaults to the whole `.pan/` tree. */
  readonly paths?: readonly string[];
  /** Commit subject. */
  readonly message: string;
}

export type CommitPlanArtifactsResult =
  | { readonly committed: true; readonly sha: string }
  | { readonly committed: false; readonly reason: string };

/** `chore(workspace): plan artifacts for PAN-1` — the subject the verbs use. */
export function planArtifactCommitMessage(issueId: string): string {
  return `chore(workspace): plan artifacts for ${issueId.toUpperCase()}`;
}

/**
 * Stage and commit `.pan/` artifacts. A clean tree is not a failure: it means
 * the artifact was already committed, and the caller carries on.
 */
export async function commitPlanArtifacts(
  options: CommitPlanArtifactsOptions,
): Promise<CommitPlanArtifactsResult> {
  const cwd = resolve(options.cwd);
  const pathspecs = (options.paths ?? ['.pan']).map((p) =>
    p.startsWith('/') ? relative(cwd, p) || '.' : p,
  );

  try {
    await execFileAsync('git', ['add', '--', ...pathspecs], { cwd });
    const { stdout: staged } = await execFileAsync(
      'git',
      ['diff', '--cached', '--name-only', '--', ...pathspecs],
      { cwd },
    );
    if (!staged.trim()) return { committed: false, reason: 'nothing to commit' };

    await execFileAsync('git', ['commit', '-m', options.message, '--only', '--', ...pathspecs], { cwd });
    const { stdout: sha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
    return { committed: true, sha: sha.trim() };
  } catch (cause) {
    // The staging above is ours; a failed commit must not leave it behind for
    // the next commit in the repo to pick up. The reset is pathspec-scoped, so
    // nothing outside the artifacts this call touched is unstaged.
    await execFileAsync('git', ['reset', '-q', '--', ...pathspecs], { cwd }).catch(() => {});
    const message = cause instanceof Error ? cause.message : String(cause);
    return { committed: false, reason: message.split('\n')[0] };
  }
}

export type PushPlanArtifactsResult =
  | {
      readonly pushed: true;
      /** The tip that landed on the remote. */
      readonly sha: string;
      /** True when origin had moved and the commits were replayed onto it. */
      readonly rebased: boolean;
      /** Set when the push landed but the local branch could not follow it. */
      readonly warning?: string;
    }
  | {
      readonly pushed: false;
      /** True when there was nothing to push to (no upstream, nothing ahead). */
      readonly skipped: boolean;
      readonly reason: string;
    };

const PUSH_TIMEOUT_MS = 120_000;

async function git(cwd: string, args: readonly string[], extraEnv: NodeJS.ProcessEnv = {}): Promise<string> {
  const { stdout } = await execFileAsync('git', [...args], {
    cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...extraEnv },
    timeout: PUSH_TIMEOUT_MS,
  });
  return stdout.trim();
}

function firstLine(cause: unknown): string {
  const err = cause as { stderr?: string; message?: string };
  const text = (err?.stderr || err?.message || String(cause)).trim();
  return text.split('\n').find((line) => line.trim())?.trim() ?? text;
}

/**
 * Push the plan-artifact commits a verb just made on the plan home's branch
 * (PAN-3923). Project-level artifacts such as the backlog sequence are
 * committed on `main` in the operator's checkout; unpushed, local main drifts
 * ahead of origin and the next release needs a rebase.
 *
 * It pushes only when every commit the branch has over its upstream touches
 * `.pan/` alone, so an unrelated local commit never rides along. When origin
 * has moved, it replays those commits onto the fetched upstream with git
 * plumbing (the operator's checkout is usually dirty, so a working-tree rebase
 * would refuse), pushes the replayed tip, and moves the branch onto it with
 * `reset --keep`, which carries uncommitted work across. It never forces,
 * never skips hooks, and reports a reason instead of throwing.
 */
export async function pushPlanArtifacts(cwdInput: string): Promise<PushPlanArtifactsResult> {
  const cwd = resolve(cwdInput);
  let branch: string;
  let upstream: string;
  try {
    branch = await git(cwd, ['symbolic-ref', '--short', 'HEAD']);
  } catch {
    return { pushed: false, skipped: true, reason: 'HEAD is detached' };
  }
  try {
    upstream = await git(cwd, ['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{upstream}']);
  } catch {
    return { pushed: false, skipped: true, reason: `${branch} has no upstream` };
  }
  const remote = await git(cwd, ['config', '--get', `branch.${branch}.remote`]).catch(() => upstream.split('/')[0]);
  const target = await git(cwd, ['config', '--get', `branch.${branch}.merge`]).catch(() => `refs/heads/${branch}`);

  try {
    await git(cwd, ['fetch', '--quiet', remote]);
  } catch (cause) {
    return { pushed: false, skipped: false, reason: `could not fetch ${remote}: ${firstLine(cause)}` };
  }

  let head: string;
  let onto: string;
  let local: string[];
  try {
    head = await git(cwd, ['rev-parse', 'HEAD']);
    onto = await git(cwd, ['rev-parse', upstream]);
    local = (await git(cwd, ['rev-list', '--reverse', `${onto}..${head}`])).split('\n').filter(Boolean);
    if (local.length === 0) return { pushed: false, skipped: true, reason: `${branch} is not ahead of ${upstream}` };

    const touched = (await git(cwd, ['log', '--format=', '--name-only', `${onto}..${head}`])).split('\n').filter(Boolean);
    const unrelated = [...new Set(touched.filter((path) => !path.startsWith('.pan/')))];
    if (unrelated.length > 0) {
      const sample = unrelated.slice(0, 3).join(', ') + (unrelated.length > 3 ? ', …' : '');
      return {
        pushed: false,
        skipped: false,
        reason: `${branch} has unpushed commits outside .pan/ (${sample}); not pushing them, push ${branch} by hand`,
      };
    }

    if ((await git(cwd, ['merge-base', onto, head])) === onto) {
      await git(cwd, ['push', '--quiet', remote, `${head}:${target}`]);
      return { pushed: true, sha: head, rebased: false };
    }
  } catch (cause) {
    return { pushed: false, skipped: false, reason: `could not push to ${upstream}: ${firstLine(cause)}` };
  }

  // Origin moved: replay the plan-artifact commits onto it without touching
  // the working tree, then push the replayed tip.
  let tip = onto;
  try {
    for (const commit of local) {
      let tree: string;
      try {
        tree = (await git(cwd, ['merge-tree', '--write-tree', `--merge-base=${commit}^`, tip, commit])).split('\n')[0];
      } catch {
        return {
          pushed: false,
          skipped: false,
          reason: `${commit.slice(0, 10)} conflicts with ${upstream}; rebase ${branch} onto it by hand`,
        };
      }
      const [name, email, date, ...body] = (await git(cwd, ['log', '-1', '--format=%an%n%ae%n%aI%n%B', commit])).split('\n');
      tip = await git(cwd, ['commit-tree', tree, '-p', tip, '-m', body.join('\n')], {
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: email,
        GIT_AUTHOR_DATE: date,
      });
    }
    await git(cwd, ['push', '--quiet', remote, `${tip}:${target}`]);
  } catch (cause) {
    return { pushed: false, skipped: false, reason: `could not push to ${upstream}: ${firstLine(cause)}` };
  }

  // The replayed commits are on the remote. Move the branch onto them only if
  // nothing committed meanwhile; `reset --keep` refuses rather than overwrite
  // an uncommitted change to a file the move would touch.
  const follow = `run git pull --rebase in ${cwd}`;
  try {
    if ((await git(cwd, ['rev-parse', 'HEAD'])) !== head) {
      return { pushed: true, sha: tip, rebased: true, warning: `pushed, but ${branch} moved meanwhile; ${follow}` };
    }
    await git(cwd, ['reset', '--quiet', '--keep', tip]);
  } catch (cause) {
    return {
      pushed: true,
      sha: tip,
      rebased: true,
      warning: `pushed, but could not move ${branch} onto the pushed commits (${firstLine(cause)}); ${follow}`,
    };
  }
  return { pushed: true, sha: tip, rebased: true };
}
