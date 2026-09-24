/**
 * Strike completion: a merged strike cleans up after itself (PAN-3981).
 *
 * A strike ends by opening a PR that the operator merges (PAN-3973). When the
 * PR merges, `finishStrike` stops the `strike-<id>` agent through the terminal
 * backend (Herdr pane close, tmux kill-session), removes the
 * `feature-<id>-strike` worktree and deletes the local `strike/<id>` branch.
 * The deacon strike-workspace reaper is the fallback for what this misses,
 * never the standard way a strike is tidied.
 *
 * The branch is deleted only when its content is on the base branch. Strikes
 * land by squash merge, and a squash commit has no parent link to the branch,
 * so `git merge-base --is-ancestor` can never see it. `isStrikeBranchMerged`
 * also asks `git merge-tree`: when merging the branch into the base changes
 * nothing, every change on the branch is already there. A commit made on the
 * branch after the PR merged fails that check, so its branch survives.
 */

import { exec } from 'child_process';
import { existsSync } from 'fs';
import { promisify } from 'util';
import { Effect } from 'effect';
import { emitActivityEntry } from '../activity-logger.js';

const execAsync = promisify(exec);

const DEFAULT_BASE_REF = 'origin/main';

function shellQuote(value: string): string {
  return `'${value.replace(/'/g, `'"'"'`)}'`;
}

export interface WorktreeRecord {
  path: string;
  branch: string;
}

/** Parse `git worktree list --porcelain` into {path, branch} records. */
export function parseWorktreePorcelain(porcelain: string): WorktreeRecord[] {
  const records: WorktreeRecord[] = [];
  let currentPath = '';
  for (const line of porcelain.split('\n')) {
    if (line.startsWith('worktree ')) {
      currentPath = line.slice('worktree '.length).trim();
    } else if (line.startsWith('branch ')) {
      const branch = line.slice('branch '.length).trim().replace(/^refs\/heads\//, '');
      if (currentPath) records.push({ path: currentPath, branch });
      currentPath = '';
    } else if (line.trim() === '') {
      currentPath = '';
    }
  }
  return records;
}

export interface StrikeMergeCheck {
  merged: boolean;
  reason: string;
}

/**
 * Squash-aware "is this branch's content on the base?" check.
 *
 * Merged when the branch is an ancestor of the base (merge commit or
 * fast-forward), or when `git merge-tree --write-tree <base> <branch>` yields
 * the base's own tree (squash or rebase merge). A conflict, a missing ref, or
 * any git failure answers "not merged", so a caller never deletes on doubt.
 *
 * A branch that has authored no commits is also "merged" by both tests; the
 * reaper guards that case with the reflog.
 */
export async function isStrikeBranchMerged(
  projectRoot: string,
  branch: string,
  baseRef: string = DEFAULT_BASE_REF,
): Promise<StrikeMergeCheck> {
  const opts = { cwd: projectRoot, encoding: 'utf-8' as const };
  try {
    await execAsync(`git merge-base --is-ancestor ${shellQuote(branch)} ${shellQuote(baseRef)}`, opts);
    return { merged: true, reason: `${branch} is an ancestor of ${baseRef}` };
  } catch {
    // Not an ancestor (or a missing ref): a squash merge still may have landed it.
  }
  try {
    const { stdout: merged } = await execAsync(
      `git merge-tree --write-tree ${shellQuote(baseRef)} ${shellQuote(branch)}`,
      opts,
    );
    const { stdout: base } = await execAsync(`git rev-parse ${shellQuote(`${baseRef}^{tree}`)}`, opts);
    const mergedTree = merged.split('\n')[0]?.trim();
    const baseTree = base.trim();
    if (mergedTree && mergedTree === baseTree) {
      return { merged: true, reason: `merging ${branch} into ${baseRef} changes nothing (squash-merged)` };
    }
    return { merged: false, reason: `${branch} has changes that are not on ${baseRef}` };
  } catch (err) {
    // merge-tree exits 1 on a conflict; a missing ref fails rev-parse.
    const message = err instanceof Error ? err.message.split('\n')[0] : String(err);
    return { merged: false, reason: `could not show ${branch} is on ${baseRef}: ${message}` };
  }
}

export interface FinishStrikeOptions {
  /** Who triggered completion, e.g. 'webhook'. */
  source: string;
  /** The PR's merged URL or number, for the journal. */
  prRef?: string;
}

export interface FinishStrikeResult {
  issueId: string;
  merged: StrikeMergeCheck;
  agentStopped: boolean;
  worktreeRemoved: boolean;
  branchDeleted: boolean;
  notes: string[];
}

/** Seams for tests. Production callers pass nothing. */
export interface FinishStrikeDeps {
  stopAgent?: (agentId: string) => Promise<void>;
  journal?: (issueId: string, data: Record<string, unknown>) => void | Promise<void>;
}

async function stopAgentDefault(agentId: string): Promise<void> {
  const { stopAgent } = await import('../agents/termination.js');
  await Effect.runPromise(stopAgent(agentId, 'system'));
}

/**
 * Journal `strike.landed` to the issue's feature workspace when it exists. The
 * strike worktree's own journal dies with the worktree, so it is not written.
 */
async function journalDefault(issueId: string, data: Record<string, unknown>): Promise<void> {
  const { getIssueWorkspacePath } = await import('../overdeck/issue-projects.js');
  const workspacePath = getIssueWorkspacePath(issueId);
  if (!workspacePath || !existsSync(workspacePath)) return;
  const { appendPipelineEntry } = await import('./pipeline-journal.js');
  appendPipelineEntry(workspacePath, {
    type: 'strike.landed',
    issueId: issueId.toUpperCase(),
    source: typeof data.source === 'string' ? data.source : 'strike-completion',
    data,
  });
}

async function strikeWorktreePath(projectRoot: string, branch: string): Promise<string | null> {
  try {
    const { stdout } = await execAsync('git worktree list --porcelain', { cwd: projectRoot, encoding: 'utf-8' });
    return parseWorktreePorcelain(stdout).find((record) => record.branch === branch)?.path ?? null;
  } catch {
    return null;
  }
}

async function localBranchExists(projectRoot: string, branch: string): Promise<boolean> {
  try {
    await execAsync(`git show-ref --verify --quiet ${shellQuote(`refs/heads/${branch}`)}`, { cwd: projectRoot });
    return true;
  } catch {
    return false;
  }
}

const _finishInFlight = new Map<string, Promise<FinishStrikeResult>>();

/**
 * Clean up a strike whose PR merged. Every step is idempotent: an absent pane,
 * worktree, or branch is skipped, and duplicate deliveries join the run already
 * in flight.
 *
 * 1. Stop `strike-<id>` through the terminal backend and write `stopped`.
 * 2. Remove the `strike/<id>` worktree unless it holds uncommitted changes to
 *    tracked files. Committed work survives on the branch.
 * 3. Delete `strike/<id>` only when `isStrikeBranchMerged` says its content is
 *    on the base branch.
 */
export function finishStrike(
  issueId: string,
  projectRoot: string,
  options: FinishStrikeOptions,
  deps: FinishStrikeDeps = {},
): Promise<FinishStrikeResult> {
  const key = issueId.toLowerCase();
  const inFlight = _finishInFlight.get(key);
  if (inFlight) return inFlight;
  const run = runFinishStrike(issueId, projectRoot, options, deps).finally(() => {
    _finishInFlight.delete(key);
  });
  _finishInFlight.set(key, run);
  return run;
}

async function runFinishStrike(
  issueId: string,
  projectRoot: string,
  options: FinishStrikeOptions,
  deps: FinishStrikeDeps,
): Promise<FinishStrikeResult> {
  const lower = issueId.toLowerCase();
  const agentId = `strike-${lower}`;
  const branch = `strike/${lower}`;
  const notes: string[] = [];
  const opts = { cwd: projectRoot, encoding: 'utf-8' as const };

  // 1. Stop the agent. The PR merged, so the strike's work is over.
  let agentStopped = false;
  try {
    await (deps.stopAgent ?? stopAgentDefault)(agentId);
    agentStopped = true;
  } catch (err) {
    notes.push(`could not stop ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  // The squash commit must be in the local base ref before merge-tree can see it.
  try {
    await execAsync('git fetch origin main', { ...opts, timeout: 60_000 });
  } catch {
    notes.push('git fetch origin main failed; using the last fetched origin/main');
  }

  const merged = await isStrikeBranchMerged(projectRoot, branch);

  // 2. Remove the worktree, unless it holds uncommitted tracked changes.
  let worktreeRemoved = false;
  const worktreePath = await strikeWorktreePath(projectRoot, branch);
  if (worktreePath) {
    let dirty = '';
    let statusUnknown = false;
    try {
      const { stdout } = await execAsync('git status --porcelain --untracked-files=no', { ...opts, cwd: worktreePath });
      dirty = stdout.trim();
    } catch (err) {
      // A vanished directory is handled by prune below; any other status failure
      // (index lock, permissions) means we cannot prove the tree is clean.
      if (existsSync(worktreePath)) {
        statusUnknown = true;
        notes.push(`kept ${worktreePath}: could not read its status (${err instanceof Error ? err.message.split('\n')[0] : String(err)})`);
      }
    }
    if (statusUnknown) {
      // Never force-remove a worktree whose cleanliness is unknown.
    } else if (dirty) {
      notes.push(`kept ${worktreePath}: it has uncommitted changes to tracked files`);
    } else {
      try {
        await execAsync(`git worktree remove --force ${shellQuote(worktreePath)}`, opts);
        worktreeRemoved = true;
      } catch (err) {
        if (!existsSync(worktreePath)) {
          await execAsync('git worktree prune', opts).catch(() => undefined);
          worktreeRemoved = true;
        } else {
          notes.push(`could not remove ${worktreePath}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
        }
      }
    }
  }

  // 3. Delete the branch only when its content is on main. git refuses to
  //    delete a branch that a worktree still has checked out.
  let branchDeleted = false;
  if (await localBranchExists(projectRoot, branch)) {
    if (!merged.merged) {
      notes.push(`kept ${branch}: ${merged.reason}`);
    } else if (worktreePath && !worktreeRemoved) {
      notes.push(`kept ${branch}: its worktree is still in place`);
    } else {
      try {
        await execAsync(`git branch -D ${shellQuote(branch)}`, opts);
        branchDeleted = true;
      } catch (err) {
        notes.push(`could not delete ${branch}: ${err instanceof Error ? err.message.split('\n')[0] : String(err)}`);
      }
    }
  }

  const result: FinishStrikeResult = { issueId: issueId.toUpperCase(), merged, agentStopped, worktreeRemoved, branchDeleted, notes };
  const summary = `Strike ${result.issueId} landed: agent ${agentStopped ? 'stopped' : 'not stopped'}, `
    + `worktree ${worktreeRemoved ? 'removed' : worktreePath ? 'kept' : 'absent'}, `
    + `branch ${branchDeleted ? 'deleted' : 'kept'}${notes.length > 0 ? ` (${notes.join('; ')})` : ''}`;
  console.log(`[strike-completion] ${summary}`);
  emitActivityEntry({
    source: 'cloister',
    level: notes.length > 0 ? 'warn' : 'info',
    message: `[strike-completion] ${summary}`,
    issueId: result.issueId,
  });

  try {
    await (deps.journal ?? journalDefault)(issueId, {
      reason: 'landed',
      source: options.source,
      sourceBranch: branch,
      ...(options.prRef ? { pr: options.prRef } : {}),
      merged: merged.reason,
      agentStopped,
      worktreeRemoved,
      branchDeleted,
    });
  } catch { /* journalling must never fail completion */ }

  return result;
}
