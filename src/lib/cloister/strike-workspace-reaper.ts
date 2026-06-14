/**
 * Strike workspace reaper (PAN-1882).
 *
 * Strikes bypass the normal pipeline — and its close-out workspace teardown —
 * so their `feature-<id>-strike` git worktrees + `strike/<id>` branches pile up
 * forever after the strike merges (27 / ~16GB observed 2026-06-14). The strike
 * role ends at "report the result" with no cleanup, and a strike can't easily
 * remove the worktree it is running in. This deacon reaper does it: each patrol
 * it removes a `strike/<id>` worktree when its branch is fully merged into
 * `origin/main` AND no live `strike-<id>` session exists.
 *
 * Safety: only `strike/*` worktrees are eligible (never `feature/*`, the active
 * pipeline); a worktree is reaped only when its branch is an ancestor of
 * origin/main (0 commits ahead — nothing unmerged is ever lost) and no live
 * strike session is using it.
 */

import { exec } from 'child_process';
import { promisify } from 'util';
import { emitActivityEntrySync } from '../activity-logger.js';
import { sessionExistsSync } from '../tmux.js';

const execAsync = promisify(exec);

interface WorktreeRecord {
  path: string;
  branch: string;
}

/** Parse `git worktree list --porcelain` into {path, branch} records. */
function parseWorktreePorcelain(porcelain: string): WorktreeRecord[] {
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

    // A live strike is using this worktree — leave it alone.
    if (sessionExistsSync(`strike-${issueId}`)) continue;

    // Reap only when the branch is fully merged (0 commits ahead of origin/main),
    // so unmerged strike work is never lost.
    let ahead: string;
    try {
      const { stdout } = await execAsync(
        `git rev-list --count origin/main..${branch}`,
        { cwd: projectRoot, encoding: 'utf-8' },
      );
      ahead = stdout.trim();
    } catch {
      continue; // can't determine merge state — leave it for a future patrol
    }
    if (ahead !== '0') continue; // has unmerged commits — never reap

    try {
      await execAsync(`git worktree remove ${JSON.stringify(path)} --force`, { cwd: projectRoot });
      // Branch is an ancestor of origin/main (verified above) — safe to delete.
      await execAsync(`git branch -D ${JSON.stringify(branch)}`, { cwd: projectRoot }).catch(() => {});
      const action = `Reaped merged strike workspace ${path} (branch ${branch})`;
      actions.push(action);
      console.log(`[deacon] ${action}`);
      emitActivityEntrySync({ source: 'cloister', level: 'info', message: `[deacon] ${action}` });
    } catch {
      // worktree busy / already gone — retry next patrol
    }
  }

  return actions;
}
