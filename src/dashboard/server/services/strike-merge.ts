/**
 * PAN-4750: the operator's strike merge door.
 *
 * A strike PR (`strike/<issue>`, PAN-3973) skips the review pipeline and is
 * authored as the operator, who cannot approve their own PR on GitHub. Nothing
 * built a `kind: 'strike'` merge request after #3987 deleted its route, so no
 * strike could merge through Overdeck. This module is the one place a
 * `StrikeMergeRequest` is built; `triggerMerge` re-validates every field of it
 * against git (`validateStrikeMergeRequest`) before it lands anything.
 *
 * Only an operator-started strike merge (`operatorStarted: true`) skips the
 * head-approval rule (`requiresHeadApproval`). Draft, changes requested, CI
 * checks, the CI test job, required UAT and mergeability still gate it.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { promisify } from 'node:util';

import { extractPrefix } from '../../../lib/issue-id.js';
import type { StrikeMergeRequest, TriggerMergeResult } from '../routes/workspaces/merge-strike.js';
import { getProjectPath } from './project-path.js';

const execFileAsync = promisify(execFile);

export interface BuildStrikeMergeRequestDeps {
  /** The project checkout that owns the issue (`getProjectPath`, as `triggerMerge` resolves it). */
  resolveProjectPath?: (issueId: string) => Promise<string | null>;
  git?: (args: string[], cwd: string) => Promise<string>;
  exists?: (path: string) => boolean;
}

export type BuildStrikeMergeRequestResult =
  | { ok: true; request: StrikeMergeRequest }
  | { ok: false; status: 404 | 409; error: string };

/**
 * The project path exactly as `triggerMerge` resolves it, so the workspace
 * this builds is the one `validateStrikeMergeRequest` compares against
 * (PAN-4750 review: the repo-prefix fallback included).
 */
async function defaultResolveProjectPath(issueId: string): Promise<string | null> {
  return getProjectPath(undefined, extractPrefix(issueId) ?? issueId.split('-')[0]) || null;
}

async function defaultGit(args: string[], cwd: string): Promise<string> {
  return (await execFileAsync('git', args, { cwd, encoding: 'utf-8', timeout: 15_000 })).stdout.trim();
}

/**
 * Build the strike merge request for `issueId` from its strike workspace and
 * the current `origin/strike/<issue>` head. The workspace path is the same
 * string template `validateStrikeMergeRequest` compares against (never
 * `join()`), so the two cannot disagree on normalization.
 */
export async function buildStrikeMergeRequest(
  issueId: string,
  mode: { operatorStarted: true } | { expectedHeadSha: string },
  deps: BuildStrikeMergeRequestDeps = {},
): Promise<BuildStrikeMergeRequestResult> {
  const lower = issueId.toLowerCase();
  const projectPath = await (deps.resolveProjectPath ?? defaultResolveProjectPath)(issueId);
  const workspacePath = projectPath ? `${projectPath}/workspaces/feature-${lower}-strike` : null;
  if (!workspacePath || !(deps.exists ?? existsSync)(workspacePath)) {
    return { ok: false, status: 404, error: `No strike workspace for ${issueId.toUpperCase()}` };
  }
  const branchName = `strike/${lower}`;
  const git = deps.git ?? defaultGit;
  let markerHead: string;
  try {
    await git(['fetch', 'origin', branchName], workspacePath);
    markerHead = await git(['rev-parse', `origin/${branchName}`], workspacePath);
  } catch (error) {
    return { ok: false, status: 409, error: `Could not read origin/${branchName}: ${error instanceof Error ? error.message : String(error)}` };
  }
  return {
    ok: true,
    request: { kind: 'strike', markerHead, workspacePath, branchName, recoveryTarget: `strike-${lower}`, ...mode },
  };
}

export interface PostStrikeMergeDeps extends BuildStrikeMergeRequestDeps {
  triggerMerge?: (issueId: string, request: StrikeMergeRequest) => Promise<TriggerMergeResult>;
}

async function defaultTriggerMerge(issueId: string, request: StrikeMergeRequest): Promise<TriggerMergeResult> {
  const { triggerMerge } = await import('../routes/workspaces/merge-ops.js');
  return triggerMerge(issueId, request);
}

/** `POST /api/merge-train/strikes/:issueId/merge`: build the operator's strike request and merge it. */
export async function postStrikeMergePayload(
  issueId: string,
  deps: PostStrikeMergeDeps = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const built = await buildStrikeMergeRequest(issueId, { operatorStarted: true }, deps);
  if (!built.ok) return { status: built.status, body: { success: false, error: built.error } };
  const { statusCode, ...body } = await (deps.triggerMerge ?? defaultTriggerMerge)(issueId, built.request);
  return { status: statusCode, body };
}
