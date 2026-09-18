/**
 * Committing `.pan/` artifacts (PAN-3917 W9).
 *
 * There is no auto-commit daemon and no state branch. Whoever writes a planning
 * artifact commits it, on the branch it belongs to: per-issue artifacts (spec
 * promotion, drafts, continue files) on the issue's feature branch inside the
 * issue workspace; project-level artifacts (order books, notes, the parked
 * list, the backlog sequence) on `main` in the project's plan home.
 *
 * Async git only — this runs from the CLI and from server-reachable code.
 */

import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { relative, resolve } from 'node:path';

const execFileAsync = promisify(execFile);

export interface CommitPlanArtifactsOptions {
  /** The checkout whose `.pan/` holds the artifacts (a workspace, or the plan home). */
  readonly cwd: string;
  /** Paths to stage. Absolute, or relative to `cwd`. Defaults to the whole `.pan/` tree. */
  readonly paths?: readonly string[];
  /** Commit subject. */
  readonly message: string;
}

export type CommitPlanArtifactsResult =
  | { readonly committed: true; readonly sha: string }
  | { readonly committed: false; readonly reason: string };

/** `chore(workspace): plan artifacts for PAN-1` — the subject the verbs use. */
export function planArtifactCommitMessage(issueId: string): string {
  return `chore(workspace): plan artifacts for ${issueId.toUpperCase()}`;
}

/**
 * Stage and commit `.pan/` artifacts. A clean tree is not a failure: it means
 * the artifact was already committed, and the caller carries on.
 */
export async function commitPlanArtifacts(
  options: CommitPlanArtifactsOptions,
): Promise<CommitPlanArtifactsResult> {
  const cwd = resolve(options.cwd);
  const pathspecs = (options.paths ?? ['.pan']).map((p) =>
    p.startsWith('/') ? relative(cwd, p) || '.' : p,
  );

  try {
    await execFileAsync('git', ['add', '--', ...pathspecs], { cwd });
    const { stdout: staged } = await execFileAsync(
      'git',
      ['diff', '--cached', '--name-only', '--', ...pathspecs],
      { cwd },
    );
    if (!staged.trim()) return { committed: false, reason: 'nothing to commit' };

    await execFileAsync('git', ['commit', '-m', options.message, '--only', '--', ...pathspecs], { cwd });
    const { stdout: sha } = await execFileAsync('git', ['rev-parse', 'HEAD'], { cwd });
    return { committed: true, sha: sha.trim() };
  } catch (cause) {
    const message = cause instanceof Error ? cause.message : String(cause);
    return { committed: false, reason: message.split('\n')[0] };
  }
}
