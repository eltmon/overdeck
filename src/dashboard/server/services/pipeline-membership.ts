import type { ProjectConfig } from '../../../lib/projects.js';
import { gatherProjectLensSignals } from '../../../lib/pipeline-membership-gather.js';
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
