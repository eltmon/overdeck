/**
 * useProjectKeyForCwd (PAN-1533)
 *
 * Resolve a conversation's `cwd` to the Panopticon project it belongs to.
 * Used by the WorktreePickerMenu to know which project's worktree
 * endpoints to call. Returns `null` when the cwd is not inside any
 * registered project (e.g. cwd is `/tmp` or `~`).
 *
 * Mirrors the same project-prefix match the CommandDeck already does
 * (see CommandDeck/index.tsx where `pathToKey` is built and matched).
 */

import { useQuery } from '@tanstack/react-query';
import { useMemo } from 'react';

interface RegisteredProject {
  key: string;
  path: string;
  name?: string;
}

async function fetchRegisteredProjects(): Promise<RegisteredProject[]> {
  const res = await fetch('/api/registered-projects');
  if (!res.ok) throw new Error(`Failed to load registered projects (${res.status})`);
  const data = await res.json();
  return Array.isArray(data) ? data : [];
}

export function useProjectKeyForCwd(cwd: string | null | undefined): string | null {
  const { data: projects = [] } = useQuery({
    queryKey: ['registered-projects'],
    queryFn: fetchRegisteredProjects,
    staleTime: 60_000,
  });

  return useMemo(() => {
    if (!cwd) return null;
    // Longest-prefix match wins — a workspace under workspaces/feature-X
    // is still inside the project, but if a future project has a path
    // that's a prefix of another, prefer the more specific one.
    const candidates = projects
      .filter((p) => p.path && (cwd === p.path || cwd.startsWith(p.path + '/')))
      .sort((a, b) => b.path.length - a.path.length);
    return candidates[0]?.key ?? null;
  }, [cwd, projects]);
}
