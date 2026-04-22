import { Schema } from "effect"
import {
  Activity,
  AgentId,
  AgentPhase,
  AgentResolution,
  AgentRuntimeSnapshot,
  AgentSnapshot,
  AgentStatus,
  IssueId,
  ResourceStats,
  ReviewStatusSnapshot,
  SequenceNumber,
  SpecialistSnapshot,
  SpecialistType,
  WaitingReason,
} from "./types"

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
  payload: Schema.Struct({ agentId: AgentId, issueId: IssueId }),
})
export type AgentStoppedEvent = typeof AgentStoppedEvent.Type

/** Replaces socket.io `godview:status-change` */
export const AgentStatusChangedEvent = Schema.Struct({
  type: Schema.Literal("agent.status_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    status: AgentStatus,
    previousStatus: Schema.optional(AgentStatus),
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
    agentPhase: Schema.optional(AgentPhase),
    hasPendingQuestion: Schema.Boolean,
    pendingQuestionCount: Schema.Number,
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

// ─── Specialist Events ────────────────────────────────────────────────────────

/** New — specialist became active */
export const SpecialistStartedEvent = Schema.Struct({
  type: Schema.Literal("specialist.started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ specialist: SpecialistSnapshot }),
})
export type SpecialistStartedEvent = typeof SpecialistStartedEvent.Type

/** New — specialist completed work */
export const SpecialistCompletedEvent = Schema.Struct({
  type: Schema.Literal("specialist.completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ name: SpecialistType, issueId: Schema.optional(IssueId) }),
})
export type SpecialistCompletedEvent = typeof SpecialistCompletedEvent.Type

/** New — specialist failed */
export const SpecialistFailedEvent = Schema.Struct({
  type: Schema.Literal("specialist.failed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    name: SpecialistType,
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

// ─── Union ────────────────────────────────────────────────────────────────────

/** All domain events — the shape streamed via subscribeDomainEvents RPC */
export const DomainEvent = Schema.Union([
  AgentCreatedEvent,
  AgentEnrichmentChangedEvent,
  AgentStartedEvent,
  AgentStoppedEvent,
  AgentStatusChangedEvent,
  AgentOutputReceivedEvent,
  // PAN-800 runtime events
  AgentActivityChangedEvent,
  AgentThinkingStartedEvent,
  AgentThinkingStoppedEvent,
  AgentWaitingStartedEvent,
  AgentWaitingClearedEvent,
  AgentMessageReceivedEvent,
  AgentModelSetEvent,
  AgentCurrentIssueSetEvent,
  AgentResolutionChangedEvent,
  AgentStateRestoredEvent,
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
  SpecialistStartedEvent,
  SpecialistCompletedEvent,
  SpecialistFailedEvent,
  ResourcesUpdatedEvent,
  IssuesSnapshotEvent,
  IssuesUpdatedEvent,
  IssueStatusChangedEvent,
  ActivityUpdatedEvent,
  ActivityEntryEvent,
  ActivityDetailedEvent,
  ActivityTtsEvent,
  ShadowInferenceUpdateEvent,
  CostEventRecordedEvent,
  WorkspaceCreatedEvent,
  WorkspaceWipeStartedEvent,
  WorkspaceDestroyedEvent,
  WorkspaceDeletedEvent,
  WorkspaceAbortedEvent,
  DashboardLifecycleStartedEvent,
  DashboardLifecycleCompletedEvent,
  DashboardLifecycleFailedEvent,
])
export type DomainEvent = typeof DomainEvent.Type
