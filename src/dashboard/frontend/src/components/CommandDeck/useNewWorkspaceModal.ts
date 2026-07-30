/**
 * New Workspace dialog state and wiring (PAN-3330 WI-3/WI-4).
 *
 * Open/close state lives in a small zustand store rather than in App.tsx for
 * two reasons: App.tsx is a god file the size ratchet pins at its origin/main
 * line count, and one of the entry points — the project-overview button — sits
 * behind CommandDeck (1.5k lines) and ProjectHome, so a prop would have to be
 * drilled through two more ratcheted files to reach it. The rail and the
 * palette are already prop-wired from App and keep taking a callback.
 */
import { useCallback } from 'react';
import { create } from 'zustand';
import { useQueryClient } from '@tanstack/react-query';
import { fetchWithTimeout } from '../../lib/apiFetch.js';
import { dashboardMutationJsonHeaders } from '../../lib/wsTransport.js';

interface NewWorkspaceDialogStore {
  isOpen: boolean;
  /** Set when a per-project entry point opened the dialog. */
  presetProjectKey: string | null;
  open: (projectKey?: string) => void;
  close: () => void;
}

export const useNewWorkspaceStore = create<NewWorkspaceDialogStore>((set) => ({
  isOpen: false,
  presetProjectKey: null,
  open: (projectKey?: string) => set({ isOpen: true, presetProjectKey: projectKey ?? null }),
  close: () => set({ isOpen: false }),
}));

/** Opener for surfaces too deep in the tree to take a prop. */
export function useOpenNewWorkspace(): (projectKey?: string) => void {
  return useNewWorkspaceStore((state) => state.open);
}

export interface NewWorkspaceModalController {
  isOpen: boolean;
  open: (projectKey?: string) => void;
  close: () => void;
  presetProjectKey: string | null;
  onCreated: (workspaceId: string) => void;
}

export function useNewWorkspaceModal(
  onSelectWorkspace: (workspaceId: string) => void,
): NewWorkspaceModalController {
  const queryClient = useQueryClient();
  const isOpen = useNewWorkspaceStore((state) => state.isOpen);
  const presetProjectKey = useNewWorkspaceStore((state) => state.presetProjectKey);
  const open = useNewWorkspaceStore((state) => state.open);
  const close = useNewWorkspaceStore((state) => state.close);

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
