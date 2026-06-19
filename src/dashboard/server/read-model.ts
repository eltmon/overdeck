/**
 * Server-side Read Model — clean data architecture (PAN-433)
 *
 * Holds an in-memory projection of the dashboard state, bootstrapped once from
 * existing lib modules (JSON-cleaned), then maintained incrementally by domain
 * events via the shared applyEvent reducer.
 *
 * getSnapshot() returns the read model directly — no lib calls, no dirty data,
 * no Schema crashes. This is the T3Code pattern.
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { Effect, Layer, Context } from 'effect';
import { getSharedDb } from './event-store.js';
import type { DashboardSnapshot, DomainEvent, TurnDiffSummary } from '@overdeck/contracts';
import { AGENTS_DIR } from '../../lib/paths.js';
import {
  type ReadModelState,
  INITIAL_READ_MODEL_STATE,
  applyEvent as applyEventReducer,
  getMaxTurnDiffSummariesPerAgent,
  isTerminalTurnDiffSummaryStatus,
  trimTurnDiffSummaries,
} from '@overdeck/contracts';
import type { AgentSnapshot, AgentStatus, Role, AgentResolution, ReviewStatusSnapshot, ReviewStatusValue, TestStatusValue, UatStatusValue, MergeStatusValue, VerificationStatusValue, ResourceStats } from '@overdeck/contracts';
import type { ReviewStatus } from '../../lib/review-status.js';
import { logDeaconEventSync } from '../../lib/persistent-logger.js';
import { listOverdeckAgentStatesSync } from '../../lib/overdeck/agent-state-sync.js';
import { computeQueuePositionFromStatusSync } from '../../lib/queue-position.js'
import { AgentsResolver, type Agent as OverdeckAgent } from '../../lib/overdeck/agents.js';

// ─── Exported async helpers (used by bootstrap Effect + tests) ───────────────



// PAN-1510: bootstrap previously only seeded `issuesRaw` from the projection
// cache or replaced it wholesale from `issueService.getIssues()`. Both paths
// missed issues filed during the previous dashboard's poll-write window — the
// projection cache flush is debounced at 2s, so a fresh `cache.set('github',
// 'issues', ...)` in IssueDataService can survive a restart while the
// projection cache entry remains stale. The helpers below mirror PAN-1506's
// `discoverNewAgentIds`/merge pattern for issues.

export function getIssueIdentifierKey(issue: unknown): string | null {
  if (!issue || typeof issue !== 'object') return null;
  const item = issue as { identifier?: unknown; id?: unknown };
  if (typeof item.identifier === 'string' && item.identifier.length > 0) {
    return item.identifier.toLowerCase();
  }
  if (typeof item.id === 'string' && item.id.length > 0) {
    return item.id.toLowerCase();
  }
  return null;
}

export function discoverNewIssues(
  cachedIssues: unknown[],
  currentIssues: unknown[],
): unknown[] {
  const cachedIds = new Set<string>();
  for (const issue of cachedIssues) {
    const id = getIssueIdentifierKey(issue);
    if (id !== null) cachedIds.add(id);
  }
  const newIssues: unknown[] = [];
  for (const issue of currentIssues) {
    const id = getIssueIdentifierKey(issue);
    if (id !== null && !cachedIds.has(id)) newIssues.push(issue);
  }
  return newIssues;
}

export function mergeIssuesByIdentifier(
  cachedIssues: unknown[],
  currentIssues: unknown[],
): unknown[] {
  const merged = new Map<string, unknown>();
  const unidentified: unknown[] = [];
  for (const issue of cachedIssues) {
    const id = getIssueIdentifierKey(issue);
    if (id !== null) merged.set(id, issue);
    else unidentified.push(issue);
  }
  for (const issue of currentIssues) {
    const id = getIssueIdentifierKey(issue);
    if (id !== null) merged.set(id, issue);
  }
  return [...unidentified, ...merged.values()];
}

export function shouldSkipCheckpointReconciliation(agent: Pick<AgentSnapshot, 'status' | 'workspace'>): boolean {
  return !agent.workspace || isTerminalTurnDiffSummaryStatus(agent.status)
}

type IssueReadSourceState = {
  identifier?: unknown;
  id?: unknown;
  status?: unknown;
  state?: unknown;
  canonicalStatus?: unknown;
  rawTrackerState?: unknown;
  completedAt?: unknown;
}

function normalizeIssueId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed ? trimmed.toUpperCase() : null;
}

export function getClosedIssueIdsForReadSource(issues: unknown[]): Set<string> {
  const closed = new Set<string>();
  for (const issue of issues) {
    if (!issue || typeof issue !== 'object') continue;
    const item = issue as IssueReadSourceState;
    const issueId = normalizeIssueId(item.identifier) ?? normalizeIssueId(item.id);
    if (!issueId) continue;
    const state = String(item.state ?? '').toLowerCase();
    const status = String(item.status ?? '').toLowerCase();
    const canonicalStatus = String(item.canonicalStatus ?? '').toLowerCase();
    const rawTrackerState = String(item.rawTrackerState ?? '').toLowerCase();
    if (
      item.completedAt ||
      state === 'closed' ||
      status === 'done' ||
      status === 'closed' ||
      status === 'cancelled' ||
      status === 'canceled' ||
      status === 'completed' ||
      canonicalStatus === 'done' ||
      canonicalStatus === 'closed' ||
      canonicalStatus === 'cancelled' ||
      canonicalStatus === 'canceled' ||
      canonicalStatus === 'completed' ||
      rawTrackerState === 'closed' ||
      rawTrackerState === 'done' ||
      rawTrackerState === 'completed'
    ) {
      closed.add(issueId);
    }
  }
  return closed;
}

export function pruneAgentsForReadSource(
  agentsById: Record<string, AgentSnapshot>,
  issues: unknown[],
): { agentsById: Record<string, AgentSnapshot>; prunedCount: number } {
  const closedIssueIds = getClosedIssueIdsForReadSource(issues);
  // PAN-1908: authoritative membership is the SQLite agents table, not state.json.
  const liveAgentIds = new Set(listOverdeckAgentStatesSync().map(a => a.id));
  const nextAgentsById: Record<string, AgentSnapshot> = {};
  let prunedCount = 0;

  for (const agent of Object.values(agentsById)) {
    if (closedIssueIds.has(agent.issueId.toUpperCase())) {
      prunedCount++;
      continue;
    }
    if (!liveAgentIds.has(agent.id)) {
      prunedCount++;
      continue;
    }
    nextAgentsById[agent.id] = agent;
  }

  return { agentsById: nextAgentsById, prunedCount };
}

// ─── Cached event store reference (avoids async dynamic import on each pushUpdated) ──
let _cachedEventStore: any = null;

type Jsonish = null | boolean | number | string | Jsonish[] | { [key: string]: Jsonish };

function toJsonish(value: unknown, seen = new WeakSet<object>()): Jsonish | undefined {
  if (value == null) return null;
  if (typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (value instanceof Date) return value.toISOString();
  if (Array.isArray(value)) {
    const next: Jsonish[] = [];
    for (const item of value) {
      const clean = toJsonish(item, seen);
      if (clean !== undefined) next.push(clean);
    }
    return next;
  }
  if (typeof value === 'object') {
    if (seen.has(value)) return null;
    seen.add(value);
    const next: { [key: string]: Jsonish } = {};
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      const clean = toJsonish(item, seen);
      if (clean !== undefined) next[key] = clean;
    }
    seen.delete(value);
    return next;
  }
  return undefined;
}

function cleanIssues(issues: unknown[]): unknown[] {
  return issues.map((issue) => toJsonish(issue) ?? null);
}

// ─── Value validators for strict literal types ──────────────────────────────

const VALID_AGENT_STATUSES = new Set<AgentStatus>(["starting", "running", "stopped", "error", "unknown"]);
const VALID_ROLES = new Set<Role>(["plan", "work", "review", "test", "ship", "flywheel", "strike"]);
const VALID_RESOLUTIONS = new Set<AgentResolution>(["working", "done", "needs_input", "stuck", "completed", "unclear", "abandoned", "api_error"]);
type SpecialistAgentName = 'review-agent' | 'test-agent' | 'merge-agent' | 'inspect-agent' | 'uat-agent';
type SpecialistLifecycleState = 'active' | 'sleeping' | 'uninitialized';

const VALID_SPECIALIST_NAMES = new Set<SpecialistAgentName>(["review-agent", "test-agent", "merge-agent", "inspect-agent", "uat-agent"]);
const VALID_SPECIALIST_LIFECYCLE_STATES = new Set<SpecialistLifecycleState>(["active", "sleeping", "uninitialized"]);
const VALID_REVIEW_STATUSES = new Set<ReviewStatusValue>(["pending", "reviewing", "passed", "failed", "blocked"]);
const VALID_TEST_STATUSES = new Set<TestStatusValue>(["pending", "testing", "passed", "failed", "skipped", "dispatch_failed"]);
const VALID_UAT_STATUSES = new Set<UatStatusValue>(["pending", "testing", "passed", "failed"]);
const VALID_MERGE_STATUSES = new Set<MergeStatusValue>(["pending", "queued", "merging", "verifying", "merged", "failed"]);
const VALID_VERIFICATION_STATUSES = new Set<VerificationStatusValue>(["pending", "running", "passed", "failed", "skipped"]);

export function toAgentStatus(v: unknown): AgentStatus {
  return VALID_AGENT_STATUSES.has(v as AgentStatus) ? v as AgentStatus : "unknown";
}

/** Pending-input fields carried by an agent snapshot (PAN-1591). */
type PendingInputFields = Pick<
  AgentSnapshot,
  | 'hasPendingQuestion'
  | 'pendingQuestionCount'
  | 'pendingQuestionPrompt'
  | 'pendingQuestionReason'
  | 'pendingInputCount'
  | 'pendingInputKinds'
  | 'pendingAskUserQuestion'
>;

/**
 * PAN-1591 — a non-running agent cannot be awaiting interactive input. The
 * enrichment poller only emits for live agents, so a `hasPendingQuestion: true`
 * computed while the agent was last alive lingers in the cache forever; the
 * `agent.status_changed` reducer already strips it on a RUNTIME stop, but the
 * bootstrap projection of an agent that was ALREADY stopped at server start
 * never did — surfacing phantom "Waiting on your input" rows that report "no
 * longer waiting" on click. This applies the same rule at projection time:
 * clear every pending-input field unless the agent is running/starting.
 */
export function projectPendingInput(status: AgentStatus, src: PendingInputFields): PendingInputFields {
  if (status !== 'running' && status !== 'starting') {
    return {
      hasPendingQuestion: undefined,
      pendingQuestionCount: undefined,
      pendingQuestionPrompt: undefined,
      pendingQuestionReason: undefined,
      pendingInputCount: undefined,
      pendingInputKinds: undefined,
      pendingAskUserQuestion: undefined,
    };
  }
  return src;
}
export function toRole(v: unknown): Role | undefined {
  return v && VALID_ROLES.has(v as Role) ? v as Role : undefined;
}

export function toAgentResolution(v: unknown): AgentResolution | undefined {
  return v && VALID_RESOLUTIONS.has(v as AgentResolution) ? v as AgentResolution : undefined;
}
export function toSpecialistAgentName(v: unknown): SpecialistAgentName | undefined {
  return VALID_SPECIALIST_NAMES.has(v as SpecialistAgentName) ? v as SpecialistAgentName : undefined;
}
export function toSpecialistLifecycleState(v: unknown): SpecialistLifecycleState {
  return VALID_SPECIALIST_LIFECYCLE_STATES.has(v as SpecialistLifecycleState) ? v as SpecialistLifecycleState : "uninitialized";
}
export function toReviewStatus(v: unknown): ReviewStatusValue | undefined {
  return v && VALID_REVIEW_STATUSES.has(v as ReviewStatusValue) ? v as ReviewStatusValue : undefined;
}
export function toTestStatus(v: unknown): TestStatusValue | undefined {
  return v && VALID_TEST_STATUSES.has(v as TestStatusValue) ? v as TestStatusValue : undefined;
}
export function toUatStatus(v: unknown): UatStatusValue | undefined {
  return v && VALID_UAT_STATUSES.has(v as UatStatusValue) ? v as UatStatusValue : undefined;
}
export function toMergeStatus(v: unknown): MergeStatusValue | undefined {
  return v && VALID_MERGE_STATUSES.has(v as MergeStatusValue) ? v as MergeStatusValue : undefined;
}
export function toVerificationStatus(v: unknown): VerificationStatusValue | undefined {
  return v && VALID_VERIFICATION_STATUSES.has(v as VerificationStatusValue) ? v as VerificationStatusValue : undefined;
}

type ReviewStatusSnapshotInput = ReviewStatus & {
  reviewCoordinatorSessionName?: string;
  reviewSessionNames?: string[];
  reviewSubStatuses?: Record<string, 'running' | 'done'>;
  activeSpecialist?: string;
};

export function toReviewStatusSnapshot(status: ReviewStatusSnapshotInput): ReviewStatusSnapshot {
  return {
    issueId: status.issueId,
    reviewStatus: toReviewStatus(status.reviewStatus),
    testStatus: toTestStatus(status.testStatus),
    uatStatus: toUatStatus(status.uatStatus),
    uatNotes: status.uatNotes || undefined,
    mergeStatus: toMergeStatus(status.mergeStatus),
    verificationStatus: toVerificationStatus(status.verificationStatus),
    verificationNotes: status.verificationNotes || undefined,
    verificationCycleCount: typeof status.verificationCycleCount === 'number' ? status.verificationCycleCount : undefined,
    readyForMerge: !!status.readyForMerge,
    updatedAt: status.updatedAt,
    prUrl: status.prUrl || undefined,
    stuck: !!status.stuck ? true : undefined,
    stuckReason: status.stuckReason || undefined,
    stuckAt: status.stuckAt || undefined,
    stuckDetails: status.stuckDetails || undefined,
    reviewedAtCommit: status.reviewedAtCommit || undefined,
    reviewSpawnedAt: status.reviewSpawnedAt || undefined,
    testRetryCount: typeof status.testRetryCount === 'number' ? status.testRetryCount : undefined,
    reviewRetryCount: typeof status.reviewRetryCount === 'number' ? status.reviewRetryCount : undefined,
    recoveryStartedAt: status.recoveryStartedAt || undefined,
    deaconIgnored: !!status.deaconIgnored ? true : undefined,
    deaconIgnoredAt: status.deaconIgnoredAt || undefined,
    deaconIgnoredReason: status.deaconIgnoredReason || undefined,
    // PAN-1691: tri-state routing key — preserve true/false/undefined as-is.
    autoMerge: status.autoMerge,
    reviewCoordinatorSessionName: status.reviewCoordinatorSessionName || undefined,
    reviewSessionNames: status.reviewSessionNames && status.reviewSessionNames.length > 0 ? status.reviewSessionNames : undefined,
    reviewSubStatuses: status.reviewSubStatuses,
    queuePosition: computeQueuePositionFromStatusSync(status).queuePosition ?? undefined,
    activeSpecialist: status.activeSpecialist || undefined,
    mergeRetryCount: typeof status.mergeRetryCount === 'number' ? status.mergeRetryCount : undefined,
    mergeNotes: status.mergeNotes || undefined,
    blockerReasons: status.blockerReasons && status.blockerReasons.length > 0 ? status.blockerReasons : undefined,
    autoRequeueCount: typeof status.autoRequeueCount === 'number' ? status.autoRequeueCount : undefined,
  };
}

// ─── ReadModelService ────────────────────────────────────────────────────────

export interface ReadModelServiceShape {
  /** Return the current read model state as a DashboardSnapshot. */
  readonly getSnapshot: Effect.Effect<DashboardSnapshot>;
  /** Return a single pending channel permission request without rebuilding a full snapshot. */
  readonly getChannelPermissionRequest: (
    requestId: string,
  ) => Effect.Effect<import('@overdeck/contracts').ChannelPermissionRequestSnapshot | null>;
  /** Return a recent resolved channel permission decision for safe delivery retries. */
  readonly getResolvedChannelPermissionDecision: (
    requestId: string,
  ) => Effect.Effect<import('@overdeck/contracts').ResolvedChannelPermissionDecision | null>;
  /** Return in-memory turn diff summaries for a single agent. */
  readonly getTurnDiffSummaries: (agentId: string) => Effect.Effect<TurnDiffSummary[]>;
  /** Return the agentId for a given sessionId (from agent snapshot or runtime claudeSessionId). */
  readonly getAgentIdBySessionId: (sessionId: string) => Effect.Effect<string | null>;
  /** Apply a domain event to the read model (called by event store on append). */
  readonly applyEvent: (event: DomainEvent) => void;
  /** Bootstrap the read model from existing lib module state. */
  readonly bootstrap: Effect.Effect<void>;
}

// ─── Overdeck → legacy AgentSnapshot adapter ─────────────────────────────────
//
// Maps overdeck's 18-field Agent (durable config only) to the legacy
// AgentSnapshot wire format. Runtime/ephemeral fields (lastActivity, branch,
// costSoFar, phase, hasPendingQuestion, etc.) start undefined and are filled
// by in-memory events from the enrichment poller and domain event stream.

function overdeckStatusToLegacy(
  status: OverdeckAgent['status'],
): AgentStatus {
  if (status === 'crashed') return 'error';
  // 'idle' = agent is alive but waiting (tool-call paused, AUQ, etc.)
  if (status === 'idle') return 'running';
  return status; // 'starting' | 'running' | 'stopped' are 1:1
}

function agentSnapshotFromOverdeck(agent: OverdeckAgent): AgentSnapshot {
  return {
    id: agent.id,
    issueId: agent.issueId,
    workspace: agent.workspace || undefined,
    runtime: agent.harness,
    model: agent.model,
    status: overdeckStatusToLegacy(agent.status),
    startedAt: agent.startedAt?.toISOString(),
    sessionId: agent.sessionId ?? undefined,
    role: agent.role,
    stoppedByUser: agent.stoppedByUser ?? undefined,
    paused: agent.paused ?? undefined,
    pausedReason: agent.pausedReason ?? undefined,
    troubled: agent.troubled ?? undefined,
    consecutiveFailures: agent.consecutiveFailures,
    firstFailureInRunAt: agent.firstFailureInRunAt?.toISOString(),
    lastFailureNextRetryAt: agent.lastFailureNextRetryAt?.toISOString(),
  };
}

export class ReadModelService extends Context.Service<
  ReadModelService,
  ReadModelServiceShape
>()('overdeck/dashboard/ReadModelService') {}

// ─── Live implementation ─────────────────────────────────────────────────────

export const ReadModelServiceLive = Layer.effect(
  ReadModelService,
  Effect.gen(function* () {
    let state: ReadModelState = { ...INITIAL_READ_MODEL_STATE };

    function cloneTurnDiffSummaries(summaries: TurnDiffSummary[] | undefined): TurnDiffSummary[] {
      if (!summaries || summaries.length === 0) return [];
      return summaries.map(summary => ({
        ...summary,
        files: summary.files.map(file => ({ ...file })),
        assistantMessageId: summary.assistantMessageId ?? undefined,
        checkpointRef: summary.checkpointRef ?? undefined,
      }));
    }

    function buildSnapshot(): DashboardSnapshot {
      // turnDiffSummariesByAgentId is intentionally excluded from the snapshot.
      //
      // Per-agent checkpoint history can grow to thousands of turns × hundreds
      // of files; in production we measured 484 MB across 44 agents, which the
      // browser's WebSocket client rejects as "Max payload size exceeded" and
      // closes the socket with code 1006 — leaving the kanban and command deck
      // perpetually empty. The data is still maintained in `state` and served
      // on-demand via GET /api/agents/:id/diffs, so chat-timeline components
      // fetch it only for the agent the user is actually viewing.
      return {
        sequence: state.sequence,
        agents: Object.values(state.agentsById),
        // PAN-1048 — specialistsByName projection retired. The DashboardSnapshot
        // schema still has a `specialists` field for backward compat with the
        // wire format; we always send an empty array and clients derive the
        // same data from agentsById filtered by role.
        specialists: [],
        reviewStatuses: Object.values(state.reviewStatusByIssueId),
        agentRuntimeById: state.agentRuntimeById,
        channelPermissionRequests: Object.values(state.channelPermissionRequestsById ?? {}),
        issues: state.issuesRaw,
        resources: state.resources ?? undefined,
        memory: {
          observationsByIssueId: state.observationsByIssueId,
          statusByIssueId: state.statusByIssueId,
          rollupsByIssueId: state.rollupsByIssueId,
          resetMarkersByScopeId: state.resetMarkersByScopeId,
          healthByIssueId: state.healthByIssueId,
        },
        scanProgress: state.scanProgress,
        enrichStats: state.enrichStats,
        enrichProgressBySessionId: state.enrichProgressBySessionId,
        embedProgressBySessionId: state.embedProgressBySessionId,
        timestamp: new Date().toISOString(),
      };
    }

    const applyEvent = (event: DomainEvent): void => {
      state = applyEventReducer(state, event);
    };

    const getSnapshot: Effect.Effect<DashboardSnapshot> = Effect.gen(function* () {
      // Refresh issues from the shared issue service before building snapshot.
      // IssueDataService polls trackers in the background; its cached issues are
      // the freshest available without blocking on API calls.
      //
      // PAN-1510: merge issueService's view with the current state.issuesRaw
      // so a hard browser reload always reflects the union of (projection
      // cache + freshest issueService data). issueService entries win on
      // identifier conflicts (fresher status, labels, etc.), and cached
      // entries that issueService is missing (transient empty fetch,
      // partial poll, single-tracker failure) are preserved instead of
      // dropped. Identifier-based merge is the same shape PAN-1506 used to
      // surface newly-spawned agents through the bootstrap fast-path.
      try {
        const { getSharedIssueService } = yield* Effect.promise(
          () => import('./services/issue-service-singleton.js'),
        );
        const issueService = getSharedIssueService();
        const currentIssues = cleanIssues(issueService.getIssues());
        if (currentIssues.length > 0 || state.issuesRaw.length === 0) {
          state = {
            ...state,
            issuesRaw: mergeIssuesByIdentifier(state.issuesRaw, currentIssues),
          };
        }
      } catch (err) {
        console.error('[ReadModel] Failed to refresh issues for snapshot:', err);
      }

      const pruned = pruneAgentsForReadSource(state.agentsById, state.issuesRaw);
      if (pruned.prunedCount > 0) {
        state = { ...state, agentsById: pruned.agentsById };
        console.log(`[ReadModel] Pruned ${pruned.prunedCount} stale agent${pruned.prunedCount === 1 ? '' : 's'} from read source`);
      }

      return buildSnapshot();
    });

    const getChannelPermissionRequest = (
      requestId: string,
    ): Effect.Effect<import('@overdeck/contracts').ChannelPermissionRequestSnapshot | null> =>
      Effect.succeed(state.channelPermissionRequestsById?.[requestId] ?? null);

    const getResolvedChannelPermissionDecision = (
      requestId: string,
    ): Effect.Effect<import('@overdeck/contracts').ResolvedChannelPermissionDecision | null> =>
      Effect.succeed(state.resolvedChannelPermissionDecisionsById?.[requestId] ?? null);

    const getTurnDiffSummaries = (agentId: string): Effect.Effect<TurnDiffSummary[]> =>
      Effect.sync(() => cloneTurnDiffSummaries(state.turnDiffSummariesByAgentId[agentId]));

    const getAgentIdBySessionId = (sessionId: string): Effect.Effect<string | null> =>
      Effect.sync(() => state.agentIdBySessionId[sessionId] ?? null);

    // ── Bootstrap inline during layer construction ───────────────────────────
    const agentsResolver = yield* AgentsResolver;
    yield* Effect.gen(function* () {
      // PAN-1938 source-swap: agents now come from overdeck.db via AgentsResolver.
      // reconstructCache still runs for reviewStatusByIssueId (which reads
      // git-backed per-issue records, NOT panopticon.db SQLite cache tables)
      // and for its side effects (agent-backfill sync, checkpoint cleanup).
      const { reconstructCacheAuto } = yield* Effect.promise(() =>
        import('../../lib/reconstruct/reconstruct-cache.js'),
      );

      const [overdeckAgents, result] = yield* Effect.all([
        agentsResolver.list({}),
        Effect.promise(() => reconstructCacheAuto()),
      ]);

      const agentsById: Record<string, AgentSnapshot> = Object.fromEntries(
        overdeckAgents.map((a) => [a.id, agentSnapshotFromOverdeck(a)]),
      );

      // ── Sequence from event store (labels the snapshot, not a replay source) ─
      let sequence = 0;
      try {
        const { getEventStore } = yield* Effect.promise(
          () => import('./event-store.js'),
        );
        sequence = getEventStore().getLatestSequence();
      } catch {
        // Event store may not be initialized yet
      }

      state = {
        ...INITIAL_READ_MODEL_STATE,
        sequence,
        agentsById,
        reviewStatusByIssueId: result.reviewStatusByIssueId,
        issuesRaw: [],
      };

      console.log(
        `[ReadModel] Bootstrapped from the Overdeck database: ` +
        `${Object.keys(agentsById).length} agents, ` +
        `${Object.keys(result.reviewStatusByIssueId).length} review statuses, ` +
        `${result.issuesEnumerated} in-flight issue(s), seq=${sequence}`,
      );

      // ── Checkpoint reconciliation (deferred — non-blocking) ──────────────────
      // Fire-and-forget: scan workspaces for git checkpoints in the background
      // so the ReadModel layer resolves immediately and the dashboard starts fast.
      void (async () => {
        try {
          const { listCheckpoints, diffCheckpointFiles, getCheckpointTimestamp, deleteLegacyCheckpointRefs } = await import('../../lib/checkpoint/checkpoint-manager.js');

          const agents = Object.values(state.agentsById);

          // One-time: clean up unscoped legacy refs from before per-agent namespacing.
          // Run against the first agent's workspace (all worktrees share the same parent .git).
          const firstAgentWithWorkspace = agents.find(a => a.workspace);
          if (firstAgentWithWorkspace?.workspace) {
            const deleted = await Effect.runPromise(deleteLegacyCheckpointRefs(firstAgentWithWorkspace.workspace));
            if (deleted > 0) {
              console.log(`[ReadModel] Deleted ${deleted} legacy unscoped checkpoint refs`);
            }
          }
          let reconciled = 0;
          for (const agent of agents) {
            if (shouldSkipCheckpointReconciliation(agent)) continue;

            const workspace = agent.workspace;
            if (!workspace) continue;
            const existingSummaries = state.turnDiffSummariesByAgentId[agent.id];
            if (existingSummaries && existingSummaries.length > 0) continue;

            try {
              const checkpoints = await Effect.runPromise(listCheckpoints(workspace, agent.id));
              if (checkpoints.length === 0) continue;

              const maxRetainedSummaries = getMaxTurnDiffSummariesPerAgent();
              const retainedCheckpoints = checkpoints.length > maxRetainedSummaries
                ? checkpoints.slice(-maxRetainedSummaries)
                : checkpoints;
              const checkpointOffset = checkpoints.length - retainedCheckpoints.length;

              const summaries: Array<{
                turnId: string;
                completedAt: string;
                files: Array<{ path: string; kind?: string; additions?: number; deletions?: number }>;
                checkpointRef?: string;
                assistantMessageId?: string;
                checkpointTurnCount?: number;
              }> = [];

              for (let i = 0; i < retainedCheckpoints.length; i++) {
                const absoluteIndex = checkpointOffset + i;
                const turnId = retainedCheckpoints[i];
                if (!turnId) continue;
                const prevTurnId = absoluteIndex > 0 ? checkpoints[absoluteIndex - 1] ?? null : null;
                let files: Array<{ path: string; kind?: string; additions?: number; deletions?: number }> = [];
                if (prevTurnId) {
                  try {
                    files = await Effect.runPromise(diffCheckpointFiles(workspace, agent.id, prevTurnId, turnId));
                  } catch { /* checkpoint might be stale */ }
                }
                const completedAt = await Effect.runPromise(getCheckpointTimestamp(workspace, agent.id, turnId));
                summaries.push({
                  turnId,
                  completedAt,
                  files,
                  checkpointRef: `refs/pan/turn/${agent.id}/${turnId}`,
                  checkpointTurnCount: absoluteIndex + 1,
                });
              }

              if (summaries.length > 0) {
                state = {
                  ...state,
                  turnDiffSummariesByAgentId: {
                    ...state.turnDiffSummariesByAgentId,
                    [agent.id]: trimTurnDiffSummaries(summaries),
                  },
                };
                reconciled++;
              }
            } catch { /* agent workspace may not be a git repo */ }
          }

          if (reconciled > 0) {
            console.log(`[ReadModel] Reconciled checkpoints for ${reconciled} agent(s)`);
          }
        } catch (err) {
          console.warn('[ReadModel] Checkpoint reconciliation failed:', err);
        }
      })();

      // ── Issue listener (always) ──────────────────────────────────────────────
      // Issues come from external trackers (Linear/GitHub) with unpredictable shapes.
      // JSON round-trip strips undefined values that can't be serialized over WebSocket.
      try {
        const { getSharedIssueService } = yield* Effect.promise(
          () => import('./services/issue-service-singleton.js'),
        );
        const issueService = getSharedIssueService();

        // PAN-1510: merge issueService's view with whatever the projection
        // cache loaded so newly-filed issues (filed during the previous
        // session's debounced-flush window, or already loaded into
        // IssueDataService's in-memory cache before the read model bootstrap
        // wired its onIssuesChanged callback) reach `issuesRaw`. Without the
        // merge, the bootstrap window between issueService.start() loading
        // its SQLite cache and read-model wiring `onIssuesChanged` could
        // strand fresh issues — the subsequent `pushSnapshot` would either
        // hit a null callback or be skipped by `issuesChanged()` because
        // `lastFetchedIssues` already matched the new GitHub fetch.
        const currentIssues = cleanIssues(issueService.getIssues());
        if (currentIssues.length > 0 || state.issuesRaw.length === 0) {
          const newIssues = discoverNewIssues(state.issuesRaw, currentIssues);
          if (newIssues.length > 0) {
            const sample = newIssues
              .slice(0, 5)
              .map(i => getIssueIdentifierKey(i) ?? 'unknown')
              .join(', ');
            const more = newIssues.length > 5 ? `, +${newIssues.length - 5} more` : '';
            console.log(
              `[ReadModel] Bootstrap: merging ${newIssues.length} new issue(s) from issueService not in projection cache (${sample}${more})`,
            );
          }
          state = {
            ...state,
            issuesRaw: mergeIssuesByIdentifier(state.issuesRaw, currentIssues),
          };
        }

        // Wire live issue updates — when IssueDataService polls new data,
        // update the read model directly AND emit to event store for
        // WebSocket subscribers (PAN-433).
        issueService.onIssuesChanged((issues) => {
          const cleaned = cleanIssues(issues);
          state = { ...state, issuesRaw: cleaned };

          // Fan-out issues.snapshot to live WebSocket subscribers via in-memory PubSub.
          // Uses emitOnly (NOT append) — issues.snapshot is ~1.5 MB and must never be
          // persisted to the event log. Persisting it causes startup OOM on replay.
          // Uses cached reference to avoid async dynamic import delay
          // (delay caused frontend to miss updates after patchIssue)
          try {
            if (!_cachedEventStore) {
              import('./event-store.js').then(({ getEventStore }) => {
                _cachedEventStore = getEventStore();
                try {
                  _cachedEventStore.emitOnly({
                    type: 'issues.snapshot',
                    timestamp: new Date().toISOString(),
                    payload: { issues: cleaned },
                  } as any);
                } catch { /* event store not ready */ }
              }).catch(() => {});
            } else {
              _cachedEventStore.emitOnly({
                type: 'issues.snapshot',
                timestamp: new Date().toISOString(),
                payload: { issues: cleaned },
              } as any);
            }
          } catch { /* event store not ready yet */ }
        });
      } catch {
        console.warn('[ReadModel] IssueDataService not available at bootstrap, starting with empty issues');
      }
    });

    return {
      getSnapshot,
      getChannelPermissionRequest,
      getResolvedChannelPermissionDecision,
      getTurnDiffSummaries,
      getAgentIdBySessionId,
      applyEvent,
      bootstrap: Effect.void,
    };
  }),
);
