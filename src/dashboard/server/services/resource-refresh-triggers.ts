/**
 * Resource-refresh triggers (PAN-2893) — event-driven cache convergence.
 *
 * The issues pane is fed by two TTL caches (resource discovery, 30s; pipeline
 * membership snapshots, 5m), both stale-while-revalidate. Before this module,
 * an agent spawn/stop only reached the pane after every TTL expired — minutes
 * of "issue missing from the pipeline" after `pan start`. This module
 * subscribes to the domain event store and, on agent lifecycle events,
 * refreshes the affected project's membership snapshot and then the
 * resource-allocated snapshot, so the next frontend poll (or event-driven
 * refetch) sees post-change state within seconds.
 *
 * Bursts (a convoy spawning several agents) are debounced into one refresh;
 * projects touched during the debounce window are accumulated.
 */
import { getEventStore, type Unsubscribe } from '../event-store.js';
import { refreshMembershipSnapshotsForProjects } from './pipeline-membership.js';
import { triggerResourceDiscoveryRefresh } from './resource-discovery.js';
import { listProjectsSync, resolveProjectFromIssueSync, type ProjectConfig } from '../../../lib/projects.js';

/** Lifecycle transitions that change which issues hold allocated resources. */
const TRIGGER_EVENT_TYPES = new Set([
  'agent.created',
  'agent.started',
  'agent.stopped',
  'agent.completed',
]);

const DEBOUNCE_MS = 1_000;
/**
 * Hard floor between event-driven refreshes. A refresh is a heavy compute
 * (tracker fetches + git scans + docker/tmux probes); under constant agent
 * churn (flywheel runs), refreshing per burst becomes a continuous compute
 * loop that pegs the CPU and starves the event loop (observed 2026-07-19:
 * 100% CPU, p99 event-loop delay >1s). Events arriving inside the floor are
 * accumulated and served by ONE refresh when the floor expires.
 */
const MIN_REFRESH_INTERVAL_MS = 30_000;

/** Minimal event shape the triggers need — matches the store's StoredEvent. */
export interface ResourceRefreshEvent {
  type: string;
  payload?: unknown;
}

export interface ResourceRefreshTriggerDeps {
  subscribe(fn: (event: ResourceRefreshEvent) => void): Unsubscribe;
  projectForIssue(issueId: string): ProjectConfig | null;
  allProjects(): ProjectConfig[];
  refreshMemberships(projects: ProjectConfig[]): Promise<void>;
  refreshResources(): Promise<unknown>;
  debounceMs?: number;
  minIntervalMs?: number;
  now?: () => number;
}

export function createResourceRefreshTriggers(deps: ResourceRefreshTriggerDeps): Unsubscribe {
  const debounceMs = deps.debounceMs ?? DEBOUNCE_MS;
  const minIntervalMs = deps.minIntervalMs ?? MIN_REFRESH_INTERVAL_MS;
  const now = deps.now ?? Date.now;
  const pendingProjects = new Map<string, ProjectConfig>();
  let pendingAll = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let lastFlushAt = 0;
  let refreshInFlight = false;

  const flush = (): void => {
    timer = null;
    if (refreshInFlight) {
      // Never queue a second compute behind a running one — re-arm and let the
      // accumulated projects ride the next flush. Unbounded chaining under
      // constant agent churn is exactly the continuous-compute loop this guard
      // exists to prevent.
      timer = setTimeout(flush, minIntervalMs);
      timer.unref?.();
      return;
    }
    lastFlushAt = now();
    const projects = pendingAll ? deps.allProjects() : [...pendingProjects.values()];
    pendingProjects.clear();
    pendingAll = false;
    if (projects.length === 0) return;
    refreshInFlight = true;
    void deps.refreshMemberships(projects)
      .then(() => deps.refreshResources())
      .catch((err: unknown) => {
        console.warn('[resource-refresh] event-driven refresh failed:', err instanceof Error ? err.message : String(err));
      })
      .finally(() => {
        refreshInFlight = false;
      });
  };

  const unsubscribe = deps.subscribe((event) => {
    if (!TRIGGER_EVENT_TYPES.has(event.type)) return;
    const issueId = (event as { payload?: { issueId?: unknown } }).payload?.issueId;
    const project = typeof issueId === 'string' ? deps.projectForIssue(issueId) : null;
    if (project) pendingProjects.set(project.path, project);
    else pendingAll = true;
    if (!timer) {
      const sinceLastFlush = now() - lastFlushAt;
      const delay = Math.max(debounceMs, minIntervalMs - sinceLastFlush);
      timer = setTimeout(flush, delay);
      timer.unref?.();
    }
  });

  return () => {
    if (timer) clearTimeout(timer);
    timer = null;
    unsubscribe();
  };
}

/** Wire the triggers to the shared event store and live services (called from main.ts). */
export function startResourceRefreshTriggers(): Unsubscribe {
  return createResourceRefreshTriggers({
    subscribe: (fn) => getEventStore().subscribe(fn),
    // The gather needs the FULL ProjectConfig (issue_prefix, github_repo, …),
    // so resolve the issue to its project key and hand back the config entry.
    projectForIssue: (issueId) => {
      const resolved = resolveProjectFromIssueSync(issueId);
      if (!resolved) return null;
      return listProjectsSync().find((entry) => entry.key === resolved.projectKey)?.config ?? null;
    },
    allProjects: () => listProjectsSync().map((entry) => entry.config),
    refreshMemberships: (projects) => refreshMembershipSnapshotsForProjects(projects),
    refreshResources: () => triggerResourceDiscoveryRefresh(),
  });
}
