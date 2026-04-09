/**
 * DashboardStore — Zustand store with shared event reducers (PAN-428 B4, PAN-433)
 *
 * Replaces React Query polling with event-sourced state.
 * The store receives a full snapshot on connect, then applies domain events incrementally.
 * Pure reducer functions are shared with the server read model via @panopticon/contracts.
 */

import { create } from 'zustand'
import type {
  AgentSnapshot,
  DashboardSnapshot,
  DomainEvent,
  ResourceStats,
  ReviewStatusSnapshot,
  SpecialistSnapshot,
} from '@panopticon/contracts'
import {
  type ReadModelState,
  INITIAL_READ_MODEL_STATE,
  syncSnapshot as syncSnapshotShared,
  applyEvent as applyEventShared,
  applyEvents as applyEventsShared,
} from '@panopticon/contracts'
import { saveSnapshotToCache } from './snapshotCache'

// ─── State shape ──────────────────────────────────────────────────────────────

export interface DashboardState extends ReadModelState {
  /** Whether the initial snapshot has been loaded */
  bootstrapComplete: boolean
  /** ISO timestamp of the last received snapshot (used for freshness indicator) */
  snapshotTimestamp: string | null
}

export interface DashboardStore extends DashboardState {
  syncSnapshot(snapshot: DashboardSnapshot): void
  applyEvent(event: DomainEvent): void
  applyEvents(events: DomainEvent[]): void
}

// ─── Initial state ────────────────────────────────────────────────────────────

const initialState: DashboardState = {
  ...INITIAL_READ_MODEL_STATE,
  bootstrapComplete: false,
  snapshotTimestamp: null,
}

// ─── Thin wrappers over shared reducers (add bootstrapComplete flag) ─────────

function syncSnapshot(state: DashboardState, snapshot: DashboardSnapshot): DashboardState {
  return { ...syncSnapshotShared(state, snapshot), bootstrapComplete: true, snapshotTimestamp: snapshot.timestamp }
}

function applyEvent(state: DashboardState, event: DomainEvent): DashboardState {
  return { ...applyEventShared(state, event), bootstrapComplete: state.bootstrapComplete, snapshotTimestamp: state.snapshotTimestamp }
}

function applyEvents(state: DashboardState, events: DomainEvent[]): DashboardState {
  return { ...applyEventsShared(state, events), bootstrapComplete: state.bootstrapComplete, snapshotTimestamp: state.snapshotTimestamp }
}

// ─── Zustand store ────────────────────────────────────────────────────────────

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
}))

// ─── Selectors ────────────────────────────────────────────────────────────────

export const selectAgentList = (s: DashboardState): AgentSnapshot[] =>
  Object.values(s.agentsById)

export const selectAgentById =
  (id: string) =>
  (s: DashboardState): AgentSnapshot | undefined =>
    s.agentsById[id]

export const selectSpecialistList = (s: DashboardState): SpecialistSnapshot[] =>
  Object.values(s.specialistsByName)

export const selectReviewStatus =
  (issueId: string) =>
  (s: DashboardState): ReviewStatusSnapshot | undefined =>
    s.reviewStatusByIssueId[issueId]

export const selectAgentOutput =
  (agentId: string) =>
  (s: DashboardState): string[] =>
    s.agentOutputById[agentId] ?? []

export const selectIsBootstrapped = (s: DashboardState): boolean => s.bootstrapComplete

export const selectDashboardLifecycle = (s: DashboardState) => s.dashboardLifecycle

export const selectResources = (s: DashboardState): ResourceStats | null => s.resources

export const selectIssues = (s: DashboardState): unknown[] => s.issuesRaw

export const selectIssuesByCycle = (_cycle: string, includeCompleted: boolean) =>
  (s: DashboardState): unknown[] => {
    const issues = s.issuesRaw as Array<Record<string, unknown>>
    if (includeCompleted) return issues
    // Only filter out canceled issues here. Done issues flow through to
    // groupByStatus() which handles closed-out label filtering separately.
    // "Include closed-out" controls the closed-out label, not the Done column.
    return issues.filter(
      (i) =>
        i['state'] !== 'canceled' && i['canonicalStatus'] !== 'canceled',
    )
  }

// ─── Export pure functions for testing ────────────────────────────────────────

export { syncSnapshot as syncSnapshotReducer, applyEvent as applyEventReducer, applyEvents as applyEventsReducer }
