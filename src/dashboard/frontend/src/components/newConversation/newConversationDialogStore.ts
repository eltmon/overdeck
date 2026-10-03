/**
 * Open state for the new-conversation options dialog (PAN-4486). The sidebar
 * split button and the command palette open it; one host mounted in main.tsx
 * renders it, so it outlives the menu that opened it.
 */
import { create } from 'zustand';

interface NewConversationDialogState {
  open: boolean;
  /** Preset project: a yaml key or a display name (resolved by the dialog, D7). */
  projectKey?: string;
  openDialog: (opts?: { projectKey?: string }) => void;
  close: () => void;
}

export const useNewConversationDialogStore = create<NewConversationDialogState>((set) => ({
  open: false,
  projectKey: undefined,
  openDialog: (opts) => set({ open: true, projectKey: opts?.projectKey }),
  close: () => set({ open: false, projectKey: undefined }),
}));

export function openNewConversationDialog(opts?: { projectKey?: string }): void {
  useNewConversationDialogStore.getState().openDialog(opts);
}
