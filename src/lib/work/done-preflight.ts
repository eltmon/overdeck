import { exec } from 'node:child_process';
import { existsSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { ProcessSpawnError } from '../errors.js';
import { isStatePlaneOnlyStatus } from '../state-plane.js';
import { readWorkspacePlanSync } from '../vbrief/io.js';
import { subItemsOf } from '../vbrief/types.js';
import { runTestRequirementCheck } from './test-requirement-gate.js';

const execAsync = promisify(exec);
const terminal = new Set(['completed', 'cancelled']);

export function checkIncompletePlanItemsSync(workspacePath: string): string[] {
  const doc = readWorkspacePlanSync(workspacePath);
  if (!doc) return ['  The required vBRIEF checklist is missing or unreadable; return the issue to planning before completion.'];
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

function nonStateLines(porcelain: string): string[] {
  return porcelain.split('\n').map((line) => line.trimEnd()).filter(Boolean).filter((line) => !isStatePlaneOnlyStatus(line));
}

async function checkUncommittedChangesPromise(workspacePath: string): Promise<string[]> {
  if (existsSync(join(workspacePath, '.git'))) {
    try {
      const lines = nonStateLines((await execAsync('git status --porcelain', { cwd: workspacePath })).stdout);
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
        const lines = nonStateLines((await execAsync('git status --porcelain', { cwd: path })).stdout);
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
