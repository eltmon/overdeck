import { Schema } from "effect"
import {
  Activity,
  AgentChannelReply,
  AgentId,
  AgentResolution,
  AgentRuntimeSnapshot,
  AgentSnapshot,
  AgentStatus,
  ChannelPermissionRequestSnapshot,
  ClaudeChannelPermissionBehavior,
  IssueId,
  ResourceStats,
  ReviewStatusSnapshot,
  Role,
  SequenceNumber,
  WaitingReason,
} from "./types"
import {
  MemoryObservation,
  MemoryStatus,
  PendingTurn,
  RagDecision,
  ResetMarker,
} from "./memory"

// ─── Agent Events ─────────────────────────────────────────────────────────────

/** Replaces socket.io `agents:changed` (event: 'started') */
export const AgentStartedEvent = Schema.Struct({
  type: Schema.Literal("agent.started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ agentId: AgentId, issueId: IssueId, agent: AgentSnapshot }),
})
export type AgentStartedEvent = typeof AgentStartedEvent.Type

/** Replaces socket.io `agents:changed` (event: 'stopped') */
export const AgentStoppedEvent = Schema.Struct({
  type: Schema.Literal("agent.stopped"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ agentId: AgentId, issueId: IssueId, sessionId: Schema.optional(Schema.String) }),
})
export type AgentStoppedEvent = typeof AgentStoppedEvent.Type

export const AgentHeartbeatDeadEvent = Schema.Struct({
  type: Schema.Literal("agent.heartbeat_dead"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ agentId: AgentId, issueId: Schema.optional(IssueId), sessionId: Schema.optional(Schema.String) }),
})
export type AgentHeartbeatDeadEvent = typeof AgentHeartbeatDeadEvent.Type

/** Role lifecycle — work agent completed implementation and is ready for review. */
export const WorkCompletedEvent = Schema.Struct({
  type: Schema.Literal("work.completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, agentId: Schema.optional(AgentId) }),
})
export type WorkCompletedEvent = typeof WorkCompletedEvent.Type

/** Role lifecycle — generic agent completion signal, normalized by Cloister by role. */
export const AgentCompletedEvent = Schema.Struct({
  type: Schema.Literal("agent.completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, agentId: Schema.optional(AgentId), role: Schema.optional(Role) }),
})
export type AgentCompletedEvent = typeof AgentCompletedEvent.Type

/** Role lifecycle — review approved the branch and testing should start. */
export const ReviewApprovedEvent = Schema.Struct({
  type: Schema.Literal("review.approved"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId }),
})
export type ReviewApprovedEvent = typeof ReviewApprovedEvent.Type

/** Role lifecycle — tests passed and shipping should prepare the branch. */
export const TestPassedEvent = Schema.Struct({
  type: Schema.Literal("test.passed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId }),
})
export type TestPassedEvent = typeof TestPassedEvent.Type

/** Replaces socket.io `godview:status-change` */
export const AgentStatusChangedEvent = Schema.Struct({
  type: Schema.Literal("agent.status_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    issueId: Schema.optional(IssueId),
    status: AgentStatus,
    previousStatus: Schema.optional(AgentStatus),
    stoppedByUser: Schema.optional(Schema.Boolean),
    paused: Schema.optional(Schema.Boolean),
    pausedReason: Schema.optional(Schema.NullOr(Schema.String)),
    pausedAt: Schema.optional(Schema.NullOr(Schema.String)),
    troubled: Schema.optional(Schema.Boolean),
    troubledAt: Schema.optional(Schema.NullOr(Schema.String)),
    consecutiveFailures: Schema.optional(Schema.Number),
    firstFailureInRunAt: Schema.optional(Schema.NullOr(Schema.String)),
    lastFailureAt: Schema.optional(Schema.NullOr(Schema.String)),
    lastFailureReason: Schema.optional(Schema.NullOr(Schema.String)),
    lastFailureNextRetryAt: Schema.optional(Schema.NullOr(Schema.String)),
  }),
})
export type AgentStatusChangedEvent = typeof AgentStatusChangedEvent.Type

/** Replaces socket.io `godview:agent-output` */
export const AgentOutputReceivedEvent = Schema.Struct({
  type: Schema.Literal("agent.output_received"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ agentId: AgentId, lines: Schema.Array(Schema.String) }),
})
export type AgentOutputReceivedEvent = typeof AgentOutputReceivedEvent.Type

/** New — agent enrichment fields updated (PAN-440) */
export const AgentEnrichmentChangedEvent = Schema.Struct({
  type: Schema.Literal("agent.enrichment_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    role: Schema.optional(Role),
    hasPendingQuestion: Schema.Boolean,
    pendingQuestionCount: Schema.Number,
    pendingQuestionPrompt: Schema.optional(Schema.String),
    pendingQuestionReason: Schema.optional(Schema.String),
    resolution: Schema.optional(AgentResolution),
    resolutionCount: Schema.optional(Schema.Number),
  }),
})
export type AgentEnrichmentChangedEvent = typeof AgentEnrichmentChangedEvent.Type

/** New — agent created in database */
export const AgentCreatedEvent = Schema.Struct({
  type: Schema.Literal("agent.created"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ agentId: AgentId, issueId: IssueId, agent: AgentSnapshot }),
})
export type AgentCreatedEvent = typeof AgentCreatedEvent.Type

// ─── Agent Runtime Events (PAN-800) ───────────────────────────────────────────
// Canonical per-tool-call runtime signals. Fold into ReadModelState.agentRuntimeById
// via the shared reducer. Server AgentStateService ref is derived from the same fold.

export const AgentActivityChangedEvent = Schema.Struct({
  type: Schema.Literal("agent.activity_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    activity: Activity,
    currentTool: Schema.optional(Schema.String),
  }),
})
export type AgentActivityChangedEvent = typeof AgentActivityChangedEvent.Type

export const AgentThinkingStartedEvent = Schema.Struct({
  type: Schema.Literal("agent.thinking_started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    lastToolAt: Schema.String,
  }),
})
export type AgentThinkingStartedEvent = typeof AgentThinkingStartedEvent.Type

export const AgentThinkingStoppedEvent = Schema.Struct({
  type: Schema.Literal("agent.thinking_stopped"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    resolvedBy: Schema.Literals(["tool", "waiting", "idle", "stopped"]),
  }),
})
export type AgentThinkingStoppedEvent = typeof AgentThinkingStoppedEvent.Type

export const AgentWaitingStartedEvent = Schema.Struct({
  type: Schema.Literal("agent.waiting_started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    reason: WaitingReason,
    message: Schema.optional(Schema.String),
  }),
})
export type AgentWaitingStartedEvent = typeof AgentWaitingStartedEvent.Type

export const AgentWaitingClearedEvent = Schema.Struct({
  type: Schema.Literal("agent.waiting_cleared"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    clearedBy: Schema.Literals(["user_response", "timeout", "stopped", "tool_resumed"]),
  }),
})
export type AgentWaitingClearedEvent = typeof AgentWaitingClearedEvent.Type

export const AgentPermissionRequestedEvent = Schema.Struct({
  type: Schema.Literal("agent.permission_requested"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: ChannelPermissionRequestSnapshot,
})
export type AgentPermissionRequestedEvent = typeof AgentPermissionRequestedEvent.Type

export const AgentPermissionResolvedEvent = Schema.Struct({
  type: Schema.Literal("agent.permission_resolved"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    requestId: Schema.String,
    agentId: AgentId,
    issueId: Schema.optional(IssueId),
    behavior: ClaudeChannelPermissionBehavior,
  }),
})
export type AgentPermissionResolvedEvent = typeof AgentPermissionResolvedEvent.Type

export const AgentMessageReceivedEvent = Schema.Struct({
  type: Schema.Literal("agent.message_received"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    direction: Schema.Literals(["to_agent", "from_agent"]),
    source: Schema.Literals(["user", "cloister", "specialist", "automated"]),
  }),
})
export type AgentMessageReceivedEvent = typeof AgentMessageReceivedEvent.Type

export const AgentChannelReplyEvent = Schema.Struct({
  type: Schema.Literal("agent.channel_reply"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    reply: AgentChannelReply,
  }),
})
export type AgentChannelReplyEvent = typeof AgentChannelReplyEvent.Type

export const AgentModelSetEvent = Schema.Struct({
  type: Schema.Literal("agent.model_set"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    model: Schema.String,
    claudeSessionId: Schema.optional(Schema.String),
  }),
})
export type AgentModelSetEvent = typeof AgentModelSetEvent.Type

export const AgentCurrentIssueSetEvent = Schema.Struct({
  type: Schema.Literal("agent.current_issue_set"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    currentIssue: Schema.optional(IssueId),
  }),
})
export type AgentCurrentIssueSetEvent = typeof AgentCurrentIssueSetEvent.Type

export const AgentResolutionChangedEvent = Schema.Struct({
  type: Schema.Literal("agent.resolution_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    resolution: AgentResolution,
    resolutionCount: Schema.Number,
  }),
})
export type AgentResolutionChangedEvent = typeof AgentResolutionChangedEvent.Type

/**
 * Bootstrap-only event emitted by AgentStateService when it seeds a runtime
 * snapshot from projection_cache. Not emitted by hooks.
 */
export const AgentStateRestoredEvent = Schema.Struct({
  type: Schema.Literal("agent.state_restored"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    snapshot: AgentRuntimeSnapshot,
  }),
})
export type AgentStateRestoredEvent = typeof AgentStateRestoredEvent.Type

/** Emitted when a turn diff checkpoint is captured and diff computed */
export const AgentTurnDiffCompletedEvent = Schema.Struct({
  type: Schema.Literal("agent.turn_diff_completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    turnId: Schema.String,
    completedAt: Schema.String,
    files: Schema.Array(Schema.Struct({
      path: Schema.String,
      kind: Schema.optional(Schema.String),
      additions: Schema.optional(Schema.Number),
      deletions: Schema.optional(Schema.Number),
    })),
    checkpointRef: Schema.optional(Schema.String),
    assistantMessageId: Schema.optional(Schema.String),
    checkpointTurnCount: Schema.optional(Schema.Number),
  }),
})
export type AgentTurnDiffCompletedEvent = typeof AgentTurnDiffCompletedEvent.Type

// ─── Planning Events ──────────────────────────────────────────────────────────

/** Replaces socket.io `planning:started` */
export const PlanningStartedEvent = Schema.Struct({
  type: Schema.Literal("planning.started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, sessionName: Schema.String }),
})
export type PlanningStartedEvent = typeof PlanningStartedEvent.Type

/** Replaces socket.io `planning:failed` */
export const PlanningFailedEvent = Schema.Struct({
  type: Schema.Literal("planning.failed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, error: Schema.String }),
})
export type PlanningFailedEvent = typeof PlanningFailedEvent.Type

/** Replaces socket.io `planning:sync` */
export const PlanningSyncEvent = Schema.Struct({
  type: Schema.Literal("planning.sync"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId,
    status: Schema.String,
    progress: Schema.optional(Schema.Number),
    message: Schema.optional(Schema.String),
  }),
})
export type PlanningSyncEvent = typeof PlanningSyncEvent.Type

// ─── Plan Item Events ─────────────────────────────────────────────────────────

/** Replaces socket.io `plan:item-status-changed` */
export const PlanItemStatusChangedEvent = Schema.Struct({
  type: Schema.Literal("plan.item_status_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, itemId: Schema.String, status: Schema.String }),
})
export type PlanItemStatusChangedEvent = typeof PlanItemStatusChangedEvent.Type

/** Replaces socket.io `plan:subitem-status-changed` */
export const PlanSubitemStatusChangedEvent = Schema.Struct({
  type: Schema.Literal("plan.subitem_status_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId,
    itemId: Schema.String,
    subItemId: Schema.String,
    status: Schema.String,
  }),
})
export type PlanSubitemStatusChangedEvent = typeof PlanSubitemStatusChangedEvent.Type

/** Replaces socket.io `plan:items-unblocked` */
export const PlanItemsUnblockedEvent = Schema.Struct({
  type: Schema.Literal("plan.items_unblocked"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, items: Schema.Array(Schema.String) }),
})
export type PlanItemsUnblockedEvent = typeof PlanItemsUnblockedEvent.Type

// ─── Pipeline / Merge Events ──────────────────────────────────────────────────

/** Replaces socket.io `pipeline:status` */
export const PipelineStatusChangedEvent = Schema.Struct({
  type: Schema.Literal("pipeline.status_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, status: ReviewStatusSnapshot }),
})
export type PipelineStatusChangedEvent = typeof PipelineStatusChangedEvent.Type

/** Replaces socket.io `merge:ready` */
export const MergeReadyEvent = Schema.Struct({
  type: Schema.Literal("merge.ready"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId }),
})
export type MergeReadyEvent = typeof MergeReadyEvent.Type

/** New — review status changed */
export const ReviewStatusChangedEvent = Schema.Struct({
  type: Schema.Literal("review.status_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, status: ReviewStatusSnapshot }),
})
export type ReviewStatusChangedEvent = typeof ReviewStatusChangedEvent.Type

/** New — review specialist dispatched */
export const PipelineReviewStartedEvent = Schema.Struct({
  type: Schema.Literal("pipeline.review-started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId }),
})
export type PipelineReviewStartedEvent = typeof PipelineReviewStartedEvent.Type

/** New — review specialist finished (passed or failed) */
export const PipelineReviewCompletedEvent = Schema.Struct({
  type: Schema.Literal("pipeline.review-completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, passed: Schema.Boolean }),
})
export type PipelineReviewCompletedEvent = typeof PipelineReviewCompletedEvent.Type

/** New — test specialist dispatched */
export const PipelineTestStartedEvent = Schema.Struct({
  type: Schema.Literal("pipeline.test-started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId }),
})
export type PipelineTestStartedEvent = typeof PipelineTestStartedEvent.Type

/** New — test specialist finished (passed or failed) */
export const PipelineTestCompletedEvent = Schema.Struct({
  type: Schema.Literal("pipeline.test-completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, passed: Schema.Boolean }),
})
export type PipelineTestCompletedEvent = typeof PipelineTestCompletedEvent.Type

/**
 * PAN-915 — reviewer session received a new prompt (spawn or resume of a
 * canonical PAN-830 session). Drives event-driven `reviewSubStatuses[role] =
 * 'running'` and tracking of `reviewSessionNames` without polling tmux.
 */
export const ReviewReviewerStartedEvent = Schema.Struct({
  type: Schema.Literal("review.reviewer_started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId,
    role: Schema.String,
    sessionName: Schema.String,
  }),
})
export type ReviewReviewerStartedEvent = typeof ReviewReviewerStartedEvent.Type

/**
 * PAN-915 — reviewer wrote its output file (round complete for that role).
 * Updates `reviewSubStatuses[role] = 'done'` event-driven.
 */
export const ReviewReviewerCompletedEvent = Schema.Struct({
  type: Schema.Literal("review.reviewer_completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId,
    role: Schema.String,
  }),
})
export type ReviewReviewerCompletedEvent = typeof ReviewReviewerCompletedEvent.Type

/**
 * Review specialist timeout telemetry. Emitted once per timed-out reviewer wait
 * attempt so operators can distinguish transient auto-retries from terminal
 * review failures.
 */
export const ReviewSpecialistTimedOutEvent = Schema.Struct({
  type: Schema.Literal("review.specialist.timed_out"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId,
    role: Schema.String,
    sessionName: Schema.String,
    attempt: Schema.Number,
    maxRetries: Schema.Number,
    willRetry: Schema.Boolean,
  }),
})
export type ReviewSpecialistTimedOutEvent = typeof ReviewSpecialistTimedOutEvent.Type

/**
 * PAN-915 — review coordinator session spawned. Surfaces in the dashboard so
 * the kanban card can show "review in progress" the instant the coordinator
 * starts, not after the first reviewer finishes.
 */
export const ReviewCoordinatorStartedEvent = Schema.Struct({
  type: Schema.Literal("review.coordinator_started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId,
    sessionName: Schema.String,
  }),
})
export type ReviewCoordinatorStartedEvent = typeof ReviewCoordinatorStartedEvent.Type

/** Review coordinator died before writing a terminal exit marker. */
export const ReviewCoordinatorDiedEvent = Schema.Struct({
  type: Schema.Literal("review.coordinator.died"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId,
    sessionName: Schema.String,
    reason: Schema.String,
  }),
})
export type ReviewCoordinatorDiedEvent = typeof ReviewCoordinatorDiedEvent.Type

// ─── Specialist Events ────────────────────────────────────────────────────────

const SpecialistLifecycleState = Schema.Literals(["active", "sleeping", "uninitialized"])

/** New — role-backed specialist became active */
export const SpecialistStartedEvent = Schema.Struct({
  type: Schema.Literal("specialist.started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    name: Role,
    state: SpecialistLifecycleState,
    isRunning: Schema.Boolean,
    currentIssue: Schema.optional(Schema.String),
    lastWake: Schema.optional(Schema.String),
  }),
})
export type SpecialistStartedEvent = typeof SpecialistStartedEvent.Type

/** New — role-backed specialist completed work */
export const SpecialistCompletedEvent = Schema.Struct({
  type: Schema.Literal("specialist.completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ name: Role, issueId: Schema.optional(IssueId) }),
})
export type SpecialistCompletedEvent = typeof SpecialistCompletedEvent.Type

/** New — role-backed specialist failed */
export const SpecialistFailedEvent = Schema.Struct({
  type: Schema.Literal("specialist.failed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    name: Role,
    issueId: Schema.optional(IssueId),
    error: Schema.String,
  }),
})
export type SpecialistFailedEvent = typeof SpecialistFailedEvent.Type

// ─── Resource Events ──────────────────────────────────────────────────────────

/** Replaces socket.io `resources:updated` */
export const ResourcesUpdatedEvent = Schema.Struct({
  type: Schema.Literal("resources.updated"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ resources: ResourceStats }),
})
export type ResourcesUpdatedEvent = typeof ResourcesUpdatedEvent.Type

export const SystemHealthSeverityChangedEvent = Schema.Struct({
  type: Schema.Literal("system.health_severity_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    previousSeverity: Schema.String,
    severity: Schema.String,
    reasons: Schema.Array(Schema.String),
    leakedSpecialistCount: Schema.Number,
  }),
})
export type SystemHealthSeverityChangedEvent = typeof SystemHealthSeverityChangedEvent.Type

// ─── Issue Events ─────────────────────────────────────────────────────────────

/** Replaces socket.io `issues:snapshot` */
export const IssuesSnapshotEvent = Schema.Struct({
  type: Schema.Literal("issues.snapshot"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issues: Schema.Array(Schema.Unknown) }),
})
export type IssuesSnapshotEvent = typeof IssuesSnapshotEvent.Type

/** Replaces socket.io `issues:updated` */
export const IssuesUpdatedEvent = Schema.Struct({
  type: Schema.Literal("issues.updated"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: Schema.optional(IssueId) }),
})
export type IssuesUpdatedEvent = typeof IssuesUpdatedEvent.Type

/** Patch a single issue's status in the read model without a full snapshot refresh. */
export const IssueStatusChangedEvent = Schema.Struct({
  type: Schema.Literal("issue.statusChanged"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId,
    status: Schema.String,
    canonicalStatus: Schema.String,
    labels: Schema.optional(Schema.Array(Schema.String)),
  }),
})
export type IssueStatusChangedEvent = typeof IssueStatusChangedEvent.Type

// ─── Activity Events ──────────────────────────────────────────────────────────

/** Replaces socket.io `godview:activity` */
export const ActivityUpdatedEvent = Schema.Struct({
  type: Schema.Literal("activity.updated"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ events: Schema.Array(Schema.Unknown) }),
})
export type ActivityUpdatedEvent = typeof ActivityUpdatedEvent.Type

/** Individual activity log entry — emitted by merge-agent, cloister, specialists (PAN-520) */
export const ActivityEntryEvent = Schema.Struct({
  type: Schema.Literal("activity.entry"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    id: Schema.String,
    source: Schema.String,
    level: Schema.String,
    message: Schema.String,
    details: Schema.optional(Schema.String),
    issueId: Schema.optional(IssueId),
  }),
})
export type ActivityEntryEvent = typeof ActivityEntryEvent.Type

/** Detailed activity log — auto-generated from domain state changes */
export const ActivityDetailedEvent = Schema.Struct({
  type: Schema.Literal("activity.detailed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    id: Schema.String,
    source: Schema.String,
    level: Schema.String,
    message: Schema.String,
    details: Schema.optional(Schema.String),
    issueId: Schema.optional(IssueId),
    triggeringEvent: Schema.optional(Schema.String),
  }),
})
export type ActivityDetailedEvent = typeof ActivityDetailedEvent.Type

/** TTS activity log — upleveled utterances for text-to-speech */
export const ActivityTtsEvent = Schema.Struct({
  type: Schema.Literal("activity.tts"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    id: Schema.String,
    utterance: Schema.String,
    priority: Schema.optional(Schema.Number),
    issueId: Schema.optional(IssueId),
    source: Schema.optional(Schema.String),
    eventType: Schema.optional(Schema.String),
  }),
})
export type ActivityTtsEvent = typeof ActivityTtsEvent.Type

// ─── Dashboard Lifecycle Events ─────────────────────────────────────────────────

/** Dashboard is restarting (post-merge deploy, pan restart, etc.) (PAN-520) */
export const DashboardLifecycleStartedEvent = Schema.Struct({
  type: Schema.Literal("dashboard.lifecycle_started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    reason: Schema.String,
    issueId: Schema.optional(IssueId),
    trigger: Schema.String,
  }),
})
export type DashboardLifecycleStartedEvent = typeof DashboardLifecycleStartedEvent.Type

/** Dashboard restarted successfully after a lifecycle event (PAN-520) */
export const DashboardLifecycleCompletedEvent = Schema.Struct({
  type: Schema.Literal("dashboard.lifecycle_completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    reason: Schema.String,
    issueId: Schema.optional(IssueId),
    durationMs: Schema.Number,
  }),
})
export type DashboardLifecycleCompletedEvent = typeof DashboardLifecycleCompletedEvent.Type

/** Dashboard restart failed (PAN-520) */
export const DashboardLifecycleFailedEvent = Schema.Struct({
  type: Schema.Literal("dashboard.lifecycle_failed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    reason: Schema.String,
    issueId: Schema.optional(IssueId),
    error: Schema.String,
  }),
})
export type DashboardLifecycleFailedEvent = typeof DashboardLifecycleFailedEvent.Type

/** Replaces socket.io `shadow:inference-update` */
export const ShadowInferenceUpdateEvent = Schema.Struct({
  type: Schema.Literal("shadow.inference_update"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, content: Schema.String }),
})
export type ShadowInferenceUpdateEvent = typeof ShadowInferenceUpdateEvent.Type

// ─── Workspace Lifecycle Events ───────────────────────────────────────────────

/** New — workspace worktree created (before planning.started) */
export const WorkspaceCreatedEvent = Schema.Struct({
  type: Schema.Literal("workspace.created"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspacePath: Schema.String }),
})
export type WorkspaceCreatedEvent = typeof WorkspaceCreatedEvent.Type

/** New — deep-wipe started (transitional state for UI spinner) */
export const WorkspaceWipeStartedEvent = Schema.Struct({
  type: Schema.Literal("workspace.wipe_started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId }),
})
export type WorkspaceWipeStartedEvent = typeof WorkspaceWipeStartedEvent.Type

/** New — deep-wipe completed, workspace fully destroyed */
export const WorkspaceDestroyedEvent = Schema.Struct({
  type: Schema.Literal("workspace.destroyed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId }),
})
export type WorkspaceDestroyedEvent = typeof WorkspaceDestroyedEvent.Type

/** New — cleanup-workspace completed, workspace directory removed */
export const WorkspaceDeletedEvent = Schema.Struct({
  type: Schema.Literal("workspace.deleted"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId }),
})
export type WorkspaceDeletedEvent = typeof WorkspaceDeletedEvent.Type

/** New — planning aborted, workspace returned to idle state */
export const WorkspaceAbortedEvent = Schema.Struct({
  type: Schema.Literal("workspace.aborted"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, sessionName: Schema.optional(Schema.String) }),
})
export type WorkspaceAbortedEvent = typeof WorkspaceAbortedEvent.Type

// ─── Memory Events ────────────────────────────────────────────────────────────

export const MemoryObservationCreatedEvent = Schema.Struct({
  type: Schema.Literal("memory.observation_created"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ observation: MemoryObservation }),
})
export type MemoryObservationCreatedEvent = typeof MemoryObservationCreatedEvent.Type

export const MemoryStatusUpdatedEvent = Schema.Struct({
  type: Schema.Literal("memory.status_updated"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    identity: Schema.Struct({ projectId: Schema.String, workspaceId: Schema.String, issueId: IssueId }),
    status: MemoryStatus,
    previousStatus: Schema.optional(MemoryStatus),
  }),
})
export type MemoryStatusUpdatedEvent = typeof MemoryStatusUpdatedEvent.Type

export const MemoryRollupTriggeredEvent = Schema.Struct({
  type: Schema.Literal("memory.rollup_triggered"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    projectId: Schema.String,
    workspaceId: Schema.String,
    issueId: IssueId,
    pendingTurns: Schema.Array(PendingTurn),
    threshold: Schema.Number,
  }),
})
export type MemoryRollupTriggeredEvent = typeof MemoryRollupTriggeredEvent.Type

export const MemoryResetMarkerCreatedEvent = Schema.Struct({
  type: Schema.Literal("memory.reset_marker_created"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ marker: ResetMarker }),
})
export type MemoryResetMarkerCreatedEvent = typeof MemoryResetMarkerCreatedEvent.Type

export const MemoryHealthChangedEvent = Schema.Struct({
  type: Schema.Literal("memory.health_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    projectId: Schema.String,
    issueId: IssueId,
    status: Schema.Literals(["healthy", "degraded", "failing"]),
    reason: Schema.NullOr(Schema.String),
    ragDecision: Schema.optional(RagDecision),
  }),
})
export type MemoryHealthChangedEvent = typeof MemoryHealthChangedEvent.Type

// ─── Cost Events ──────────────────────────────────────────────────────────────

/** New — cost event recorded in the store */
export const CostEventRecordedEvent = Schema.Struct({
  type: Schema.Literal("cost.event_recorded"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    issueId: IssueId,
    cost: Schema.Number,
    inputTokens: Schema.Number,
    outputTokens: Schema.Number,
  }),
})
export type CostEventRecordedEvent = typeof CostEventRecordedEvent.Type

// ─── Conversation Events ──────────────────────────────────────────────────────

/** Emitted (in-memory only, not persisted) when a Panopticon-native compaction starts or completes. */
export const ConversationCompactingChangedEvent = Schema.Struct({
  type: Schema.Literal("conversation.compacting_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    conversationName: Schema.String,
    compacting: Schema.Boolean,
  }),
})
export type ConversationCompactingChangedEvent = typeof ConversationCompactingChangedEvent.Type

/** Emitted (in-memory only) when a new conversation row is created, so the
 * sidebar list can refresh immediately instead of waiting for its poll tick. */
export const ConversationCreatedEvent = Schema.Struct({
  type: Schema.Literal("conversation.created"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    conversationName: Schema.String,
  }),
})
export type ConversationCreatedEvent = typeof ConversationCreatedEvent.Type

/** Emitted (in-memory only) when a PermissionRequest hook fires or resolves for a conversation. */
export const ConversationPermissionChangedEvent = Schema.Struct({
  type: Schema.Literal("conversation.permission_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    conversationName: Schema.String,
    waiting: Schema.Boolean,
    toolName: Schema.optional(Schema.String),
  }),
})
export type ConversationPermissionChangedEvent = typeof ConversationPermissionChangedEvent.Type

// ─── Conversation Discovery Events (PAN-457) ──────────────────────────────────

/** Scan started */
export const ScanStartedEvent = Schema.Struct({
  type: Schema.Literal("scan.started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    mode: Schema.Literals(['targeted', 'watched', 'system']),
    dirs: Schema.Array(Schema.String),
  }),
})
export type ScanStartedEvent = typeof ScanStartedEvent.Type

/** Scan progress tick */
export const ScanProgressEvent = Schema.Struct({
  type: Schema.Literal("scan.progress"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    dirsProcessed: Schema.Number,
    dirsTotal: Schema.Number,
    sessionsFound: Schema.Number,
    elapsedMs: Schema.Number,
  }),
})
export type ScanProgressEvent = typeof ScanProgressEvent.Type

/** Scan completed */
export const ScanCompleteEvent = Schema.Struct({
  type: Schema.Literal("scan.complete"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    inserted: Schema.Number,
    updated: Schema.Number,
    skipped: Schema.Number,
    errors: Schema.Number,
    durationMs: Schema.Number,
  }),
})
export type ScanCompleteEvent = typeof ScanCompleteEvent.Type

/** Per-session enrichment progress */
export const EnrichProgressEvent = Schema.Struct({
  type: Schema.Literal("enrich.progress"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    sessionId: Schema.Number,
    level: Schema.Number,
    model: Schema.String,
    cost: Schema.Number,
    success: Schema.Boolean,
    error: Schema.optional(Schema.String),
  }),
})
export type EnrichProgressEvent = typeof EnrichProgressEvent.Type

/** Enrichment batch completed */
export const EnrichCompleteEvent = Schema.Struct({
  type: Schema.Literal("enrich.complete"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    processed: Schema.Number,
    totalCost: Schema.Number,
    failures: Schema.Number,
    durationMs: Schema.Number,
  }),
})
export type EnrichCompleteEvent = typeof EnrichCompleteEvent.Type

/** Per-session embedding progress */
export const EmbedProgressEvent = Schema.Struct({
  type: Schema.Literal("embed.progress"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    sessionId: Schema.Number,
    model: Schema.String,
    success: Schema.Boolean,
    error: Schema.optional(Schema.String),
  }),
})
export type EmbedProgressEvent = typeof EmbedProgressEvent.Type

// ─── Union ────────────────────────────────────────────────────────────────────

/** All domain events — the shape streamed via subscribeDomainEvents RPC */
export const DomainEvent = Schema.Union([
  AgentCreatedEvent,
  AgentEnrichmentChangedEvent,
  AgentStartedEvent,
  AgentStoppedEvent,
  AgentHeartbeatDeadEvent,
  WorkCompletedEvent,
  AgentCompletedEvent,
  ReviewApprovedEvent,
  TestPassedEvent,
  AgentStatusChangedEvent,
  AgentOutputReceivedEvent,
  // PAN-800 runtime events
  AgentActivityChangedEvent,
  AgentThinkingStartedEvent,
  AgentThinkingStoppedEvent,
  AgentWaitingStartedEvent,
  AgentWaitingClearedEvent,
  AgentPermissionRequestedEvent,
  AgentPermissionResolvedEvent,
  AgentMessageReceivedEvent,
  AgentChannelReplyEvent,
  AgentModelSetEvent,
  AgentCurrentIssueSetEvent,
  AgentResolutionChangedEvent,
  AgentStateRestoredEvent,
  AgentTurnDiffCompletedEvent,
  PlanningStartedEvent,
  PlanningFailedEvent,
  PlanningSyncEvent,
  PlanItemStatusChangedEvent,
  PlanSubitemStatusChangedEvent,
  PlanItemsUnblockedEvent,
  PipelineStatusChangedEvent,
  MergeReadyEvent,
  ReviewStatusChangedEvent,
  PipelineReviewStartedEvent,
  PipelineReviewCompletedEvent,
  PipelineTestStartedEvent,
  PipelineTestCompletedEvent,
  ReviewReviewerStartedEvent,
  ReviewReviewerCompletedEvent,
  ReviewSpecialistTimedOutEvent,
  ReviewCoordinatorStartedEvent,
  ReviewCoordinatorDiedEvent,
  SpecialistStartedEvent,
  SpecialistCompletedEvent,
  SpecialistFailedEvent,
  ResourcesUpdatedEvent,
  SystemHealthSeverityChangedEvent,
  IssuesSnapshotEvent,
  IssuesUpdatedEvent,
  IssueStatusChangedEvent,
  ActivityUpdatedEvent,
  ActivityEntryEvent,
  ActivityDetailedEvent,
  ActivityTtsEvent,
  ShadowInferenceUpdateEvent,
  MemoryObservationCreatedEvent,
  MemoryStatusUpdatedEvent,
  MemoryRollupTriggeredEvent,
  MemoryResetMarkerCreatedEvent,
  MemoryHealthChangedEvent,
  CostEventRecordedEvent,
  WorkspaceCreatedEvent,
  WorkspaceWipeStartedEvent,
  WorkspaceDestroyedEvent,
  WorkspaceDeletedEvent,
  WorkspaceAbortedEvent,
  DashboardLifecycleStartedEvent,
  DashboardLifecycleCompletedEvent,
  DashboardLifecycleFailedEvent,
  ConversationCompactingChangedEvent,
  ConversationCreatedEvent,
  ConversationPermissionChangedEvent,
  ScanStartedEvent,
  ScanProgressEvent,
  ScanCompleteEvent,
  EnrichProgressEvent,
  EnrichCompleteEvent,
  EmbedProgressEvent,
])
export type DomainEvent = typeof DomainEvent.Type
