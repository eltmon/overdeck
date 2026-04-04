import { Schema } from "effect"
import {
  AgentId,
  AgentPhase,
  AgentResolution,
  AgentSnapshot,
  AgentStatus,
  IssueId,
  ResourceStats,
  ReviewStatusSnapshot,
  SequenceNumber,
  SpecialistSnapshot,
  SpecialistType,
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

// ─── Activity Events ──────────────────────────────────────────────────────────

/** Replaces socket.io `godview:activity` */
export const ActivityUpdatedEvent = Schema.Struct({
  type: Schema.Literal("activity.updated"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ events: Schema.Array(Schema.Unknown) }),
})
export type ActivityUpdatedEvent = typeof ActivityUpdatedEvent.Type

/** Replaces socket.io `shadow:inference-update` */
export const ShadowInferenceUpdateEvent = Schema.Struct({
  type: Schema.Literal("shadow.inference_update"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, content: Schema.String }),
})
export type ShadowInferenceUpdateEvent = typeof ShadowInferenceUpdateEvent.Type

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
  ActivityUpdatedEvent,
  ShadowInferenceUpdateEvent,
  CostEventRecordedEvent,
])
export type DomainEvent = typeof DomainEvent.Type
