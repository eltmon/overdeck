/**
 * New Workspace dialog wiring (PAN-3330 WI-3).
 *
 * Lives outside App.tsx deliberately: App.tsx is a god file the size ratchet
 * holds at its origin/main line count, and the post-create aftermath — cache
 * invalidation, activation, navigation — is self-contained enough to own its
 * own seam.
 */
import { useCallback, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { fetchWithTimeout } from '../../lib/apiFetch.js';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport.js';

export interface NewWorkspaceModalController {
  isOpen: boolean;
  /** Opens the dialog, optionally preselecting a project (per-project entry point). */
  open: (projectKey?: string) => void;
  close: () => void;
  presetProjectKey: string | null;
  onCreated: (workspaceId: string) => void;
}

export function useNewWorkspaceModal(
  onSelectWorkspace: (workspaceId: string) => void,
): NewWorkspaceModalController {
  const queryClient = useQueryClient();
  const [isOpen, setIsOpen] = useState(false);
  const [presetProjectKey, setPresetProjectKey] = useState<string | null>(null);

  const open = useCallback((projectKey?: string) => {
    setPresetProjectKey(projectKey ?? null);
    setIsOpen(true);
  }, []);

  const close = useCallback(() => setIsOpen(false), []);

  // D-5/FR-8: invalidate rather than waiting out the rail's 10s poll, so the
  // new row is visible the moment the dialog closes; then activate (a recency
  // touch, matching palette activation) and open it.
  const onCreated = useCallback((workspaceId: string) => {
    void queryClient.invalidateQueries({ queryKey: ['workspace-registry'] });
    void (async () => {
      try {
        await fetchWithTimeout(`/api/workspace-registry/${encodeURIComponent(workspaceId)}/activate`, {
          method: 'POST',
          credentials: 'include',
          headers: await dashboardMutationJsonHeaders(),
        });
      } catch { /* the row exists either way; activation only touches recency */ }
    })();
    onSelectWorkspace(workspaceId);
  }, [queryClient, onSelectWorkspace]);

  return { isOpen, open, close, presetProjectKey, onCreated };
}
