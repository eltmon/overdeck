/**
 * Opens the Add-project dialog from anywhere (PAN-4281 D11, D21).
 *
 * The dialog is mounted once in the app chrome and shown by this store, so the
 * sidebar, the command palette and the New Workspace chips open the same modal
 * instead of navigating to `/projects/new`. `returnTo` travels here rather than
 * in the URL, because in modal mode the URL is still the page that opened it.
 *
 * `initialUrl` and `onCreated` let a caller open clone mode with the URL filled
 * in and hear about the created project (PAN-4437 D-13: Session Vault's
 * "Clone and register"). `hide()` clears both so the next open starts empty.
 */

import { create } from 'zustand';
import type { CreatedProject } from './projectCreateTypes.js';

export type AddProjectMode = 'clone' | 'existing' | 'new';

export interface AddProjectShowOptions {
  initialUrl?: string;
  onCreated?: (project: CreatedProject) => void;
}

interface AddProjectDialogState {
  open: boolean;
  mode?: AddProjectMode;
  returnTo?: string;
  initialUrl?: string;
  onCreatedExtra?: (project: CreatedProject) => void;
  show(mode?: AddProjectMode, returnTo?: string, options?: AddProjectShowOptions): void;
  hide(): void;
}

export const useAddProjectDialog = create<AddProjectDialogState>((set) => ({
  open: false,
  show: (mode, returnTo, options) =>
    set({ open: true, mode, returnTo, initialUrl: options?.initialUrl, onCreatedExtra: options?.onCreated }),
  hide: () => set({ open: false, mode: undefined, returnTo: undefined, initialUrl: undefined, onCreatedExtra: undefined }),
}));

/** Returns and clears the pending returnTo so a later create does not reuse it. */
export function takeAddProjectReturnTo(): string | undefined {
  const { returnTo } = useAddProjectDialog.getState();
  useAddProjectDialog.setState({ returnTo: undefined });
  return returnTo;
}
