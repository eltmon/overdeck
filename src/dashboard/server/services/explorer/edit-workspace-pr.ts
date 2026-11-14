/**
 * Edit-workspace PR service (PAN-5191 WI-F5).
 *
 * `getEditWorkspaceStatus` answers the edit-workspace banner: the workspace,
 * its PR with the merge verdict (D-F7), and whether the project supports a
 * direct PR and the pipeline path. A failed PR lookup returns `pr: null` so
 * the banner still renders.
 *
 * `createDirectPr` commits every change, pushes the edit branch with upstream
 * and opens a PR to the default branch. While the branch already has an open
 * PR it only commits and pushes ("Commit and push", FR-8).
 */
import type { EditWorkspaceCreatePrResult, EditWorkspaceStatus } from '@overdeck/contracts';
import { EditWorkspaceError } from './edit-workspace-errors.js';
import { commitAll, pushHead } from './edit-workspace-git.js';
import { createPullRequest, defaultGh, defaultSleep, findBranchPr, readPrWithVerdict, type Sleep } from './edit-workspace-gh.js';
import { editSupport, resolveEditWorkspace, type EditWorkspaceDeps } from './edit-workspace.js';

export interface EditWorkspacePrDeps extends EditWorkspaceDeps {
  sleep?: Sleep;
  commitAll?: typeof commitAll;
  pushHead?: typeof pushHead;
}

/** The remote-tracking ref of the default branch, which commitAll compares against. */
export function baseRefFor(defaultBranch: string): string {
  return `refs/remotes/origin/${defaultBranch}`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function getEditWorkspaceStatus(workspaceId: string, deps: EditWorkspacePrDeps = {}): Promise<EditWorkspaceStatus> {
  const { root, row, project } = await resolveEditWorkspace(workspaceId, deps);
  const support = editSupport(project.config);
  const branch = row.branchName as string;
  let pr: EditWorkspaceStatus['pr'] = null;
  if (support.repo) {
    try {
      pr = await readPrWithVerdict(deps.gh ?? defaultGh, support.repo, branch, root.absPath, deps.sleep ?? defaultSleep);
    } catch (error) {
      console.warn(`[explorer-edit] PR lookup failed: ${messageOf(error)}`);
    }
  }
  return {
    workspace: {
      id: row.id,
      rootId: root.id,
      name: row.name,
      branch,
      projectKey: project.key,
      defaultBranch: root.defaultBranch,
      path: root.absPath,
    },
    pr,
    prSupport: support.prSupport,
    pipelineSupport: support.pipelineSupport,
  };
}

export async function createDirectPr(
  workspaceId: string,
  input: { title: string; body: string; draft: boolean },
  deps: EditWorkspacePrDeps = {},
): Promise<Extract<EditWorkspaceCreatePrResult, { mode: 'direct' }>> {
  const { root, row, project } = await resolveEditWorkspace(workspaceId, deps);
  const support = editSupport(project.config);
  if (!support.repo) throw new EditWorkspaceError('PR_UNSUPPORTED', 409, support.prSupport.reason ?? 'PR support is unavailable.');
  const gh = deps.gh ?? defaultGh;
  const branch = row.branchName as string;

  await (deps.commitAll ?? commitAll)(root.absPath, input.title, baseRefFor(root.defaultBranch));
  await (deps.pushHead ?? pushHead)(root.absPath, branch, { setUpstream: true });

  const existing = await findBranchPr(gh, support.repo, branch, root.absPath);
  if (existing?.state === 'OPEN') return { mode: 'direct', url: existing.url, number: existing.number, created: false };

  try {
    const pr = await createPullRequest(gh, {
      repo: support.repo,
      head: branch,
      base: root.defaultBranch,
      title: input.title,
      body: input.body,
      draft: input.draft,
      cwd: root.absPath,
    });
    return { mode: 'direct', url: pr.url, number: pr.number, created: true };
  } catch (error) {
    if (error instanceof EditWorkspaceError) throw error;
    throw new EditWorkspaceError('PR_CREATE_FAILED', 502, `Opening the PR failed: ${messageOf(error)}`);
  }
}
