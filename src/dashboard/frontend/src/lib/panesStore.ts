/**
 * panesStore — per-workspace Stage pane state for the Command Deck (PAN-1549).
 *
 * The Stage replaces the single-pane Zone C with a persistent PaneBar of tabs.
 * Each workspace opens on a permanent, unclosable HOME pane; the user opens
 * additional panes that persist independently per workspace.
 *
 * Like `lib/commandDeckSelection.ts`, this is a sibling Zustand store kept out
 * of the event-sourced `lib/store.ts` so local UI pane state never entangles
 * with the contracts-shared event reducers. State persists to localStorage
 * under `pan-panes:{workspaceId}` and `pan-active-pane:{workspaceId}`.
 */

import { create } from 'zustand'

export type WorkspaceId = string
export type PaneId = string

export type PaneType =
  | 'home'
  | 'agent'
  | 'terminal'
  | 'files'
  | 'commits'
  | 'plan'
  | 'docs'
  | 'browser'

export interface WorkspacePane {
  paneId: PaneId
  paneType: PaneType
  label: string
  createdAt: number
  /** true for the HOME pane — it is synthesized and cannot be closed. */
  isPermanent?: boolean
  // agent pane
  conversationId?: string
  agentType?: string
  isRunning?: boolean
  viewMode?: 'conversation' | 'terminal' | 'findings'
  // terminal pane
  terminalId?: string | null
  // files / commits pane
  fileBrowserScopePath?: string
  fileBrowserInitialQuery?: string
  // docs pane
  docFilePath?: string
  // browser pane
  browserInitialUrl?: string
}

/** Fields a caller supplies when opening a pane; paneId/createdAt are generated. */
export type PaneSpec = Omit<WorkspacePane, 'paneId' | 'createdAt'>

export interface PanesState {
  /** Map of workspaceId → ordered panes (HOME always first). */
  panesByWorkspace: Record<WorkspaceId, WorkspacePane[]>
  /** Map of workspaceId → active pane id. */
  activePaneByWorkspace: Record<WorkspaceId, PaneId>
}

export interface PanesStore extends PanesState {
  /**
   * Ensure a workspace has a HOME pane. Hydrates from localStorage on first
   * access; synthesizes a HOME-only state when storage is empty or corrupt.
   * Idempotent — safe to call on every render.
   */
  ensureHome(workspaceId: WorkspaceId): void
  /** Open a new pane and make it active. Returns the generated paneId. */
  addPane(workspaceId: WorkspaceId, spec: PaneSpec): PaneId
  /** Close a pane. Refuses to close the HOME pane. Active falls back to HOME. */
  closePane(workspaceId: WorkspaceId, paneId: PaneId): void
  /** Focus a pane (no-op if it does not exist in the workspace). */
  setActivePane(workspaceId: WorkspaceId, paneId: PaneId): void
  /** Patch fields on an existing pane (e.g. isRunning, viewMode, label). */
  updatePane(workspaceId: WorkspaceId, paneId: PaneId, patch: Partial<WorkspacePane>): void
}

// ─── localStorage persistence (mc-*/pan-* convention, try/catch-guarded) ───────

const panesKey = (workspaceId: WorkspaceId): string => `pan-panes:${workspaceId}`
const activeKey = (workspaceId: WorkspaceId): string => `pan-active-pane:${workspaceId}`

function generatePaneId(): PaneId {
  try {
    return crypto.randomUUID()
  } catch {
    return `pane-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
  }
}

function makeHomePane(): WorkspacePane {
  return {
    paneId: generatePaneId(),
    paneType: 'home',
    label: 'Home',
    createdAt: Date.now(),
    isPermanent: true,
  }
}

function isValidPane(value: unknown): value is WorkspacePane {
  if (typeof value !== 'object' || value === null) return false
  const p = value as Record<string, unknown>
  return (
    typeof p.paneId === 'string' &&
    typeof p.paneType === 'string' &&
    typeof p.label === 'string' &&
    typeof p.createdAt === 'number'
  )
}

/**
 * Read panes for a workspace from localStorage. Returns null when storage is
 * absent or corrupt so the caller can degrade to a synthesized HOME pane.
 * Guarantees exactly one HOME pane at the front when it returns an array.
 */
function readPanes(workspaceId: WorkspaceId): WorkspacePane[] | null {
  let parsed: unknown
  try {
    const raw = localStorage.getItem(panesKey(workspaceId))
    if (!raw) return null
    parsed = JSON.parse(raw)
  } catch {
    return null
  }
  if (!Array.isArray(parsed)) return null
  const panes = parsed.filter(isValidPane)
  if (panes.length === 0) return null
  // Normalize to exactly one HOME pane at the front.
  const homes = panes.filter((p) => p.paneType === 'home')
  const rest = panes.filter((p) => p.paneType !== 'home')
  const home = homes[0] ?? makeHomePane()
  home.isPermanent = true
  return [home, ...rest]
}

function readActive(workspaceId: WorkspaceId): PaneId | null {
  try {
    return localStorage.getItem(activeKey(workspaceId))
  } catch {
    return null
  }
}

function persist(workspaceId: WorkspaceId, panes: WorkspacePane[], activeId: PaneId): void {
  try {
    localStorage.setItem(panesKey(workspaceId), JSON.stringify(panes))
    localStorage.setItem(activeKey(workspaceId), activeId)
  } catch {
    /* ignore — persistence is best-effort */
  }
}

/** Pick a valid active id: keep `preferred` if it exists, else fall back to HOME. */
function resolveActiveId(panes: WorkspacePane[], preferred: PaneId | null): PaneId {
  if (preferred && panes.some((p) => p.paneId === preferred)) return preferred
  const home = panes.find((p) => p.paneType === 'home') ?? panes[0]
  return home.paneId
}

// ─── Store ─────────────────────────────────────────────────────────────────────

const initialState: PanesState = {
  panesByWorkspace: {},
  activePaneByWorkspace: {},
}

export const usePanesStore = create<PanesStore>((set, get) => ({
  ...initialState,

  ensureHome: (workspaceId) => {
    const state = get()
    // Already loaded into memory — just guarantee a valid active id.
    if (workspaceId in state.panesByWorkspace) {
      const panes = state.panesByWorkspace[workspaceId]
      const activeId = resolveActiveId(panes, state.activePaneByWorkspace[workspaceId] ?? null)
      if (activeId !== state.activePaneByWorkspace[workspaceId]) {
        set((s) => ({
          activePaneByWorkspace: { ...s.activePaneByWorkspace, [workspaceId]: activeId },
        }))
        persist(workspaceId, panes, activeId)
      }
      return
    }
    // First access — hydrate from storage, else synthesize HOME-only.
    const hydrated = readPanes(workspaceId)
    const panes = hydrated ?? [makeHomePane()]
    const activeId = resolveActiveId(panes, readActive(workspaceId))
    set((s) => ({
      panesByWorkspace: { ...s.panesByWorkspace, [workspaceId]: panes },
      activePaneByWorkspace: { ...s.activePaneByWorkspace, [workspaceId]: activeId },
    }))
    persist(workspaceId, panes, activeId)
  },

  addPane: (workspaceId, spec) => {
    const paneId = generatePaneId()
    const newPane: WorkspacePane = { ...spec, paneId, createdAt: Date.now() }
    set((s) => {
      const existing = s.panesByWorkspace[workspaceId] ?? [makeHomePane()]
      const panes = [...existing, newPane]
      persist(workspaceId, panes, paneId)
      return {
        panesByWorkspace: { ...s.panesByWorkspace, [workspaceId]: panes },
        activePaneByWorkspace: { ...s.activePaneByWorkspace, [workspaceId]: paneId },
      }
    })
    return paneId
  },

  closePane: (workspaceId, paneId) => {
    set((s) => {
      const existing = s.panesByWorkspace[workspaceId]
      if (!existing) return s
      const target = existing.find((p) => p.paneId === paneId)
      // Refuse to close HOME / permanent panes.
      if (!target || target.isPermanent || target.paneType === 'home') return s
      const panes = existing.filter((p) => p.paneId !== paneId)
      const activeId = resolveActiveId(panes, s.activePaneByWorkspace[workspaceId] ?? null)
      persist(workspaceId, panes, activeId)
      return {
        panesByWorkspace: { ...s.panesByWorkspace, [workspaceId]: panes },
        activePaneByWorkspace: { ...s.activePaneByWorkspace, [workspaceId]: activeId },
      }
    })
  },

  setActivePane: (workspaceId, paneId) => {
    set((s) => {
      const panes = s.panesByWorkspace[workspaceId]
      if (!panes || !panes.some((p) => p.paneId === paneId)) return s
      persist(workspaceId, panes, paneId)
      return {
        activePaneByWorkspace: { ...s.activePaneByWorkspace, [workspaceId]: paneId },
      }
    })
  },

  updatePane: (workspaceId, paneId, patch) => {
    set((s) => {
      const existing = s.panesByWorkspace[workspaceId]
      if (!existing || !existing.some((p) => p.paneId === paneId)) return s
      const panes = existing.map((p) =>
        p.paneId === paneId ? { ...p, ...patch, paneId: p.paneId } : p,
      )
      persist(workspaceId, panes, s.activePaneByWorkspace[workspaceId])
      return { panesByWorkspace: { ...s.panesByWorkspace, [workspaceId]: panes } }
    })
  },
}))

// ─── Selectors ──────────────────────────────────────────────────────────────────

/** Panes for a workspace (empty until `ensureHome` runs). */
export const selectPanesForWorkspace =
  (workspaceId: WorkspaceId) =>
  (s: PanesState): WorkspacePane[] =>
    s.panesByWorkspace[workspaceId] ?? []

/** Active pane id for a workspace, or null if none. */
export const selectActivePaneId =
  (workspaceId: WorkspaceId) =>
  (s: PanesState): PaneId | null =>
    s.activePaneByWorkspace[workspaceId] ?? null

/** The active pane object for a workspace, or null if none resolved yet. */
export const selectActivePane =
  (workspaceId: WorkspaceId) =>
  (s: PanesState): WorkspacePane | null => {
    const panes = s.panesByWorkspace[workspaceId]
    const activeId = s.activePaneByWorkspace[workspaceId]
    if (!panes || !activeId) return null
    return panes.find((p) => p.paneId === activeId) ?? null
  }
