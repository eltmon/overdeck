/**
 * Which Settings → Anywhere dialog is open from outside Settings (PAN-4869).
 * The command palette opens them; one host mounted in main.tsx renders the
 * dialog, so it outlives the palette.
 *
 * PAN-4942 W-LINK1 D-11: a machine-link card opens Link a machine with the
 * agent request it answers. `agentRequestId` holds it until close, and every
 * open without one sets it to null, so a later open from the palette never
 * resolves an old request.
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

export interface AnywhereDialogOptions {
  /** PAN-4942: the agent request a Link a machine dialog resolves after it links. */
  agentRequestId?: string;
}

interface AnywhereDialogState {
  dialog: AnywhereDialog | null;
  agentRequestId: string | null;
  openDialog: (dialog: AnywhereDialog, opts?: AnywhereDialogOptions) => void;
  close: () => void;
}

export const useAnywhereDialogStore = create<AnywhereDialogState>((set) => ({
  dialog: null,
  agentRequestId: null,
  openDialog: (dialog, opts) => set({ dialog, agentRequestId: opts?.agentRequestId ?? null }),
  close: () => set({ dialog: null, agentRequestId: null }),
}));

export function openAnywhereDialog(dialog: AnywhereDialog, opts?: AnywhereDialogOptions): void {
  useAnywhereDialogStore.getState().openDialog(dialog, opts);
}
