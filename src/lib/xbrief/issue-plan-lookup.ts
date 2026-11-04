/**
 * Where an issue's plan lives (PAN-4683).
 *
 * A planned issue's spec is committed on its feature branch, not on the primary
 * checkout, so "is it planned?" checks the local workspace, then the feature
 * branch refs, then the primary checkout. It reads only refs already present
 * locally: no `git fetch`, no network I/O.
 */
import { existsSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { basename } from 'node:path';
import { promisify } from 'node:util';
import { Effect } from 'effect';
import { findPlanSync } from './io.js';
import { parseXBriefFilename } from './lifecycle.js';
import { findSpecByIssue } from '../pan-dir/specs.js';

const execFileAsync = promisify(execFile);
const SPECS_DIR = '.pan/specs/';

function isIssueSpecPath(path: string, issueId: string): boolean {
  if (!path.startsWith(SPECS_DIR)) return false;
  const parsed = parseXBriefFilename(basename(path));
  return parsed !== null && parsed.issueId.toUpperCase() === issueId.toUpperCase();
}

/** Spec paths for the issue on a ref, sorted; any git error (missing ref, not a repo) is no match. */
async function issueSpecPathsOnRef(projectRoot: string, ref: string, issueId: string): Promise<string[]> {
  try {
    const { stdout } = await execFileAsync(
      'git',
      ['-c', 'core.quotePath=false', 'ls-tree', '--name-only', '--full-name', ref, '--', SPECS_DIR],
      { cwd: projectRoot },
    );
    return stdout.split('\n').map(line => line.trim()).filter(path => isIssueSpecPath(path, issueId)).sort();
  } catch {
    return [];
  }
}

/**
 * Returns a path, or `<ref>:<path>` for a spec found only on a branch ref.
 * The `<ref>:<path>` form is for truth-testing only; it is not a file path.
 */
export async function findIssuePlan(input: {
  issueId: string;
  projectRoot: string;
  localWorkspace: string | null;
}): Promise<string | null> {
  const { issueId, projectRoot, localWorkspace } = input;

  if (localWorkspace && existsSync(localWorkspace)) {
    const plan = findPlanSync(localWorkspace);
    if (plan) return plan;
  }

  const branch = `feature/${issueId.toLowerCase()}`;
  for (const ref of [`refs/heads/${branch}`, `refs/remotes/origin/${branch}`]) {
    const [first] = await issueSpecPathsOnRef(projectRoot, ref, issueId);
    if (first) return `${ref}:${first}`;
  }

  return (await Effect.runPromise(findSpecByIssue(projectRoot, issueId)))?.path ?? null;
}
