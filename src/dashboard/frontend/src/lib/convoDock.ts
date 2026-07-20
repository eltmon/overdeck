/**
 * PAN-2908 · C-CONVO — the conversation dock (level 2 · talk).
 *
 * A persistent cross-issue rail of open conversations, remembered across
 * sessions. Items are issue conversations (the active agent's feed); needs-you
 * items pin to the top. Level 3 (deep-dive) stays the issue drawer/detail.
 */
import { create } from 'zustand';

export interface DockItem {
  issueId: string;
  addedAt: number;
}

interface ConvoDockState {
  items: DockItem[];
  /** Rail expanded (vs slim edge handle). */
  expanded: boolean;
  add: (issueId: string) => void;
  remove: (issueId: string) => void;
  setExpanded: (expanded: boolean) => void;
}

const STORAGE_KEY = 'overdeck:convo-dock';

function load(): { items: DockItem[]; expanded: boolean } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as { items?: DockItem[]; expanded?: boolean };
      if (Array.isArray(parsed.items)) return { items: parsed.items.slice(0, 8), expanded: parsed.expanded !== false };
    }
  } catch {
    // corrupted state → start fresh
  }
  return { items: [], expanded: false };
}

function persist(state: { items: DockItem[]; expanded: boolean }) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ items: state.items, expanded: state.expanded }));
  } catch {
    // storage unavailable
  }
}

export const useConvoDock = create<ConvoDockState>((set) => ({
  ...load(),
  add: (issueId) =>
    set((state) => {
      const items = [{ issueId, addedAt: Date.now() }, ...state.items.filter((item) => item.issueId !== issueId)].slice(0, 8);
      const next = { items, expanded: true };
      persist(next);
      return next;
    }),
  remove: (issueId) =>
    set((state) => {
      const next = { items: state.items.filter((item) => item.issueId !== issueId), expanded: state.expanded };
      persist(next);
      return next;
    }),
  setExpanded: (expanded) =>
    set((state) => {
      const next = { ...state, expanded };
      persist(next);
      return next;
    }),
}));
