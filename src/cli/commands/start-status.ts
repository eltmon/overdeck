import { sep } from 'path';
import { findPlanSync } from '../../lib/xbrief/io.js';
import { resolveIssueWorkspacePlanHome, transitionIssueXBrief, updatePlanStatus } from '../../lib/xbrief/lifecycle-io.js';

export async function transitionStartedXBrief(projectRoot: string, issueId: string) {
  const planHome = resolveIssueWorkspacePlanHome(projectRoot, issueId);
  if (!planHome) {
    throw new Error(`no base workspace for ${issueId.toUpperCase()}; spec transition skipped`);
  }
  return transitionIssueXBrief(
    planHome,
    issueId,
    'active',
    'running',
  );
}

export function updateWorkspaceDraftPlanStatus(workspace: string): boolean {
  const spawnedPlanPath = findPlanSync(workspace);
  if (!spawnedPlanPath?.startsWith(workspace + sep)) return false;
  updatePlanStatus(spawnedPlanPath, 'running');
  return true;
}
