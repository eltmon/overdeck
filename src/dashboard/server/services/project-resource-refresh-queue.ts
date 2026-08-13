import type { ProjectConfig } from '../../../lib/projects.js';
import { listProjectsSync } from '../../../lib/projects.js';
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

export interface ProjectResourceRefreshQueue {
  enqueueProject(project: ProjectConfig, reason: string): void;
  enqueueProjects(projects: ProjectConfig[], reason: string): void;
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

  return {
    enqueueProject,
    enqueueProjects(projects, reason) {
      for (const project of projects) enqueueProject(project, reason);
    },
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
]);

export function shouldRefreshMembershipForResourceRefresh(
  context: ProjectResourceRefreshContext,
): boolean {
  return [...context.reasonsByProjectPath.values()]
    .some((projectReasons) => [...projectReasons].some((reason) => MEMBERSHIP_REFRESH_REASONS.has(reason)));
}

const projectResourceRefreshQueue = createProjectResourceRefreshQueue({
  refreshProjects: (projects, context) => refreshResourceAllocatedProjects(projects, {
    refreshMembership: shouldRefreshMembershipForResourceRefresh(context),
  }),
});

export function enqueueProjectResourceRefresh(project: ProjectConfig, reason: string): void {
  projectResourceRefreshQueue.enqueueProject(project, reason);
}

export function enqueueProjectsResourceRefresh(projects: ProjectConfig[], reason: string): void {
  projectResourceRefreshQueue.enqueueProjects(projects, reason);
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

export function startProjectResourceConvergence(): () => void {
  const timer = setInterval(() => {
    enqueueProjectsResourceRefresh(
      listProjectsSync().map((entry) => entry.config),
      'periodic-convergence',
    );
  }, PROJECT_RESOURCE_CONVERGENCE_INTERVAL_MS);
  timer.unref?.();
  return () => clearInterval(timer);
}
