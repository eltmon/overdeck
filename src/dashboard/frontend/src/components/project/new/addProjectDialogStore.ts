/**
 * Opens the Add-project dialog from anywhere (PAN-4281 D11, D21).
 *
 * The dialog is mounted once in the app chrome and shown by this store, so the
 * sidebar, the command palette and the New Workspace chips open the same modal
 * instead of navigating to `/projects/new`. `returnTo` travels here rather than
 * in the URL, because in modal mode the URL is still the page that opened it.
 */

import { create } from 'zustand';

export type AddProjectMode = 'clone' | 'existing' | 'new';

interface AddProjectDialogState {
  open: boolean;
  mode?: AddProjectMode;
  returnTo?: string;
  show(mode?: AddProjectMode, returnTo?: string): void;
  hide(): void;
}

export const useAddProjectDialog = create<AddProjectDialogState>((set) => ({
  open: false,
  show: (mode, returnTo) => set({ open: true, mode, returnTo }),
  hide: () => set({ open: false, mode: undefined, returnTo: undefined }),
}));

/** Returns and clears the pending returnTo so a later create does not reuse it. */
export function takeAddProjectReturnTo(): string | undefined {
  const { returnTo } = useAddProjectDialog.getState();
  useAddProjectDialog.setState({ returnTo: undefined });
  return returnTo;
}
