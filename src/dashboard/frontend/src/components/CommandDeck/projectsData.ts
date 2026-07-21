/**
 * projectsData — shared project list fetch/shape for the project-scoped nav
 * (PAN-1561). Both the App Sidebar (project rail) and the CommandDeck (project
 * workspace) read this via the same react-query key `command-deck-projects`,
 * so the network request is deduped and both surfaces agree on the list.
 */
import { compareIssueIds } from '@overdeck/contracts';
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

/** True when a conversation's cwd is not under any registered project (or has no
 * cwd) — i.e. it belongs in the No-project bucket. */
export function isUnscopedConversation(
  conv: { cwd?: string | null },
  registeredProjects: readonly RegisteredProjectLite[],
): boolean {
  const cwd = conv.cwd;
  if (!cwd) return true;
  return !registeredProjects.some((rp) => rp.path && (cwd === rp.path || cwd.startsWith(rp.path + '/')));
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

export async function fetchProjectPipelineMembership(projectKey: string): Promise<true> {
  const response = await fetch(`/api/pipeline/membership?project=${encodeURIComponent(projectKey)}`);
  if (response.ok) return true;
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
    { method: 'POST' },
  );
  if (response.ok) return true;
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
