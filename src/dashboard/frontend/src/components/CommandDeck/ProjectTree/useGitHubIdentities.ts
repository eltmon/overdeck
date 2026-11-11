/**
 * PAN-5153: `GET /api/github/identities` — who acts on each registered
 * project's GitHub repository, grouped by owner. The types mirror
 * `src/lib/github-repo-identity.ts` (declared again here, as MergeBackendStatus
 * is, so the frontend imports nothing from the server).
 */
import { useQuery } from '@tanstack/react-query';

export interface GitHubIdentityProject {
  key: string;
  name: string;
  /** "owner/repo" */
  repo: string;
  mode: 'app' | 'user' | 'none';
  actor: string | null;
  detail: string;
}

export interface GitHubIdentityOwner {
  owner: string;
  projects: GitHubIdentityProject[];
}

export interface GitHubIdentitiesSnapshot {
  ghLogin: string | null;
  appSlug: string | null;
  owners: GitHubIdentityOwner[];
}

async function fetchGitHubIdentities(): Promise<GitHubIdentitiesSnapshot> {
  const res = await fetch('/api/github/identities');
  if (!res.ok) throw new Error(`GitHub identities request failed: ${res.status}`);
  return await res.json() as GitHubIdentitiesSnapshot;
}

export function useGitHubIdentities() {
  return useQuery({
    queryKey: ['github-identities'],
    queryFn: fetchGitHubIdentities,
    staleTime: 60_000,
  });
}

/** The owner and identity of one project, or null when the snapshot does not list it. */
export function findProjectIdentity(
  snapshot: GitHubIdentitiesSnapshot | undefined,
  projectKey: string,
): { owner: string; project: GitHubIdentityProject } | null {
  for (const { owner, projects } of snapshot?.owners ?? []) {
    const project = projects.find((p) => p.key === projectKey);
    if (project) return { owner, project };
  }
  return null;
}
