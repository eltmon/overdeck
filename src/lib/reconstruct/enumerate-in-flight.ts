/** Resolver-backed source-of-truth enumerator for pipeline members (PAN-1920/PAN-1966). */

import { gatherProjectLensSignals } from '../pipeline-membership-gather.js';
import { resolvePipelineMembership, type IssueLensSignals } from '../pipeline-membership.js';
import type { ProjectConfig } from '../projects.js';

export async function enumerateInFlightIssuesFromSources(
  projects: ProjectConfig[],
  gather: (project: ProjectConfig) => Promise<IssueLensSignals[]> = gatherProjectLensSignals,
): Promise<Set<string>> {
  const signals = (await Promise.all(projects.map((project) => gather(project)))).flat();
  return new Set(
    signals
      .map(resolvePipelineMembership)
      .filter((membership) => membership.inPipeline)
      .map((membership) => membership.issueId),
  );
}
