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
  detailedActivity: unknown[]
  ttsActivity: unknown[]
  shadowInferenceByIssueId: Record<string, string>
  dashboardLifecycle: DashboardLifecycleState
}

export interface DashboardLifecycleState {
  active: boolean
  reason: string | null
  issueId: string | null
  trigger: string | null
  startedAt: string | null
  completedAt: string | null
  failedAt: string | null
  error: string | null
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
  detailedActivity: [],
  ttsActivity: [],
  shadowInferenceByIssueId: {},
  dashboardLifecycle: {
    active: false,
    reason: null,
    issueId: null,
    trigger: null,
    startedAt: null,
    completedAt: null,
    failedAt: null,
    error: null,
  },
}

// ─── Constants ───────────────────────────────────────────────────────────────

const MAX_AGENT_OUTPUT_LINES = 200
const MAX_ACTIVITY_ENTRIES = 50
const MAX_DETAILED_ENTRIES = 200
const MAX_TTS_ENTRIES = 50

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

    case 'issue.statusChanged': {
      const { issueId, status, canonicalStatus } = event.payload
      const updatedIssues = (state.issuesRaw as Array<Record<string, unknown>>).map(issue => {
        if (issue['identifier'] === issueId || issue['id'] === issueId) {
          return { ...issue, status, canonicalStatus, state: canonicalStatus }
        }
        return issue
      })
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        issuesRaw: updatedIssues,
      }
    }

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
    case 'workspace.created':
      return { ...state, sequence: Math.max(state.sequence, event.sequence) }

    case 'workspace.wipe_started': {
      const { issueId } = event.payload
      const updatedIssues = (state.issuesRaw as Array<Record<string, unknown>>).map(issue => {
        if (issue['identifier'] === issueId || issue['id'] === issueId) {
          return { ...issue, canonicalStatus: 'wiping', state: 'wiping' }
        }
        return issue
      })
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        issuesRaw: updatedIssues,
      }
    }

    case 'workspace.destroyed':
    case 'workspace.deleted': {
      const { issueId } = event.payload
      const updatedAgents = Object.fromEntries(
        Object.entries(state.agentsById).filter(([, agent]) => agent.issueId !== issueId)
      )
      const updatedIssues = (state.issuesRaw as Array<Record<string, unknown>>).map(issue => {
        if (issue['identifier'] === issueId || issue['id'] === issueId) {
          return { ...issue, status: 'Todo', canonicalStatus: 'todo', state: 'todo' }
        }
        return issue
      })
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentsById: updatedAgents,
        issuesRaw: updatedIssues,
      }
    }

    case 'workspace.aborted': {
      const { issueId, sessionName } = event.payload
      let updatedAgents: typeof state.agentsById
      if (sessionName) {
        const { [sessionName]: _removed, ...rest } = state.agentsById
        updatedAgents = rest
      } else {
        updatedAgents = Object.fromEntries(
          Object.entries(state.agentsById).filter(([, agent]) => agent.issueId !== issueId)
        )
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentsById: updatedAgents,
      }
    }

    case 'planning.failed':
    case 'planning.sync':
    case 'plan.item_status_changed':
    case 'plan.subitem_status_changed':
    case 'plan.items_unblocked':
    case 'cost.event_recorded':
      return { ...state, sequence: Math.max(state.sequence, event.sequence) }

    case 'activity.entry': {
      const entry = event.payload as Record<string, unknown>;
      const newEntry = { id: entry.id, timestamp: event.timestamp, ...entry };
      const updated = [newEntry, ...(state.recentActivity as Array<Record<string, unknown>>)].slice(0, MAX_ACTIVITY_ENTRIES);
      return { ...state, sequence: Math.max(state.sequence, event.sequence), recentActivity: updated };
    }

    case 'activity.detailed': {
      const entry = event.payload as Record<string, unknown>;
      const newEntry = { id: entry.id, timestamp: event.timestamp, ...entry };
      const updated = [newEntry, ...(state.detailedActivity as Array<Record<string, unknown>>)].slice(0, MAX_DETAILED_ENTRIES);
      return { ...state, sequence: Math.max(state.sequence, event.sequence), detailedActivity: updated };
    }

    case 'activity.tts': {
      const entry = event.payload as Record<string, unknown>;
      const newEntry = { id: entry.id, timestamp: event.timestamp, ...entry };
      const updated = [newEntry, ...(state.ttsActivity as Array<Record<string, unknown>>)].slice(0, MAX_TTS_ENTRIES);
      return { ...state, sequence: Math.max(state.sequence, event.sequence), ttsActivity: updated };
    }

    case 'dashboard.lifecycle_started': {
      const { reason, issueId, trigger } = event.payload as { reason: string; issueId: string | null; trigger: string };
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        dashboardLifecycle: {
          active: true,
          reason,
          issueId,
          trigger,
          startedAt: event.timestamp,
          completedAt: null,
          failedAt: null,
          error: null,
        },
      };
    }

    case 'dashboard.lifecycle_completed': {
      const { reason, issueId } = event.payload as { reason: string; issueId: string | null; durationMs: number };
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        dashboardLifecycle: {
          ...state.dashboardLifecycle,
          active: false,
          reason: reason ?? state.dashboardLifecycle.reason,
          issueId: issueId ?? state.dashboardLifecycle.issueId,
          completedAt: event.timestamp,
        },
      };
    }

    case 'dashboard.lifecycle_failed': {
      const { reason, issueId, error } = event.payload as { reason: string; issueId: string | null; error: string };
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        dashboardLifecycle: {
          ...state.dashboardLifecycle,
          active: false,
          reason: reason ?? state.dashboardLifecycle.reason,
          issueId: issueId ?? state.dashboardLifecycle.issueId,
          failedAt: event.timestamp,
          error,
        },
      };
    }

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
