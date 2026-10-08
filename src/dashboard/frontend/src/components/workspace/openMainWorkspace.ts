import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { fetchWithTimeout } from '../../lib/apiFetch.js';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport.js';

interface RegistryRow {
  id: string;
  projectId: string;
  kind: 'main' | 'issue' | 'scratch';
  isArchived: boolean;
}

async function errorMessage(response: Response): Promise<string> {
  const body = (await response.json().catch(() => ({}))) as { findings?: Array<{ message?: string }>; error?: string };
  return body.findings?.[0]?.message ?? body.error ?? `HTTP ${response.status}`;
}

/**
 * The id of a project's main-checkout workspace, created on first use.
 *
 * A project's primary checkout is its `kind='main'` workspace, created lazily
 * (docs/WORKSPACES-AND-PROJECTS.md). An archived main row is unarchived rather
 * than re-created: the writer allows one main row per project, archived or not.
 */
export async function ensureMainWorkspace(projectKey: string): Promise<string> {
  // includeArchived: the list hides archived rows by default, and an archived
  // main row still blocks creating a second one.
  const query = new URLSearchParams({ project: projectKey, kind: 'main', includeArchived: 'true' });
  const list = await fetchWithTimeout(`/api/workspace-registry?${query}`, { credentials: 'include' });
  if (!list.ok) throw new Error(await errorMessage(list));
  const { workspaces = [] } = (await list.json()) as { workspaces?: RegistryRow[] };
  const existing = workspaces.find((ws) => ws.kind === 'main' && ws.projectId === projectKey);

  if (existing) {
    if (existing.isArchived) {
      const restored = await fetchWithTimeout(`/api/workspace-registry/${encodeURIComponent(existing.id)}/archive`, {
        method: 'POST',
        credentials: 'include',
        headers: await dashboardMutationJsonHeaders(),
        body: JSON.stringify({ archived: false }),
      });
      if (!restored.ok) throw new Error(await errorMessage(restored));
    }
    return existing.id;
  }

  const created = await fetchWithTimeout('/api/workspace-registry', {
    method: 'POST',
    credentials: 'include',
    headers: await dashboardMutationJsonHeaders(),
    body: JSON.stringify({ project: projectKey, bootstrapMain: true }),
  });
  if (!created.ok) throw new Error(await errorMessage(created));
  return ((await created.json()) as { id: string }).id;
}

/** Open a workspace view through the routed `/workspace/<id>` path. */
export function navigateToWorkspace(workspaceId: string): void {
  window.history.pushState({ tab: 'workspace' }, '', `/workspace/${encodeURIComponent(workspaceId)}`);
  window.dispatchEvent(new PopStateEvent('popstate'));
}

/**
 * Open a project's main checkout from its Home: the project's primary checkout
 * lives there, not as a row in the Workspaces rail.
 */
export function useOpenMainCheckout(): { open: (projectKey: string) => Promise<void>; opening: boolean } {
  const queryClient = useQueryClient();
  const [opening, setOpening] = useState(false);
  const open = useCallback(async (projectKey: string) => {
    setOpening(true);
    try {
      const id = await ensureMainWorkspace(projectKey);
      void queryClient.invalidateQueries({ queryKey: ['workspace-registry'] });
      navigateToWorkspace(id);
    } catch (error) {
      toast.error(`Could not open the main checkout: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setOpening(false);
    }
  }, [queryClient]);
  return { open, opening };
}
