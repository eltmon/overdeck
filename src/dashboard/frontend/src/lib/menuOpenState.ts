/**
 * PAN-2937 · menu open state lives ABOVE re-renders.
 *
 * The action overflow menu used to keep `open` in local useState, so a live
 * WS tick that remounted the card closed the menu mid-browse. Now it's a tiny
 * zustand slice: one open menu key at a time (which also gives single-open
 * behavior across the whole app), immune to remounts.
 */
import { create } from 'zustand';

interface MenuOpenState {
  openMenuKey: string | null;
  setOpenMenu: (key: string | null) => void;
}

export const useMenuOpen = create<MenuOpenState>((set) => ({
  openMenuKey: null,
  setOpenMenu: (key) => set({ openMenuKey: key }),
}));
