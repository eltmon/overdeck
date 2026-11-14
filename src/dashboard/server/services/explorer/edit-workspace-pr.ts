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
 *
 * `mergeEditWorkspace` re-reads the PR, refuses unless the verdict allows it
 * and every edit is pushed (D-F8), squash-merges pinned to the head SHA, and
 * removes the edit workspace with its remote branch. `discardEditWorkspace`
 * optionally closes the PR and force-removes the workspace; the remote branch
 * survives only while its PR stays open (D-F10).
 */
import type { EditWorkspaceCreatePrResult, EditWorkspaceStatus } from '@overdeck/contracts';
import { getForgeAdapter, type MergeReviewArtifactInput } from '../../../../lib/forge.js';
import { EditWorkspaceError } from './edit-workspace-errors.js';
import { commitAll, headSha, isClean, pushHead } from './edit-workspace-git.js';
import {
  closePullRequest,
  createPullRequest,
  defaultGh,
  defaultSleep,
  findBranchPr,
  readPrWithVerdict,
  type BranchPr,
  type Sleep,
} from './edit-workspace-gh.js';
import { removeEditWorkspace } from './edit-workspace-remove.js';
import { editSupport, resolveEditWorkspace, type EditWorkspaceDeps } from './edit-workspace.js';

export interface EditWorkspacePrDeps extends EditWorkspaceDeps {
  sleep?: Sleep;
  commitAll?: typeof commitAll;
  pushHead?: typeof pushHead;
  isClean?: (cwd: string) => Promise<boolean>;
  headSha?: (cwd: string) => Promise<string>;
  mergePr?: (input: MergeReviewArtifactInput) => Promise<void>;
  removeEditWorkspace?: typeof removeEditWorkspace;
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

export async function mergeEditWorkspace(workspaceId: string, deps: EditWorkspacePrDeps = {}): Promise<{ merged: true }> {
  const { root, row, project } = await resolveEditWorkspace(workspaceId, deps);
  const { repo } = editSupport(project.config);
  const branch = row.branchName as string;
  const pr = repo ? await readPrWithVerdict(deps.gh ?? defaultGh, repo, branch, root.absPath, deps.sleep ?? defaultSleep) : null;
  if (!repo || !pr) throw new EditWorkspaceError('NO_PR', 404, 'This edit workspace has no PR.');
  if (!pr.canMerge) throw new EditWorkspaceError('NOT_MERGEABLE', 409, pr.reason ?? 'GitHub does not allow this merge.');

  const clean = await (deps.isClean ?? isClean)(root.absPath);
  if (!clean || (await (deps.headSha ?? headSha)(root.absPath)) !== pr.headSha) {
    throw new EditWorkspaceError('UNPUSHED_CHANGES', 409, 'Commit and push your changes first.');
  }

  const merge = deps.mergePr ?? ((input: MergeReviewArtifactInput) => getForgeAdapter('github').mergeReviewArtifact(input));
  try {
    await merge({ forge: 'github', url: pr.url, method: 'squash', matchHeadCommit: pr.headSha, cwd: root.absPath, repository: repo });
  } catch (error) {
    throw new EditWorkspaceError('MERGE_FAILED', 502, `Merging PR #${pr.number} failed: ${messageOf(error)}`);
  }

  try {
    await (deps.removeEditWorkspace ?? removeEditWorkspace)(
      { row, primaryPath: project.config.path },
      { force: false, deleteRemoteBranch: true },
    );
  } catch (error) {
    throw new EditWorkspaceError('REMOVE_FAILED', 500, `The PR merged, but removing the edit workspace failed: ${messageOf(error)}`);
  }
  return { merged: true };
}

export async function discardEditWorkspace(
  workspaceId: string,
  input: { closePr: boolean },
  deps: EditWorkspacePrDeps = {},
): Promise<{ removed: true; prClosed: boolean }> {
  const { root, row, project } = await resolveEditWorkspace(workspaceId, deps);
  const { repo } = editSupport(project.config);
  const gh = deps.gh ?? defaultGh;
  const branch = row.branchName as string;

  let existing: BranchPr | null = null;
  if (repo) {
    try {
      existing = await findBranchPr(gh, repo, branch, root.absPath);
    } catch (error) {
      console.warn(`[explorer-edit] PR lookup failed: ${messageOf(error)}`);
    }
  }
  const open = existing?.state === 'OPEN';
  if (input.closePr && open && repo && existing) {
    try {
      await closePullRequest(gh, repo, existing.number, root.absPath);
    } catch (error) {
      throw new EditWorkspaceError('PR_CLOSE_FAILED', 502, `Closing PR #${existing.number} failed: ${messageOf(error)}`);
    }
  }
  const prStillOpen = open && !input.closePr;
  await (deps.removeEditWorkspace ?? removeEditWorkspace)(
    { row, primaryPath: project.config.path },
    { force: true, deleteRemoteBranch: !prStillOpen },
  );
  return { removed: true, prClosed: input.closePr && open };
}
