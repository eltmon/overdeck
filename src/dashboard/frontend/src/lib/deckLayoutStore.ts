/**
 * deckLayoutStore — each deck's split layout and focus history (PAN-5343 H-D14).
 *
 * The layout used to live in Stage component state, so nothing outside the
 * Stage (the conversation list, the top-bar crumb, the deck openers) could
 * read or change it. This sibling zustand store owns it instead. The
 * localStorage key `pan-layout:<deck>` and the rule "a layout with ≤1 leaf is
 * stored as null and its key removed" are unchanged.
 *
 * The focus history is session-only: most recent first, no duplicates, at most
 * 32 pane ids per deck. The deck openers use it to pick which leaf to replace.
 */

import { create } from 'zustand'
import { isValidLayout, leafCount, type PaneLayout } from './paneLayout'

export const layoutStorageKey = (deckKey: string): string => `pan-layout:${deckKey}`

const FOCUS_HISTORY_MAX = 32

export interface DeckLayoutStore {
  layoutByDeck: Record<string, PaneLayout | null>
  /** Most recent first, max 32, session only. */
  focusHistoryByDeck: Record<string, string[]>
  /** Always re-reads localStorage; keeps a valid layout with >1 leaf, else null. */
  hydrateLayout(deckKey: string): PaneLayout | null
  /** The deck's layout, hydrating from storage when the deck is not in memory yet. */
  getLayout(deckKey: string): PaneLayout | null
  /** ≤1 leaf → null; writes through to localStorage (removeItem for null). */
  setLayout(deckKey: string, next: PaneLayout | null): void
  noteFocus(deckKey: string, paneId: string): void
}

function readStoredLayout(deckKey: string): PaneLayout | null {
  try {
    const raw = localStorage.getItem(layoutStorageKey(deckKey))
    const parsed = raw ? (JSON.parse(raw) as unknown) : null
    return isValidLayout(parsed) && leafCount(parsed) > 1 ? parsed : null
  } catch {
    return null
  }
}

export const useDeckLayoutStore = create<DeckLayoutStore>((set, get) => ({
  layoutByDeck: {},
  focusHistoryByDeck: {},

  hydrateLayout: (deckKey) => {
    const layout = readStoredLayout(deckKey)
    const { layoutByDeck } = get()
    // Skip a no-op write so subscribers do not re-render on an unchanged layout.
    if (!(deckKey in layoutByDeck) || JSON.stringify(layoutByDeck[deckKey]) !== JSON.stringify(layout)) {
      set((s) => ({ layoutByDeck: { ...s.layoutByDeck, [deckKey]: layout } }))
    }
    return layout
  },

  getLayout: (deckKey) => {
    const { layoutByDeck } = get()
    if (deckKey in layoutByDeck) return layoutByDeck[deckKey] ?? null
    return get().hydrateLayout(deckKey)
  },

  setLayout: (deckKey, next) => {
    const effective = next && leafCount(next) > 1 ? next : null
    set((s) => ({ layoutByDeck: { ...s.layoutByDeck, [deckKey]: effective } }))
    try {
      if (effective) localStorage.setItem(layoutStorageKey(deckKey), JSON.stringify(effective))
      else localStorage.removeItem(layoutStorageKey(deckKey))
    } catch {
      /* ignore — persistence is best-effort */
    }
  },

  noteFocus: (deckKey, paneId) => {
    const current = get().focusHistoryByDeck[deckKey] ?? []
    if (current[0] === paneId) return
    const next = [paneId, ...current.filter((id) => id !== paneId)].slice(0, FOCUS_HISTORY_MAX)
    set((s) => ({ focusHistoryByDeck: { ...s.focusHistoryByDeck, [deckKey]: next } }))
  },
}))

/** The deck's in-memory layout (null until hydrated). */
export const selectDeckLayout =
  (deckKey: string) =>
  (s: DeckLayoutStore): PaneLayout | null =>
    s.layoutByDeck[deckKey] ?? null

/** Tests only: drop every in-memory layout and focus history. */
export function resetDeckLayoutStore(): void {
  useDeckLayoutStore.setState({ layoutByDeck: {}, focusHistoryByDeck: {} })
}
