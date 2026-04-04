/**
 * DashboardStore — Zustand store with pure event reducers (PAN-428 B4)
 *
 * Replaces React Query polling with event-sourced state.
 * The store receives a full snapshot on connect, then applies domain events incrementally.
 * All state updates are pure functions (no side effects inside reducers).
 *
 * Event coalescing: rapid events are batched via queueMicrotask before applying to React.
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

// ─── State shape ──────────────────────────────────────────────────────────────

export interface DashboardState {
  /** Whether the initial snapshot has been loaded */
  bootstrapComplete: boolean
  /** Current sequence number */
  sequence: number
  /** All active agents */
  agentsById: Record<string, AgentSnapshot>
  /** All specialist statuses */
  specialistsByName: Record<string, SpecialistSnapshot>
  /** Review status per issue */
  reviewStatusByIssueId: Record<string, ReviewStatusSnapshot>
  /** Resource stats (containers, networks, etc.) */
  resources: ResourceStats | null
  /** Buffered recent agent output lines (last 200 per agent) */
  agentOutputById: Record<string, string[]>
  /** Issues data (raw — from issues:snapshot/updated events) */
  issuesRaw: unknown[]
  /** Recent activity events */
  recentActivity: unknown[]
  /** Shadow inference content per issue */
  shadowInferenceByIssueId: Record<string, string>
}

export interface DashboardStore extends DashboardState {
  syncSnapshot(snapshot: DashboardSnapshot): void
  applyEvent(event: DomainEvent): void
  applyEvents(events: DomainEvent[]): void
}

// ─── Initial state ────────────────────────────────────────────────────────────

const initialState: DashboardState = {
  bootstrapComplete: false,
  sequence: 0,
  agentsById: {},
  specialistsByName: {},
  reviewStatusByIssueId: {},
  resources: null,
  agentOutputById: {},
  issuesRaw: [],
  recentActivity: [],
  shadowInferenceByIssueId: {},
}

// ─── Pure reducers ────────────────────────────────────────────────────────────

function syncSnapshot(state: DashboardState, snapshot: DashboardSnapshot): DashboardState {
  const agentsById: Record<string, AgentSnapshot> = {}
  for (const agent of snapshot.agents) {
    agentsById[agent.id] = agent
  }

  const specialistsByName: Record<string, SpecialistSnapshot> = {}
  for (const spec of snapshot.specialists) {
    specialistsByName[spec.name] = spec
  }

  const reviewStatusByIssueId: Record<string, ReviewStatusSnapshot> = {}
  for (const rs of snapshot.reviewStatuses) {
    reviewStatusByIssueId[rs.issueId] = rs
  }

  return {
    ...state,
    bootstrapComplete: true,
    sequence: snapshot.sequence,
    agentsById,
    specialistsByName,
    reviewStatusByIssueId,
    resources: snapshot.resources ?? null,
  }
}

const MAX_AGENT_OUTPUT_LINES = 200
const MAX_ACTIVITY_ENTRIES = 50

function applyEvent(state: DashboardState, event: DomainEvent): DashboardState {
  switch (event.type) {
    case 'agent.created':
    case 'agent.started':
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentsById: {
          ...state.agentsById,
          [event.payload.agentId]: event.payload.agent,
        },
      }

    case 'agent.stopped': {
      const { [event.payload.agentId]: _removed, ...rest } = state.agentsById
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentsById: rest,
      }
    }

    case 'agent.status_changed': {
      const agent = state.agentsById[event.payload.agentId]
      if (!agent) return state
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentsById: {
          ...state.agentsById,
          [event.payload.agentId]: { ...agent, status: event.payload.status },
        },
      }
    }

    case 'agent.output_received': {
      const existing = state.agentOutputById[event.payload.agentId] ?? []
      const updated = [...existing, ...event.payload.lines].slice(-MAX_AGENT_OUTPUT_LINES)
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentOutputById: {
          ...state.agentOutputById,
          [event.payload.agentId]: updated,
        },
      }
    }

    case 'pipeline.status_changed':
    case 'review.status_changed':
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        reviewStatusByIssueId: {
          ...state.reviewStatusByIssueId,
          [event.payload.issueId]: event.payload.status,
        },
      }

    case 'merge.ready':
      // merge:ready is handled by the review status pipeline — just advance sequence
      return { ...state, sequence: Math.max(state.sequence, event.sequence) }

    case 'specialist.started':
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        specialistsByName: {
          ...state.specialistsByName,
          [event.payload.specialist.name]: event.payload.specialist,
        },
      }

    case 'specialist.completed': {
      const spec = state.specialistsByName[event.payload.name]
      if (!spec) return state
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        specialistsByName: {
          ...state.specialistsByName,
          [event.payload.name]: { ...spec, state: 'sleeping', isRunning: false, currentIssue: undefined },
        },
      }
    }

    case 'specialist.failed': {
      const spec = state.specialistsByName[event.payload.name]
      if (!spec) return state
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        specialistsByName: {
          ...state.specialistsByName,
          [event.payload.name]: { ...spec, state: 'sleeping', isRunning: false },
        },
      }
    }

    case 'resources.updated':
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        resources: event.payload.resources,
      }

    case 'issues.snapshot':
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        issuesRaw: event.payload.issues as unknown[],
      }

    case 'issues.updated':
      // Signal to re-fetch issues (B19 will wire this up)
      return { ...state, sequence: Math.max(state.sequence, event.sequence) }

    case 'activity.updated':
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        recentActivity: (event.payload.events as unknown[]).slice(0, MAX_ACTIVITY_ENTRIES),
      }

    case 'shadow.inference_update':
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        shadowInferenceByIssueId: {
          ...state.shadowInferenceByIssueId,
          [event.payload.issueId]: event.payload.content,
        },
      }

    case 'planning.started':
    case 'planning.failed':
    case 'planning.sync':
    case 'plan.item_status_changed':
    case 'plan.subitem_status_changed':
    case 'plan.items_unblocked':
    case 'cost.event_recorded':
      // Advance sequence; B19 will wire component-level handlers for these
      return { ...state, sequence: Math.max(state.sequence, event.sequence) }

    default: {
      const _exhaustive: never = event
      return state
    }
  }
}

function applyEvents(state: DashboardState, events: DomainEvent[]): DashboardState {
  return events.reduce(applyEvent, state)
}

// ─── Zustand store ────────────────────────────────────────────────────────────

export const useDashboardStore = create<DashboardStore>((set) => ({
  ...initialState,

  syncSnapshot: (snapshot) =>
    set((state) => syncSnapshot(state, snapshot)),

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

export const selectResources = (s: DashboardState): ResourceStats | null => s.resources

// ─── Export pure functions for testing ────────────────────────────────────────

export { syncSnapshot as syncSnapshotReducer, applyEvent as applyEventReducer, applyEvents as applyEventsReducer }
