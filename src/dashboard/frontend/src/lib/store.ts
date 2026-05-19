/**
 * DashboardStore — Zustand store with shared event reducers (PAN-428 B4, PAN-433)
 *
 * Replaces React Query polling with event-sourced state.
 * The store receives a full snapshot on connect, then applies domain events incrementally.
 * Pure reducer functions are shared with the server read model via @panctl/contracts.
 */

import { create } from 'zustand'
import type {
  AgentSnapshot,
  ChannelPermissionRequestSnapshot,
  DashboardSnapshot,
  DomainEvent,
  ResourceStats,
  ReviewStatusSnapshot,
} from '@panctl/contracts'
import {
  type ReadModelState,
  INITIAL_READ_MODEL_STATE,
  syncSnapshot as syncSnapshotShared,
  applyEvent as applyEventShared,
  applyEvents as applyEventsShared,
} from '@panctl/contracts'
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

// ─── Export pure functions for testing ────────────────────────────────────────

export { syncSnapshot as syncSnapshotReducer, applyEvent as applyEventReducer, applyEvents as applyEventsReducer }
