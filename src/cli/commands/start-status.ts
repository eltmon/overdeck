import { sep } from 'path';
import { findPlanSync } from '../../lib/xbrief/io.js';
import { transitionIssueXBrief, updatePlanStatus } from '../../lib/xbrief/lifecycle-io.js';
import { resolvePlanHome } from '../../lib/pan-dir/paths.js';

export async function transitionStartedXBrief(projectRoot: string, issueId: string) {
  return transitionIssueXBrief(
    resolvePlanHome(projectRoot),
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
