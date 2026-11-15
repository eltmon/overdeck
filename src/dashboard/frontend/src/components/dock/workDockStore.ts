// Work dock state, keyed by deck (PAN-5287 §6.3, WI-S3).
//
// The dock is the right column with Files, Changes, Search and Live tabs
// (child B of PAN-5284, PAN-5289, builds its UI). Per deck it holds whether
// the dock is open, the active tab, its width, and the transient state a
// caller asked for: reveal/diff/scope, the Search tab's folder (`searchPath`),
// an `openSeq` that counts `openDock` calls (so a tab can react to a repeat
// open), the Go to file flag (`quickOpen`) and a root override with the pane
// it belongs to (`rootOverrideAnchor`, B-D17). Only `open`, `tab` and `width`
// persist, as JSON under
// `overdeck.dock.<deckKey>`; every read and write is in try/catch, and a
// corrupt stored field hydrates its default.
//
// `OpenDockInput` lives here (and is re-exported by StageDeckContext) so the
// store never imports the Stage context module.

import { create } from 'zustand'
import type { ChangeScope } from '@overdeck/contracts'

export type DockTab = 'files' | 'changes' | 'search' | 'live'

export const DOCK_DEFAULT_WIDTH = 340 // mockup --dock-w
export const DOCK_MIN_WIDTH = 260
export const DOCK_MAX_WIDTH = 720

const DOCK_TABS: readonly DockTab[] = ['files', 'changes', 'search', 'live']

/** A file the Changes tab shows a diff of: a root path, its commit, or a committed file of an issue root (vs main). */
export interface DockDiffTarget {
  /** Root path (a repo path when the file is outside the root). */
  path: string
  sha?: string
  committedVsMain?: boolean
  /** Conversation commits: the repo the commit is in, and the file's path in it (for compare). */
  repoRoot?: string
  repoPath?: string
  /** The commit is on the remote (shown in the diff header). */
  pushed?: boolean
  /** The file is outside the dock root: no open beside or reveal. */
  outsideRoot?: boolean
}

export interface OpenDockInput {
  tab: DockTab
  reveal?: { rootId: string; path: string }
  diff?: DockDiffTarget
  /** The Changes list in display order, for the diff view's i/N and previous/next. */
  diffList?: readonly DockDiffTarget[]
  changesScope?: ChangeScope
  /** Search tab: limit content search to this root path (Find in folder). */
  searchPath?: string
}

export interface DockState {
  open: boolean
  tab: DockTab
  width: number
  rootOverride?: string
  /** Pane id the override belongs to (B-D17); undefined applies to every pane. */
  rootOverrideAnchor?: string
  changesScope?: ChangeScope
  diff?: DockDiffTarget
  diffList?: readonly DockDiffTarget[]
  reveal?: { rootId: string; path: string }
  searchPath?: string
  /** Counts openDock calls; starts at 0 on hydrate, never persisted. */
  openSeq: number
  /** Go to file is open; shared by the Stage + menu and the dock, never persisted. */
  quickOpen: boolean
}

export interface WorkDockStore {
  byDeck: Record<string, DockState>
  /** The deck's state, hydrated from localStorage on first read (defaults: closed, 'files', 340). */
  ensureDeck(deckKey: string): DockState
  /** open=true and the tab; replaces reveal/diff/changesScope/searchPath with the input's (absent fields cleared); increments openSeq. */
  openDock(deckKey: string, input: OpenDockInput): void
  /** open=false; keeps tab and width. */
  closeDock(deckKey: string): void
  setTab(deckKey: string, tab: DockTab): void
  /** Drop the diff, its list and the Search folder: they belong to the scope they were opened in. */
  clearScopedState(deckKey: string): void
  /** Closes the dock when it is open on `tab`; otherwise openDock({ tab }). */
  toggleTab(deckKey: string, tab: DockTab): void
  setQuickOpen(deckKey: string, open: boolean): void
  /** Clamps to [260, 720] and rounds to an integer. */
  setWidth(deckKey: string, width: number): void
  /** Sets the override and its anchor pane; `rootId` undefined clears both. */
  setRootOverride(deckKey: string, rootId: string | undefined, anchorPaneId?: string): void
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
  const state: DockState = { open: false, tab: 'files', width: DOCK_DEFAULT_WIDTH, openSeq: 0, quickOpen: false }
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
      const { reveal: _reveal, diff: _diff, diffList: _diffList, changesScope: _scope, searchPath: _searchPath, ...rest } = current(deckKey)
      const next: DockState = { ...rest, open: true, tab: input.tab, openSeq: rest.openSeq + 1 }
      if (input.reveal) next.reveal = input.reveal
      if (input.diff) next.diff = input.diff
      if (input.diffList) next.diffList = input.diffList
      if (input.changesScope) next.changesScope = input.changesScope
      if (input.searchPath) next.searchPath = input.searchPath
      commit(deckKey, next)
    },

    closeDock: (deckKey) => commit(deckKey, { ...current(deckKey), open: false }),

    setTab: (deckKey, tab) => commit(deckKey, { ...current(deckKey), tab }),

    clearScopedState: (deckKey) => {
      const deck = get().byDeck[deckKey]
      if (!deck || (!deck.diff && !deck.diffList && deck.searchPath === undefined)) return
      const { diff: _diff, diffList: _diffList, searchPath: _searchPath, ...rest } = deck
      commit(deckKey, rest)
    },

    toggleTab: (deckKey, tab) => {
      const deck = current(deckKey)
      if (deck.open && deck.tab === tab) get().closeDock(deckKey)
      else get().openDock(deckKey, { tab })
    },

    setQuickOpen: (deckKey, open) => commit(deckKey, { ...current(deckKey), quickOpen: open }),

    setWidth: (deckKey, width) => commit(deckKey, { ...current(deckKey), width: clampWidth(width) }),

    setRootOverride: (deckKey, rootId, anchorPaneId) => {
      const { rootOverride: _old, rootOverrideAnchor: _oldAnchor, ...rest } = current(deckKey)
      if (rootId === undefined) {
        commit(deckKey, rest)
        return
      }
      const next: DockState = { ...rest, rootOverride: rootId }
      if (anchorPaneId !== undefined) next.rootOverrideAnchor = anchorPaneId
      commit(deckKey, next)
    },
  }
})
