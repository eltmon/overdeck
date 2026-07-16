import type { ProjectConfig } from '../../../lib/projects.js';
import type { IssuePipelineMembership } from '@overdeck/contracts';
import { gatherProjectLensSignals, mapPipelineProjects } from '../../../lib/pipeline-membership-gather.js';
import { resolvePipelineMembership, type IssueLensSignals, type PipelineMembership } from '../../../lib/pipeline-membership.js';

export const PIPELINE_MEMBERSHIP_TTL_MS = 30_000;

interface PipelineMembershipServiceDeps {
  gather(project: ProjectConfig): Promise<IssueLensSignals[]>;
  now(): number;
}

export function createPipelineMembershipService(
  deps: PipelineMembershipServiceDeps = { gather: gatherProjectLensSignals, now: Date.now },
) {
  const cache = new Map<string, { expiresAt: number; value: Promise<PipelineMembership[]> }>();
  return async (project: ProjectConfig): Promise<PipelineMembership[]> => {
    if (!project.github_repo) return [];
    const key = project.path;
    const cached = cache.get(key);
    if (cached && cached.expiresAt > deps.now()) return cached.value;
    const value = deps.gather(project).then((signals) => signals.map(resolvePipelineMembership));
    cache.set(key, { expiresAt: deps.now() + PIPELINE_MEMBERSHIP_TTL_MS, value });
    value.catch(() => {
      if (cache.get(key)?.value === value) cache.delete(key);
    });
    return value;
  };
}

export const getProjectPipelineMembership = createPipelineMembershipService();

export async function getPipelineMembershipForProjects(
  projects: ProjectConfig[],
  getMembership = getProjectPipelineMembership,
): Promise<PipelineMembership[]> {
  const results = await getPipelineMembershipResultsForProjects(projects, getMembership);
  const failed = results.find((result) => result.error);
  if (failed) throw failed.error;
  return results.flatMap((result) => result.memberships ?? []);
}

export interface ProjectPipelineMembershipResult {
  project: ProjectConfig;
  memberships?: PipelineMembership[];
  error?: unknown;
}

export async function getPipelineMembershipResultsForProjects(
  projects: ProjectConfig[],
  getMembership = getProjectPipelineMembership,
): Promise<ProjectPipelineMembershipResult[]> {
  const gathered = await mapPipelineProjects(projects, getMembership);
  return gathered.map(({ project, value, error }) => {
    if (error) return { project, error };
    return { project, memberships: value ?? [] };
  });
}

export function summarizePipelineMembership(membership: PipelineMembership): IssuePipelineMembership {
  return {
    available: true,
    inPipeline: membership.inPipeline,
    bucket: membership.bucket,
    labelDrift: membership.labelDrift,
  };
}

export function unavailablePipelineMembership(): IssuePipelineMembership {
  return { available: false, inPipeline: false, bucket: 'clean_terminal', labelDrift: null };
}
