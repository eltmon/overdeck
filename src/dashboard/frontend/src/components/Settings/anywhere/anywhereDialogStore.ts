/**
 * Which Settings → Anywhere dialog is open from outside Settings (PAN-4869).
 * The command palette opens them; one host mounted in main.tsx renders the
 * dialog, so it outlives the palette.
 */
import { create } from 'zustand';

export type AnywhereDialog =
  | 'link-machine'
  | 'add-fly-machine'
  | 'add-ssh-machine'
  | 'set-up-phone'
  | 'pair-device'
  | 'tailscale-setup'
  | 'connect-bot';

interface AnywhereDialogState {
  dialog: AnywhereDialog | null;
  openDialog: (dialog: AnywhereDialog) => void;
  close: () => void;
}

export const useAnywhereDialogStore = create<AnywhereDialogState>((set) => ({
  dialog: null,
  openDialog: (dialog) => set({ dialog }),
  close: () => set({ dialog: null }),
}));

export function openAnywhereDialog(dialog: AnywhereDialog): void {
  useAnywhereDialogStore.getState().openDialog(dialog);
}
