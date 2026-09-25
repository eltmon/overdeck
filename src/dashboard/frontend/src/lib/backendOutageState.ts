/**
 * PAN-3867 · the backend-outage boundary hides route pages (display: none)
 * instead of unmounting them, so their window/document keydown listeners stay
 * attached. `BackendConnectionBoundary` writes this flag; page-level global
 * shortcuts return early while it is set, so a stray chord cannot move a
 * tracker issue or close a pane on a page the operator cannot see.
 */
import { create } from 'zustand';

interface BackendOutageState {
  outage: boolean;
  setOutage: (outage: boolean) => void;
}

export const useBackendOutage = create<BackendOutageState>((set) => ({
  outage: false,
  setOutage: (outage) => set({ outage }),
}));

/** True while the outage boundary hides the route pages. Read inside handlers. */
export function isBackendOutage(): boolean {
  return useBackendOutage.getState().outage;
}
