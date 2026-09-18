/**
 * Docker stacks grouped by compose project, with each stack's issue state.
 *
 * PAN-3917 W6: a stack's pipeline position used to be `phase`, computed from
 * the six status fields on the review-status record. It is now `state` — the
 * derived issue state (FR-6), read from the tracker, the forge, git, and the
 * terminal backend. `buildResourceStacks` stays pure over an already-loaded
 * state map so the grouping logic is testable without touching a forge.
 */

import type { DerivedIssueState, IssueState } from '@overdeck/contracts';

import { loadIssueStatesForProject } from '../../services/derived-issue-state.js';
import { resolveProjectFromIssueSync } from '../../../../lib/projects.js';

export interface StackContainerResource {
  id: string;
  name: string;
  cpuPercent?: number;
  memoryUsage?: number;
  memoryLimit?: number;
  diskUsage?: number;
  status?: string;
  labels?: Record<string, string>;
}

export interface ResourceStack {
  id: string;
  issueId: string | null;
  issueTitle: string;
  composeProject: string;
  serviceCount: number;
  services: StackContainerResource[];
  aggregates: {
    cpuPercent: number;
    memoryBytes: number;
    diskBytes: number;
  };
  /** Derived issue state (FR-6). `null` for a stack with no issue. */
  state: IssueState | null;
}

/** Derived state per issue id, as `buildResourceStacks` wants it. */
export type IssueStatesByIssueId = ReadonlyMap<string, DerivedIssueState>;

/**
 * Group containers into stacks and stamp each one's derived issue state.
 *
 * Async because the state is read from its owners; `buildResourceStacks` is
 * the pure half.
 */
export async function getResourceStacks(containers: StackContainerResource[]): Promise<ResourceStack[]> {
  return buildResourceStacks(containers, await loadStackIssueStates(containers));
}

/** Pure: group containers and attach the states the caller already loaded. */
export function buildResourceStacks(
  containers: StackContainerResource[],
  issueStates: IssueStatesByIssueId = new Map(),
): ResourceStack[] {
  return [...groupByComposeProject(containers).entries()].map(([composeProject, services]) => {
    const issueId = issueIdFor(composeProject, services);
    return {
      id: issueId ?? composeProject,
      issueId,
      issueTitle: issueId ?? 'Unassigned',
      composeProject,
      serviceCount: services.length,
      services,
      aggregates: {
        cpuPercent: roundOne(services.reduce((sum, service) => sum + (service.cpuPercent ?? 0), 0)),
        memoryBytes: services.reduce((sum, service) => sum + (service.memoryUsage ?? 0), 0),
        diskBytes: services.reduce((sum, service) => sum + (service.diskUsage ?? 0), 0),
      },
      state: issueId ? issueStates.get(issueId)?.state ?? null : null,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * Derive the state of every issue these containers belong to, one batched
 * forge read per project rather than one per stack.
 */
export async function loadStackIssueStates(
  containers: StackContainerResource[],
): Promise<IssueStatesByIssueId> {
  const byProject = new Map<string, string[]>();
  for (const [composeProject, services] of groupByComposeProject(containers)) {
    const issueId = issueIdFor(composeProject, services);
    if (!issueId) continue;
    const projectPath = resolveProjectFromIssueSync(issueId)?.projectPath;
    if (!projectPath) continue;
    byProject.set(projectPath, [...(byProject.get(projectPath) ?? []), issueId]);
  }

  const states = new Map<string, DerivedIssueState>();
  const loaded = await Promise.allSettled(
    [...byProject.entries()].map(([projectPath, issueIds]) =>
      loadIssueStatesForProject(projectPath, issueIds),
    ),
  );
  for (const outcome of loaded) {
    if (outcome.status !== 'fulfilled') continue;
    for (const [issueId, state] of outcome.value) states.set(issueId, state);
  }
  return states;
}

function groupByComposeProject(
  containers: StackContainerResource[],
): Map<string, StackContainerResource[]> {
  const groups = new Map<string, StackContainerResource[]>();
  for (const container of containers) {
    const key = composeProjectFor(container) ?? 'unassigned';
    groups.set(key, [...(groups.get(key) ?? []), container]);
  }
  return groups;
}

function composeProjectFor(container: StackContainerResource): string | null {
  const labelProject = container.labels?.['com.docker.compose.project']?.trim();
  if (labelProject) return labelProject;

  const issueProject = container.name.match(/^(.+?feature[-_](?:pan|min|aur|krux)[-_]?\d+)/i);
  if (issueProject?.[1]) return issueProject[1];

  const match = container.name.match(/^(.+?)[_-][a-z0-9]+[._-][0-9]+$/i);
  return match?.[1] ?? null;
}

function issueIdFor(composeProject: string, services: StackContainerResource[]): string | null {
  if (composeProject === 'unassigned') return null;
  const fromProject = issueIdFromText(composeProject);
  if (fromProject) return fromProject;

  for (const service of services) {
    const labelText = Object.values(service.labels ?? {}).join(' ');
    const fromLabels = issueIdFromText(labelText);
    if (fromLabels) return fromLabels;
  }

  return null;
}

function issueIdFromText(value: string): string | null {
  const match = value.match(/(?:workspaces[\\/])?feature[-_](pan|min|aur|krux)[-_]?(\d+)/i)
    ?? value.match(/\b(pan|min|aur|krux)[-_]?(\d+)\b/i);
  if (!match) return null;
  return `${match[1].toUpperCase()}-${match[2]}`;
}

function roundOne(value: number): number {
  return Math.round(value * 10) / 10;
}
