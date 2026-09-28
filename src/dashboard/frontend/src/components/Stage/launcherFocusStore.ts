/**
 * A one-shot request to focus a deck's Launcher (PAN-4281 FR-11).
 *
 * After a project is added the app navigates to its deck, but the deck's Home
 * pane mounts later, so the request waits here until that deck's Launcher
 * takes it.
 */

import { create } from 'zustand';

interface LauncherFocusState {
  pendingDeckKey: string | null;
  requestFocus(deckKey: string): void;
  clear(): void;
}

export const useLauncherFocusStore = create<LauncherFocusState>((set) => ({
  pendingDeckKey: null,
  requestFocus: (deckKey) => set({ pendingDeckKey: deckKey }),
  clear: () => set({ pendingDeckKey: null }),
}));

/** Ask the new project's Launcher for focus, only when the app lands on its command deck. */
export function requestLauncherFocusAfterCreate(tab: string, projectKey: string): void {
  if (tab === 'command-deck') useLauncherFocusStore.getState().requestFocus(projectKey);
}
