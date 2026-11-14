// Work dock state, keyed by deck (PAN-5287 §6.3, WI-S3).
//
// The dock is the future right column with Files, Changes and Search tabs
// (child B of PAN-5284 builds its UI). Per deck it holds whether the dock is
// open, the active tab, its width, and the transient reveal/diff/scope a
// caller asked for. Only `open`, `tab` and `width` persist, as JSON under
// `overdeck.dock.<deckKey>`; every read and write is in try/catch, and a
// corrupt stored field hydrates its default.
//
// `OpenDockInput` lives here (and is re-exported by StageDeckContext) so the
// store never imports the Stage context module.

import { create } from 'zustand'
import type { ChangeScope } from '@overdeck/contracts'

export type DockTab = 'files' | 'changes' | 'search'

export const DOCK_DEFAULT_WIDTH = 340 // mockup --dock-w
export const DOCK_MIN_WIDTH = 260
export const DOCK_MAX_WIDTH = 720

const DOCK_TABS: readonly DockTab[] = ['files', 'changes', 'search']

export interface OpenDockInput {
  tab: DockTab
  reveal?: { rootId: string; path: string }
  diff?: { path: string; sha?: string }
  changesScope?: ChangeScope
}

export interface DockState {
  open: boolean
  tab: DockTab
  width: number
  rootOverride?: string
  changesScope?: ChangeScope
  diff?: { path: string; sha?: string }
  reveal?: { rootId: string; path: string }
}

export interface WorkDockStore {
  byDeck: Record<string, DockState>
  /** The deck's state, hydrated from localStorage on first read (defaults: closed, 'files', 340). */
  ensureDeck(deckKey: string): DockState
  /** open=true and the tab; replaces reveal/diff/changesScope with the input's (absent fields cleared). */
  openDock(deckKey: string, input: OpenDockInput): void
  /** open=false; keeps tab and width. */
  closeDock(deckKey: string): void
  setTab(deckKey: string, tab: DockTab): void
  /** Clamps to [260, 720] and rounds to an integer. */
  setWidth(deckKey: string, width: number): void
  setRootOverride(deckKey: string, rootId: string | undefined): void
}

export function dockStorageKey(deckKey: string): string {
  return `overdeck.dock.${deckKey}`
}

function clampWidth(width: number): number {
  return Math.round(Math.min(DOCK_MAX_WIDTH, Math.max(DOCK_MIN_WIDTH, width)))
}

function isDockTab(value: unknown): value is DockTab {
  return typeof value === 'string' && (DOCK_TABS as readonly string[]).includes(value)
}

function readPersisted(deckKey: string): DockState {
  const state: DockState = { open: false, tab: 'files', width: DOCK_DEFAULT_WIDTH }
  try {
    const raw = localStorage.getItem(dockStorageKey(deckKey))
    if (!raw) return state
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return state
    const { open, tab, width } = parsed as Record<string, unknown>
    if (typeof open === 'boolean') state.open = open
    if (isDockTab(tab)) state.tab = tab
    if (typeof width === 'number' && Number.isFinite(width)) state.width = clampWidth(width)
  } catch {
    // Corrupt JSON or blocked storage: defaults.
  }
  return state
}

function writePersisted(deckKey: string, state: DockState): void {
  try {
    localStorage.setItem(dockStorageKey(deckKey), JSON.stringify({ open: state.open, tab: state.tab, width: state.width }))
  } catch {
    // Storage blocked or full: the dock still works for this session.
  }
}

export const useWorkDockStore = create<WorkDockStore>((set, get) => {
  const current = (deckKey: string): DockState => get().byDeck[deckKey] ?? readPersisted(deckKey)

  /** Store the deck's next state; persist when a persisted field changed. */
  const commit = (deckKey: string, next: DockState): void => {
    const prev = get().byDeck[deckKey]
    set((s) => ({ byDeck: { ...s.byDeck, [deckKey]: next } }))
    if (!prev || prev.open !== next.open || prev.tab !== next.tab || prev.width !== next.width) {
      writePersisted(deckKey, next)
    }
  }

  return {
    byDeck: {},

    ensureDeck: (deckKey) => {
      const existing = get().byDeck[deckKey]
      if (existing) return existing
      const hydrated = readPersisted(deckKey)
      set((s) => ({ byDeck: { ...s.byDeck, [deckKey]: hydrated } }))
      return hydrated
    },

    openDock: (deckKey, input) => {
      const { reveal: _reveal, diff: _diff, changesScope: _scope, ...rest } = current(deckKey)
      const next: DockState = { ...rest, open: true, tab: input.tab }
      if (input.reveal) next.reveal = input.reveal
      if (input.diff) next.diff = input.diff
      if (input.changesScope) next.changesScope = input.changesScope
      commit(deckKey, next)
    },

    closeDock: (deckKey) => commit(deckKey, { ...current(deckKey), open: false }),

    setTab: (deckKey, tab) => commit(deckKey, { ...current(deckKey), tab }),

    setWidth: (deckKey, width) => commit(deckKey, { ...current(deckKey), width: clampWidth(width) }),

    setRootOverride: (deckKey, rootId) => {
      const { rootOverride: _old, ...rest } = current(deckKey)
      commit(deckKey, rootId === undefined ? rest : { ...rest, rootOverride: rootId })
    },
  }
})
