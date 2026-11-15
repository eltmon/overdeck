// Explorer tree state, keyed by root id (PAN-5186, WI-B3).
//
// Per root: the loaded directories, the expanded set, the dotfile toggle, the
// git-ignored toggle, the Changed filter and the selection. The expanded set
// and the two toggles persist in localStorage under `overdeck.explorer.<rootId>`; every read and
// write is in try/catch, and a corrupt value hydrates the defaults (D-B13).

import { create } from 'zustand'
import type { ExplorerEntry } from '@overdeck/contracts'

export interface DirState {
  status: 'loading' | 'ready' | 'error'
  entries: readonly ExplorerEntry[]
  truncated: boolean
  absPath: string | null
  errorCode?: string
  errorMessage?: string
}

export interface RootState {
  /** Key: root-relative directory path; '' is the root. */
  dirs: Record<string, DirState>
  /** Root-relative paths of open folders. Persisted. */
  expanded: string[]
  /** Persisted; default true. */
  showDotfiles: boolean
  /** Show git-ignored entries. Persisted; default false (PAN-5289). */
  showIgnored: boolean
  /** Not persisted. */
  changedOnly: boolean
  selection: string[]
  anchor: string | null
  focused: string | null
}

export type SelectMode = 'replace' | 'toggle' | 'range'

export interface ExplorerStore {
  roots: Record<string, RootState>
  /** Create the root's state if missing, hydrating the persisted fields. */
  ensureRoot(rootId: string): void
  setDir(rootId: string, path: string, state: DirState): void
  removeDir(rootId: string, path: string): void
  setExpanded(rootId: string, path: string, open: boolean): void
  /** Add many paths to the expanded set. */
  setExpandedMany(rootId: string, paths: readonly string[]): void
  collapseAll(rootId: string): void
  setShowDotfiles(rootId: string, show: boolean): void
  setShowIgnored(rootId: string, show: boolean): void
  /** Open every ancestor folder of `path` (persisted) and make it the selection, anchor and focus. */
  revealPath(rootId: string, path: string): void
  setChangedOnly(rootId: string, on: boolean): void
  select(rootId: string, path: string, mode: SelectMode, visibleOrder: readonly string[]): void
  setFocused(rootId: string, path: string | null): void
  /**
   * A rename or move on disk (PAN-5190, D-E5): rewrite the expanded set, the
   * selection, the anchor and the focused path, and drop listings at or under
   * `from`. Persists.
   */
  renamePaths(rootId: string, from: string, to: string): void
  /** Empty the selection and the anchor; the focused path is unchanged. */
  clearSelection(rootId: string): void
}

const storageKey = (rootId: string): string => `overdeck.explorer.${rootId}`

interface Persisted {
  expanded: string[]
  showDotfiles: boolean
  showIgnored: boolean
}

function readPersisted(rootId: string): Persisted {
  const defaults: Persisted = { expanded: [], showDotfiles: true, showIgnored: false }
  try {
    const raw = localStorage.getItem(storageKey(rootId))
    if (!raw) return defaults
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return defaults
    const { expanded, showDotfiles, showIgnored } = parsed as Record<string, unknown>
    return {
      expanded: Array.isArray(expanded) ? expanded.filter((p): p is string => typeof p === 'string') : [],
      showDotfiles: typeof showDotfiles === 'boolean' ? showDotfiles : true,
      showIgnored: typeof showIgnored === 'boolean' ? showIgnored : false,
    }
  } catch {
    return defaults
  }
}

function writePersisted(rootId: string, root: RootState): void {
  try {
    const value: Persisted = { expanded: root.expanded, showDotfiles: root.showDotfiles, showIgnored: root.showIgnored }
    localStorage.setItem(storageKey(rootId), JSON.stringify(value))
  } catch {
    // Storage blocked or full: the tree still works for this session.
  }
}

/**
 * Map a path through a rename of `from` to `to`. Kept here rather than imported
 * from actions/name-rules, which reaches the tree model, which imports this
 * module's types.
 */
function movedPath(path: string, from: string, to: string): string {
  if (path === from) return to
  if (path.startsWith(`${from}/`)) return `${to}${path.slice(from.length)}`
  return path
}

function freshRoot(rootId: string): RootState {
  const persisted = readPersisted(rootId)
  return {
    dirs: {},
    expanded: persisted.expanded,
    showDotfiles: persisted.showDotfiles,
    showIgnored: persisted.showIgnored,
    changedOnly: false,
    selection: [],
    anchor: null,
    focused: null,
  }
}

export const useExplorerStore = create<ExplorerStore>((set, get) => {
  /** Apply `fn` to the root (created when missing); persist when `persist` is set. */
  const update = (rootId: string, fn: (root: RootState) => RootState, persist = false): void => {
    const current = get().roots[rootId] ?? freshRoot(rootId)
    const next = fn(current)
    if (next === current && get().roots[rootId]) return
    set((s) => ({ roots: { ...s.roots, [rootId]: next } }))
    if (persist) writePersisted(rootId, next)
  }

  return {
    roots: {},

    ensureRoot: (rootId) => {
      if (get().roots[rootId]) return
      set((s) => ({ roots: { ...s.roots, [rootId]: freshRoot(rootId) } }))
    },

    setDir: (rootId, path, state) => update(rootId, (r) => ({ ...r, dirs: { ...r.dirs, [path]: state } })),

    removeDir: (rootId, path) =>
      update(rootId, (r) => {
        if (!(path in r.dirs)) return r
        const dirs = { ...r.dirs }
        delete dirs[path]
        return { ...r, dirs }
      }),

    setExpanded: (rootId, path, open) =>
      update(
        rootId,
        (r) => {
          const has = r.expanded.includes(path)
          if (open === has) return r
          return { ...r, expanded: open ? [...r.expanded, path] : r.expanded.filter((p) => p !== path) }
        },
        true,
      ),

    setExpandedMany: (rootId, paths) =>
      update(
        rootId,
        (r) => {
          const set = new Set(r.expanded)
          for (const p of paths) set.add(p)
          return set.size === r.expanded.length ? r : { ...r, expanded: [...set] }
        },
        true,
      ),

    collapseAll: (rootId) => update(rootId, (r) => (r.expanded.length === 0 ? r : { ...r, expanded: [] }), true),

    setShowDotfiles: (rootId, show) =>
      update(rootId, (r) => (r.showDotfiles === show ? r : { ...r, showDotfiles: show }), true),

    setShowIgnored: (rootId, show) =>
      update(rootId, (r) => (r.showIgnored === show ? r : { ...r, showIgnored: show }), true),

    revealPath: (rootId, path) =>
      update(
        rootId,
        (r) => {
          const expanded = new Set(r.expanded)
          for (let slash = path.indexOf('/'); slash > 0; slash = path.indexOf('/', slash + 1)) expanded.add(path.slice(0, slash))
          return { ...r, expanded: [...expanded], selection: [path], anchor: path, focused: path }
        },
        true,
      ),

    setChangedOnly: (rootId, on) => update(rootId, (r) => (r.changedOnly === on ? r : { ...r, changedOnly: on })),

    select: (rootId, path, mode, visibleOrder) =>
      update(rootId, (r) => {
        if (mode === 'toggle') {
          const selection = r.selection.includes(path) ? r.selection.filter((p) => p !== path) : [...r.selection, path]
          return { ...r, selection, anchor: path, focused: path }
        }
        if (mode === 'range' && r.anchor !== null) {
          const from = visibleOrder.indexOf(r.anchor)
          const to = visibleOrder.indexOf(path)
          if (from !== -1 && to !== -1) {
            const [lo, hi] = from <= to ? [from, to] : [to, from]
            // The anchor stays put, so a second Shift+click re-slices from it.
            return { ...r, selection: visibleOrder.slice(lo, hi + 1), focused: path }
          }
        }
        return { ...r, selection: [path], anchor: path, focused: path }
      }),

    setFocused: (rootId, path) => update(rootId, (r) => (r.focused === path ? r : { ...r, focused: path })),

    renamePaths: (rootId, from, to) =>
      update(
        rootId,
        (r) => {
          const move = (path: string): string => movedPath(path, from, to)
          const dirs: Record<string, DirState> = {}
          for (const [path, dir] of Object.entries(r.dirs)) {
            if (path !== from && !path.startsWith(`${from}/`)) dirs[path] = dir
          }
          return {
            ...r,
            dirs,
            expanded: [...new Set(r.expanded.map(move))],
            selection: [...new Set(r.selection.map(move))],
            anchor: r.anchor === null ? null : move(r.anchor),
            focused: r.focused === null ? null : move(r.focused),
          }
        },
        true,
      ),

    clearSelection: (rootId) =>
      update(rootId, (r) => (r.selection.length === 0 && r.anchor === null ? r : { ...r, selection: [], anchor: null })),
  }
})
