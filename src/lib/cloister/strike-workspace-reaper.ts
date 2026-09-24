/**
 * Strike workspace reaper (PAN-1882, PAN-2359) — the FALLBACK.
 *
 * A merged strike cleans up after itself: the merged-PR webhook runs
 * `finishStrike` (`strike-completion.ts`, PAN-3981), which stops the strike
 * agent through the terminal backend, removes the `feature-<id>-strike`
 * worktree and deletes the `strike/<id>` branch. This patrol catches what that
 * missed (a dropped webhook, a restart mid-run) and logs every reap as a miss,
 * so a completion path that stops working shows up.
 *
 * Each patrol it removes a `strike/<id>` worktree when its branch's content is
 * on `origin/main` AND the terminal backend confirms no live `strike-<id>`
 * agent. "On main" is squash-aware (`isStrikeBranchMerged`): strikes land by
 * squash merge, and a squashed branch stays commits-ahead of main forever.
 *
 * Safety: only `strike/*` worktrees are eligible (never `feature/*`, the active
 * pipeline); a worktree is reaped only when its branch AUTHORED commits
 * (walk-reflogs > 1) whose content is all on origin/main, and liveness answered
 * a confirmed death — an indeterminate probe never reaps. A freshly-created
 * strike branch sits at origin/main's HEAD with a single reflog entry, so the
 * reflog guard prevents reaping a workspace before the agent has committed.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { emitActivityEntry } from '../activity-logger.js';
import { isAlive, isConfirmedDead, type LivenessVerdict } from '../agents/liveness.js';
import { isStrikeBranchMerged, parseWorktreePorcelain } from './strike-completion.js';

const execAsync = promisify(exec);

export async function reapMergedStrikeWorkspaces(projectRoot: string = process.cwd()): Promise<string[]> {
  const actions: string[] = [];

  let porcelain: string;
  try {
    const { stdout } = await execAsync('git worktree list --porcelain', { cwd: projectRoot, encoding: 'utf-8' });
    porcelain = stdout;
  } catch {
    return actions; // not a git repo / no worktrees — nothing to do
  }

  for (const { path, branch } of parseWorktreePorcelain(porcelain)) {
    if (!branch.startsWith('strike/')) continue; // strike worktrees only — never feature/*
    const issueId = branch.slice('strike/'.length); // e.g. "pan-1864"
    if (!issueId) continue;

    // A live strike is using this worktree — leave it alone. Ask the selected
    // terminal backend: on Herdr a strike has no tmux session, so a tmux probe
    // would call every live strike dead. Only a confirmed death reaps.
    const verdict = await isAlive(`strike-${issueId}`).catch(
      (): LivenessVerdict => ({ alive: false, reason: 'runtime-indeterminate' }),
    );
    if (!isConfirmedDead(verdict)) continue;

    // Reap only when the branch's content is on origin/main (squash-aware), so
    // unmerged strike work is never lost.
    const merged = await isStrikeBranchMerged(projectRoot, branch);
    if (!merged.merged) continue;

    // A fresh strike branch is created at origin/main's HEAD and is also
    // 0 commits ahead, but it has not authored any commits yet. Only reap
    // branches that actually authored commits and are now fully merged.
    let reflogCount: number;
    try {
      const { stdout } = await execAsync(
        `git rev-list --walk-reflogs --count ${JSON.stringify(branch)}`,
        { cwd: projectRoot, encoding: 'utf-8' },
      );
      reflogCount = Number(stdout.trim());
      if (Number.isNaN(reflogCount)) continue;
    } catch {
      continue; // can't determine authorship — leave it for a future patrol
    }
    if (reflogCount <= 1) continue; // never-committed branch (fresh strike) — don't reap

    try {
      await execAsync(`git worktree remove ${JSON.stringify(path)} --force`, { cwd: projectRoot });
      // Branch content is on origin/main (verified above) — safe to delete.
      await execAsync(`git branch -D ${JSON.stringify(branch)}`, { cwd: projectRoot }).catch(() => {});
      const action = `Reaped merged strike workspace ${path} (branch ${branch}; ${merged.reason}) — `
        + 'strike completion (finishStrike) should have cleaned this up when the PR merged';
      actions.push(action);
      console.warn(`[deacon] ${action}`);
      emitActivityEntry({ source: 'cloister', level: 'warn', message: `[deacon] ${action}` });
    } catch {
      // worktree busy / already gone — retry next patrol
    }
  }

  return actions;
}
