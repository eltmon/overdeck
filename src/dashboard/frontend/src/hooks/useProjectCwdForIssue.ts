import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

interface RegisteredProject {
  key: string;
  name: string;
  path: string;
  linearTeam: string | null;
  githubRepo: string | null;
  linearProject: string | null;
}

export function useRegisteredProjects() {
  return useQuery<RegisteredProject[]>({
    queryKey: ['registered-projects'],
    queryFn: async () => {
      const res = await fetch('/api/registered-projects');
      if (!res.ok) return [];
      return res.json();
    },
    staleTime: 60000,
  });
}

/**
 * Resolve the project root path for an issue id (e.g. `PAN-123` → the
 * `panopticon` project's `path`). Returns `null` when no issue is selected
 * or no matching project is registered — callers should fall back to the
 * server-side default cwd.
 */
export function useProjectCwdForIssue(issueId: string | null): string | null {
  const { data: projects = [] } = useRegisteredProjects();

  return useMemo(() => {
    if (!issueId) return null;
    const prefix = issueId.split('-')[0]?.toUpperCase();
    if (!prefix) return null;
    const match =
      projects.find((p) => p.linearTeam?.toUpperCase() === prefix) ??
      projects.find((p) => p.key.toUpperCase().replace(/-/g, '') === prefix);
    return match?.path ?? null;
  }, [issueId, projects]);
}
