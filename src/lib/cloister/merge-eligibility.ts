import { gatherProjectLensSignals } from '../pipeline-membership-gather.js';
import {
  resolvePipelineMembership,
  type PipelineMembership,
} from '../pipeline-membership.js';
import {
  getProjectSync,
  resolveProjectFromIssueSync,
  type ProjectConfig,
} from '../projects.js';

export interface MergeEligibilityDeps {
  resolveProject: typeof resolveProjectFromIssueSync;
  getProject: typeof getProjectSync;
  gather: typeof gatherProjectLensSignals;
}

const defaultDeps: MergeEligibilityDeps = {
  resolveProject: resolveProjectFromIssueSync,
  getProject: getProjectSync,
  gather: gatherProjectLensSignals,
};

export function isMergeEligible(membership: PipelineMembership): boolean {
  return membership.bucket === 'in_flight';
}

/** Classify candidates through one durable-lens gather per represented project. */
export async function gatherMergeEligibility(
  issueIds: string[],
  deps: MergeEligibilityDeps = defaultDeps,
): Promise<Map<string, PipelineMembership>> {
  const candidatesByProject = new Map<string, { project: ProjectConfig; issueIds: Set<string> }>();

  for (const issueId of issueIds) {
    const resolved = deps.resolveProject(issueId);
    if (!resolved) continue;
    const configured = deps.getProject(resolved.projectKey);
    if (!configured) continue;
    const existing = candidatesByProject.get(resolved.projectKey);
    if (existing) {
      existing.issueIds.add(issueId.toUpperCase());
    } else {
      candidatesByProject.set(resolved.projectKey, {
        project: { ...configured, path: resolved.projectPath },
        issueIds: new Set([issueId.toUpperCase()]),
      });
    }
  }

  const memberships = new Map<string, PipelineMembership>();
  await Promise.all([...candidatesByProject.values()].map(async ({ project, issueIds: candidates }) => {
    const signals = await deps.gather(project);
    for (const signal of signals) {
      const issueId = signal.issueId.toUpperCase();
      if (candidates.has(issueId)) memberships.set(issueId, resolvePipelineMembership(signal));
    }
  }));
  return memberships;
}
