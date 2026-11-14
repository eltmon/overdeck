/**
 * Send an edit workspace through the pipeline (PAN-5191 WI-F8, D-F2, D-F3).
 *
 * The order is fixed: commit, create the GitHub issue, push the commit as
 * `feature/<issue-lower>`, open its PR, remove the edit workspace, adopt.
 * A PR is never opened against an unpushed head, and the edit workspace is
 * removed only after its commit is on the remote, so nothing is lost.
 *
 * Adoption (PAN-4605) builds the pipeline workspace through the paved
 * creation path and starts review. It runs in the background. The webhook
 * for the new PR may adopt it first; `adoptPrAndStartReview` coalesces
 * concurrent calls, and when the workspace already exists this service skips
 * the call.
 *
 * `deps.ensurePr` is required: the route passes `ensurePRExists`, because a
 * service never imports a route module.
 */
import { access } from 'node:fs/promises';
import type { EditWorkspaceCreatePrResult } from '@overdeck/contracts';
import { adoptPrAndStartReview } from '../../../../lib/cloister/pr-adoption-review.js';
import { getIssuePrefix } from '../../../../lib/projects.js';
import { getWorkspacePathForIssue } from '../../workspace-paths.js';
import { EditWorkspaceError } from './edit-workspace-errors.js';
import { commitAll, headSha, pushHead } from './edit-workspace-git.js';
import { createGitHubIssue, defaultGh, findBranchPr } from './edit-workspace-gh.js';
import { baseRefFor, type EditWorkspacePrDeps } from './edit-workspace-pr.js';
import { removeEditWorkspace } from './edit-workspace-remove.js';
import { editSupport, resolveEditWorkspace } from './edit-workspace.js';

export const PIPELINE_ISSUE_FOOTER = 'Created from the Overdeck file explorer.';

export type EnsurePr = (
  issueId: string,
  options: { cwd: string; branchName: string; targetBranch: string },
) => Promise<{ created: boolean; prUrl?: string; error?: string }>;

export interface EditWorkspacePipelineDeps extends EditWorkspacePrDeps {
  ensurePr: EnsurePr;
  adopt?: typeof adoptPrAndStartReview;
  pathExists?: (path: string) => Promise<boolean>;
}

async function defaultPathExists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

export async function sendThroughPipeline(
  workspaceId: string,
  input: { title: string; body: string },
  deps: EditWorkspacePipelineDeps,
): Promise<Extract<EditWorkspaceCreatePrResult, { mode: 'pipeline' }>> {
  const { root, row, project } = await resolveEditWorkspace(workspaceId, deps);
  const support = editSupport(project.config);
  const prefix = getIssuePrefix(project.config)?.trim() ?? '';
  if (!support.pipelineSupport.available || !support.repo || prefix === '') {
    throw new EditWorkspaceError('PIPELINE_UNSUPPORTED', 409, support.pipelineSupport.reason ?? 'Pipeline support is unavailable.');
  }
  const repo = support.repo;
  const gh = deps.gh ?? defaultGh;
  const editBranch = row.branchName as string;

  const existing = await findBranchPr(gh, repo, editBranch, root.absPath);
  if (existing?.state === 'OPEN') {
    throw new EditWorkspaceError('PR_EXISTS', 409, `This edit workspace already has PR #${existing.number}. Merge or discard it instead.`);
  }

  await (deps.commitAll ?? commitAll)(root.absPath, input.title, baseRefFor(root.defaultBranch));

  let issue: { number: number; url: string };
  try {
    issue = await createGitHubIssue(gh, {
      repo,
      title: input.title,
      body: `${input.body.trimEnd()}\n\n${PIPELINE_ISSUE_FOOTER}`,
      cwd: root.absPath,
    });
  } catch (error) {
    if (error instanceof EditWorkspaceError) throw error;
    throw new EditWorkspaceError('ISSUE_CREATE_FAILED', 502, `Creating the GitHub issue failed: ${messageOf(error)}`);
  }
  const issueId = `${prefix.toUpperCase()}-${issue.number}`;
  const featureBranch = `feature/${issueId.toLowerCase()}`;

  try {
    await (deps.pushHead ?? pushHead)(root.absPath, featureBranch, { setUpstream: false });
  } catch (error) {
    throw new EditWorkspaceError('PUSH_FAILED', 502, `Created ${issueId} (${issue.url}), but ${lowerFirst(messageOf(error))}`);
  }

  const pr = await deps.ensurePr(issueId, { cwd: root.absPath, branchName: featureBranch, targetBranch: root.defaultBranch });
  const prNumberMatch = pr.prUrl ? /\/pull\/(\d+)/.exec(pr.prUrl) : null;
  if (pr.error || !pr.prUrl || !prNumberMatch) {
    throw new EditWorkspaceError('PR_CREATE_FAILED', 502, `Created ${issueId}, but opening its PR failed: ${pr.error ?? 'no PR URL'}`);
  }
  const prUrl = pr.prUrl;
  const prNumber = Number(prNumberMatch[1]);
  const sha = await (deps.headSha ?? headSha)(root.absPath);

  try {
    await (deps.removeEditWorkspace ?? removeEditWorkspace)(
      { row, primaryPath: project.config.path },
      { force: false, deleteRemoteBranch: false },
    );
  } catch (error) {
    console.warn(`[explorer-edit] removing ${row.name} after pipeline send failed: ${messageOf(error)}`);
  }

  const { workspacePath } = getWorkspacePathForIssue(project.config.path, issueId);
  if (await (deps.pathExists ?? defaultPathExists)(workspacePath)) {
    console.log(`[explorer-edit] ${issueId} already adopted`);
  } else {
    const adopt = deps.adopt ?? adoptPrAndStartReview;
    void adopt({ issueId, number: prNumber, headRef: featureBranch, headSha: sha, repo }, { source: 'api' })
      .then((outcome) => console.log(`[explorer-edit] adoption for ${issueId}: ${outcome.kind}`))
      .catch((error: unknown) => console.warn(`[explorer-edit] adoption for ${issueId} failed: ${messageOf(error)}`));
  }

  return { mode: 'pipeline', issueId, issueUrl: issue.url, prUrl, prNumber };
}
