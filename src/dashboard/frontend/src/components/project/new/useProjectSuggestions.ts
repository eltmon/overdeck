/**
 * Repositories already on this server that are not projects yet (PAN-4281
 * WI-8), from `GET /api/projects/suggestions`. The only owner of this query:
 * the start step lists them and the folder step starts its picker at `root`.
 */

import { useQuery } from '@tanstack/react-query';
import { fetchWithTimeout } from '../../../lib/apiFetch.js';
import type { NestedRepository } from './projectCreateTypes.js';

export interface ProjectSuggestions {
  root: string | undefined;
  homeDir: string | undefined;
  repositories: NestedRepository[];
}

export const PROJECT_SUGGESTIONS_QUERY_KEY = ['project-suggestions'] as const;

export function useProjectSuggestions(): ProjectSuggestions {
  const query = useQuery({
    queryKey: PROJECT_SUGGESTIONS_QUERY_KEY,
    staleTime: 30_000,
    queryFn: async (): Promise<ProjectSuggestions> => {
      const response = await fetchWithTimeout('/api/projects/suggestions', { credentials: 'include' });
      if (!response.ok) return { root: undefined, homeDir: undefined, repositories: [] };
      const data = (await response.json()) as Partial<Record<keyof ProjectSuggestions, unknown>>;
      return {
        root: typeof data.root === 'string' ? data.root : undefined,
        homeDir: typeof data.homeDir === 'string' ? data.homeDir : undefined,
        repositories: Array.isArray(data.repositories) ? (data.repositories as NestedRepository[]) : [],
      };
    },
  });
  return query.data ?? { root: undefined, homeDir: undefined, repositories: [] };
}

/** `path` with the home directory shown as `~`, when it is under home. */
export function tildePath(path: string, homeDir: string | undefined): string {
  if (!homeDir) return path;
  if (path === homeDir) return '~';
  return path.startsWith(`${homeDir}/`) ? `~${path.slice(homeDir.length)}` : path;
}
