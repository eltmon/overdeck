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
  ProjectCiSuite,
  ResourceStats,
  RestartGateSnapshot,
  ReviewStatusSnapshot,
  Role,
  SequenceNumber,
  WaitingReason,
} from "./types"
import {
  MemoryObservation,
  MemoryStatus,
  RagDecision,
  ResetMarker,
} from "./memory"
import { HealthState } from "./system-health"

// ─── System Events ────────────────────────────────────────────────────────────

/** App-level liveness frame for the /ws/rpc domain-events stream. */
export const SystemHeartbeatEvent = Schema.Struct({
  type: Schema.Literal("system.heartbeat"),
  timestamp: Schema.String,
  payload: Schema.Struct({ ts: Schema.Number }),
})
export type SystemHeartbeatEvent = typeof SystemHeartbeatEvent.Type

/** The canonical local Dolt head advanced after a background remote pull. */
export const BeadsFreshnessChangedEvent = Schema.Struct({
  type: Schema.Literal("beads.freshness_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    projectKey: Schema.String,
    localHead: Schema.String,
    lastSyncedAt: Schema.String,
  }),
})
export type BeadsFreshnessChangedEvent = typeof BeadsFreshnessChangedEvent.Type

/**
 * One GitHub Actions check suite observed on a project's default branch
 * (PAN-3537).
 *
 * Emitted by the `check_suite` webhook handler for live updates, only after an
 * independent branch-head lookup verifies the payload SHA is still current.
 * `suiteId` is the check suite id — for GitHub Actions that is one suite per
 * workflow run. The webhook payload does not carry `htmlUrl`.
 *
 * Boot and periodic repair use `project.ci_head_observed`, which replaces the
 * complete projection after pagination. Both events feed
 * `ReadModelState.ciByProjectKey`, a disposable cache rebuilt from REST on every
 * boot — there is no durable CI store.
 */
export const ProjectCiSuiteObservedEvent = Schema.Struct({
  type: Schema.Literal("project.ci_suite_observed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    projectKey: Schema.String,
    repo: Schema.String,
    branch: Schema.String,
    headSha: Schema.String,
    suiteId: Schema.String,
    status: Schema.String,
    conclusion: Schema.NullOr(Schema.String),
    htmlUrl: Schema.optional(Schema.String),
    observedAt: Schema.String,
    /** True only after the emitter verified headSha against the branch head. */
    authoritativeHead: Schema.optional(Schema.Boolean),
  }),
})
export type ProjectCiSuiteObservedEvent = typeof ProjectCiSuiteObservedEvent.Type

/**
 * Complete GitHub Actions projection for the verified default-branch head.
 * The REST seed/repair emits one event after paginating every run and verifying
 * the branch head a second time. An empty suites record explicitly clears stale
 * CI when the current commit has no Actions runs.
 */
export const ProjectCiHeadObservedEvent = Schema.Struct({
  type: Schema.Literal("project.ci_head_observed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    projectKey: Schema.String,
    repo: Schema.String,
    branch: Schema.String,
    headSha: Schema.String,
    suites: Schema.Record(Schema.String, ProjectCiSuite),
    observedAt: Schema.String,
  }),
})
export type ProjectCiHeadObservedEvent = typeof ProjectCiHeadObservedEvent.Type

/**
 * The restart gate changed (PAN-3729).
 *
 * The payload is the COMPLETE gate projection, not a delta, so the reducer is a
 * plain replace and no ordering logic is needed. Emitted by the gate writer
 * (`src/dashboard/server/services/restart-gate.ts`) on every mutation and on
 * every sweep tick that drops an expired request, so the approval banner clears
 * itself when a requester dies without polling again.
 *
 * The gate is runtime-plane state (like `~/.overdeck/dashboard-restarting.json`),
 * so this event is emitted in-memory only — it is never persisted to the event
 * log and never replayed at boot.
 */
export const RestartGateChangedEvent = Schema.Struct({
  type: Schema.Literal("restart_gate.changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: RestartGateSnapshot,
})
export type RestartGateChangedEvent = typeof RestartGateChangedEvent.Type

// ─── Agent Events ─────────────────────────────────────────────────────────────

/** Replaces socket.io `agents:changed` (event: 'started') */
export const AgentStartedEvent = Schema.Struct({
  type: Schema.Literal("agent.started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ agentId: AgentId, issueId: IssueId, workspaceId: Schema.optional(Schema.String), agent: AgentSnapshot }),
})
export type AgentStartedEvent = typeof AgentStartedEvent.Type

/** Replaces socket.io `agents:changed` (event: 'stopped') */
export const AgentStoppedEvent = Schema.Struct({
  type: Schema.Literal("agent.stopped"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ agentId: AgentId, issueId: IssueId, workspaceId: Schema.optional(Schema.String), sessionId: Schema.optional(Schema.String) }),
})
export type AgentStoppedEvent = typeof AgentStoppedEvent.Type

export const AgentHeartbeatDeadEvent = Schema.Struct({
  type: Schema.Literal("agent.heartbeat_dead"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ agentId: AgentId, issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String), sessionId: Schema.optional(Schema.String) }),
})
export type AgentHeartbeatDeadEvent = typeof AgentHeartbeatDeadEvent.Type

/** Role lifecycle — work agent completed implementation and is ready for review. */
export const WorkCompletedEvent = Schema.Struct({
  type: Schema.Literal("work.completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), agentId: Schema.optional(AgentId) }),
})
export type WorkCompletedEvent = typeof WorkCompletedEvent.Type

/** Role lifecycle — generic agent completion signal, normalized by Cloister by role. */
export const AgentCompletedEvent = Schema.Struct({
  type: Schema.Literal("agent.completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), agentId: Schema.optional(AgentId), role: Schema.optional(Role) }),
})
export type AgentCompletedEvent = typeof AgentCompletedEvent.Type

/** Role lifecycle — review approved the branch and testing should start. */
export const ReviewApprovedEvent = Schema.Struct({
  type: Schema.Literal("review.approved"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String) }),
})
export type ReviewApprovedEvent = typeof ReviewApprovedEvent.Type

/** Role lifecycle — tests passed and shipping should prepare the branch. */
export const TestPassedEvent = Schema.Struct({
  type: Schema.Literal("test.passed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String) }),
})
export type TestPassedEvent = typeof TestPassedEvent.Type

/** Replaces socket.io `godview:status-change` */
export const AgentStatusChangedEvent = Schema.Struct({
  type: Schema.Literal("agent.status_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String),
    status: AgentStatus,
    previousStatus: Schema.optional(AgentStatus),
    hasLiveTmuxSession: Schema.optional(Schema.Boolean),
    stoppedByUser: Schema.optional(Schema.Boolean),
    stoppedByPause: Schema.optional(Schema.Boolean),
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
    kickoffDelivered: Schema.optional(Schema.Boolean),
    hostOverride: Schema.optional(Schema.Boolean),
    role: Schema.optional(Role),
    model: Schema.optional(Schema.String),
    workspace: Schema.optional(Schema.String),
    sessionId: Schema.optional(Schema.String),
    lastActivity: Schema.optional(Schema.String),
    lastResumeAt: Schema.optional(Schema.String),
    stoppedAt: Schema.optional(Schema.String),
    branch: Schema.optional(Schema.String),
    costSoFar: Schema.optional(Schema.Number),
    phase: Schema.optional(Schema.String),
    workType: Schema.optional(Schema.String),
    roleRunHead: Schema.optional(Schema.String),
    flywheelRunId: Schema.optional(Schema.String),
    reviewSubRole: Schema.optional(Schema.String),
    reviewRunId: Schema.optional(Schema.String),
    reviewOutputPath: Schema.optional(Schema.String),
    reviewSynthesisAgentId: Schema.optional(Schema.String),
    reviewDeadlineAt: Schema.optional(Schema.String),
    reviewMonitorSignaled: Schema.optional(Schema.String),
    reviewRetryAttempt: Schema.optional(Schema.Number),
    inspectSubRole: Schema.optional(Schema.String),
    deliveryMethod: Schema.optional(Schema.String),
    supervisorEnabled: Schema.optional(Schema.Boolean),
    channelsEnabled: Schema.optional(Schema.Boolean),
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
    issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String),
    role: Schema.optional(Role),
    // Optional because this event type predates these fields (PAN-440). The event
    // store is append-only, so older persisted events lack them — a required schema
    // makes those events fail replay decode ("Missing key").
    hasPendingQuestion: Schema.optional(Schema.Boolean),
    pendingQuestionCount: Schema.optional(Schema.Number),
    pendingQuestionPrompt: Schema.optional(Schema.String),
    pendingQuestionReason: Schema.optional(Schema.String),
    // PAN-1520 — unified pending-input surfaces
    pendingInputCount: Schema.optional(Schema.Number),
    pendingInputKinds: Schema.optional(Schema.Array(Schema.String)),
    pendingAskUserQuestion: Schema.optional(Schema.Struct({
      toolUseId: Schema.String,
      askedAt: Schema.String,
      questions: Schema.Array(Schema.Struct({
        question: Schema.String,
        header: Schema.optional(Schema.String),
        multiSelect: Schema.optional(Schema.Boolean),
        options: Schema.Array(Schema.Struct({
          label: Schema.String,
          description: Schema.optional(Schema.String),
        })),
      })),
    })),
    // PAN-1520 (FR-1) — pending ExitPlanMode plan payload for the approval modal.
    pendingProposedPlan: Schema.optional(Schema.Struct({
      toolUseId: Schema.String,
      askedAt: Schema.String,
      plan: Schema.String,
    })),
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
  payload: Schema.Struct({ agentId: AgentId, issueId: IssueId, workspaceId: Schema.optional(Schema.String), agent: AgentSnapshot }),
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
    hookName: Schema.optional(Schema.String),
  }),
})
export type AgentActivityChangedEvent = typeof AgentActivityChangedEvent.Type

/** A registered harness hook fired without implying an agent activity transition. */
export const AgentHookFiredEvent = Schema.Struct({
  type: Schema.Literal("agent.hook_fired"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    hookName: Schema.String,
    tool: Schema.optional(Schema.String),
  }),
})
export type AgentHookFiredEvent = typeof AgentHookFiredEvent.Type

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
    issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String),
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
    claudeSessionId: Schema.optional(Schema.NullOr(Schema.String)),
    sessionModel: Schema.optional(Schema.String),
    sessionHarness: Schema.optional(Schema.String),
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

export const AgentContextSaturationChangedEvent = Schema.Struct({
  type: Schema.Literal("agent.context_saturation_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: AgentId,
    contextSaturatedAt: Schema.optional(Schema.String),
  }),
})
export type AgentContextSaturationChangedEvent = typeof AgentContextSaturationChangedEvent.Type

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
 * snapshot during bootstrap (reconstruction from sources, PAN-1920). Not
 * emitted by hooks.
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
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), sessionName: Schema.String, harness: Schema.optional(Schema.String) }),
})
export type PlanningStartedEvent = typeof PlanningStartedEvent.Type

/** Replaces socket.io `planning:failed` */
export const PlanningFailedEvent = Schema.Struct({
  type: Schema.Literal("planning.failed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), error: Schema.String }),
})
export type PlanningFailedEvent = typeof PlanningFailedEvent.Type

/** Replaces socket.io `planning:sync` */
export const PlanningSyncEvent = Schema.Struct({
  type: Schema.Literal("planning.sync"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
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
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), itemId: Schema.String, status: Schema.String }),
})
export type PlanItemStatusChangedEvent = typeof PlanItemStatusChangedEvent.Type

/** Replaces socket.io `plan:subitem-status-changed` */
export const PlanSubitemStatusChangedEvent = Schema.Struct({
  type: Schema.Literal("plan.subitem_status_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
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
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), items: Schema.Array(Schema.String) }),
})
export type PlanItemsUnblockedEvent = typeof PlanItemsUnblockedEvent.Type

// ─── Pipeline / Merge Events ──────────────────────────────────────────────────

/** Replaces socket.io `pipeline:status` */
export const PipelineStatusChangedEvent = Schema.Struct({
  type: Schema.Literal("pipeline.status_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), status: ReviewStatusSnapshot }),
})
export type PipelineStatusChangedEvent = typeof PipelineStatusChangedEvent.Type

/** Replaces socket.io `merge:ready` */
export const MergeReadyEvent = Schema.Struct({
  type: Schema.Literal("merge.ready"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String) }),
})
export type MergeReadyEvent = typeof MergeReadyEvent.Type

/** New — review status changed */
export const ReviewStatusChangedEvent = Schema.Struct({
  type: Schema.Literal("review.status_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), status: ReviewStatusSnapshot }),
})
export type ReviewStatusChangedEvent = typeof ReviewStatusChangedEvent.Type

/** New — review specialist dispatched */
export const PipelineReviewStartedEvent = Schema.Struct({
  type: Schema.Literal("pipeline.review-started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String) }),
})
export type PipelineReviewStartedEvent = typeof PipelineReviewStartedEvent.Type

/** New — review specialist finished (passed or failed) */
export const PipelineReviewCompletedEvent = Schema.Struct({
  type: Schema.Literal("pipeline.review-completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), passed: Schema.Boolean }),
})
export type PipelineReviewCompletedEvent = typeof PipelineReviewCompletedEvent.Type

/** New — test specialist dispatched */
export const PipelineTestStartedEvent = Schema.Struct({
  type: Schema.Literal("pipeline.test-started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String) }),
})
export type PipelineTestStartedEvent = typeof PipelineTestStartedEvent.Type

/** New — test specialist finished (passed or failed) */
export const PipelineTestCompletedEvent = Schema.Struct({
  type: Schema.Literal("pipeline.test-completed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), passed: Schema.Boolean }),
})
export type PipelineTestCompletedEvent = typeof PipelineTestCompletedEvent.Type

/** New — verification gate dispatched (review-pipeline verify step) */
export const PipelineVerificationStartedEvent = Schema.Struct({
  type: Schema.Literal("pipeline.verification-started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String) }),
})
export type PipelineVerificationStartedEvent = typeof PipelineVerificationStartedEvent.Type

/** New — verification gate failed (carries failedCheck for gate failures, message for infra errors) */
export const PipelineVerificationFailedEvent = Schema.Struct({
  type: Schema.Literal("pipeline.verification-failed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
    failedCheck: Schema.optional(Schema.String),
    message: Schema.optional(Schema.String),
  }),
})
export type PipelineVerificationFailedEvent = typeof PipelineVerificationFailedEvent.Type

/** New — issue lifecycle transition (single source: IssueLifecycle.transitionTo).
 * `state` stays an open string so new server-side lifecycle states can never
 * poison the domain-event stream (the failure mode behind this event's addition). */
export const IssueTransitionedEvent = Schema.Struct({
  type: Schema.Literal("issue.transitioned"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), state: Schema.String }),
})
export type IssueTransitionedEvent = typeof IssueTransitionedEvent.Type

export const OperatorInterventionEvent = Schema.Struct({
  type: Schema.Literal("operator.intervention"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
    kind: Schema.Literals(["tell", "pause", "restart", "manual_edit", "deep_wipe", "unpause", "untroubled"]),
    source: Schema.String,
  }),
})
export type OperatorInterventionEvent = typeof OperatorInterventionEvent.Type

export const LinearMcpAuthRequiredEvent = Schema.Struct({
  type: Schema.Literal("linear_mcp_auth.required"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: Schema.String,
    issueId: Schema.NullOr(Schema.String),
    authUrl: Schema.NullOr(Schema.String),
    expiresAt: Schema.NullOr(Schema.String),
  }),
})
export type LinearMcpAuthRequiredEvent = typeof LinearMcpAuthRequiredEvent.Type

export const LinearMcpAuthHealthyEvent = Schema.Struct({
  type: Schema.Literal("linear_mcp_auth.healthy"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: Schema.String,
    issueId: Schema.NullOr(Schema.String),
    source: Schema.Literals(["hook", "operator"]),
  }),
})
export type LinearMcpAuthHealthyEvent = typeof LinearMcpAuthHealthyEvent.Type

export const LinearMcpAuthNotifiedEvent = Schema.Struct({
  type: Schema.Literal("linear_mcp_auth.notified"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: Schema.String,
    issueId: Schema.NullOr(Schema.String),
    // 'delivering' is the durable pre-delivery claim (PAN-2997 review cycle
    // 3): it makes the wake crash-idempotent — a crash after the claim never
    // replays the delivery at boot recovery. lifecycleId correlates this
    // record to the lifecycle whose wake pass produced it; absent only in
    // events written before PAN-2997 review cycle 2.
    outcome: Schema.Literals(["delivering", "delivered", "queued", "failed"]),
    lifecycleId: Schema.optional(Schema.String),
  }),
})
export type LinearMcpAuthNotifiedEvent = typeof LinearMcpAuthNotifiedEvent.Type

export const LinearMcpAuthCallbackRelayedEvent = Schema.Struct({
  type: Schema.Literal("linear_mcp_auth.callback_relayed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    agentId: Schema.String,
    issueId: Schema.NullOr(Schema.String),
  }),
})
export type LinearMcpAuthCallbackRelayedEvent = typeof LinearMcpAuthCallbackRelayedEvent.Type

export const SubstrateBugFiledEvent = Schema.Struct({
  type: Schema.Literal("substrate.bug_filed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
    runId: Schema.optional(Schema.String),
    filedBy: Schema.Literals(["agent", "operator"]),
    discoveredIn: Schema.optional(IssueId),
    severity: Schema.Literals(["P0", "P1", "P2"]),
  }),
})
export type SubstrateBugFiledEvent = typeof SubstrateBugFiledEvent.Type

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
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
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
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
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
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
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
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
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
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
    sessionName: Schema.String,
    reason: Schema.String,
  }),
})
export type ReviewCoordinatorDiedEvent = typeof ReviewCoordinatorDiedEvent.Type

/** A terminal review verdict was rejected due to stale evidence. */
export const ReviewVerdictRejectedEvent = Schema.Struct({
  type: Schema.Literal("review.verdict_rejected"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId,
    workspaceId: Schema.optional(Schema.String),
    writer: Schema.String,
    verdict: Schema.String,
    evidenceHead: Schema.String,
    rowHead: Schema.String,
    reason: Schema.String,
  }),
})
export type ReviewVerdictRejectedEvent = typeof ReviewVerdictRejectedEvent.Type

/** A terminal review verdict was landed and dispatched with a fresh evidence head. */
export const ReviewVerdictDispatchedEvent = Schema.Struct({
  type: Schema.Literal("review.verdict_dispatched"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId,
    workspaceId: Schema.optional(Schema.String),
    writer: Schema.String,
    verdict: Schema.String,
    evidenceHead: Schema.String,
    rowHead: Schema.String,
    classification: Schema.String,
    testGateReset: Schema.Boolean,
  }),
})
export type ReviewVerdictDispatchedEvent = typeof ReviewVerdictDispatchedEvent.Type

/**
 * A recovery path found a fresh verdict artifact but declined to restore it,
 * because the artifact's head evidence disagrees with the row's anchor. The
 * verdict is NOT lost silently — it is reported here so the operator can see a
 * finished review that recovery refused to write (PAN-3511).
 */
export const ReviewVerdictRestoreBlockedEvent = Schema.Struct({
  type: Schema.Literal("review.verdict_restore_blocked"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId,
    /** Recovery path that attempted the restore (orphan-reset, sweeper, …). */
    caller: Schema.String,
    verdict: Schema.String,
    artifactHead: Schema.String,
    rowHead: Schema.String,
    reason: Schema.String,
  }),
})
export type ReviewVerdictRestoreBlockedEvent = typeof ReviewVerdictRestoreBlockedEvent.Type

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
  payload: Schema.Struct({ name: Role, issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String) }),
})
export type SpecialistCompletedEvent = typeof SpecialistCompletedEvent.Type

/** New — role-backed specialist failed */
export const SpecialistFailedEvent = Schema.Struct({
  type: Schema.Literal("specialist.failed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    name: Role,
    issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String),
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
    version: Schema.optional(Schema.Literal(2)),
    transitionVersion: Schema.optional(Schema.Number),
    previousState: Schema.optional(HealthState),
    state: Schema.optional(HealthState),
    reasonCodes: Schema.optional(Schema.Array(Schema.String)),
    acceptedAt: Schema.optional(Schema.String),
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
  payload: Schema.Struct({ issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String) }),
})
export type IssuesUpdatedEvent = typeof IssuesUpdatedEvent.Type

/** Patch a single issue's status in the read model without a full snapshot refresh. */
export const IssueStatusChangedEvent = Schema.Struct({
  type: Schema.Literal("issue.statusChanged"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
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
    status: Schema.optional(Schema.Literals(["accepted", "running", "completed", "failed"])),
    command: Schema.optional(Schema.String),
    message: Schema.String,
    details: Schema.optional(Schema.String),
    output: Schema.optional(Schema.String),
    issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String),
    /** Dashboard route the feed navigates to on click (e.g. /conv/<name>, /flywheel). */
    link: Schema.optional(Schema.String),
    /** PAN-1862 (FR-12): fire a desktop notification for this entry (operator-facing warnings). */
    desktop: Schema.optional(Schema.Boolean),
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
    issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String),
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
    issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String),
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
    issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String),
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
    issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String),
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
    issueId: Schema.optional(IssueId), workspaceId: Schema.optional(Schema.String),
    error: Schema.String,
  }),
})
export type DashboardLifecycleFailedEvent = typeof DashboardLifecycleFailedEvent.Type

/** Replaces socket.io `shadow:inference-update` */
export const ShadowInferenceUpdateEvent = Schema.Struct({
  type: Schema.Literal("shadow.inference_update"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), content: Schema.String }),
})
export type ShadowInferenceUpdateEvent = typeof ShadowInferenceUpdateEvent.Type

// ─── Workspace Lifecycle Events ───────────────────────────────────────────────

/** New — workspace worktree created (before planning.started) */
export const WorkspaceCreatedEvent = Schema.Struct({
  type: Schema.Literal("workspace.created"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), workspacePath: Schema.String }),
})
export type WorkspaceCreatedEvent = typeof WorkspaceCreatedEvent.Type

/** New — deep-wipe started (transitional state for UI spinner) */
export const WorkspaceWipeStartedEvent = Schema.Struct({
  type: Schema.Literal("workspace.wipe_started"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String) }),
})
export type WorkspaceWipeStartedEvent = typeof WorkspaceWipeStartedEvent.Type

/** New — deep-wipe completed, workspace fully destroyed */
export const WorkspaceDestroyedEvent = Schema.Struct({
  type: Schema.Literal("workspace.destroyed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String) }),
})
export type WorkspaceDestroyedEvent = typeof WorkspaceDestroyedEvent.Type

/** New — cleanup-workspace completed, workspace directory removed */
export const WorkspaceDeletedEvent = Schema.Struct({
  type: Schema.Literal("workspace.deleted"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String) }),
})
export type WorkspaceDeletedEvent = typeof WorkspaceDeletedEvent.Type

/** New — planning aborted, workspace returned to idle state */
export const WorkspaceAbortedEvent = Schema.Struct({
  type: Schema.Literal("workspace.aborted"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({ issueId: IssueId, workspaceId: Schema.optional(Schema.String), sessionName: Schema.optional(Schema.String) }),
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
    pendingCount: Schema.Number,
    turnIds: Schema.Array(Schema.String),
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
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
    status: Schema.Literals(["healthy", "degraded", "failing"]),
    reason: Schema.NullOr(Schema.String),
    // Human-readable cause of the most recent failure (e.g. the provider error
    // message). Distinct from `reason`, which is a coarse machine code like
    // "extraction-failed". Surfaced verbatim in the UI so the operator can see
    // *why* memory extraction is failing without reading server logs.
    detail: Schema.optional(Schema.String),
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
    issueId: IssueId, workspaceId: Schema.optional(Schema.String),
    cost: Schema.Number,
    inputTokens: Schema.Number,
    outputTokens: Schema.Number,
  }),
})
export type CostEventRecordedEvent = typeof CostEventRecordedEvent.Type

// ─── Conversation Events ──────────────────────────────────────────────────────

/** Emitted (in-memory only, not persisted) when a Overdeck-native compaction starts or completes. */
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

/** Emitted (in-memory only, not persisted) when a conversation's project
 * assignment override changes, so the sidebar can re-group it live instead of
 * waiting for its poll tick. */
export const ConversationMovedEvent = Schema.Struct({
  type: Schema.Literal("conversation.moved"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    conversationName: Schema.String,
    projectKey: Schema.String,
  }),
})
export type ConversationMovedEvent = typeof ConversationMovedEvent.Type

/** Emitted (in-memory only) when a conversation title changes, so the sidebar
 * list can refresh immediately instead of waiting for its poll tick. */
export const ConversationTitleChangedEvent = Schema.Struct({
  type: Schema.Literal("conversation.title_changed"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    conversationName: Schema.String,
    title: Schema.String,
    titleSource: Schema.String,
  }),
})
export type ConversationTitleChangedEvent = typeof ConversationTitleChangedEvent.Type

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

// ─── Stall Sweeper Events (PAN-3485) ──────────────────────────────────────────

/** The parked population changed — carries the full new population (compact rows). */
export const SweepScanEvent = Schema.Struct({
  type: Schema.Literal("sweep.scan"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueCount: Schema.Number,
    rowCount: Schema.Number,
    rows: Schema.Array(Schema.Struct({
      issueId: Schema.String,
      orbit: Schema.String,
      parkedAt: Schema.String,
    })),
  }),
})
export type SweepScanEvent = typeof SweepScanEvent.Type

/** A parked row was (re-)surfaced to the operator — gates respected, TTL re-surface, or exhaustion. */
export const SweepEscalatedEvent = Schema.Struct({
  type: Schema.Literal("sweep.escalated"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: Schema.String,
    orbit: Schema.String,
    reason: Schema.String,
  }),
})
export type SweepEscalatedEvent = typeof SweepEscalatedEvent.Type

/** The sweeper recommended a remedy for a parked row (observability-only — never an action, PAN-3551). */
export const SweepRecommendationEvent = Schema.Struct({
  type: Schema.Literal("sweep.recommendation"),
  sequence: SequenceNumber,
  timestamp: Schema.String,
  payload: Schema.Struct({
    issueId: Schema.String,
    orbit: Schema.String,
    recommendation: Schema.String,
    recurring: Schema.optional(Schema.Boolean),
    agentId: Schema.optional(Schema.String),
  }),
})
export type SweepRecommendationEvent = typeof SweepRecommendationEvent.Type

// ─── Union ────────────────────────────────────────────────────────────────────

/** All domain events — the shape streamed via subscribeDomainEvents RPC */
export const DomainEvent = Schema.Union([
  SystemHeartbeatEvent,
  BeadsFreshnessChangedEvent,
  ProjectCiSuiteObservedEvent,
  ProjectCiHeadObservedEvent,
  RestartGateChangedEvent,
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
  AgentHookFiredEvent,
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
  AgentContextSaturationChangedEvent,
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
  PipelineVerificationStartedEvent,
  PipelineVerificationFailedEvent,
  IssueTransitionedEvent,
  OperatorInterventionEvent,
  LinearMcpAuthRequiredEvent,
  LinearMcpAuthHealthyEvent,
  LinearMcpAuthNotifiedEvent,
  LinearMcpAuthCallbackRelayedEvent,
  SubstrateBugFiledEvent,
  ReviewReviewerStartedEvent,
  ReviewReviewerCompletedEvent,
  ReviewSpecialistTimedOutEvent,
  ReviewCoordinatorStartedEvent,
  ReviewCoordinatorDiedEvent,
  ReviewVerdictRejectedEvent,
  ReviewVerdictDispatchedEvent,
  ReviewVerdictRestoreBlockedEvent,
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
  ConversationMovedEvent,
  ConversationTitleChangedEvent,
  ConversationPermissionChangedEvent,
  ScanStartedEvent,
  ScanProgressEvent,
  ScanCompleteEvent,
  EnrichProgressEvent,
  EnrichCompleteEvent,
  EmbedProgressEvent,
  SweepScanEvent,
  SweepEscalatedEvent,
  SweepRecommendationEvent,
])
export type DomainEvent = typeof DomainEvent.Type
