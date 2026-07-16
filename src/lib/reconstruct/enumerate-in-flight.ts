/** Resolver-backed source-of-truth enumerator for pipeline members (PAN-1920/PAN-1966). */

import { gatherProjectLensSignals, gatherProjectLensSignalsForProjects } from '../pipeline-membership-gather.js';
import { resolvePipelineMembership, type IssueLensSignals } from '../pipeline-membership.js';
import type { ProjectConfig } from '../projects.js';

export async function enumerateInFlightIssuesFromSources(
  projects: ProjectConfig[],
  gather: (project: ProjectConfig) => Promise<IssueLensSignals[]> = gatherProjectLensSignals,
): Promise<Set<string>> {
  const results = await gatherProjectLensSignalsForProjects(projects, gather);
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;
  const signals = results.flatMap((result) => result.signals ?? []);
  return new Set(
    signals
      .map(resolvePipelineMembership)
      .filter((membership) => membership.inPipeline)
      .map((membership) => membership.issueId),
  );
}
