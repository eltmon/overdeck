/**
 * Shared event reducers — pure functions for applying domain events to state (PAN-433)
 *
 * Used by:
 *   - Server read model (src/dashboard/server/read-model.ts)
 *   - Frontend Zustand store (src/dashboard/frontend/src/lib/store.ts)
 *
 * Both produce identical results for the same event, keeping server and client
 * eventually consistent (the T3Code pattern).
 */

import type {
  AgentSnapshot,
  DashboardSnapshot,
  DomainEvent,
  ResourceStats,
  ReviewStatusSnapshot,
  SpecialistSnapshot,
} from './index'

// ─── Read model state shape ──────────────────────────────────────────────────

export interface ReadModelState {
  sequence: number
  agentsById: Record<string, AgentSnapshot>
  specialistsByName: Record<string, SpecialistSnapshot>
  reviewStatusByIssueId: Record<string, ReviewStatusSnapshot>
  resources: ResourceStats | null
  agentOutputById: Record<string, string[]>
  issuesRaw: unknown[]
  recentActivity: unknown[]
  shadowInferenceByIssueId: Record<string, string>
}

export const INITIAL_READ_MODEL_STATE: ReadModelState = {
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

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_AGENT_OUTPUT_LINES = 200
const MAX_ACTIVITY_ENTRIES = 50

// ─── syncSnapshot — bootstrap from a full DashboardSnapshot ──────────────────

export function syncSnapshot(state: ReadModelState, snapshot: DashboardSnapshot): ReadModelState {
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
    sequence: snapshot.sequence,
    agentsById,
    specialistsByName,
    reviewStatusByIssueId,
    resources: (snapshot.resources as ResourceStats | undefined) ?? null,
    issuesRaw: (snapshot as any).issues ?? state.issuesRaw,
  }
}

// ─── applyEvent — apply a single domain event ───────────────────────────────

export function applyEvent(state: ReadModelState, event: DomainEvent): ReadModelState {
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

    case 'agent.enrichment_changed': {
      const agent = state.agentsById[event.payload.agentId]
      if (!agent) return { ...state, sequence: Math.max(state.sequence, event.sequence) }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentsById: {
          ...state.agentsById,
          [event.payload.agentId]: {
            ...agent,
            agentPhase: event.payload.agentPhase,
            hasPendingQuestion: event.payload.hasPendingQuestion,
            pendingQuestionCount: event.payload.pendingQuestionCount,
            resolution: event.payload.resolution,
            resolutionCount: event.payload.resolutionCount,
          },
        },
      }
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
      if (!agent) return { ...state, sequence: Math.max(state.sequence, event.sequence) }
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
      if (!spec) return { ...state, sequence: Math.max(state.sequence, event.sequence) }
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
      if (!spec) return { ...state, sequence: Math.max(state.sequence, event.sequence) }
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

    case 'planning.started': {
      const sessionName = event.payload.sessionName as string
      const issueId = event.payload.issueId as string
      if (sessionName) {
        return {
          ...state,
          sequence: Math.max(state.sequence, event.sequence),
          agentsById: {
            ...state.agentsById,
            [sessionName]: {
              ...state.agentsById[sessionName],
              id: sessionName,
              issueId,
              status: 'running',
              startedAt: event.timestamp,
              runtime: 'claude',
              agentPhase: 'planning' as const,
            },
          },
        }
      }
      return { ...state, sequence: Math.max(state.sequence, event.sequence) }
    }
    case 'planning.failed':
    case 'planning.sync':
    case 'plan.item_status_changed':
    case 'plan.subitem_status_changed':
    case 'plan.items_unblocked':
    case 'cost.event_recorded':
      return { ...state, sequence: Math.max(state.sequence, event.sequence) }

    default: {
      void (event as never)
      return state
    }
  }
}

// ─── applyEvents — batch apply ───────────────────────────────────────────────

export function applyEvents(state: ReadModelState, events: DomainEvent[]): ReadModelState {
  return events.reduce(applyEvent, state)
}
