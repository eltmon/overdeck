import { Effect } from 'effect';
import { findSpecByIssue } from '../pan-dir/specs.js';
import { analyzeSwarmReadiness } from '../vbrief/swarm-readiness.js';
import { listFeatureWorkspaces, type FeatureWorkspace } from './deacon-workspaces.js';

export interface CoordinateSwarmSlotsOptions {
  issueId?: string;
}

export interface CoordinateSwarmSlotsDeps {
  listFeatureWorkspaces: () => FeatureWorkspace[];
}

const defaultDeps: CoordinateSwarmSlotsDeps = {
  listFeatureWorkspaces,
};

export async function coordinateSwarmSlots(
  opts: CoordinateSwarmSlotsOptions = {},
  deps: CoordinateSwarmSlotsDeps = defaultDeps,
): Promise<string[]> {
  const actions: string[] = [];
  const filterIssueId = opts.issueId?.toUpperCase();

  for (const workspace of deps.listFeatureWorkspaces()) {
    const issueId = workspace.issueId.toUpperCase();
    if (filterIssueId && issueId !== filterIssueId) continue;

    try {
      const spec = await Effect.runPromise(findSpecByIssue(workspace.projectPath, issueId));
      if (!spec) continue;

      const readiness = analyzeSwarmReadiness(spec.document);
      const slotEligibleCount = readiness.items.filter(item => item.slotEligible).length;
      if (!readiness.swarmEligible || slotEligibleCount < 2) continue;

      actions.push(`[swarm] considered ${issueId}: swarm eligible`);
    } catch (err) {
      console.warn(`[deacon] Error coordinating swarm ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  return actions;
}
