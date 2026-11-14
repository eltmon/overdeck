import type { ProjectConfig } from '../../../lib/projects.js';
import { listProjectsSync } from '../../../lib/projects.js';
import { membershipFallbackMs } from '../../../lib/overdeck/pr-freshness.js';
import { tryResolveProjectTrackerType } from '../../../lib/project-tracker-type.js';
import { membershipSnapshotAgeMs } from './pipeline-membership.js';
import { refreshResourceAllocatedProjects } from './resource-discovery.js';

export const PROJECT_RESOURCE_REFRESH_DEBOUNCE_MS = 1_000;
export const PROJECT_RESOURCE_CONVERGENCE_INTERVAL_MS = 5 * 60_000;

export interface ProjectResourceRefreshQueueState {
  running: boolean;
  activeProjectPaths: string[];
  pendingProjectPaths: string[];
  lastStartedAt: number | null;
  lastCompletedAt: number | null;
  lastError: string | null;
}

export interface ProjectResourceRefreshContext {
  reasonsByProjectPath: ReadonlyMap<string, ReadonlySet<string>>;
}

export interface ProjectResourceRefreshQueueDeps {
  refreshProjects(projects: ProjectConfig[], context: ProjectResourceRefreshContext): Promise<unknown>;
  debounceMs?: number;
  now?: () => number;
}

/** A staggered enqueue in flight (PAN-4264). */
export interface ProjectResourceRefreshStagger {
  /** Resolves once every project was enqueued, or the stagger was cancelled. */
  done: Promise<void>;
  /** Drop the projects not yet enqueued. */
  cancel(): void;
}

export interface ProjectResourceRefreshQueue {
  enqueueProject(project: ProjectConfig, reason: string): void;
  enqueueProjects(projects: ProjectConfig[], reason: string): void;
  /**
   * PAN-4264: enqueue project `i` at `i * spacing`, spacing =
   * max(debounce + 1 s, floor(windowMs / projects.length)). The spacing stays
   * above the debounce, so staggered projects refresh as separate batches
   * instead of one burst of GitHub calls.
   */
  enqueueProjectsStaggered(projects: ProjectConfig[], reason: string, windowMs: number): ProjectResourceRefreshStagger;
  whenIdle(): Promise<void>;
  getState(): ProjectResourceRefreshQueueState;
  stop(): void;
}

export function createProjectResourceRefreshQueue(
  deps: ProjectResourceRefreshQueueDeps,
): ProjectResourceRefreshQueue {
  const debounceMs = deps.debounceMs ?? PROJECT_RESOURCE_REFRESH_DEBOUNCE_MS;
  const now = deps.now ?? Date.now;
  const pending = new Map<string, ProjectConfig>();
  const reasons = new Map<string, Set<string>>();
  const idleWaiters = new Set<() => void>();
  let activeProjectPaths: string[] = [];
  let timer: ReturnType<typeof setTimeout> | null = null;
  let running = false;
  let stopped = false;
  let lastStartedAt: number | null = null;
  let lastCompletedAt: number | null = null;
  let lastError: string | null = null;

  const isIdle = () => !running && timer === null && pending.size === 0;

  const resolveIdleWaiters = () => {
    if (!isIdle()) return;
    for (const resolve of idleWaiters) resolve();
    idleWaiters.clear();
  };

  const drain = async (): Promise<void> => {
    timer = null;
    if (running || stopped) return;
    running = true;
    try {
      while (!stopped && pending.size > 0) {
        const projects = [...pending.values()];
        const reasonsByProjectPath = new Map<string, ReadonlySet<string>>();
        for (const project of projects) {
          reasonsByProjectPath.set(project.path, new Set(reasons.get(project.path) ?? []));
          reasons.delete(project.path);
        }
        pending.clear();
        activeProjectPaths = projects.map((project) => project.path);
        lastStartedAt = now();
        try {
          await deps.refreshProjects(projects, { reasonsByProjectPath });
          lastError = null;
        } catch (error) {
          lastError = error instanceof Error ? error.message : String(error);
          console.warn('[project-resource-refresh] batch failed:', lastError);
        } finally {
          activeProjectPaths = [];
          lastCompletedAt = now();
        }
      }
    } finally {
      running = false;
      resolveIdleWaiters();
    }
  };

  const schedule = () => {
    if (stopped || running || timer) return;
    timer = setTimeout(() => void drain(), debounceMs);
    timer.unref?.();
  };

  const enqueueProject = (project: ProjectConfig, reason: string) => {
    if (stopped) return;
    pending.set(project.path, project);
    const projectReasons = reasons.get(project.path) ?? new Set<string>();
    projectReasons.add(reason);
    reasons.set(project.path, projectReasons);
    schedule();
  };

  const staggers = new Set<ProjectResourceRefreshStagger>();

  const enqueueProjectsStaggered = (
    projects: ProjectConfig[],
    reason: string,
    windowMs: number,
  ): ProjectResourceRefreshStagger => {
    const spacing = Math.max(debounceMs + 1_000, Math.floor(windowMs / Math.max(projects.length, 1)));
    const timers = new Set<ReturnType<typeof setTimeout>>();
    let resolveDone: () => void = () => undefined;
    const done = new Promise<void>((resolve) => {
      resolveDone = resolve;
    });
    let remaining = projects.length;
    const stagger: ProjectResourceRefreshStagger = {
      done,
      cancel() {
        for (const timer of timers) clearTimeout(timer);
        timers.clear();
        staggers.delete(stagger);
        resolveDone();
      },
    };
    if (stopped || remaining === 0) {
      resolveDone();
      return stagger;
    }
    staggers.add(stagger);
    projects.forEach((project, index) => {
      const timer = setTimeout(() => {
        timers.delete(timer);
        enqueueProject(project, reason);
        remaining -= 1;
        if (remaining === 0) stagger.cancel();
      }, index * spacing);
      timer.unref?.();
      timers.add(timer);
    });
    return stagger;
  };

  return {
    enqueueProject,
    enqueueProjects(projects, reason) {
      for (const project of projects) enqueueProject(project, reason);
    },
    enqueueProjectsStaggered,
    whenIdle() {
      if (isIdle()) return Promise.resolve();
      return new Promise<void>((resolve) => idleWaiters.add(resolve));
    },
    getState() {
      return {
        running,
        activeProjectPaths: [...activeProjectPaths],
        pendingProjectPaths: [...pending.keys()],
        lastStartedAt,
        lastCompletedAt,
        lastError,
      };
    },
    stop() {
      stopped = true;
      for (const stagger of [...staggers]) stagger.cancel();
      if (timer) clearTimeout(timer);
      timer = null;
      pending.clear();
      reasons.clear();
      resolveIdleWaiters();
    },
  };
}

const MEMBERSHIP_REFRESH_REASONS = new Set([
  'boot-warm',
  'periodic-convergence',
  'issue.statusChanged:closed-out',
  'pull_request:opened',
  'pull_request:closed',
  'pull_request:reopened',
  'review-door',
  'merge.completed',
  'tracker:issues-changed',
]);

export function shouldRefreshMembershipForResourceRefresh(
  context: ProjectResourceRefreshContext,
): boolean {
  return [...context.reasonsByProjectPath.values()]
    .some((projectReasons) => [...projectReasons].some((reason) => MEMBERSHIP_REFRESH_REASONS.has(reason)));
}

/**
 * PAN-5224: any membership reason other than `periodic-convergence` refreshes
 * at once. `periodic-convergence` alone refreshes only once the project's
 * membership snapshot is at least as old as its fallback interval (longer
 * while webhooks are healthy and the project's tracker is GitHub) — the
 * fallback this project would otherwise miss entirely, since nothing else
 * invalidates its membership snapshot on a 5-minute convergence tick.
 */
export function membershipRefreshForProject(
  project: ProjectConfig,
  reasons: ReadonlySet<string>,
  deps = { ageMs: membershipSnapshotAgeMs, fallbackMs: membershipFallbackMs, trackerType: tryResolveProjectTrackerType },
): boolean {
  const immediate = [...reasons].some((reason) => reason !== 'periodic-convergence' && MEMBERSHIP_REFRESH_REASONS.has(reason));
  if (immediate) return true;
  if (!reasons.has('periodic-convergence')) return false;
  const age = deps.ageMs(project.path);
  return age === null || age >= deps.fallbackMs(deps.trackerType(project) === 'github');
}

const projectResourceRefreshQueue = createProjectResourceRefreshQueue({
  refreshProjects: (projects, context) => refreshResourceAllocatedProjects(projects, {
    refreshMembership: (project) =>
      membershipRefreshForProject(project, context.reasonsByProjectPath.get(project.path) ?? new Set()),
  }),
});

export function enqueueProjectResourceRefresh(project: ProjectConfig, reason: string): void {
  projectResourceRefreshQueue.enqueueProject(project, reason);
}

export function enqueueProjectsResourceRefresh(projects: ProjectConfig[], reason: string): void {
  projectResourceRefreshQueue.enqueueProjects(projects, reason);
}

/** PAN-4264: see `ProjectResourceRefreshQueue.enqueueProjectsStaggered`. */
export function enqueueProjectsResourceRefreshStaggered(
  projects: ProjectConfig[],
  reason: string,
  windowMs: number,
): ProjectResourceRefreshStagger {
  return projectResourceRefreshQueue.enqueueProjectsStaggered(projects, reason, windowMs);
}

export function whenProjectResourceRefreshIdle(): Promise<void> {
  return projectResourceRefreshQueue.whenIdle();
}

export function getProjectResourceRefreshQueueState(): ProjectResourceRefreshQueueState {
  return projectResourceRefreshQueue.getState();
}

export function stopProjectResourceRefreshQueue(): void {
  projectResourceRefreshQueue.stop();
}

/** PAN-4264: boot-warm refreshes spread over this window. */
export const PROJECT_RESOURCE_BOOT_STAGGER_WINDOW_MS = 60_000;
/** PAN-4264: each convergence tick spreads its projects over this window. */
export const PROJECT_RESOURCE_CONVERGENCE_STAGGER_WINDOW_MS = 4 * 60_000;

/**
 * Every 5 minutes, enqueue every project for a periodic convergence refresh,
 * staggered over 4 minutes (PAN-4264). A new tick cancels the previous tick's
 * pending enqueues: with the spacing floor, a large project list can
 * outlast the interval.
 */
export function startProjectResourceConvergence(
  queue: Pick<ProjectResourceRefreshQueue, 'enqueueProjectsStaggered'> = projectResourceRefreshQueue,
  listProjects: () => ProjectConfig[] = () => listProjectsSync().map((entry) => entry.config),
): () => void {
  let stagger: ProjectResourceRefreshStagger | null = null;
  const timer = setInterval(() => {
    stagger?.cancel();
    stagger = queue.enqueueProjectsStaggered(
      listProjects(),
      'periodic-convergence',
      PROJECT_RESOURCE_CONVERGENCE_STAGGER_WINDOW_MS,
    );
  }, PROJECT_RESOURCE_CONVERGENCE_INTERVAL_MS);
  timer.unref?.();
  return () => {
    clearInterval(timer);
    stagger?.cancel();
  };
}
