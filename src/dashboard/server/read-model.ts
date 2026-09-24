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

import { Effect, Layer, Context } from 'effect';
import type { DashboardSnapshot, DomainEvent, TurnDiffSummary } from '@overdeck/contracts';
import {
  type ReadModelState,
  INITIAL_READ_MODEL_STATE,
  applyEvent as applyEventReducer,
  createIssueDelta,
  getMaxTurnDiffSummariesPerAgent,
  isTerminalTurnDiffSummaryStatus,
  trimTurnDiffSummaries,
} from '@overdeck/contracts';
import type { AgentSnapshot, AgentStatus, Role, AgentResolution, BackendPane, DerivedIssueState } from '@overdeck/contracts';
import { AgentsResolver, type Agent as OverdeckAgent } from '../../lib/overdeck/agents.js';

// ─── Exported async helpers (used by bootstrap Effect + tests) ───────────────

const MAX_SNAPSHOT_ACTIVITY_ENTRIES = 50;

type DashboardSnapshotWithActivity = DashboardSnapshot & {
  recentActivity?: unknown[];
};

export function activityEntriesFromStoredEvents(
  events: ReadonlyArray<{ timestamp: string; payload: unknown }>,
  limit = MAX_SNAPSHOT_ACTIVITY_ENTRIES,
): unknown[] {
  const entries: Record<string, unknown>[] = [];
  for (const event of events) {
    const entry = event.payload && typeof event.payload === 'object'
      ? event.payload as Record<string, unknown>
      : {};
    const previousIndex = entries.findIndex(candidate => candidate.id === entry.id);
    const previous = previousIndex >= 0 ? entries[previousIndex] : undefined;
    if (previousIndex >= 0) entries.splice(previousIndex, 1);
    entries.unshift({ ...previous, id: entry.id, timestamp: event.timestamp, ...entry });
  }
  return entries.slice(0, limit);
}


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

// ─── Cached event store reference (avoids async dynamic import on each pushUpdated) ──
let _cachedEventStore: any = null;

/**
 * Fan a derived read-model event out to live subscribers only (PAN-3917).
 *
 * `emitOnly`, never `append`: `issue_state.changed` and `backend_pane.*` carry
 * facts recomputed from the tracker, the forge and the terminal backend on
 * every boot. Persisting them would resurrect dead panes and stale pipeline
 * positions on replay — exactly the stored status this issue deletes.
 */
function emitDerivedEvent(event: { type: string; payload: unknown }): void {
  try {
    if (!_cachedEventStore) {
      void import('./event-store.js').then(({ getEventStore }) => {
        _cachedEventStore = getEventStore();
        try {
          _cachedEventStore.emitOnly({ ...event, timestamp: new Date().toISOString() } as any);
        } catch { /* event store not ready */ }
      }).catch(() => {});
      return;
    }
    _cachedEventStore.emitOnly({ ...event, timestamp: new Date().toISOString() } as any);
  } catch { /* event store not ready yet */ }
}

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
const VALID_ROLES = new Set<Role>(["plan", "work", "review", "test", "ship", "flywheel", "strike", "sequencer", "knowledge", "worker"]);
const VALID_RESOLUTIONS = new Set<AgentResolution>(["working", "done", "needs_input", "stuck", "completed", "unclear", "abandoned", "api_error"]);
type SpecialistAgentName = 'review-agent' | 'test-agent' | 'merge-agent' | 'inspect-agent' | 'uat-agent';
type SpecialistLifecycleState = 'active' | 'sleeping' | 'uninitialized';

const VALID_SPECIALIST_NAMES = new Set<SpecialistAgentName>(["review-agent", "test-agent", "merge-agent", "inspect-agent", "uat-agent"]);
const VALID_SPECIALIST_LIFECYCLE_STATES = new Set<SpecialistLifecycleState>(["active", "sleeping", "uninitialized"]);
export function toAgentStatus(v: unknown): AgentStatus {
  return VALID_AGENT_STATUSES.has(v as AgentStatus) ? v as AgentStatus : "unknown";
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
// ─── ReadModelService ────────────────────────────────────────────────────────

export interface ReadModelServiceShape {
  /** Return the current read model state as a DashboardSnapshot. */
  readonly getSnapshot: Effect.Effect<DashboardSnapshotWithActivity>;
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
  // 'idle'/'waiting' = agent is alive but waiting (tool-call paused, AUQ, etc.)
  if (status === 'idle' || status === 'waiting') return 'running';
  return status; // 'starting' | 'running' | 'stopped' are 1:1
}

export function agentSnapshotFromOverdeck(agent: OverdeckAgent): AgentSnapshot {
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

// ─── Served agent status: derived from the backend inventory (#4098) ─────────
//
// `agentsById` holds each agent's last stored status, copied at boot, so a dead
// agent kept `running` in every snapshot. Overdeck stores no status it can
// derive: at serve time a row that CLAIMS to be live (`running`/`starting`)
// keeps the claim only while the terminal backend hosts a non-exited pane for
// it. Downgrade only — a stored `stopped`/`error` is operator or supervisor
// intent (on Herdr a stopped agent's pane can outlive the stop), and `paused`
// / `stoppedByUser` are separate fields that pass through untouched.

/** Stored statuses that claim a live agent; only these are checked against the inventory. */
const CLAIMED_LIVE_STATUSES: ReadonlySet<AgentStatus> = new Set(['running', 'starting']);

/**
 * The managed agent ids the backend inventory can answer for — the same
 * filter `GET /api/agents` applies. Other rows (e.g. `sequencer-runner`) are
 * absent from the tmux inventory by design, so their stored status is served.
 */
function isInventoryAnsweredAgentId(id: string): boolean {
  return id.startsWith('agent-') || id.startsWith('planning-') || id.startsWith('strike-');
}

/**
 * `trusted`: the inventory has been read successfully at least once, so
 * `backendPanesById` is a real answer (current, or the last good one while the
 * backend is briefly unreadable). `unavailable`: no read has ever succeeded —
 * the dashboard booted before Herdr — so absence of a pane proves nothing.
 */
export type PaneInventoryTrust = 'trusted' | 'unavailable';

/**
 * Agent rows as the terminal backend sees them. A row claiming to be live with
 * no live pane reads `stopped` (or `unknown` while the inventory has never
 * answered). Panes match the way `GET /api/agents` matches them — the pane's
 * terminal id (or pane id) is the agent id — plus the pane's `agentId` token.
 * There is no issue+role fallback: a dead and a live agent of one issue share
 * issue and role, and the fallback would report the dead one running.
 */
export function deriveServedAgentStatuses(
  agents: readonly AgentSnapshot[],
  panesById: Readonly<Record<string, BackendPane>>,
  inventory: PaneInventoryTrust,
): AgentSnapshot[] {
  const livePaneAgentIds = new Set<string>();
  for (const pane of Object.values(panesById)) {
    if (pane.state === 'exited') continue;
    livePaneAgentIds.add(pane.terminalId ?? pane.id);
    if (pane.agentId) livePaneAgentIds.add(pane.agentId);
  }
  return agents.map((agent) => {
    if (!CLAIMED_LIVE_STATUSES.has(agent.status)) return agent;
    if (!isInventoryAnsweredAgentId(agent.id)) return agent;
    if (livePaneAgentIds.has(agent.id)) return agent;
    return { ...agent, status: inventory === 'trusted' ? 'stopped' as const : 'unknown' as const };
  });
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
    // #4098: becomes `trusted` after the first non-degraded inventory read and
    // stays so — a later failed read serves the last-good panes, never `[]`.
    let paneInventory: PaneInventoryTrust = 'unavailable';

    function cloneTurnDiffSummaries(summaries: TurnDiffSummary[] | undefined): TurnDiffSummary[] {
      if (!summaries || summaries.length === 0) return [];
      return summaries.map(summary => ({
        ...summary,
        files: summary.files.map(file => ({ ...file })),
        assistantMessageId: summary.assistantMessageId ?? undefined,
        checkpointRef: summary.checkpointRef ?? undefined,
      }));
    }

    function buildSnapshot(): DashboardSnapshotWithActivity {
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
        // #4098: status is derived from the backend inventory, not the stored copy.
        agents: deriveServedAgentStatuses(Object.values(state.agentsById), state.backendPanesById, paneInventory),
        // PAN-1048 — specialistsByName projection retired. The DashboardSnapshot
        // schema still has a `specialists` field for backward compat with the
        // wire format; we always send an empty array and clients derive the
        // same data from agentsById filtered by role.
        specialists: [],
        // PAN-3917 FR-6 / FR-12 — the two derived read models. Neither is
        // stored: the snapshot is rebuilt from the tracker, the forge and the
        // terminal backend on every connect.
        derivedIssueStates: Object.values(state.derivedIssueStateByIssueId),
        backendPanes: Object.values(state.backendPanesById),
        agentRuntimeById: state.agentRuntimeById,
        channelPermissionRequests: Object.values(state.channelPermissionRequestsById ?? {}),
        issues: state.issuesRaw,
        recentActivity: state.recentActivity,
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
        ciByProjectKey: state.ciByProjectKey,
        // PAN-3729: the restart-approval banner reads the gate from the
        // snapshot on connect and from restart_gate.changed events after that
        // — the frontend never polls the gate endpoints.
        restartGate: state.restartGate ?? undefined,
        timestamp: new Date().toISOString(),
      };
    }

    const applyEvent = (event: DomainEvent): void => {
      state = applyEventReducer(state, event);
    };

    const getSnapshot: Effect.Effect<DashboardSnapshotWithActivity> = Effect.gen(function* () {
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

      // PAN-3917: the derived read models are recomputed, never replayed. Seed
      // both maps from their owners so a fresh connect sees current facts even
      // before the next change event.
      try {
        const [{ getSharedIssueService }, { getBackendPanes, isBackendInventoryDegraded }] = yield* Effect.promise(() => Promise.all([
          import('./services/issue-service-singleton.js'),
          import('./services/backend-inventory.js'),
        ]));
        const derivedIssueStateByIssueId: Record<string, DerivedIssueState> = {};
        for (const derived of getSharedIssueService().listDerivedStates()) {
          derivedIssueStateByIssueId[derived.issueId] = derived;
        }
        const backendPanesById: Record<string, BackendPane> = {};
        for (const pane of yield* Effect.promise(() => getBackendPanes())) {
          backendPanesById[pane.id] = pane;
        }
        if (!isBackendInventoryDegraded()) paneInventory = 'trusted';
        state = { ...state, derivedIssueStateByIssueId, backendPanesById };
      } catch (err) {
        console.error('[ReadModel] Failed to refresh the derived read model for snapshot:', err);
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
      // Agents come from AgentsResolver. There is no status reconstruction to
      // do: pipeline position is derived per read (FR-6).
      const overdeckAgents = yield* agentsResolver.list({});

      const agentsById: Record<string, AgentSnapshot> = Object.fromEntries(
        overdeckAgents.map((a) => [a.id, agentSnapshotFromOverdeck(a)]),
      );

      // ── Sequence from event store (labels the snapshot, not a replay source) ─
      let sequence = 0;
      let recentActivity: unknown[] = [];
      try {
        const { getEventStore } = yield* Effect.promise(
          () => import('./event-store.js'),
        );
        const eventStore = getEventStore();
        sequence = eventStore.getLatestSequence();
        recentActivity = activityEntriesFromStoredEvents(
          eventStore.queryByType('activity.entry', MAX_SNAPSHOT_ACTIVITY_ENTRIES),
        );
      } catch (err) {
        console.error('[ReadModel] Failed to read the event-store sequence:', err);
      }

      state = {
        ...INITIAL_READ_MODEL_STATE,
        sequence,
        agentsById,
        issuesRaw: [],
        recentActivity,
      };

      console.log(
        `[ReadModel] Bootstrapped from local database: ` +
        `${Object.keys(agentsById).length} agents, seq=${sequence}`,
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
            const deleted = await deleteLegacyCheckpointRefs(firstAgentWithWorkspace.workspace);
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
        const mergeT0 = performance.now();
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
        console.log(`[boot-timing] ReadModel bootstrap merge completed at +${Math.round(performance.now() - mergeT0)}ms`);

        // Wire live issue updates — when IssueDataService polls new data,
        // update the read model directly AND emit to event store for
        // WebSocket subscribers (PAN-433).
        issueService.onIssuesChanged((issues) => {
          const cleaned = cleanIssues(issues);
          const delta = createIssueDelta(state.issuesRaw, cleaned);
          if (!delta) return;
          state = { ...state, issuesRaw: cleaned };

          // Initial/reconnect snapshots retain every field. Subsequent updates
          // send complete changed rows only, preserving descriptions and order.
          // These cache projections must never enter the durable event log.
          // Uses cached reference to avoid async dynamic import delay
          // (delay caused frontend to miss updates after patchIssue)
          try {
            if (!_cachedEventStore) {
              import('./event-store.js').then(({ getEventStore }) => {
                _cachedEventStore = getEventStore();
                try {
                  _cachedEventStore.emitOnly({
                    type: 'issues.delta',
                    timestamp: new Date().toISOString(),
                    payload: delta,
                  } as any);
                } catch { /* event store not ready */ }
              }).catch(() => {});
            } else {
              _cachedEventStore.emitOnly({
                type: 'issues.delta',
                timestamp: new Date().toISOString(),
                payload: delta,
              } as any);
            }
          } catch { /* event store not ready yet */ }

          // PAN-1866: debounced incremental sequencer pass on every backlog delta
          import('../../lib/backlog/backlog-auto-trigger.js').then(({ triggerDebouncedIncrementalPass }) => {
            triggerDebouncedIncrementalPass(process.cwd());
          }).catch(() => {});
        });

        // PAN-3917 FR-6 — a recomputed pipeline state fans out as
        // issue_state.changed. emitOnly, never append: replaying a derived
        // state on the next boot would be storing a status we can derive.
        issueService.onDerivedStatesChanged((changed) => {
          const next = { ...state.derivedIssueStateByIssueId };
          for (const derived of changed) next[derived.issueId] = derived;
          state = { ...state, derivedIssueStateByIssueId: next };
          for (const issueState of changed) {
            emitDerivedEvent({ type: 'issue_state.changed', payload: { issueState } });
          }
        });
      } catch {
        console.warn('[ReadModel] IssueDataService not available at bootstrap, starting with empty issues');
      }
    });

    // PAN-3917 FR-12 — live pane inventory fans out the same way.
    yield* Effect.promise(async () => {
      try {
        const inventory = await import('./services/backend-inventory.js');
        inventory.onBackendPanesChanged(({ changed, removed }) => {
          const next = { ...state.backendPanesById };
          for (const pane of changed) next[pane.id] = pane;
          for (const paneId of removed) delete next[paneId];
          state = { ...state, backendPanesById: next };
          for (const pane of changed) {
            emitDerivedEvent({ type: 'backend_pane.changed', payload: { pane } });
          }
          for (const paneId of removed) {
            emitDerivedEvent({ type: 'backend_pane.removed', payload: { paneId } });
          }
        });
        await inventory.startBackendInventory();
      } catch (err) {
        console.error('[ReadModel] Backend pane inventory unavailable:', err);
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
