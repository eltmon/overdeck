/**
 * DashboardStore — Zustand store with shared event reducers (PAN-428 B4, PAN-433)
 *
 * Replaces React Query polling with event-sourced state.
 * The store receives a full snapshot on connect, then applies domain events incrementally.
 * Pure reducer functions are shared with the server read model via @overdeck/contracts.
 */

import { create } from 'zustand'
import type {
  AgentSnapshot,
  ChannelPermissionRequestSnapshot,
  DashboardSnapshot,
  DomainEvent,
  MemoryObservation,
  MemoryStatus,
  ResetMarker,
  ResourceStats,
  ReviewStatusSnapshot,
} from '@overdeck/contracts'
import {
  type ReadModelState,
  INITIAL_READ_MODEL_STATE,
  syncSnapshot as syncSnapshotShared,
  applyEvent as applyEventShared,
  applyEvents as applyEventsShared,
} from '@overdeck/contracts'
import { saveSnapshotToCache } from './snapshotCache'

// ─── State shape ──────────────────────────────────────────────────────────────

export type DrawerState = {
  issueId: string | null
  tab: string
}

export interface DashboardState extends ReadModelState {
  drawer: DrawerState
  /** Whether the initial snapshot has been loaded */
  bootstrapComplete: boolean
  /** ISO timestamp of the last received snapshot (used for freshness indicator) */
  snapshotTimestamp: string | null
}

export interface DashboardStore extends DashboardState {
  syncSnapshot(snapshot: DashboardSnapshot): void
  applyEvent(event: DomainEvent): void
  applyEvents(events: DomainEvent[]): void
  /**
   * Seed recentActivity with persisted entries fetched over HTTP at bootstrap.
   * The WS snapshot carries no activity history, so without this the feed only
   * shows events emitted while the page was connected — which silently hides
   * anything announced during boot (e.g. dashboard restart announcements,
   * which are emitted before any client can reconnect). Live entries already
   * in the store win on id collisions.
   */
  seedRecentActivity(entries: unknown[]): void
  openIssue(issueId: string, tab?: string): void
  closeIssue(): void
  setDrawerTab(tab: string): void
  syncDrawerFromUrl(): void
}

// ─── Initial state ────────────────────────────────────────────────────────────

const initialState: DashboardState = {
  ...INITIAL_READ_MODEL_STATE,
  drawer: { issueId: null, tab: 'overview' },
  bootstrapComplete: false,
  snapshotTimestamp: null,
}

// ─── Thin wrappers over shared reducers (add bootstrapComplete flag) ─────────

function syncSnapshot(state: DashboardState, snapshot: DashboardSnapshot): DashboardState {
  return {
    ...syncSnapshotShared(state, snapshot),
    drawer: state.drawer,
    bootstrapComplete: true,
    snapshotTimestamp: snapshot.timestamp,
  }
}

function applyEvent(state: DashboardState, event: DomainEvent): DashboardState {
  return {
    ...applyEventShared(state, event),
    drawer: state.drawer,
    bootstrapComplete: state.bootstrapComplete,
    snapshotTimestamp: state.snapshotTimestamp,
  }
}

function applyEvents(state: DashboardState, events: DomainEvent[]): DashboardState {
  return {
    ...applyEventsShared(state, events),
    drawer: state.drawer,
    bootstrapComplete: state.bootstrapComplete,
    snapshotTimestamp: state.snapshotTimestamp,
  }
}

// ─── Zustand store ────────────────────────────────────────────────────────────

function replaceDrawerUrl(drawer: DrawerState) {
  if (typeof window === 'undefined') return

  const url = new URL(window.location.href)
  if (drawer.issueId) {
    url.searchParams.set('issue', drawer.issueId)
    url.searchParams.set('tab', drawer.tab)
  } else {
    url.searchParams.delete('issue')
    url.searchParams.delete('tab')
  }
  window.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`)
}

function readDrawerFromUrl(): DrawerState {
  if (typeof window === 'undefined') return { issueId: null, tab: 'overview' }

  const params = new URLSearchParams(window.location.search)
  return {
    issueId: params.get('issue'),
    tab: params.get('tab') || 'overview',
  }
}

export const useDashboardStore = create<DashboardStore>((set) => ({
  ...initialState,

  syncSnapshot: (snapshot) => {
    saveSnapshotToCache(snapshot)
    set((state) => syncSnapshot(state, snapshot))
  },

  applyEvent: (event) =>
    set((state) => applyEvent(state, event)),

  applyEvents: (events) =>
    set((state) => applyEvents(state, events)),

  seedRecentActivity: (entries) =>
    set((state) => {
      const byId = new Map<string, Record<string, unknown>>()
      // Live entries first so they win id collisions over the HTTP fetch.
      for (const entry of [
        ...(state.recentActivity as Array<Record<string, unknown>>),
        ...(entries as Array<Record<string, unknown>>),
      ]) {
        const id = typeof entry?.['id'] === 'string' ? (entry['id'] as string) : null
        if (id && !byId.has(id)) byId.set(id, entry)
      }
      const merged = [...byId.values()]
        .sort((a, b) => String(b['timestamp'] ?? '').localeCompare(String(a['timestamp'] ?? '')))
        .slice(0, 50)
      return { recentActivity: merged }
    }),

  openIssue: (issueId, tab = 'overview') => {
    const drawer = { issueId, tab }
    replaceDrawerUrl(drawer)
    set({ drawer })
  },

  closeIssue: () => {
    const drawer = { issueId: null, tab: 'overview' }
    replaceDrawerUrl(drawer)
    set({ drawer })
  },

  setDrawerTab: (tab) =>
    set((state) => {
      const drawer = { issueId: state.drawer.issueId, tab }
      replaceDrawerUrl(drawer)
      return { drawer }
    }),

  syncDrawerFromUrl: () =>
    set({ drawer: readDrawerFromUrl() }),
}))

// ─── Selector memoization helpers ─────────────────────────────────────────────
// Reducers use immutable updates, so we can cache derived arrays keyed by the
// source object reference. This prevents cascading re-renders when unrelated
// store slices change (e.g. an agent event should not re-render components
// that only consume issues).

function memoizeArraySelector<S, K extends keyof S, R>(
  key: K,
  derive: (slice: S[K]) => R,
): (s: S) => R {
  let lastSlice: S[K] | undefined
  let lastResult: R | undefined
  return (s: S) => {
    const slice = s[key]
    if (slice === lastSlice && lastResult !== undefined) {
      return lastResult
    }
    lastSlice = slice
    lastResult = derive(slice)
    return lastResult
  }
}

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectAgents = memoizeArraySelector<DashboardState, 'agentsById', AgentSnapshot[]>(
  'agentsById',
  (agents) => Object.values(agents),
)

export const selectAgentById =
  (id: string) =>
  (s: DashboardState): AgentSnapshot | undefined =>
    s.agentsById[id]

/**
 * PAN-1048 — selectSpecialistList retired. Consumers derive role-based lists
 * from `selectAgents` filtered by `agent.role` (review / test / ship).
 */
export const selectAgentsByRole =
  (role: 'review' | 'test' | 'ship' | 'work' | 'plan') =>
  (s: DashboardState): AgentSnapshot[] =>
    Object.values(s.agentsById).filter((a) => a.role === role)

export const selectReviewStatus =
  (issueId: string) =>
  (s: DashboardState): ReviewStatusSnapshot | undefined =>
    s.reviewStatusByIssueId[issueId]

export const selectMemoryObservations =
  (issueId: string) =>
  (s: DashboardState): MemoryObservation[] =>
    s.observationsByIssueId[issueId] ?? []

export const selectMemoryStatus =
  (issueId: string) =>
  (s: DashboardState): MemoryStatus | undefined =>
    s.statusByIssueId[issueId]

export const selectResetMarkersByScope =
  (scope: string, scopeId: string) =>
  (s: DashboardState): ResetMarker[] =>
    s.resetMarkersByScopeId[`${scope}:${scopeId}`] ?? []

export const selectChannelPermissionRequests = memoizeArraySelector<
  DashboardState,
  'channelPermissionRequestsById',
  ChannelPermissionRequestSnapshot[]
>(
  'channelPermissionRequestsById',
  (requestsById) =>
    Object.values(requestsById).sort((a, b) =>
      a.createdAt === b.createdAt ? a.requestId.localeCompare(b.requestId) : a.createdAt.localeCompare(b.createdAt),
    ),
)

/**
 * PAN-1520 — agents that have an outstanding AskUserQuestion the operator
 * can answer by clicking an option. Sorted by askedAt (oldest first).
 */
export const selectAgentsWithPendingAskUserQuestion = memoizeArraySelector<
  DashboardState,
  'agentsById',
  AgentSnapshot[]
>(
  'agentsById',
  (agentsById) =>
    Object.values(agentsById)
      .filter((a) => a.pendingAskUserQuestion != null)
      .sort((a, b) => {
        const aTime = a.pendingAskUserQuestion?.askedAt ?? ''
        const bTime = b.pendingAskUserQuestion?.askedAt ?? ''
        return aTime === bTime ? a.id.localeCompare(b.id) : aTime.localeCompare(bTime)
      }),
)

/**
 * PAN-1520 — a single agent-or-conversation subject that is blocked waiting on
 * the operator, across EVERY surface (AskUserQuestion, ExitPlanMode,
 * EnterPlanMode, session-resume, and PermissionRequest). This is what the
 * unified "Needs you" list and indicator consume so a dismissed plan-approval
 * or permission is recoverable, not just AskUserQuestions.
 *
 * `kinds` merges the agent's JSONL-derived `pendingInputKinds` (which the
 * enrichment poller owns) with `permissionRequest` derived from the SEPARATE
 * channel-permission event stream — they live in different store slices and the
 * enrichment event overwrites `pendingInputKinds` each poll, so the merge must
 * happen here at read time rather than being baked into one field server-side.
 */
export interface PendingInputSubject {
  agentId: string
  issueId?: string
  kinds: string[]
  /** AUQ payload when an AskUserQuestion is among the kinds (for the dialog). */
  pendingAskUserQuestion?: AgentSnapshot['pendingAskUserQuestion']
  /** Outstanding permission requests for this agent (for routing/labels). */
  permissionRequestIds: string[]
  /** Oldest blocking timestamp for stable ordering. */
  since: string
}

function deriveMemo<S, A, B, R>(
  ka: (s: S) => A,
  kb: (s: S) => B,
  derive: (a: A, b: B) => R,
): (s: S) => R {
  let lastA: A | undefined
  let lastB: B | undefined
  let last: R | undefined
  return (s: S) => {
    const a = ka(s)
    const b = kb(s)
    if (a === lastA && b === lastB && last !== undefined) return last
    lastA = a
    lastB = b
    last = derive(a, b)
    return last
  }
}

export const selectPendingInputSubjects = deriveMemo<
  DashboardState,
  DashboardState['agentsById'],
  DashboardState['channelPermissionRequestsById'],
  PendingInputSubject[]
>(
  (s) => s.agentsById,
  (s) => s.channelPermissionRequestsById,
  (agentsById, permsById) => {
    const perms = Object.values(permsById ?? {})
    const permByAgent = new Map<string, ChannelPermissionRequestSnapshot[]>()
    for (const p of perms) {
      const list = permByAgent.get(p.agentId) ?? []
      list.push(p)
      permByAgent.set(p.agentId, list)
    }

    const subjects: PendingInputSubject[] = []
    for (const a of Object.values(agentsById)) {
      const jsonlKinds = a.pendingInputKinds ? [...a.pendingInputKinds] : []
      const agentPerms = permByAgent.get(a.id) ?? []
      const kinds = [...jsonlKinds]
      if (agentPerms.length > 0 && !kinds.includes('permissionRequest')) {
        kinds.push('permissionRequest')
      }
      // PAN-1591 — "Needs you" must be ACTIONABLE. Require a concrete pending
      // surface (askUserQuestion / plan-mode / sessionResume / permissionRequest);
      // do NOT trust the fuzzy `hasPendingQuestion` superset bool here. That bool
      // is set by generic pane/runtime/fallback detections (reason 'other') that
      // add no kind, no count, and no answerable payload — e.g. a stopped agent
      // whose `resolution: needs_input` lingers forever, or a live pane-scan
      // false-positive. Those surfaced phantom "Waiting on your input" rows that
      // said "no longer waiting" the moment you clicked them. An actionable wait
      // always carries a kind, so `kinds.length > 0` is the precise signal.
      const waiting = kinds.length > 0
      if (!waiting) continue
      const since =
        a.pendingAskUserQuestion?.askedAt ??
        agentPerms.map((p) => p.createdAt).sort()[0] ??
        ''
      subjects.push({
        agentId: a.id,
        issueId: a.issueId,
        kinds,
        pendingAskUserQuestion: a.pendingAskUserQuestion,
        permissionRequestIds: agentPerms.map((p) => p.requestId),
        since,
      })
    }
    subjects.sort((x, y) =>
      x.since === y.since ? x.agentId.localeCompare(y.agentId) : x.since.localeCompare(y.since),
    )
    return subjects
  },
)

/**
 * Issues currently awaiting a human merge click — `readyForMerge: true`
 * and not already merged. Sorted oldest-ready first (FIFO) so issues
 * don't age in the queue.
 */
export const selectAwaitingMerge = memoizeArraySelector<DashboardState, 'reviewStatusByIssueId', ReviewStatusSnapshot[]>(
  'reviewStatusByIssueId',
  (rsMap) =>
    Object.values(rsMap)
      .filter(
        (rs): rs is ReviewStatusSnapshot =>
          rs?.readyForMerge === true &&
          rs.mergeStatus !== 'merged' &&
          (rs.blockerReasons?.length ?? 0) === 0,
      )
      .sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '')),
)

/**
 * Issues blocked from merge by GitHub-native blockers.
 * Shows issues with blockerReasons that haven't been merged yet.
 */
export const selectBlockedFromMerge = memoizeArraySelector<DashboardState, 'reviewStatusByIssueId', ReviewStatusSnapshot[]>(
  'reviewStatusByIssueId',
  (rsMap) =>
    Object.values(rsMap)
      .filter(
        (rs): rs is ReviewStatusSnapshot =>
          (rs?.blockerReasons?.length ?? 0) > 0 &&
          rs.mergeStatus !== 'merged' &&
          rs.reviewStatus === 'passed' &&
          (rs.testStatus === 'passed' || rs.testStatus === 'skipped'),
      )
      .sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '')),
)

/**
 * Open merge requests — PR/MR exists but not yet readyForMerge.
 * Shown on the Awaiting Merge page so the user can approve/review early.
 */
export const selectOpenMergeRequests = memoizeArraySelector<DashboardState, 'reviewStatusByIssueId', ReviewStatusSnapshot[]>(
  'reviewStatusByIssueId',
  (rsMap) =>
    Object.values(rsMap)
      .filter(
        (rs): rs is ReviewStatusSnapshot =>
          !!rs?.prUrl &&
          rs.readyForMerge !== true &&
          rs.mergeStatus !== 'merged',
      )
      .sort((a, b) => (a.updatedAt ?? '').localeCompare(b.updatedAt ?? '')),
)

const EMPTY_STRING_ARRAY: string[] = []

export const selectAgentOutput =
  (agentId: string) =>
  (s: DashboardState): string[] =>
    s.agentOutputById[agentId] ?? EMPTY_STRING_ARRAY

export const selectIsBootstrapped = (s: DashboardState): boolean => s.bootstrapComplete

export const selectDashboardLifecycle = (s: DashboardState) => s.dashboardLifecycle

export const selectScanProgress = (s: DashboardState) => s.scanProgress

export const selectResources = (s: DashboardState): ResourceStats | null => s.resources

export const selectIssues = (s: DashboardState): unknown[] => s.issuesRaw

export const selectIssuesByCycle = (_cycle: string, includeCompleted: boolean) =>
  memoizeArraySelector<DashboardState, 'issuesRaw', unknown[]>(
    'issuesRaw',
    (issues) => {
      const typed = issues as Array<Record<string, unknown>>
      if (includeCompleted) return typed
      // Only filter out canceled issues here. Done issues flow through to
      // groupByStatus() which handles closed-out label filtering separately.
      // "Include closed-out" controls the closed-out label, not the Done column.
      return typed.filter(
        (i) =>
          i['state'] !== 'canceled' && i['canonicalStatus'] !== 'canceled',
      )
    },
  )

// ─── Debug / test hook ────────────────────────────────────────────────────────

if (typeof window !== 'undefined') {
  (window as unknown as { useDashboardStore?: typeof useDashboardStore }).useDashboardStore = useDashboardStore
}

// ─── Export pure functions for testing ────────────────────────────────────────

export { syncSnapshot as syncSnapshotReducer, applyEvent as applyEventReducer, applyEvents as applyEventsReducer }
