import { exec } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { ProcessSpawnError } from '../errors.js';
import { isOverdeckOwnedOnlyStatus } from '../state-plane.js';
import { readWorkspacePlanSync } from '../xbrief/io.js';
import { subItemsOf } from '../xbrief/types.js';
import { runTestRequirementCheck } from './test-requirement-gate.js';

const execAsync = promisify(exec);
const terminal = new Set(['completed', 'cancelled']);

export function checkIncompletePlanItemsSync(workspacePath: string): string[] {
  const doc = readWorkspacePlanSync(workspacePath);
  if (!doc) return ['  The required xBRIEF checklist is missing or unreadable; return the issue to planning before completion.'];
  const incomplete = doc.plan.items.flatMap((item) => {
    const lines: string[] = [];
    if (!terminal.has(item.status)) lines.push(`    - ${item.id} ${item.title} (${item.status})`);
    for (const child of subItemsOf(item)) {
      if (!terminal.has(child.status)) lines.push(`    - ${item.id}.${child.id} ${child.title} (${child.status})`);
    }
    return lines;
  });
  return incomplete.length === 0 ? [] : [`  Incomplete plan items (${incomplete.length}):`, ...incomplete];
}

export async function checkIncompletePlanItemsPromise(workspacePath: string, _issueId?: string): Promise<string[]> {
  return checkIncompletePlanItemsSync(workspacePath);
}

/**
 * Generated devcontainer harness (`pan workspace render-devcontainer`):
 * reproducible runtime artifacts, never commit targets. Excluded from the
 * uncommitted-changes check unconditionally — without this, the preflight
 * fails on `?? .devcontainer/` / `?? dev` and agents infer they must delete
 * workspace infrastructure to unblock `pan done` (MIN-896/MIN-898).
 */
const GENERATED_HARNESS_PATHS = ['.devcontainer/', '.devcontainer', 'dev'];

function isGeneratedHarnessStatus(porcelain: string): boolean {
  const path = porcelain.slice(3).trim();
  return GENERATED_HARNESS_PATHS.some((p) => path === p || path.startsWith(p.endsWith('/') ? p : `${p}/`));
}

/** Pure, exported for tests: drop Overdeck-owned (state-plane + `.pan/`/`.overdeck/` runtime) and generated-harness lines from `git status --porcelain`. */
export function filterUncommittedPorcelainLines(porcelain: string): string[] {
  return porcelain.split('\n').map((line) => line.trimEnd()).filter(Boolean)
    .filter((line) => !isOverdeckOwnedOnlyStatus(line))
    .filter((line) => !isGeneratedHarnessStatus(line));
}

async function checkUncommittedChangesPromise(workspacePath: string): Promise<string[]> {
  if (existsSync(join(workspacePath, '.git'))) {
    try {
      // -uall: list untracked files individually instead of collapsing dirs, so
      // state-plane paths (.pan/review/ etc.) inside an untracked .pan/ dir are
      // still matched and filtered — a collapsed `?? .pan/` line is not.
      const lines = filterUncommittedPorcelainLines((await execAsync('git status --porcelain -uall', { cwd: workspacePath })).stdout);
      return lines.length === 0 ? [] : ['  Uncommitted changes:', ...lines.map((line) => `    ${line}`)];
    } catch { return []; }
  }
  const failures: string[] = [];
  try {
    for (const entry of readdirSync(workspacePath, { withFileTypes: true })) {
      if (!entry.isDirectory() || entry.name.startsWith('.')) continue;
      const path = join(workspacePath, entry.name);
      if (!existsSync(join(path, '.git'))) continue;
      try {
        const lines = filterUncommittedPorcelainLines((await execAsync('git status --porcelain -uall', { cwd: path })).stdout);
        if (lines.length > 0) failures.push(`  Uncommitted changes in ${entry.name}/:`, ...lines.map((line) => `    ${line}`));
      } catch { /* ignore unreadable sub-repositories */ }
    }
  } catch { /* ignore unreadable workspace */ }
  return failures;
}

async function runPreflightChecksPromise(workspacePath: string, issueId: string, testWaived?: string): Promise<string[]> {
  return [
    ...checkIncompletePlanItemsSync(workspacePath),
    ...await checkUncommittedChangesPromise(workspacePath),
    ...await Effect.runPromise(runTestRequirementCheck(workspacePath, issueId, testWaived)),
  ];
}

const processError = (op: string, cause: unknown) => new ProcessSpawnError({
  command: 'done-preflight', args: [op], message: cause instanceof Error ? cause.message : String(cause), cause,
});

export const checkIncompletePlanItems = (workspacePath: string): Effect.Effect<string[]> =>
  Effect.sync(() => checkIncompletePlanItemsSync(workspacePath));

export const checkUncommittedChanges = (workspacePath: string): Effect.Effect<string[], ProcessSpawnError> =>
  Effect.tryPromise({ try: () => checkUncommittedChangesPromise(workspacePath), catch: (cause) => processError('checkUncommittedChanges', cause) });

export const runPreflightChecks = (workspacePath: string, issueId: string, testWaived?: string): Effect.Effect<string[], ProcessSpawnError> =>
  Effect.tryPromise({ try: () => runPreflightChecksPromise(workspacePath, issueId, testWaived), catch: (cause) => processError('runPreflightChecks', cause) });
