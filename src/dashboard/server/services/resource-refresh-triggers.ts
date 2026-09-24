/**
 * Resource-refresh triggers — route lifecycle changes into the project queue.
 *
 * This module only resolves event ownership. Queueing, burst coalescing,
 * non-overlap, membership refresh, and resource publication belong to
 * project-resource-refresh-queue.ts.
 */
import { getBackendPanes } from './backend-inventory.js';
import { listProjectsSync, resolveProjectFromIssueSync, type ProjectConfig } from '../../../lib/projects.js';
import { getEventStore, type Unsubscribe } from '../event-store.js';
import { enqueueProjectsResourceRefresh } from './project-resource-refresh-queue.js';

const TRIGGER_EVENT_TYPES = new Set([
  'agent.created',
  'agent.started',
  'agent.stopped',
  'agent.completed',
  'agent.heartbeat_dead',
  'issue.statusChanged',
]);

export interface ResourceRefreshEvent {
  type: string;
  payload?: unknown;
}

export interface ResourceRefreshTriggerDeps {
  subscribe(fn: (event: ResourceRefreshEvent) => void): Unsubscribe;
  projectForIssue(issueId: string): ProjectConfig | null;
  projectForKey(projectKey: string): ProjectConfig | null;
  issueForAgent(agentId: string): Promise<string | null>;
  enqueueProjects(projects: ProjectConfig[], reason: string): void;
  warn?: (message: string) => void;
}

export function createResourceRefreshTriggers(deps: ResourceRefreshTriggerDeps): Unsubscribe {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  return deps.subscribe((event) => { void (async () => {
    if (!TRIGGER_EVENT_TYPES.has(event.type)) return;
    const payload = event.payload as {
      projectKey?: unknown;
      issueId?: unknown;
      agentId?: unknown;
      labels?: unknown;
    } | undefined;

    let project: ProjectConfig | null = null;
    if (typeof payload?.projectKey === 'string') {
      project = deps.projectForKey(payload.projectKey);
    }
    if (!project && typeof payload?.issueId === 'string') {
      project = deps.projectForIssue(payload.issueId);
    }
    if (!project && typeof payload?.agentId === 'string') {
      const issueId = await deps.issueForAgent(payload.agentId);
      if (issueId) project = deps.projectForIssue(issueId);
    }

    if (!project) {
      warn(`[resource-refresh] skipped ${event.type}: affected project could not be resolved`);
      return;
    }
    const reason = event.type === 'issue.statusChanged'
      && Array.isArray(payload?.labels)
      && payload.labels.some((label) => String(label).toLowerCase() === 'closed-out')
      ? 'issue.statusChanged:closed-out'
      : event.type;
    deps.enqueueProjects([project], reason);
  })(); });
}

export function startResourceRefreshTriggers(): Unsubscribe {
  const entries = () => listProjectsSync();
  return createResourceRefreshTriggers({
    subscribe: (fn) => getEventStore().subscribe(fn),
    projectForIssue: (issueId) => {
      const resolved = resolveProjectFromIssueSync(issueId);
      if (!resolved) return null;
      return entries().find((entry) => entry.key === resolved.projectKey)?.config ?? null;
    },
    projectForKey: (projectKey) =>
      entries().find((entry) => entry.key === projectKey)?.config ?? null,
    // PAN-3917 FR-12: an agent's issue is its pane's `issue` token, read live
    // from the backend inventory rather than from a persisted agent mirror.
    issueForAgent: async (agentId) => {
      try {
        return (await getBackendPanes()).find((pane) => pane.id === agentId)?.issue ?? null;
      } catch {
        return null;
      }
    },
    enqueueProjects: enqueueProjectsResourceRefresh,
  });
}
