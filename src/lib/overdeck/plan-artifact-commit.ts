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
 * PAN-3923, #4108), so the plan home does not drift ahead of origin. Moving
 * the branch onto a pushed or already-landed tip can collide with an
 * untracked `.pan/` file the checkout never staged (PAN-4224); that file is
 * backed up rather than clobbered or stashed.
 *
 * Async git only — this runs from the CLI and from server-reachable code.
 */

import { execFile } from 'node:child_process';
import { access, mkdir, rename, rm, rmdir, writeFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { dirname, join, relative, resolve } from 'node:path';

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

/** An untracked `.pan/` file moved aside because it collided with a path `reset --keep` was about to start tracking. */
export interface PlanArtifactBackup {
  /** The path (relative to `cwd`) the file was moved aside from. */
  readonly path: string;
  /** Where its original bytes now live. */
  readonly backup: string;
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
      /** Untracked files moved aside before the move, whose bytes differed from what's now tracked. */
      readonly backedUp?: readonly PlanArtifactBackup[];
    }
  | {
      readonly pushed: false;
      /** True when there was nothing to push to (no upstream, nothing ahead). */
      readonly skipped: boolean;
      readonly reason: string;
      /** Untracked files moved aside before the move, whose bytes differed from what's now tracked. */
      readonly backedUp?: readonly PlanArtifactBackup[];
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

type FollowTipResult =
  | { readonly moved: true; readonly backedUp?: readonly PlanArtifactBackup[] }
  | { readonly moved: false; readonly headMoved: true }
  | { readonly moved: false; readonly headMoved: false; readonly cause: string };

/**
 * Move `cwd` onto `tip` with `reset --keep`, which carries uncommitted work
 * across but refuses to overwrite an untracked file that `tip` would start
 * tracking (PAN-4224: origin gained a `.pan/` file through a merge the
 * checkout never staged, e.g. a promoted draft). Any such colliding file is
 * moved aside first: deleted afterward if its bytes matched what's now
 * tracked, kept and reported in `backedUp` otherwise. If the reset still
 * fails for an unrelated reason, every moved-aside file is restored to where
 * it was. Never `git stash`, never `git clean`.
 */
async function followTip(cwd: string, head: string, tip: string): Promise<FollowTipResult> {
  if ((await git(cwd, ['rev-parse', 'HEAD'])) !== head) return { moved: false, headMoved: true };

  const added = (
    await git(cwd, ['diff', '--name-only', '--no-renames', '--diff-filter=A', '-z', 'HEAD', tip, '--', '.pan/'])
  )
    .split('\0')
    .filter(Boolean);
  const untracked = new Set(
    (await git(cwd, ['ls-files', '--others', '--exclude-standard', '-z', '--', '.pan/'])).split('\0').filter(Boolean),
  );
  const collisions = added.filter((path) => untracked.has(path));

  const backupRoot = join(cwd, '.overdeck', 'plan-artifact-backups');
  const stampDir = join(backupRoot, new Date().toISOString().replace(/[:.]/g, '-'));
  const staged: { readonly path: string; readonly backup: string; readonly identical: boolean }[] = [];

  for (const path of collisions) {
    const identical =
      (await git(cwd, ['hash-object', join(cwd, path)])) === (await git(cwd, ['rev-parse', `${tip}:${path}`]).catch(() => ''));
    const backup = join(stampDir, path);
    await mkdir(dirname(backup), { recursive: true });
    await rename(join(cwd, path), backup);
    staged.push({ path, backup, identical });
  }
  if (staged.length > 0) {
    const gitignore = join(backupRoot, '.gitignore');
    await access(gitignore).catch(() => writeFile(gitignore, '*\n', 'utf8'));
  }

  // rmdir only ever removes an empty directory, so walking up from a removed
  // file's directory and stopping at the first non-empty one is safe even
  // when a sibling backup under the same stamp is being kept.
  const removeEmptyAncestors = async (start: string): Promise<void> => {
    for (let dir = start; dir !== stampDir; dir = dirname(dir)) {
      try {
        await rmdir(dir);
      } catch {
        return;
      }
    }
  };

  try {
    await git(cwd, ['reset', '--quiet', '--keep', tip]);
  } catch (cause) {
    for (const { path, backup } of staged) {
      await rename(backup, join(cwd, path)).catch(() => {});
      await removeEmptyAncestors(dirname(backup));
    }
    return { moved: false, headMoved: false, cause: firstLine(cause) };
  }

  const backedUp: PlanArtifactBackup[] = [];
  for (const { path, backup, identical } of staged) {
    if (identical) {
      await rm(backup, { force: true }).catch(() => {});
      await removeEmptyAncestors(dirname(backup));
    } else {
      backedUp.push({ path, backup });
    }
  }
  if (staged.length > 0) await rmdir(stampDir).catch(() => {});

  return backedUp.length > 0 ? { moved: true, backedUp } : { moved: true };
}

/**
 * Push the plan-artifact commits a verb just made on the plan home's branch
 * (PAN-3923). Project-level artifacts such as the backlog sequence are
 * committed on `main` in the operator's checkout; unpushed, local main drifts
 * ahead of origin and the next release needs a rebase.
 *
 * It refuses outright when the branch holds a merge commit over its upstream.
 * Otherwise it only ever replays the commits upstream actually lacks: a
 * cherry-pick-equivalence check drops any local commit whose patch already
 * landed on upstream under a different sha (a squash merge of a prior push),
 * so replaying never produces an empty duplicate. It pushes only when every
 * remaining commit touches `.pan/` alone, so an unrelated local commit never
 * rides along. When origin has moved, it replays the remaining commits onto
 * the fetched upstream with git plumbing (the operator's checkout is usually
 * dirty, so a working-tree rebase would refuse), pushes the replayed tip, and
 * moves the branch onto it with `reset --keep`, which carries uncommitted
 * work across. If every local commit already landed, or the replay turns out
 * to be a no-op, it self-heals by moving the branch onto upstream without
 * pushing. It never forces, never skips hooks, and reports a reason instead
 * of throwing.
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

  const selfHeal = async (onto: string): Promise<PushPlanArtifactsResult> => {
    const result = await followTip(cwd, head, onto);
    if (!result.moved) {
      const reason = result.headMoved
        ? `${branch} moved meanwhile; run git pull --rebase in ${cwd}`
        : `could not move ${branch} onto ${upstream} (${result.cause}); run git pull --rebase in ${cwd}`;
      return { pushed: false, skipped: false, reason };
    }
    return {
      pushed: false,
      skipped: true,
      reason: `${branch} was already on ${upstream}; moved ${branch} onto it`,
      ...(result.backedUp ? { backedUp: result.backedUp } : {}),
    };
  };

  let head: string;
  let onto: string;
  let pending: string[];
  try {
    head = await git(cwd, ['rev-parse', 'HEAD']);
    onto = await git(cwd, ['rev-parse', upstream]);
    const local = (await git(cwd, ['rev-list', '--reverse', `${onto}..${head}`])).split('\n').filter(Boolean);
    if (local.length === 0) return { pushed: false, skipped: true, reason: `${branch} is not ahead of ${upstream}` };

    const merges = (await git(cwd, ['rev-list', '--merges', `${onto}..${head}`])).split('\n').filter(Boolean);
    if (merges.length > 0) {
      return {
        pushed: false,
        skipped: false,
        reason: `${branch} has merge commits over ${upstream}; not replaying them, push ${branch} by hand`,
      };
    }

    pending = (
      await git(cwd, ['rev-list', '--reverse', '--cherry-pick', '--right-only', '--no-merges', `${onto}...${head}`])
    )
      .split('\n')
      .filter(Boolean);
    if (pending.length === 0) return await selfHeal(onto);

    const touched = (await git(cwd, ['log', '--no-walk', '--format=', '--name-only', ...pending])).split('\n').filter(Boolean);
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

  // Origin moved: replay the plan-artifact commits it lacks onto it without
  // touching the working tree, then push the replayed tip.
  let tip = onto;
  let replayed = false;
  try {
    for (const commit of pending) {
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
      // The patch already landed under a different sha (e.g. a squash merge):
      // replaying it here would produce an empty, duplicate commit.
      if (tree === (await git(cwd, ['rev-parse', `${tip}^{tree}`]))) continue;
      const [name, email, date, ...body] = (await git(cwd, ['log', '-1', '--format=%an%n%ae%n%aI%n%B', commit])).split('\n');
      tip = await git(cwd, ['commit-tree', tree, '-p', tip, '-m', body.join('\n')], {
        GIT_AUTHOR_NAME: name,
        GIT_AUTHOR_EMAIL: email,
        GIT_AUTHOR_DATE: date,
      });
      replayed = true;
    }
    if (!replayed) return await selfHeal(onto);
    await git(cwd, ['push', '--quiet', remote, `${tip}:${target}`]);
  } catch (cause) {
    return { pushed: false, skipped: false, reason: `could not push to ${upstream}: ${firstLine(cause)}` };
  }

  // The replayed commits are on the remote. Move the branch onto them only if
  // nothing committed meanwhile; `reset --keep` refuses rather than overwrite
  // an uncommitted change to a file the move would touch.
  const follow = `run git pull --rebase in ${cwd}`;
  const result = await followTip(cwd, head, tip);
  if (!result.moved) {
    const warning = result.headMoved
      ? `pushed, but ${branch} moved meanwhile; ${follow}`
      : `pushed, but could not move ${branch} onto the pushed commits (${result.cause}); ${follow}`;
    return { pushed: true, sha: tip, rebased: true, warning };
  }
  return { pushed: true, sha: tip, rebased: true, ...(result.backedUp ? { backedUp: result.backedUp } : {}) };
}
