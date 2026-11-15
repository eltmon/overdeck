// The mounted work dock's registration (PAN-5289 B-D5).
//
// `CommandPalette` is mounted in `App.tsx`, outside every Stage deck, so it
// cannot read the dock through context. The mounted `WorkDock` publishes what
// the palette needs here and clears it on unmount. This is a live
// registration of a mounted component, not stored status. `clear(deckKey)`
// only clears the entry when it still belongs to that deck, so an unmounting
// dock never wipes a newer dock's registration.
//
// This module must not import any components/Stage module.

import { create } from 'zustand'

export interface ActiveDock {
  deckKey: string
  /** The active Stage pane id (anchor for overrides set from outside the dock, B-D17). */
  activePaneId: string | null
  rootId: string | null
  changedPaths: ReadonlySet<string>
  /** openBeside on rootId. */
  openFile(path: string): void
  /** openDock({ tab: 'files', reveal }). */
  revealFile(path: string): void
}

export interface ActiveDockStore {
  current: ActiveDock | null
  set(dock: ActiveDock | null): void
  /** Sets current to null only when it holds `deckKey`. */
  clear(deckKey: string): void
}

export const useActiveDock = create<ActiveDockStore>((set, get) => ({
  current: null,
  set: (dock) => set({ current: dock }),
  clear: (deckKey) => {
    if (get().current?.deckKey === deckKey) set({ current: null })
  },
}))
