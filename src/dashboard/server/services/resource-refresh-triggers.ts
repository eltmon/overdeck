/**
 * Resource-refresh triggers — route lifecycle changes into the project queue.
 *
 * This module only resolves event ownership. Queueing, burst coalescing,
 * non-overlap, membership refresh, and resource publication belong to
 * project-resource-refresh-queue.ts.
 */
import { getAgentStateSync } from '../../../lib/agents.js';
import { listProjectsSync, resolveProjectFromIssueSync, type ProjectConfig } from '../../../lib/projects.js';
import { getEventStore, type Unsubscribe } from '../event-store.js';
import { enqueueProjectsResourceRefresh } from './project-resource-refresh-queue.js';

const TRIGGER_EVENT_TYPES = new Set([
  'agent.created',
  'agent.started',
  'agent.stopped',
  'agent.completed',
  'agent.heartbeat_dead',
]);

export interface ResourceRefreshEvent {
  type: string;
  payload?: unknown;
}

export interface ResourceRefreshTriggerDeps {
  subscribe(fn: (event: ResourceRefreshEvent) => void): Unsubscribe;
  projectForIssue(issueId: string): ProjectConfig | null;
  projectForKey(projectKey: string): ProjectConfig | null;
  issueForAgent(agentId: string): string | null;
  enqueueProjects(projects: ProjectConfig[], reason: string): void;
  warn?: (message: string) => void;
}

export function createResourceRefreshTriggers(deps: ResourceRefreshTriggerDeps): Unsubscribe {
  const warn = deps.warn ?? ((message: string) => console.warn(message));
  return deps.subscribe((event) => {
    if (!TRIGGER_EVENT_TYPES.has(event.type)) return;
    const payload = event.payload as {
      projectKey?: unknown;
      issueId?: unknown;
      agentId?: unknown;
    } | undefined;

    let project: ProjectConfig | null = null;
    if (typeof payload?.projectKey === 'string') {
      project = deps.projectForKey(payload.projectKey);
    }
    if (!project && typeof payload?.issueId === 'string') {
      project = deps.projectForIssue(payload.issueId);
    }
    if (!project && typeof payload?.agentId === 'string') {
      const issueId = deps.issueForAgent(payload.agentId);
      if (issueId) project = deps.projectForIssue(issueId);
    }

    if (!project) {
      warn(`[resource-refresh] skipped ${event.type}: affected project could not be resolved`);
      return;
    }
    deps.enqueueProjects([project], event.type);
  });
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
    issueForAgent: (agentId) => {
      try {
        return getAgentStateSync(agentId)?.issueId ?? null;
      } catch {
        return null;
      }
    },
    enqueueProjects: enqueueProjectsResourceRefresh,
  });
}
