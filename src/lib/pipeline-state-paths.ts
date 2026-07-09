import { execFile, spawn } from 'child_process';
import { promisify } from 'util';
import { isStatePlanePath, STATE_PLANE_PATHS } from './state-plane.js';

const execFileAsync = promisify(execFile);

// Git pathspecs that exclude every state-plane path from a diff, so a
// contribution comparison ignores churn in specs/beads/records/etc. Derived from
// STATE_PLANE_PATHS so it never drifts from the canonical state-plane definition.
const STATE_PLANE_DIFF_EXCLUDES = STATE_PLANE_PATHS.map(
  (path) => `:(exclude)${path.replace(/\/$/, '')}`,
);

export function isPipelineStatePath(relativePath: string): boolean {
  return isStatePlanePath(relativePath);
}

export async function hasOnlyPipelineStateChangesSinceCommit(
  workspacePath: string,
  baseCommit: string,
  headCommit = 'HEAD',
): Promise<boolean> {
  const changedPaths = await changedPathsBetween(workspacePath, baseCommit, headCommit);
  return changedPaths.length > 0 && changedPaths.every(isPipelineStatePath);
}

export async function getEffectiveCodeCommit(
  workspacePath: string,
  headCommit = 'HEAD',
): Promise<string> {
  let current = (await gitStdout(workspacePath, ['rev-parse', headCommit])).trim();
  const seen = new Set<string>();

  while (current && !seen.has(current)) {
    seen.add(current);

    let parent: string;
    try {
      parent = (await gitStdout(workspacePath, ['rev-parse', `${current}^`])).trim();
    } catch {
      return current;
    }

    const changedPaths = await changedPathsBetween(workspacePath, parent, current);
    if (changedPaths.length > 0 && changedPaths.every(isPipelineStatePath)) {
      current = parent;
      continue;
    }

    return current;
  }

  return current;
}

export async function haveSameEffectiveCodeCommit(
  workspacePath: string,
  leftCommit: string,
  rightCommit: string,
): Promise<boolean> {
  const [leftEffective, rightEffective] = await Promise.all([
    getEffectiveCodeCommit(workspacePath, leftCommit),
    getEffectiveCodeCommit(workspacePath, rightCommit),
  ]);
  return leftEffective === rightEffective;
}

/**
 * True when `leftCommit` and `rightCommit` introduce the same non-state-plane
 * contribution relative to their own merge-base with `baseRef`.
 *
 * A rebase onto a newer base rewrites every commit SHA on the branch, so the
 * SHA-based `haveSameEffectiveCodeCommit` reports a change even though the patch
 * the branch applies is byte-for-byte identical. Comparing the merge-base-
 * relative diff by git patch-id — content, not SHA — recognises such a rebase as
 * benign, so a passed review is not needlessly invalidated (PAN-2468). Returns
 * false if either contribution cannot be computed.
 */
export async function haveSameCodeContribution(
  workspacePath: string,
  leftCommit: string,
  rightCommit: string,
  baseRef = 'origin/main',
): Promise<boolean> {
  const [left, right] = await Promise.all([
    codeContributionPatchId(workspacePath, leftCommit, baseRef),
    codeContributionPatchId(workspacePath, rightCommit, baseRef),
  ]);
  return left !== null && right !== null && left === right;
}

/**
 * git patch-id of the non-state-plane diff `commit` introduces relative to its
 * merge-base with `baseRef`. Returns a stable sentinel when the contribution has
 * no code changes, or null when it cannot be computed (missing base, git error).
 */
async function codeContributionPatchId(
  workspacePath: string,
  commit: string,
  baseRef: string,
): Promise<string | null> {
  let base: string;
  try {
    base = (await gitStdout(workspacePath, ['merge-base', baseRef, commit])).trim();
  } catch {
    return null;
  }
  if (!base) return null;

  let diff: string;
  try {
    diff = await gitStdout(workspacePath, [
      'diff',
      `${base}..${commit}`,
      '--',
      '.',
      ...STATE_PLANE_DIFF_EXCLUDES,
    ]);
  } catch {
    return null;
  }
  if (!diff.trim()) return 'no-code-contribution';

  return patchIdOfDiff(workspacePath, diff);
}

/** Reduce a unified diff to a stable git patch-id (content hash of the patch). */
function patchIdOfDiff(workspacePath: string, diff: string): Promise<string | null> {
  return new Promise((resolve) => {
    const child = spawn('git', ['patch-id', '--stable'], { cwd: workspacePath });
    let out = '';
    child.stdout.on('data', (chunk) => (out += chunk));
    child.on('error', () => resolve(null));
    child.on('close', () => {
      const id = out.trim().split(/\s+/)[0] ?? '';
      resolve(id || null);
    });
    child.stdin.on('error', () => resolve(null));
    child.stdin.end(diff);
  });
}

async function changedPathsBetween(
  workspacePath: string,
  baseCommit: string,
  headCommit: string,
): Promise<string[]> {
  const stdout = await gitStdout(workspacePath, ['diff', '--name-only', baseCommit, headCommit]);
  return stdout
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);
}

async function gitStdout(workspacePath: string, args: string[]): Promise<string> {
  const result = await execFileAsync(
    'git',
    args,
    // 64 MiB: codeContributionPatchId feeds full contribution diffs through
    // here; the 1 MiB default would throw on large branches and silently
    // downgrade the benign-rebase guard to a reset (PAN-2468).
    { cwd: workspacePath, encoding: 'utf-8', maxBuffer: 64 * 1024 * 1024 },
  ) as unknown;
  if (typeof result === 'string') return result;
  return String((result as { stdout?: unknown }).stdout ?? '');
}
