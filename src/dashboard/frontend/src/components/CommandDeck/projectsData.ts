/**
 * projectsData — shared project list fetch/shape for the project-scoped nav
 * (PAN-1561). Both the App Sidebar (project rail) and the CommandDeck (project
 * workspace) read this via the same react-query key `command-deck-projects`,
 * so the network request is deduped and both surfaces agree on the list.
 */
import { compareIssueIds } from '@overdeck/contracts';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport';
import type { ProjectFeature } from './ProjectTree/ProjectNode';

/** Sentinel deck key for the "No project" bucket — conversations/terminals not
 * under any registered project (PAN-1561). */
export const NO_PROJECT_KEY = '__no-project__';
export const NO_PROJECT_LABEL = 'No project';

export interface RegisteredProjectLite {
  key: string;
  name?: string;
  path: string;
}

/** The project a conversation effectively belongs to (PAN-1577): the explicit
 * `projectKey` override when set, otherwise the registered project whose path
 * contains `cwd`. Null when neither resolves — the single source of truth for
 * every "is this conversation already in project X" check (grouping, the move
 * pickers' current-project indicator, and drag-drop's no-op detection) so they
 * can't disagree with each other. */
export function resolveEffectiveProjectKey(
  conv: { cwd?: string | null; projectKey?: string | null },
  registeredProjects: readonly RegisteredProjectLite[],
): string | null {
  if (conv.projectKey) return conv.projectKey;
  const cwd = conv.cwd;
  if (!cwd) return null;
  const matched = registeredProjects.find((rp) => rp.path && (cwd === rp.path || cwd.startsWith(rp.path + '/')));
  return matched?.key ?? null;
}

/** Resolve a conversation's effective project record for consumers that need its display name. */
export function resolveConversationProject(
  conv: { cwd?: string | null; projectKey?: string | null },
  registeredProjects: readonly RegisteredProjectLite[],
): RegisteredProjectLite | null {
  const key = resolveEffectiveProjectKey(conv, registeredProjects);
  return key ? registeredProjects.find((project) => project.key === key) ?? null : null;
}

/** True when a conversation doesn't resolve to any registered project — i.e. it
 * belongs in the No-project bucket. */
export function isUnscopedConversation(
  conv: { cwd?: string | null; projectKey?: string | null },
  registeredProjects: readonly RegisteredProjectLite[],
): boolean {
  const effectiveKey = resolveEffectiveProjectKey(conv, registeredProjects);
  return effectiveKey === null || !registeredProjects.some((rp) => rp.key === effectiveKey);
}

export interface ProjectData {
  key: string;
  name: string;
  path: string;
  features: ProjectFeature[];
}

export function filterSpecOnlyPlanned(
  features: ProjectFeature[],
  showPlannedBacklog: boolean,
): ProjectFeature[] {
  if (showPlannedBacklog) return features;
  return features.filter((feature) => feature.specOnlyPlanned !== true);
}

export function groupProjects(issues: ProjectFeature[]): ProjectData[] {
  const grouped = new Map<string, ProjectData>();

  for (const issue of issues) {
    const existing = grouped.get(issue.projectName);
    if (existing) {
      existing.features.push(issue);
      continue;
    }

    grouped.set(issue.projectName, {
      key: issue.projectName,
      name: issue.projectName,
      path: issue.projectName,
      features: [issue],
    });
  }

  return [...grouped.values()]
    .map((project) => ({
      ...project,
      features: [...project.features].sort((a, b) => compareIssueIds(a.issueId, b.issueId)),
    }))
    .sort((a, b) => a.name.localeCompare(b.name));
}

async function readMembershipSuccess(response: Response): Promise<true> {
  const body = await response.json() as unknown;
  if (typeof body === 'object' && body !== null && !Array.isArray(body)) {
    const result = body as Record<string, unknown>;
    if (result.status === 'unavailable') {
      const message = typeof result.message === 'string'
        ? result.message
        : 'Pipeline membership could not be loaded';
      const reason = typeof result.reason === 'string' ? result.reason : 'gather_failed';
      throw new Error(`${message} (${reason})`);
    }
  }
  return true;
}

export async function fetchProjectPipelineMembership(projectKey: string): Promise<true> {
  const response = await fetch(`/api/pipeline/membership?project=${encodeURIComponent(projectKey)}`);
  if (response.ok) return readMembershipSuccess(response);
  throw new Error(await readMembershipError(response));
}

/**
 * PAN-2972 — operator-initiated retry. A cold snapshot can only be healed by a
 * re-gather, so the retry button POSTs to the refresh route instead of
 * re-reading the same cold snapshot.
 */
export async function refreshProjectPipelineMembership(projectKey: string): Promise<true> {
  const response = await fetch(
    `/api/pipeline/membership/refresh?project=${encodeURIComponent(projectKey)}`,
    { method: 'POST', headers: await dashboardMutationJsonHeaders() },
  );
  if (response.ok) return readMembershipSuccess(response);
  throw new Error(await readMembershipError(response));
}

async function readMembershipError(response: Response): Promise<string> {
  let message = 'Pipeline membership could not be loaded';
  try {
    const body = await response.json() as { error?: unknown };
    if (typeof body.error === 'string') message = body.error;
  } catch {
    // Keep the operator-facing fallback when the server returns a non-JSON error.
  }
  return message;
}

export async function fetchProjects(): Promise<ProjectData[]> {
  const [issuesRes, registeredRes] = await Promise.all([
    fetch('/api/issues/resource-allocated'),
    fetch('/api/registered-projects'),
  ]);
  if (!issuesRes.ok) throw new Error('Failed to fetch resource-allocated issues');
  if (!registeredRes.ok) throw new Error('Failed to fetch registered projects');

  const issues = await issuesRes.json() as ProjectFeature[];
  const registered = await registeredRes.json() as { key: string; name: string; path: string }[];

  // Start with projects that have qualifying issues
  const projectMap = new Map(groupProjects(issues).map(p => [p.name, p]));

  // Preserve stable keys when registered projects already have grouped issues.
  for (const proj of registered) {
    const name = proj.name ?? proj.key;
    const existing = projectMap.get(name);
    projectMap.set(name, existing
      ? { ...existing, key: proj.key, path: proj.path }
      : { key: proj.key, name, path: proj.path, features: [] });
  }

  return [...projectMap.values()].sort((a, b) => a.name.localeCompare(b.name));
}
