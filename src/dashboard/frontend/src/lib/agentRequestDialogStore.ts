/**
 * Which agent request the Needs-you dialog answers (PAN-5541 D1).
 *
 * Activating a Needs-you item for an agent request opens this dialog instead
 * of navigating: a secret request has no conversation URL to open, and an
 * agent owner's request has nowhere to navigate at all. One host, mounted in
 * main.tsx next to `AnywhereDialogHost`, renders it over whatever page the
 * operator is on.
 *
 * This module holds only a request id — never a decision, a row or a query
 * result — so it cannot import `useDecisions.ts` or `needsYou.ts`
 * (`lint:circular`).
 */
import { create } from 'zustand';

interface AgentRequestDialogState {
  requestId: string | null;
  open: (requestId: string) => void;
  close: () => void;
}

export const useAgentRequestDialogStore = create<AgentRequestDialogState>((set) => ({
  requestId: null,
  open: (requestId) => set({ requestId }),
  close: () => set({ requestId: null }),
}));

export function openAgentRequestDialog(requestId: string): void {
  useAgentRequestDialogStore.getState().open(requestId);
}
