/**
 * Edit-workspace PR service (PAN-5191 WI-F5).
 *
 * `getEditWorkspaceStatus` answers the edit-workspace banner: the workspace,
 * its PR with the merge verdict (D-F7), and whether the project supports a
 * direct PR and the pipeline path. A failed PR lookup returns `pr: null` so
 * the banner still renders.
 */
import type { EditWorkspaceStatus } from '@overdeck/contracts';
import { defaultGh, defaultSleep, readPrWithVerdict, type Sleep } from './edit-workspace-gh.js';
import { editSupport, resolveEditWorkspace, type EditWorkspaceDeps } from './edit-workspace.js';

export interface EditWorkspacePrDeps extends EditWorkspaceDeps {
  sleep?: Sleep;
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
      console.warn(`[explorer-edit] PR lookup failed: ${error instanceof Error ? error.message : String(error)}`);
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
