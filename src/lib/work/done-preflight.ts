import { existsSync, readdirSync } from 'fs';
import { readFile } from 'fs/promises';
import { join } from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import chalk from 'chalk';
import { Effect } from 'effect';
import { ProcessSpawnError } from '../errors.js';
import { getVBriefACStatusSync, syncBeadStatusToVBrief } from '../vbrief/beads.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

const BD_LIST_TIMEOUT_MS = 10_000;

type BeadRecord = Record<string, unknown>;

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

async function readIssueBeadsFromJsonl(workspacePath: string, issueId: string): Promise<BeadRecord[] | null> {
  const jsonlPath = join(workspacePath, '.beads', 'issues.jsonl');
  if (!existsSync(jsonlPath)) return null;

  const label = issueId.toLowerCase();
  return (await readFile(jsonlPath, 'utf-8'))
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as BeadRecord)
    .filter((bead) => Array.isArray(bead.labels) && bead.labels.map(String).includes(label));
}

async function listBeadsByStatus(
  workspacePath: string,
  issueId: string,
  status: 'open' | 'closed',
  preloadedBeads?: BeadRecord[] | null,
): Promise<string> {
  if (preloadedBeads !== undefined && preloadedBeads !== null) {
    return JSON.stringify(preloadedBeads.filter((bead) => bead.status === status));
  }

  try {
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
  } catch (error) {
    if (!isMissingCommand(error) && !isTimeout(error)) throw error;
    const jsonlBeads = await readIssueBeadsFromJsonl(workspacePath, issueId);
    if (jsonlBeads !== null) {
      return JSON.stringify(jsonlBeads.filter((bead) => bead.status === status));
    }
    throw error;
  }
}async function checkOpenBeadsPromise(workspacePath: string, issueId: string, preloadedBeads?: BeadRecord[] | null): Promise<string[]> {
  let stdout: string;
  try {
    stdout = await listBeadsByStatus(workspacePath, issueId, 'open', preloadedBeads);
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
}async function checkUncommittedChangesPromise(workspacePath: string): Promise<string[]> {
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
export function checkVBriefACStatusSync(workspacePath: string): string[] {
  try {
    const acStatus = getVBriefACStatusSync(workspacePath);
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
}async function runPreflightChecksPromise(workspacePath: string, issueId: string): Promise<string[]> {
  const failures: string[] = [];

  // Check 1: Open beads
  const beadFailures = await Effect.runPromise(checkOpenBeads(workspacePath, issueId));
  failures.push(...beadFailures);

  // Check 2: Uncommitted changes
  const gitFailures = await Effect.runPromise(checkUncommittedChanges(workspacePath));
  failures.push(...gitFailures);

  // Sync closed beads to vBRIEF before AC check
  try {
    const stdout = await listBeadsByStatus(workspacePath, issueId, 'closed');
    const closedBeads = JSON.parse(stdout || '[]');
    let synced = 0;
    for (const bead of closedBeads) {
      if (bead.id) {
        const itemId = await Effect.runPromise(syncBeadStatusToVBrief(bead.id, workspacePath, 'completed', bead.title));
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
  const acFailures = checkVBriefACStatusSync(workspacePath);
  failures.push(...acFailures);

  return failures;
}

// ─── Effect variants (PAN-1249) ───────────────────────────────────────────────
// Additive Effect wrappers around the public preflight checks. Each variant
// preserves the existing "soft-failure" semantics — the original functions
// already swallow errors and return failure-line arrays, so the Effect
// channel for these is effectively `never` for the bead / git checks. The
// `runPreflightChecks` wrapper surfaces a `ProcessSpawnError` only if its
// underlying `bd` invocation throws something the inner catch missed (which
// today it does not, but we keep the typed channel for future hardening).

const toPreflightProcessError = (
  op: string,
  cause: unknown,
): ProcessSpawnError =>
  new ProcessSpawnError({
    command: 'done-preflight',
    args: [op],
    message: cause instanceof Error ? cause.message : String(cause),
    cause,
  });

/** Check for open beads scoped to an issue (Effect variant). */
export const checkOpenBeads = (
  workspacePath: string,
  issueId: string,
): Effect.Effect<string[], ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => checkOpenBeadsPromise(workspacePath, issueId),
    catch: (cause) => toPreflightProcessError('checkOpenBeads', cause),
  });

/** Check for uncommitted changes in a workspace (Effect variant). */
export const checkUncommittedChanges = (
  workspacePath: string,
): Effect.Effect<string[], ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => checkUncommittedChangesPromise(workspacePath),
    catch: (cause) => toPreflightProcessError('checkUncommittedChanges', cause),
  });

/** Check vBRIEF acceptance-criteria status (Effect variant — pure, never fails). */
export const checkVBriefACStatus = (
  workspacePath: string,
): Effect.Effect<string[]> =>
  Effect.sync(() => checkVBriefACStatusSync(workspacePath));

/** Run all `pan done` pre-flight checks (Effect variant). */
export const runPreflightChecks = (
  workspacePath: string,
  issueId: string,
): Effect.Effect<string[], ProcessSpawnError> =>
  Effect.tryPromise({
    try: () => runPreflightChecksPromise(workspacePath, issueId),
    catch: (cause) => toPreflightProcessError('runPreflightChecks', cause),
  });
