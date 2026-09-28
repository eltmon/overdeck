/**
 * PAN-4291: skip the PR-cache forge lookup for a repo that can never answer
 * one — a project with no resolvable tracker, or a repo with no git remote
 * configured. Before this, `readRepoPullRequests` ran `gh pr list` for every
 * project on every cache refresh, including 5 projects with no git remote
 * (413 failed calls/hour) and projects the operator has otherwise skipped.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createSettledTtlPromiseCache } from '../concurrency.js';
import { findProjectByPath } from '../projects.js';
import { tryResolveProjectTrackerType } from '../project-tracker-type.js';

const execFileAsync = promisify(execFile);

/** How long a repo's "has a git remote" answer is trusted. */
export const PR_CACHE_REMOTE_CHECK_TTL_MS = 10 * 60_000;

const cachedHasRemote = createSettledTtlPromiseCache<string, boolean>(PR_CACHE_REMOTE_CHECK_TTL_MS);

/**
 * `git remote` with empty stdout is a confirmed, cacheable "no remote". A
 * thrown exec (bad cwd, timeout, transient git failure) answers nothing about
 * the repo, so it is never cached as "no remote" — `createSettledTtlPromiseCache`
 * already drops a rejected load instead of caching it, and the rejection
 * propagates through `shouldListPullRequests` so the caller reads it as a
 * failed read (`null`), never as a false "no PRs" (`[]`).
 */
function hasGitRemote(projectPath: string): Promise<boolean> {
  return cachedHasRemote(projectPath, async () => {
    const { stdout } = await execFileAsync('git', ['remote'], { cwd: projectPath, timeout: 5_000 });
    return stdout.trim().length > 0;
  });
}

/**
 * Whether a `gh pr list` call for `projectPath` could ever return something:
 * false for a registered project with no resolvable tracker, or a repo with
 * no git remote configured. Rejects (never resolves false) when the `git
 * remote` check itself fails, so a transient failure reads as "failed", not
 * as a confirmed "no remote" cached for `PR_CACHE_REMOTE_CHECK_TTL_MS`.
 */
export async function shouldListPullRequests(projectPath: string): Promise<boolean> {
  const project = findProjectByPath(projectPath);
  if (project && tryResolveProjectTrackerType(project) === null) return false;
  return hasGitRemote(projectPath);
}

/** How long a PR listing with no open PR is trusted: nothing there can change without a new PR. */
export const PR_CACHE_IDLE_TTL_MS = 5 * 60_000;

/**
 * `activeTtlMs`, or `PR_CACHE_IDLE_TTL_MS` when `rows` is a listing with no
 * OPEN row: a repo with only merged/closed PRs in its window can't produce a
 * state change until a new PR opens, so the next read need not hit the forge
 * as often as one still tracking an open PR.
 */
export function prListingTtlMs(rows: readonly { state?: string }[] | null, activeTtlMs: number): number {
  if (!rows) return activeTtlMs;
  const hasOpenPr = rows.some((row) => row.state?.toUpperCase() === 'OPEN');
  return hasOpenPr ? activeTtlMs : PR_CACHE_IDLE_TTL_MS;
}
