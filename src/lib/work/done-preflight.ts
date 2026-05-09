import { existsSync, readFileSync, readdirSync } from 'fs';
import { join } from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import { getVBriefACStatus, syncBeadStatusToVBrief } from '../vbrief/beads.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const BD_LIST_TIMEOUT_MS = 10_000;

function errorCode(error: unknown): unknown {
  return error instanceof Error
    ? (error as unknown as Record<string, unknown>).code
    : undefined;
}

function isMissingCommand(error: unknown): boolean {
  const code = errorCode(error);
  return code === 'ENOENT' || code === 127;
}

function isTimeout(error: unknown): boolean {
  if (!(error instanceof Error)) return false;
  const record = error as unknown as Record<string, unknown>;
  return record.killed === true ||
    record.signal === 'SIGTERM' ||
    record.signal === 'SIGKILL' ||
    /timed out|timeout/i.test(error.message);
}

async function listBeadsByStatus(
  workspacePath: string,
  issueId: string,
  status: 'open' | 'closed',
): Promise<string> {
  const jsonlPath = join(workspacePath, '.beads', 'issues.jsonl');
  if (existsSync(jsonlPath)) {
    const label = issueId.toLowerCase();
    const beads = readFileSync(jsonlPath, 'utf-8')
      .split('\n')
      .filter((line) => line.trim().length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>)
      .filter((bead) => bead.status === status)
      .filter((bead) => Array.isArray(bead.labels) && bead.labels.map(String).includes(label));
    return JSON.stringify(beads);
  }

  const { stdout } = await execFileAsync(
    'bd',
    ['list', '--status', status, '-l', issueId.toLowerCase(), '--limit', '0', '--json'],
    {
      cwd: workspacePath,
      encoding: 'utf-8',
      timeout: BD_LIST_TIMEOUT_MS,
      killSignal: 'SIGKILL',
    },
  );
  return stdout;
}

/**
 * Check for open beads scoped to the given issue.
 *
 * Returns an array of failure lines (empty = pass).
 */
export async function checkOpenBeads(workspacePath: string, issueId: string): Promise<string[]> {
  let stdout: string;
  try {
    stdout = await listBeadsByStatus(workspacePath, issueId, 'open');
  } catch (error: unknown) {
    if (isMissingCommand(error)) return [];
    if (isTimeout(error)) {
      console.warn(chalk.yellow(`  ⚠ Beads open-work check timed out after ${BD_LIST_TIMEOUT_MS / 1000}s; continuing without the bead gate`));
      return [];
    }
    return ['  Open beads check failed — run `bd list --status open` to diagnose'];
  }

  let beads: unknown;
  try {
    beads = JSON.parse(stdout);
  } catch {
    return ['  Open beads check produced invalid output — run `bd list --status open` to diagnose'];
  }

  if (!Array.isArray(beads) || beads.length === 0) return [];

  const lines: string[] = [`  Open beads (${beads.length}):`];
  for (const bead of beads as Array<Record<string, unknown>>) {
    const id = String(bead.id ?? bead.beadId ?? '?');
    const task = String(bead.task ?? bead.subject ?? bead.title ?? 'untitled');
    lines.push(`    - ${id} ${task}`);
  }
  return lines;
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
 * 1. Check 1: open beads
 * 2. Check 2: uncommitted changes
 * 3. Sync closed bead statuses to vBRIEF (so Check 3 sees latest state).
 * 4. Check 3: vBRIEF acceptance criteria completion.
 *
 * Pure validation — no git mutations. The caller (pan done) is responsible for
 * committing any planning artifacts dirtied by the sync step.
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
    const stdout = await listBeadsByStatus(workspacePath, issueId, 'closed');
    const closedBeads = JSON.parse(stdout || '[]');
    let synced = 0;
    for (const bead of closedBeads) {
      if (bead.id) {
        const itemId = await syncBeadStatusToVBrief(bead.id, workspacePath, 'completed', bead.title);
        if (itemId) synced++;
      }
    }
    if (synced > 0) {
      // eslint-disable-next-line no-console
      console.log(chalk.dim(`  Synced ${synced} closed bead(s) to vBRIEF AC status`));
    }
  } catch {
    // Non-fatal — sync failure shouldn't block completion check
  }

  // Check 3: vBRIEF AC status
  const acFailures = checkVBriefACStatus(workspacePath);
  failures.push(...acFailures);

  return failures;
}
