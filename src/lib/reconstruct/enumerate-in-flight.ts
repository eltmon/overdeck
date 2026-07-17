/** Resolver-backed source-of-truth enumerator for pipeline members (PAN-1920/PAN-1966). */

import { gatherProjectLensSignals, gatherProjectLensSignalsForProjects } from '../pipeline-membership-gather.js';
import { resolvePipelineMembership, type IssueLensSignals } from '../pipeline-membership.js';
import type { ProjectConfig } from '../projects.js';

export async function enumerateInFlightIssuesFromSources(
  projects: ProjectConfig[],
  gather: (project: ProjectConfig) => Promise<IssueLensSignals[]> = gatherProjectLensSignals,
): Promise<Set<string>> {
  const results = await gatherProjectLensSignalsForProjects(projects, gather);
  // Degrade per project, never throw: this runs during dashboard boot
  // (reconstruct-cache), and one project's unreadable lens — a GitHub App
  // token without access, a phantom issue id in a spec — must not take the
  // whole server down (PAN-2820: boot died before the HTTP listen). A failed
  // project's issues are simply not enumerated this pass; reconstruct keeps
  // its other sources and the next pass retries.
  for (const result of results) {
    if (result.error) {
      const message = result.error instanceof Error ? result.error.message : String(result.error);
      console.error(`[enumerate-in-flight] Skipping project ${result.project.name}: lens gather failed — ${message.slice(0, 300)}`);
    }
  }
  const signals = results.flatMap((result) => result.signals ?? []);
  return new Set(
    signals
      .map(resolvePipelineMembership)
      .filter((membership) => membership.inPipeline)
      .map((membership) => membership.issueId),
  );
}
