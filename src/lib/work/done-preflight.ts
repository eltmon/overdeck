import { existsSync } from 'fs';
import { readdirSync } from 'fs';
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
 * Syncs closed bead statuses to vBRIEF before running the AC check so the
 * plan sees the latest state.
 *
 * Returns an array of failure lines (empty = all checks passed).
 */
export async function runPreflightChecks(workspacePath: string, issueId: string): Promise<string[]> {
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
    for (const bead of closedBeads) {
      if (bead.id) {
        syncBeadStatusToVBrief(bead.id, workspacePath, 'completed', bead.title);
      }
    }
  } catch {
    // Non-fatal — sync failure shouldn't block completion check
  }

  // Check 3: vBRIEF AC status
  const acFailures = checkVBriefACStatus(workspacePath);
  failures.push(...acFailures);

  return failures;
}
