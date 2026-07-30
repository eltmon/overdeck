import { sep } from 'path';
import { Effect } from 'effect';
import { findPlanSync } from '../../lib/xbrief/io.js';
import { transitionXBriefOnMain, updatePlanStatus } from '../../lib/xbrief/lifecycle-io.js';

export async function transitionStartedXBrief(projectRoot: string, issueId: string) {
  return Effect.runPromise(transitionXBriefOnMain(
    projectRoot,
    issueId,
    'active',
    'running',
    `chore(state): start ${issueId.toUpperCase()} xBRIEF (status=running)`,
  ));
}

export function updateWorkspaceDraftPlanStatus(workspace: string): boolean {
  const spawnedPlanPath = findPlanSync(workspace);
  if (!spawnedPlanPath?.startsWith(workspace + sep)) return false;
  updatePlanStatus(spawnedPlanPath, 'running');
  return true;
}
