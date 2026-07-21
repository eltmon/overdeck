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

export interface PipelineMembershipService {
  (project: ProjectConfig): Promise<PipelineMembership[]>;
  /** Drop the settled per-project TTL entry so the next call re-gathers (PAN-2893 event-driven refresh). */
  invalidate(projectPath?: string): void;
}

export function createPipelineMembershipService(
  deps: PipelineMembershipServiceDeps = { gather: gatherProjectLensSignals, now: Date.now },
): PipelineMembershipService {
  const cachedGather = createSettledTtlPromiseCache<string, PipelineMembership[]>(PIPELINE_MEMBERSHIP_TTL_MS, deps.now);
  const service = async (project: ProjectConfig): Promise<PipelineMembership[]> =>
    cachedGather(project.path, () =>
      deps.gather(project).then((signals) => signals.map(resolvePipelineMembership)));
  service.invalidate = (projectPath?: string): void => cachedGather.invalidate(projectPath);
  return service;
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

type MembershipLookup = (project: ProjectConfig) => Promise<PipelineMembership[]>;

interface MembershipSnapshot {
  value: PipelineMembership[];
  refreshedAt: number;
  refresh?: Promise<void>;
  lastError?: string;
  lastErrorAt?: number;
}

const membershipSnapshots = new Map<string, MembershipSnapshot>();
const scheduleMembershipRefresh = createPromiseConcurrencyLimiter(PIPELINE_PROJECT_CONCURRENCY);

function refreshMembershipSnapshot(
  project: ProjectConfig,
  snapshot: MembershipSnapshot,
  getMembership: MembershipLookup,
  now: () => number,
): Promise<void> {
  if (snapshot.refresh) return snapshot.refresh;
  snapshot.refresh = scheduleMembershipRefresh(() => getMembership(project)).then((value) => {
    snapshot.value = value;
    snapshot.refreshedAt = now();
    snapshot.lastError = undefined;
    snapshot.lastErrorAt = undefined;
  }).catch((error: unknown) => {
    // Keep the last successful snapshot; a cold caller remains unavailable.
    // Record and log the failure — a swallowed boot-warm failure previously
    // left a cold project with zero diagnostic trace (PAN-2972).
    snapshot.lastError = error instanceof Error ? error.message : String(error);
    snapshot.lastErrorAt = now();
    console.warn(
      `[pipeline-membership] refresh failed for ${project.name ?? project.path}; keeping last-good snapshot:`,
      snapshot.lastError,
    );
  }).finally(() => {
    snapshot.refresh = undefined;
  });
  return snapshot.refresh;
}

/** Read the latest successful snapshots without scheduling tracker or git work. */
export function readPipelineMembershipSnapshotsForProjects(
  projects: ProjectConfig[],
): ProjectPipelineMembershipResult[] {
  return projects.map((project) => {
    const snapshot = membershipSnapshots.get(project.path);
    if (snapshot?.refreshedAt) return { project, memberships: snapshot.value };
    // Cold cache: surface the recorded failure when one exists so the operator
    // sees the real cause instead of a permanent "loading" (PAN-2972).
    return {
      project,
      error: new Error(snapshot?.lastError
        ? `Pipeline membership refresh failed: ${snapshot.lastError}`
        : 'Pipeline membership snapshot is loading'),
    };
  });
}

/** Return the latest successful snapshot immediately and refresh stale/missing projects in the background. */
export function getPipelineMembershipSnapshotsForProjects(
  projects: ProjectConfig[],
  getMembership: MembershipLookup = getProjectPipelineMembership,
  now = Date.now,
): ProjectPipelineMembershipResult[] {
  const results = readPipelineMembershipSnapshotsForProjects(projects);
  for (const project of projects) {
    const snapshot = membershipSnapshots.get(project.path);
    if (!snapshot?.refresh && (!snapshot || now() - snapshot.refreshedAt >= PIPELINE_MEMBERSHIP_SNAPSHOT_TTL_MS)) {
      const current = snapshot ?? { value: [], refreshedAt: 0 };
      membershipSnapshots.set(project.path, current);
      void refreshMembershipSnapshot(project, current, getMembership, now);
    }
  }
  return results;
}

/** Await only the first snapshot; later resource refreshes consume stale data while revalidating. */
export async function getPipelineMembershipSnapshotsForResourceDiscovery(
  projects: ProjectConfig[],
  getMembership: MembershipLookup = getProjectPipelineMembership,
  now = Date.now,
): Promise<ProjectPipelineMembershipResult[]> {
  return Promise.all(projects.map(async (project) => {
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

/**
 * PAN-2893 — event-driven refresh. Invalidate the per-project TTL cache and
 * force a snapshot re-gather NOW for the given projects, so agent lifecycle
 * changes reach membership consumers without waiting out the 5-minute TTL.
 * Refresh failures keep the last good snapshot (same policy as TTL refreshes).
 */
export async function refreshMembershipSnapshotsForProjects(
  projects: ProjectConfig[],
  getMembership = getProjectPipelineMembership,
  now = Date.now,
): Promise<void> {
  await Promise.all(projects.map(async (project) => {
    getMembership.invalidate(project.path);
    const snapshot = membershipSnapshots.get(project.path) ?? { value: [], refreshedAt: 0 };
    membershipSnapshots.set(project.path, snapshot);
    // A refresh that started BEFORE the triggering event may resolve with
    // pre-event data; chain a fresh gather behind it instead of reusing it.
    const inFlight = snapshot.refresh;
    if (inFlight) {
      await inFlight;
      getMembership.invalidate(project.path);
    }
    await refreshMembershipSnapshot(project, snapshot, getMembership, now);
  }));
}

/**
 * PAN-2893 — last successful membership result for a project, or null when no
 * gather has ever succeeded. Lets the membership route serve stale data through
 * a transient tracker failure (e.g. a Linear 503) instead of erroring the pane.
 */
export function getLastGoodMembershipSnapshot(projectPath: string): PipelineMembership[] | null {
  const snapshot = membershipSnapshots.get(projectPath);
  return snapshot?.refreshedAt ? snapshot.value : null;
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
