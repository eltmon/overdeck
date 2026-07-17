import type { ProjectConfig } from '../../../lib/projects.js';
import type { IssuePipelineMembership } from '@overdeck/contracts';
import { createPromiseConcurrencyLimiter, createSettledTtlPromiseCache } from '../../../lib/concurrency.js';
import { gatherProjectLensSignals, mapPipelineProjects, PIPELINE_PROJECT_CONCURRENCY } from '../../../lib/pipeline-membership-gather.js';
import { resolvePipelineMembership, type IssueLensSignals, type PipelineMembership } from '../../../lib/pipeline-membership.js';

export const PIPELINE_MEMBERSHIP_TTL_MS = 30_000;
export const PIPELINE_MEMBERSHIP_SNAPSHOT_TTL_MS = 5 * 60_000;

interface PipelineMembershipServiceDeps {
  gather(project: ProjectConfig): Promise<IssueLensSignals[]>;
  now(): number;
}

export function createPipelineMembershipService(
  deps: PipelineMembershipServiceDeps = { gather: gatherProjectLensSignals, now: Date.now },
) {
  const cachedGather = createSettledTtlPromiseCache<string, PipelineMembership[]>(PIPELINE_MEMBERSHIP_TTL_MS, deps.now);
  return async (project: ProjectConfig): Promise<PipelineMembership[]> => {
    if (!project.github_repo) return [];
    return cachedGather(project.path, () =>
      deps.gather(project).then((signals) => signals.map(resolvePipelineMembership)));
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

interface MembershipSnapshot {
  value: PipelineMembership[];
  refreshedAt: number;
  refresh?: Promise<void>;
}

const membershipSnapshots = new Map<string, MembershipSnapshot>();
const scheduleMembershipRefresh = createPromiseConcurrencyLimiter(PIPELINE_PROJECT_CONCURRENCY);

function refreshMembershipSnapshot(
  project: ProjectConfig,
  snapshot: MembershipSnapshot,
  getMembership: typeof getProjectPipelineMembership,
  now: () => number,
): Promise<void> {
  if (snapshot.refresh) return snapshot.refresh;
  snapshot.refresh = scheduleMembershipRefresh(() => getMembership(project)).then((value) => {
    snapshot.value = value;
    snapshot.refreshedAt = now();
  }).catch(() => {
    // Keep the last successful snapshot; a cold caller remains unavailable.
  }).finally(() => {
    snapshot.refresh = undefined;
  });
  return snapshot.refresh;
}

/** Return the latest successful snapshot immediately and refresh stale/missing projects in the background. */
export function getPipelineMembershipSnapshotsForProjects(
  projects: ProjectConfig[],
  getMembership = getProjectPipelineMembership,
  now = Date.now,
): ProjectPipelineMembershipResult[] {
  return projects.map((project) => {
    if (!project.github_repo) return { project, error: new Error('Pipeline membership unavailable: missing github_repo') };
    const snapshot = membershipSnapshots.get(project.path);
    if (!snapshot?.refresh && (!snapshot || now() - snapshot.refreshedAt >= PIPELINE_MEMBERSHIP_SNAPSHOT_TTL_MS)) {
      const current = snapshot ?? { value: [], refreshedAt: 0 };
      membershipSnapshots.set(project.path, current);
      void refreshMembershipSnapshot(project, current, getMembership, now);
    }
    return snapshot?.refreshedAt
      ? { project, memberships: snapshot.value }
      : { project, error: new Error('Pipeline membership snapshot is loading') };
  });
}

/** Await only the first snapshot; later resource refreshes consume stale data while revalidating. */
export async function getPipelineMembershipSnapshotsForResourceDiscovery(
  projects: ProjectConfig[],
  getMembership = getProjectPipelineMembership,
  now = Date.now,
): Promise<ProjectPipelineMembershipResult[]> {
  return Promise.all(projects.map(async (project) => {
    if (!project.github_repo) return { project, error: new Error('Pipeline membership unavailable: missing github_repo') };
    const existing = membershipSnapshots.get(project.path);
    if (existing?.refreshedAt) {
      if (now() - existing.refreshedAt >= PIPELINE_MEMBERSHIP_SNAPSHOT_TTL_MS) {
        void refreshMembershipSnapshot(project, existing, getMembership, now);
      }
      return { project, memberships: existing.value };
    }
    const snapshot = existing ?? { value: [], refreshedAt: 0 };
    membershipSnapshots.set(project.path, snapshot);
    await refreshMembershipSnapshot(project, snapshot, getMembership, now);
    return snapshot.refreshedAt
      ? { project, memberships: snapshot.value }
      : { project, error: new Error('Pipeline membership snapshot failed to load') };
  }));
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
