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
  AgentRuntimeSnapshot,
  AgentSnapshot,
  ChannelPermissionRequestSnapshot,
  DashboardSnapshot,
  DomainEvent,
  ResourceStats,
  ReviewStatusSnapshot,
  TurnDiffSummary,
} from './index'

// ─── Read model state shape ──────────────────────────────────────────────────

export interface ResolvedChannelPermissionDecision {
  requestId: string
  agentId: string
  issueId?: string
  behavior: 'allow' | 'deny'
}

export interface SpecialistProjection {
  name: string
  state: 'active' | 'sleeping' | 'uninitialized'
  isRunning: boolean
  currentIssue?: string
  lastWake?: string
}

export interface ReadModelState {
  sequence: number
  agentsById: Record<string, AgentSnapshot>
  /**
   * PAN-800 — per-agent runtime state derived from agent.* runtime events.
   * Kept separate from agentsById because it updates on every tool call; merging
   * would cause the whole AgentSnapshot to re-diff on the frontend.
   */
  agentRuntimeById: Record<string, AgentRuntimeSnapshot>
  specialistsByName: Record<string, SpecialistProjection>
  reviewStatusByIssueId: Record<string, ReviewStatusSnapshot>
  resources: ResourceStats | null
  agentOutputById: Record<string, string[]>
  issuesRaw: unknown[]
  recentActivity: unknown[]
  detailedActivity: unknown[]
  ttsActivity: unknown[]
  shadowInferenceByIssueId: Record<string, string>
  turnDiffSummariesByAgentId: Record<string, TurnDiffSummary[]>
  channelPermissionRequestsById: Record<string, ChannelPermissionRequestSnapshot>
  channelPermissionRequestIdsByAgentId: Record<string, string[]>
  resolvedChannelPermissionDecisionsById: Record<string, ResolvedChannelPermissionDecision>
  resolvedChannelPermissionDecisionIdsByAgentId: Record<string, string[]>
  dashboardLifecycle: DashboardLifecycleState
  /** Conversation names currently undergoing Panopticon-native compaction. */
  conversationsCompactingByName: Record<string, boolean>
  /** Conversation names currently waiting for user permission (PermissionRequest hook). */
  conversationsAwaitingPermissionByName: Record<string, boolean>
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
  agentRuntimeById: {},
  specialistsByName: {},
  reviewStatusByIssueId: {},
  resources: null,
  agentOutputById: {},
  issuesRaw: [],
  recentActivity: [],
  detailedActivity: [],
  ttsActivity: [],
  shadowInferenceByIssueId: {},
  turnDiffSummariesByAgentId: {},
  channelPermissionRequestsById: {},
  channelPermissionRequestIdsByAgentId: {},
  resolvedChannelPermissionDecisionsById: {},
  resolvedChannelPermissionDecisionIdsByAgentId: {},
  conversationsCompactingByName: {},
  conversationsAwaitingPermissionByName: {},
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
export const DEFAULT_MAX_TURN_DIFF_SUMMARIES_PER_AGENT = 200

export function getMaxTurnDiffSummariesPerAgent(): number {
  const raw = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.PANOPTICON_TURN_DIFF_SUMMARY_LIMIT
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN
  return Number.isInteger(parsed) && parsed > 0 ? parsed : DEFAULT_MAX_TURN_DIFF_SUMMARIES_PER_AGENT
}

export function isTerminalTurnDiffSummaryStatus(status: unknown): boolean {
  return status === 'stopped' || status === 'done' || status === 'archived' || status === 'closed'
}

export function trimTurnDiffSummaries(summaries: TurnDiffSummary[]): TurnDiffSummary[] {
  const max = getMaxTurnDiffSummariesPerAgent()
  return summaries.length > max ? summaries.slice(-max) : summaries
}

export function omitTurnDiffSummariesForAgent(
  turnDiffSummariesByAgentId: ReadModelState['turnDiffSummariesByAgentId'] | undefined,
  agentId: string,
): ReadModelState['turnDiffSummariesByAgentId'] {
  const { [agentId]: _removed, ...rest } = turnDiffSummariesByAgentId ?? {}
  return rest
}

// ─── PAN-800 runtime helpers ─────────────────────────────────────────────────

function defaultRuntimeSnapshot(agentId: string, timestamp: string, sequence: number): AgentRuntimeSnapshot {
  return {
    id: agentId,
    activity: 'idle',
    lastActivity: timestamp,
    updatedAtSequence: sequence,
  }
}

/**
 * Bump runtimeSnapshotSequence on the corresponding AgentSnapshot (if present)
 * so low-frequency subscribers can cheaply detect a runtime change. No-op if
 * the agent has no lifecycle snapshot yet (a runtime event arrived before
 * agent.created — unusual but defensive).
 */
function bumpRuntimeSnapshotSequence(
  agentsById: Record<string, AgentSnapshot>,
  agentId: string,
  sequence: number,
): Record<string, AgentSnapshot> {
  const agent = agentsById[agentId]
  if (!agent) return agentsById
  return { ...agentsById, [agentId]: { ...agent, runtimeSnapshotSequence: sequence } }
}

// ─── syncSnapshot — bootstrap from a full DashboardSnapshot ──────────────────

export function syncSnapshot(state: ReadModelState, snapshot: DashboardSnapshot): ReadModelState {
  const agentsById: Record<string, AgentSnapshot> = {}
  for (const agent of snapshot.agents) {
    agentsById[agent.id] = agent
  }

  const specialistsByName: Record<string, SpecialistProjection> = {}
  for (const rawSpec of snapshot.specialists) {
    if (!rawSpec || typeof rawSpec !== 'object') continue
    const spec = rawSpec as Partial<SpecialistProjection>
    if (typeof spec.name !== 'string') continue
    specialistsByName[spec.name] = {
      name: spec.name,
      state: spec.state ?? 'uninitialized',
      isRunning: spec.isRunning ?? false,
      currentIssue: spec.currentIssue,
      lastWake: spec.lastWake,
    }
  }

  const reviewStatusByIssueId: Record<string, ReviewStatusSnapshot> = {}
  for (const rs of snapshot.reviewStatuses) {
    reviewStatusByIssueId[rs.issueId] = rs
  }

  const channelPermissionRequestsById: Record<string, ChannelPermissionRequestSnapshot> = {}
  const channelPermissionRequestIdsByAgentId: Record<string, string[]> = {}
  for (const request of snapshot.channelPermissionRequests ?? []) {
    channelPermissionRequestsById[request.requestId] = request
    const existing = channelPermissionRequestIdsByAgentId[request.agentId] ?? []
    channelPermissionRequestIdsByAgentId[request.agentId] = [...existing, request.requestId]
  }

  return {
    ...state,
    sequence: snapshot.sequence,
    agentsById,
    specialistsByName,
    reviewStatusByIssueId,
    agentRuntimeById: snapshot.agentRuntimeById ?? state.agentRuntimeById,
    channelPermissionRequestsById,
    channelPermissionRequestIdsByAgentId,
    resolvedChannelPermissionDecisionsById: {},
    resolvedChannelPermissionDecisionIdsByAgentId: {},
    resources: (snapshot.resources as ResourceStats | undefined) ?? null,
    issuesRaw: (snapshot as any).issues ?? state.issuesRaw,
  }
}

// ─── applyEvent — apply a single domain event ───────────────────────────────

export function applyEvent(state: ReadModelState, event: DomainEvent): ReadModelState {
  switch (event.type) {
    case 'agent.created': {
      const existing = state.agentsById[event.payload.agentId]
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentsById: {
          ...state.agentsById,
          [event.payload.agentId]: existing
            ? { ...existing, ...event.payload.agent }
            : event.payload.agent,
        },
      }
    }

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
            role: event.payload.role,
            hasPendingQuestion: event.payload.hasPendingQuestion,
            pendingQuestionCount: event.payload.pendingQuestionCount,
            pendingQuestionPrompt: event.payload.pendingQuestionPrompt,
            pendingQuestionReason: event.payload.pendingQuestionReason,
            resolution: event.payload.resolution,
            resolutionCount: event.payload.resolutionCount,
          },
        },
      }
    }

    case 'agent.stopped': {
      const { [event.payload.agentId]: _removed, ...rest } = state.agentsById
      // PAN-800 — mark the runtime snapshot stopped too. pan kill bypasses the
      // Stop hook, so without this fold a killed agent shows activity: "idle"
      // forever. Retain the row (don't delete) so the projection cache has the
      // last-known snapshot for forensics.
      const runtimeById = state.agentRuntimeById ?? {}
      const prevRuntime = runtimeById[event.payload.agentId]
      const nextRuntimeById = prevRuntime
        ? {
            ...runtimeById,
            [event.payload.agentId]: {
              ...prevRuntime,
              activity: 'stopped' as const,
              currentTool: undefined,
              thinking: undefined,
              waiting: undefined,
              channelReply: undefined,
              lastActivity: event.timestamp,
              updatedAtSequence: event.sequence,
            },
          }
        : runtimeById
      const permissionRequestIdsByAgentId = state.channelPermissionRequestIdsByAgentId ?? {}
      const pendingIds = permissionRequestIdsByAgentId[event.payload.agentId] ?? []
      const nextPermissionRequestsById = { ...state.channelPermissionRequestsById }
      for (const requestId of pendingIds) {
        delete nextPermissionRequestsById[requestId]
      }
      const { [event.payload.agentId]: _removedPendingIds, ...restPendingIds } =
        permissionRequestIdsByAgentId

      const resolvedDecisionIdsByAgentId = state.resolvedChannelPermissionDecisionIdsByAgentId ?? {}
      const resolvedIds = resolvedDecisionIdsByAgentId[event.payload.agentId] ?? []
      const nextResolvedDecisionsById = { ...(state.resolvedChannelPermissionDecisionsById ?? {}) }
      for (const requestId of resolvedIds) {
        delete nextResolvedDecisionsById[requestId]
      }
      const { [event.payload.agentId]: _removedResolvedIds, ...restResolvedIds } =
        resolvedDecisionIdsByAgentId

      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentsById: rest,
        agentRuntimeById: nextRuntimeById,
        channelPermissionRequestsById: nextPermissionRequestsById,
        channelPermissionRequestIdsByAgentId: restPendingIds,
        resolvedChannelPermissionDecisionsById: nextResolvedDecisionsById,
        resolvedChannelPermissionDecisionIdsByAgentId: restResolvedIds,
        turnDiffSummariesByAgentId: omitTurnDiffSummariesForAgent(state.turnDiffSummariesByAgentId, event.payload.agentId),
      }
    }

    case 'agent.status_changed': {
      const agent = state.agentsById[event.payload.agentId]
      if (!agent) return { ...state, sequence: Math.max(state.sequence, event.sequence) }
      const nextTurnDiffSummariesByAgentId = isTerminalTurnDiffSummaryStatus(event.payload.status)
        ? omitTurnDiffSummariesForAgent(state.turnDiffSummariesByAgentId, event.payload.agentId)
        : state.turnDiffSummariesByAgentId
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentsById: {
          ...state.agentsById,
          [event.payload.agentId]: { ...agent, status: event.payload.status },
        },
        turnDiffSummariesByAgentId: nextTurnDiffSummariesByAgentId,
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

    // PAN-915 — event-driven reviewer sub-status. Avoids tmux polling in
    // enrichReviewStatusFromSessions for the common case (reviewer dispatched).
    case 'review.reviewer_started': {
      const { issueId, role, sessionName } = event.payload
      const existing = state.reviewStatusByIssueId[issueId]
      const prevSubs = existing?.reviewSubStatuses ?? {}
      const prevNames = existing?.reviewSessionNames ?? []
      const nextNames = prevNames.includes(sessionName) ? prevNames : [...prevNames, sessionName]
      const nextStatus: ReviewStatusSnapshot = {
        ...(existing ?? { issueId }),
        reviewSubStatuses: { ...prevSubs, [role]: 'running' },
        reviewSessionNames: nextNames,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        reviewStatusByIssueId: { ...state.reviewStatusByIssueId, [issueId]: nextStatus },
      }
    }

    case 'review.reviewer_completed': {
      const { issueId, role } = event.payload
      const existing = state.reviewStatusByIssueId[issueId]
      if (!existing) return { ...state, sequence: Math.max(state.sequence, event.sequence) }
      const prevSubs = existing.reviewSubStatuses ?? {}
      const nextStatus: ReviewStatusSnapshot = {
        ...existing,
        reviewSubStatuses: { ...prevSubs, [role]: 'done' },
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        reviewStatusByIssueId: { ...state.reviewStatusByIssueId, [issueId]: nextStatus },
      }
    }

    case 'review.specialist.timed_out':
      // Telemetry-only event. Sequence update lets clients observe the event
      // stream without mutating the durable review-status snapshot.
      return { ...state, sequence: Math.max(state.sequence, event.sequence) }

    case 'review.coordinator_started': {
      const { issueId, sessionName } = event.payload
      const existing = state.reviewStatusByIssueId[issueId]
      const nextStatus: ReviewStatusSnapshot = {
        ...(existing ?? { issueId }),
        reviewCoordinatorSessionName: sessionName,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        reviewStatusByIssueId: { ...state.reviewStatusByIssueId, [issueId]: nextStatus },
      }
    }

    case 'review.coordinator.died':
      // Telemetry-only. The durable review-status row is updated by recovery
      // checks; keep clients in sequence so event stream subscribers can alert.
      return { ...state, sequence: Math.max(state.sequence, event.sequence) }

    case 'pipeline.review-started':
    case 'pipeline.review-completed':
    case 'pipeline.test-started':
    case 'pipeline.test-completed':
      // Handled by review.status_changed; sequence-only update keeps clients in lockstep.
      return { ...state, sequence: Math.max(state.sequence, event.sequence) }

    case 'merge.ready':
      return { ...state, sequence: Math.max(state.sequence, event.sequence) }

    case 'specialist.started':
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        specialistsByName: {
          ...state.specialistsByName,
          [event.payload.name]: event.payload,
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
      const { issueId, status, canonicalStatus, labels } = event.payload
      const updatedIssues = (state.issuesRaw as Array<Record<string, unknown>>).map(issue => {
        if (issue['identifier'] === issueId || issue['id'] === issueId) {
          const patch: Record<string, unknown> = { ...issue, status, canonicalStatus, state: canonicalStatus }
          if (labels) patch.labels = labels
          return patch
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
              runtime: 'claude-code',
              role: 'plan' as const,
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
      const removedAgentIds = Object.entries(state.agentsById)
        .filter(([, agent]) => agent.issueId === issueId)
        .map(([agentId]) => agentId)
      const updatedAgents = Object.fromEntries(
        Object.entries(state.agentsById).filter(([, agent]) => agent.issueId !== issueId)
      )
      let nextTurnDiffSummariesByAgentId = state.turnDiffSummariesByAgentId
      for (const agentId of removedAgentIds) {
        nextTurnDiffSummariesByAgentId = omitTurnDiffSummariesForAgent(nextTurnDiffSummariesByAgentId, agentId)
      }
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
        turnDiffSummariesByAgentId: nextTurnDiffSummariesByAgentId,
        issuesRaw: updatedIssues,
      }
    }

    case 'workspace.aborted': {
      const { issueId, sessionName } = event.payload
      let updatedAgents: typeof state.agentsById
      let nextTurnDiffSummariesByAgentId = state.turnDiffSummariesByAgentId
      if (sessionName) {
        const { [sessionName]: _removed, ...rest } = state.agentsById
        updatedAgents = rest
        nextTurnDiffSummariesByAgentId = omitTurnDiffSummariesForAgent(nextTurnDiffSummariesByAgentId, sessionName)
      } else {
        const removedAgentIds = Object.entries(state.agentsById)
          .filter(([, agent]) => agent.issueId === issueId)
          .map(([agentId]) => agentId)
        updatedAgents = Object.fromEntries(
          Object.entries(state.agentsById).filter(([, agent]) => agent.issueId !== issueId)
        )
        for (const agentId of removedAgentIds) {
          nextTurnDiffSummariesByAgentId = omitTurnDiffSummariesForAgent(nextTurnDiffSummariesByAgentId, agentId)
        }
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentsById: updatedAgents,
        turnDiffSummariesByAgentId: nextTurnDiffSummariesByAgentId,
      }
    }

    case 'planning.failed':
    case 'planning.sync':
    case 'plan.item_status_changed':
    case 'plan.subitem_status_changed':
    case 'plan.items_unblocked':
    case 'cost.event_recorded':
      return { ...state, sequence: Math.max(state.sequence, event.sequence) }

    // ─── PAN-800 Agent Runtime Events ──────────────────────────────────────
    case 'agent.activity_changed': {
      const { agentId, activity, currentTool } = event.payload
      const prev = state.agentRuntimeById[agentId]
        ?? defaultRuntimeSnapshot(agentId, event.timestamp, event.sequence)
      const next: AgentRuntimeSnapshot = {
        ...prev,
        activity,
        currentTool: activity === 'working' ? currentTool : undefined,
        // Clear thinking/waiting on transitions away from those activities.
        thinking: activity === 'thinking' ? prev.thinking : undefined,
        waiting: activity === 'waiting' ? prev.waiting : undefined,
        channelReply: activity === 'working' ? undefined : prev.channelReply,
        lastActivity: event.timestamp,
        updatedAtSequence: event.sequence,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentRuntimeById: { ...state.agentRuntimeById, [agentId]: next },
        agentsById: bumpRuntimeSnapshotSequence(state.agentsById, agentId, event.sequence),
      }
    }

    case 'agent.thinking_started': {
      const { agentId, lastToolAt } = event.payload
      const prev = state.agentRuntimeById[agentId]
        ?? defaultRuntimeSnapshot(agentId, event.timestamp, event.sequence)
      const next: AgentRuntimeSnapshot = {
        ...prev,
        activity: 'thinking',
        currentTool: undefined,
        thinking: { since: event.timestamp, lastToolAt },
        waiting: undefined,
        channelReply: undefined,
        lastActivity: event.timestamp,
        updatedAtSequence: event.sequence,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentRuntimeById: { ...state.agentRuntimeById, [agentId]: next },
        agentsById: bumpRuntimeSnapshotSequence(state.agentsById, agentId, event.sequence),
      }
    }

    case 'agent.thinking_stopped': {
      const { agentId } = event.payload
      const prev = state.agentRuntimeById[agentId]
      if (!prev) return { ...state, sequence: Math.max(state.sequence, event.sequence) }
      // Clear the thinking state but leave activity for the follow-up event
      // (agent.activity_changed / waiting_started / stopped) to set.
      const next: AgentRuntimeSnapshot = {
        ...prev,
        thinking: undefined,
        lastActivity: event.timestamp,
        updatedAtSequence: event.sequence,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentRuntimeById: { ...state.agentRuntimeById, [agentId]: next },
        agentsById: bumpRuntimeSnapshotSequence(state.agentsById, agentId, event.sequence),
      }
    }

    case 'agent.waiting_started': {
      const { agentId, reason, message } = event.payload
      const prev = state.agentRuntimeById[agentId]
        ?? defaultRuntimeSnapshot(agentId, event.timestamp, event.sequence)
      const next: AgentRuntimeSnapshot = {
        ...prev,
        activity: 'waiting',
        currentTool: undefined,
        thinking: undefined,
        waiting: {
          reason,
          startedAt: event.timestamp,
          message,
        },
        lastActivity: event.timestamp,
        updatedAtSequence: event.sequence,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentRuntimeById: { ...state.agentRuntimeById, [agentId]: next },
        agentsById: bumpRuntimeSnapshotSequence(state.agentsById, agentId, event.sequence),
      }
    }

    case 'agent.waiting_cleared': {
      const { agentId } = event.payload
      const prev = state.agentRuntimeById[agentId]
      if (!prev) return { ...state, sequence: Math.max(state.sequence, event.sequence) }
      const next: AgentRuntimeSnapshot = {
        ...prev,
        waiting: undefined,
        lastActivity: event.timestamp,
        updatedAtSequence: event.sequence,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentRuntimeById: { ...state.agentRuntimeById, [agentId]: next },
        agentsById: bumpRuntimeSnapshotSequence(state.agentsById, agentId, event.sequence),
      }
    }

    case 'agent.permission_requested': {
      const request = event.payload
      const permissionRequestIdsByAgentId = state.channelPermissionRequestIdsByAgentId ?? {}
      const resolvedDecisionsById = state.resolvedChannelPermissionDecisionsById ?? {}
      const resolvedDecisionIdsByAgentId = state.resolvedChannelPermissionDecisionIdsByAgentId ?? {}
      const nextPendingIds = permissionRequestIdsByAgentId[request.agentId] ?? []
      const resolvedDecision = resolvedDecisionsById[request.requestId]
      const nextResolvedDecisionsById = { ...resolvedDecisionsById }
      const nextResolvedIdsByAgentId = { ...resolvedDecisionIdsByAgentId }
      if (resolvedDecision) {
        delete nextResolvedDecisionsById[request.requestId]
        const prevResolvedIds = nextResolvedIdsByAgentId[resolvedDecision.agentId] ?? []
        const filteredResolvedIds = prevResolvedIds.filter((id) => id !== request.requestId)
        if (filteredResolvedIds.length > 0) {
          nextResolvedIdsByAgentId[resolvedDecision.agentId] = filteredResolvedIds
        } else {
          delete nextResolvedIdsByAgentId[resolvedDecision.agentId]
        }
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        channelPermissionRequestsById: {
          ...state.channelPermissionRequestsById,
          [request.requestId]: request,
        },
        channelPermissionRequestIdsByAgentId: {
          ...permissionRequestIdsByAgentId,
          [request.agentId]: nextPendingIds.includes(request.requestId)
            ? nextPendingIds
            : [...nextPendingIds, request.requestId],
        },
        resolvedChannelPermissionDecisionsById: nextResolvedDecisionsById,
        resolvedChannelPermissionDecisionIdsByAgentId: nextResolvedIdsByAgentId,
      }
    }

    case 'agent.permission_resolved': {
      const { [event.payload.requestId]: _removed, ...rest } = state.channelPermissionRequestsById
      const nextPendingIdsByAgentId = { ...(state.channelPermissionRequestIdsByAgentId ?? {}) }
      const prevPendingIds = nextPendingIdsByAgentId[event.payload.agentId] ?? []
      const filteredPendingIds = prevPendingIds.filter((id) => id !== event.payload.requestId)
      if (filteredPendingIds.length > 0) {
        nextPendingIdsByAgentId[event.payload.agentId] = filteredPendingIds
      } else {
        delete nextPendingIdsByAgentId[event.payload.agentId]
      }

      const resolvedDecisionIdsByAgentId = state.resolvedChannelPermissionDecisionIdsByAgentId ?? {}
      const nextResolvedIds = resolvedDecisionIdsByAgentId[event.payload.agentId] ?? []
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        channelPermissionRequestsById: rest,
        channelPermissionRequestIdsByAgentId: nextPendingIdsByAgentId,
        resolvedChannelPermissionDecisionsById: {
          ...(state.resolvedChannelPermissionDecisionsById ?? {}),
          [event.payload.requestId]: {
            requestId: event.payload.requestId,
            agentId: event.payload.agentId,
            issueId: event.payload.issueId,
            behavior: event.payload.behavior,
          },
        },
        resolvedChannelPermissionDecisionIdsByAgentId: {
          ...resolvedDecisionIdsByAgentId,
          [event.payload.agentId]: nextResolvedIds.includes(event.payload.requestId)
            ? nextResolvedIds
            : [...nextResolvedIds, event.payload.requestId],
        },
      }
    }

    case 'agent.message_received': {
      const { agentId, direction } = event.payload
      const prev = state.agentRuntimeById[agentId]
        ?? defaultRuntimeSnapshot(agentId, event.timestamp, event.sequence)
      const next: AgentRuntimeSnapshot = {
        ...prev,
        lastMessageAt: event.timestamp,
        channelReply: direction === 'to_agent' ? undefined : prev.channelReply,
        lastActivity: event.timestamp,
        updatedAtSequence: event.sequence,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentRuntimeById: { ...state.agentRuntimeById, [agentId]: next },
        agentsById: bumpRuntimeSnapshotSequence(state.agentsById, agentId, event.sequence),
      }
    }

    case 'agent.channel_reply': {
      const { agentId, reply } = event.payload
      const prev = state.agentRuntimeById[agentId]
        ?? defaultRuntimeSnapshot(agentId, event.timestamp, event.sequence)
      const next: AgentRuntimeSnapshot = {
        ...prev,
        channelReply: {
          ...reply,
          reportedAt: event.timestamp,
        },
        resolution:
          reply.kind === 'done'
            ? 'done'
            : reply.kind === 'needs_input'
              ? 'needs_input'
              : prev.resolution,
        resolutionUpdatedAt:
          reply.kind === 'done' || reply.kind === 'needs_input'
            ? event.timestamp
            : prev.resolutionUpdatedAt,
        lastActivity: event.timestamp,
        updatedAtSequence: event.sequence,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentRuntimeById: { ...state.agentRuntimeById, [agentId]: next },
        agentsById: bumpRuntimeSnapshotSequence(state.agentsById, agentId, event.sequence),
      }
    }

    case 'agent.model_set': {
      const { agentId, model, claudeSessionId } = event.payload
      const prev = state.agentRuntimeById[agentId]
        ?? defaultRuntimeSnapshot(agentId, event.timestamp, event.sequence)
      const next: AgentRuntimeSnapshot = {
        ...prev,
        model,
        claudeSessionId: claudeSessionId ?? prev.claudeSessionId,
        lastActivity: event.timestamp,
        updatedAtSequence: event.sequence,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentRuntimeById: { ...state.agentRuntimeById, [agentId]: next },
        agentsById: bumpRuntimeSnapshotSequence(state.agentsById, agentId, event.sequence),
      }
    }

    case 'agent.current_issue_set': {
      const { agentId, currentIssue } = event.payload
      const prev = state.agentRuntimeById[agentId]
        ?? defaultRuntimeSnapshot(agentId, event.timestamp, event.sequence)
      const next: AgentRuntimeSnapshot = {
        ...prev,
        currentIssue,
        lastActivity: event.timestamp,
        updatedAtSequence: event.sequence,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentRuntimeById: { ...state.agentRuntimeById, [agentId]: next },
        agentsById: bumpRuntimeSnapshotSequence(state.agentsById, agentId, event.sequence),
      }
    }

    case 'agent.resolution_changed': {
      const { agentId, resolution, resolutionCount } = event.payload
      const prev = state.agentRuntimeById[agentId]
        ?? defaultRuntimeSnapshot(agentId, event.timestamp, event.sequence)
      const next: AgentRuntimeSnapshot = {
        ...prev,
        resolution,
        resolutionCount,
        resolutionUpdatedAt: event.timestamp,
        lastActivity: event.timestamp,
        updatedAtSequence: event.sequence,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentRuntimeById: { ...state.agentRuntimeById, [agentId]: next },
        agentsById: bumpRuntimeSnapshotSequence(state.agentsById, agentId, event.sequence),
      }
    }

    case 'agent.state_restored': {
      const { agentId, snapshot } = event.payload
      // Seed directly from the restored snapshot but use the new event's sequence
      // so downstream consumers key off a monotonic value.
      const next: AgentRuntimeSnapshot = {
        ...snapshot,
        updatedAtSequence: event.sequence,
      }
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        agentRuntimeById: { ...state.agentRuntimeById, [agentId]: next },
        agentsById: bumpRuntimeSnapshotSequence(state.agentsById, agentId, event.sequence),
      }
    }

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

    case 'agent.turn_diff_completed': {
      const p = event.payload as {
        agentId: string
        turnId: string
        completedAt: string
        files: Array<{ path: string; kind?: string; additions?: number; deletions?: number }>
        checkpointRef?: string
        assistantMessageId?: string
        checkpointTurnCount?: number
      }
      const existing = state.turnDiffSummariesByAgentId[p.agentId] ?? []
      const summary: TurnDiffSummary = {
        turnId: p.turnId,
        completedAt: p.completedAt,
        files: p.files,
        checkpointRef: p.checkpointRef,
        assistantMessageId: p.assistantMessageId ?? undefined,
        checkpointTurnCount: p.checkpointTurnCount,
      }
      // Deduplicate by turnId — replace if exists, append otherwise
      const idx = existing.findIndex(s => s.turnId === p.turnId)
      const updated = trimTurnDiffSummaries(
        idx >= 0
          ? existing.map((s, i) => i === idx ? summary : s)
          : [...existing, summary]
      )
      return {
        ...state,
        sequence: Math.max(state.sequence, event.sequence),
        turnDiffSummariesByAgentId: {
          ...state.turnDiffSummariesByAgentId,
          [p.agentId]: updated,
        },
      }
    }

    case 'conversation.compacting_changed': {
      const { conversationName, compacting } = event.payload
      if (!compacting) {
        const { [conversationName]: _removed, ...rest } = state.conversationsCompactingByName
        return { ...state, conversationsCompactingByName: rest }
      }
      return {
        ...state,
        conversationsCompactingByName: { ...state.conversationsCompactingByName, [conversationName]: true },
      }
    }

    case 'conversation.permission_changed': {
      const { conversationName, waiting } = event.payload
      if (!waiting) {
        const { [conversationName]: _removed, ...rest } = state.conversationsAwaitingPermissionByName
        return { ...state, conversationsAwaitingPermissionByName: rest }
      }
      return {
        ...state,
        conversationsAwaitingPermissionByName: { ...state.conversationsAwaitingPermissionByName, [conversationName]: true },
      }
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
