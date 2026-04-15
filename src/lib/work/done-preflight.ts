import { existsSync, readdirSync } from 'fs';
import { join } from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { getVBriefACStatus, syncBeadStatusToVBrief } from '../vbrief/beads.js';

const execAsync = promisify(exec);

/**
 * Check for open beads scoped to the given issue.
 *
 * Returns an array of failure lines (empty = pass).
 */
export async function checkOpenBeads(workspacePath: string, issueId: string): Promise<string[]> {
  try {
    const { stdout } = await execAsync(
      `bd list --status open -l "${issueId.toLowerCase()}" --limit 0 --json`,
      { cwd: workspacePath }
    );
    const beads = JSON.parse(stdout);
    if (!Array.isArray(beads) || beads.length === 0) return [];

    const lines: string[] = [`  Open beads (${beads.length}):`];
    for (const bead of beads) {
      const id = bead.id || bead.beadId || '?';
      const task = bead.task || bead.subject || bead.title || 'untitled';
      lines.push(`    - ${id} ${task}`);
    }
    return lines;
  } catch {
    // beads CLI not installed or not a beads workspace — skip check
    return [];
  }
}

/**
 * Check for uncommitted changes in a workspace.
 *
 * Handles both monorepo (single top-level .git) and polyrepo (subdirs with .git).
 * Returns an array of failure lines (empty = pass).
 */
export async function checkUncommittedChanges(workspacePath: string): Promise<string[]> {
  const hasTopLevelGit = existsSync(join(workspacePath, '.git'));

  if (hasTopLevelGit) {
    // Monorepo — single git status check
    try {
      const { stdout } = await execAsync('git status --porcelain', { cwd: workspacePath });
      if (!stdout.trim()) return [];

      const lines: string[] = ['  Uncommitted changes:'];
      for (const line of stdout.trim().split('\n')) {
        lines.push(`    ${line}`);
      }
      return lines;
    } catch {
      return [];
    }
  } else {
    // Polyrepo — check each subdir that has a .git file/dir
    const failures: string[] = [];
    try {
      const entries = readdirSync(workspacePath, { withFileTypes: true });
      for (const entry of entries) {
        if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
        const subPath = join(workspacePath, entry.name);
        if (!existsSync(join(subPath, '.git'))) continue;

        try {
          const { stdout } = await execAsync('git status --porcelain', { cwd: subPath });
          if (stdout.trim()) {
            failures.push(`  Uncommitted changes in ${entry.name}/:`);
            for (const line of stdout.trim().split('\n')) {
              failures.push(`    ${line}`);
            }
          }
        } catch {
          // skip this sub-repo
        }
      }
    } catch {
      // can't read workspace dir — skip
    }
    return failures;
  }
}

/**
 * Check vBRIEF acceptance criteria completion status.
 *
 * Returns an array of failure lines (empty = pass or vBRIEF not available).
 * NOTE: Call syncBeadStatusToVBrief before this to ensure closed beads are reflected.
 */
export function checkVBriefACStatus(workspacePath: string): string[] {
  try {
    const acStatus = getVBriefACStatus(workspacePath);
    if (!acStatus || acStatus.allCompleted) return [];

    const lines: string[] = [
      `  Incomplete acceptance criteria (${acStatus.totalPending}/${acStatus.totalCount}):`,
    ];
    for (const item of acStatus.items) {
      if (item.pending > 0) {
        for (const ac of item.criteria) {
          if (ac.status !== 'completed' && ac.status !== 'cancelled') {
            lines.push(`    - [ ] ${ac.title} (${item.itemTitle})`);
          }
        }
      }
    }
    return lines;
  } catch {
    // vBRIEF not available — skip check
    return [];
  }
}

/**
 * Run all pre-flight checks for `pan done`.
 *
 * Performs in order:
 * 1. Auto-commit any .planning/ artifacts dirtied by a prior pan-done run (so
 *    they don't surface as uncommitted changes in Check 2).
 * 2. Check 1: open beads
 * 3. Check 2: uncommitted changes
 * 4. Sync closed bead statuses to vBRIEF (so Check 3 sees latest state).
 * 5. Auto-commit .planning/ artifacts dirtied by the sync above.
 * 6. Check 3: vBRIEF acceptance criteria completion.
 *
 * Returns an array of failure lines (empty = all checks passed).
 */
export async function runPreflightChecks(workspacePath: string, issueId: string): Promise<string[]> {
  // Auto-commit .planning/ before the uncommitted-changes check.
  // plan.vbrief.json can be modified by a previous invocation of `pan done`
  // (vBRIEF sync) and left dirty if that run failed. Commit it so Check 2
  // doesn't block on workspace-internal state that this command manages.
  try {
    const { stdout: preDirty } = await execAsync('git status --porcelain .planning/', { cwd: workspacePath, encoding: 'utf-8' });
    if (preDirty.trim()) {
      await execAsync('git add .planning/', { cwd: workspacePath });
      await execAsync('git commit -m "chore: sync planning artifacts" --allow-empty-message', { cwd: workspacePath }).catch(() =>
        execAsync('git commit -m "chore: sync planning artifacts"', { cwd: workspacePath })
      );
    }
  } catch { /* non-fatal */ }

  const failures: string[] = [];

  // Check 1: Open beads
  const beadFailures = await checkOpenBeads(workspacePath, issueId);
  failures.push(...beadFailures);

  // Check 2: Uncommitted changes
  const gitFailures = await checkUncommittedChanges(workspacePath);
  failures.push(...gitFailures);

  // Sync closed beads to vBRIEF before AC check
  try {
    const { stdout } = await execAsync(
      `bd list --status closed -l "${issueId.toLowerCase()}" --json --limit 0`,
      { cwd: workspacePath, encoding: 'utf-8' }
    );
    const closedBeads = JSON.parse(stdout || '[]');
    let synced = 0;
    for (const bead of closedBeads) {
      if (bead.id) {
        const itemId = syncBeadStatusToVBrief(bead.id, workspacePath, 'completed', bead.title);
        if (itemId) synced++;
      }
    }
    if (synced > 0) {
      // eslint-disable-next-line no-console
      console.log(`  Synced ${synced} closed bead(s) to vBRIEF AC status`);
    }
  } catch {
    // Non-fatal — sync failure shouldn't block completion check
  }

  // Auto-commit .planning/ artifacts dirtied by the vBRIEF sync above.
  try {
    const { stdout: afterSyncDirty } = await execAsync('git status --porcelain .planning/', { cwd: workspacePath, encoding: 'utf-8' });
    if (afterSyncDirty.trim()) {
      await execAsync('git add .planning/', { cwd: workspacePath });
      await execAsync('git commit -m "chore: sync planning artifacts"', { cwd: workspacePath });
    }
  } catch { /* non-fatal */ }

  // Check 3: vBRIEF AC status
  const acFailures = checkVBriefACStatus(workspacePath);
  failures.push(...acFailures);

  return failures;
}
