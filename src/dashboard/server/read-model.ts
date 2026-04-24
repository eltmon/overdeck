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
import { Effect, Layer, ServiceMap } from 'effect';
import type { DashboardSnapshot, DomainEvent } from '@panopticon/contracts';
import { AGENTS_DIR } from '../../lib/paths.js';
import {
  type ReadModelState,
  INITIAL_READ_MODEL_STATE,
  applyEvent as applyEventReducer,
} from '@panopticon/contracts';
import type { AgentSnapshot, AgentStatus, AgentPhase, AgentResolution, ReviewStatusSnapshot, SpecialistSnapshot, SpecialistType, SpecialistState, ReviewStatusValue, TestStatusValue, MergeStatusValue, VerificationStatusValue } from '@panopticon/contracts';
import type { ReviewStatus } from '../../lib/review-status.js';
import { logDeaconEvent } from '../../lib/persistent-logger.js';

// ─── Exported async helpers (used by bootstrap Effect + tests) ───────────────

export async function discoverNewAgentIds(agentsDir: string, cachedIds: Set<string>): Promise<string[]> {
  const { readdir } = await import('node:fs/promises');
  let entries: string[];
  try {
    entries = await readdir(agentsDir);
  } catch {
    return [];
  }
  return entries.filter(e => !cachedIds.has(e) && existsSync(join(agentsDir, e, 'state.json')));
}

// ─── Cached event store reference (avoids async dynamic import on each pushUpdated) ──
let _cachedEventStore: any = null;

// ─── Value validators for strict literal types ──────────────────────────────

const VALID_AGENT_STATUSES = new Set<AgentStatus>(["starting", "running", "stopped", "error", "unknown"]);
const VALID_AGENT_PHASES = new Set<AgentPhase>(["planning", "exploration", "implementation", "testing", "documentation", "pre_push", "post_push", "review", "review-response", "merge"]);
const VALID_RESOLUTIONS = new Set<AgentResolution>(["working", "done", "needs_input", "stuck", "completed", "unclear"]);
const VALID_SPECIALIST_TYPES = new Set<SpecialistType>(["review-agent", "test-agent", "merge-agent", "inspect-agent", "uat-agent"]);
const VALID_SPECIALIST_STATES = new Set<SpecialistState>(["active", "sleeping", "uninitialized"]);
const VALID_REVIEW_STATUSES = new Set<ReviewStatusValue>(["pending", "reviewing", "passed", "failed", "blocked"]);
const VALID_TEST_STATUSES = new Set<TestStatusValue>(["pending", "testing", "passed", "failed", "skipped", "dispatch_failed"]);
const VALID_MERGE_STATUSES = new Set<MergeStatusValue>(["pending", "queued", "merging", "verifying", "merged", "failed"]);
const VALID_VERIFICATION_STATUSES = new Set<VerificationStatusValue>(["pending", "running", "passed", "failed", "skipped"]);

export function toAgentStatus(v: unknown): AgentStatus {
  return VALID_AGENT_STATUSES.has(v as AgentStatus) ? v as AgentStatus : "unknown";
}
export function toAgentPhase(v: unknown): AgentPhase | undefined {
  return v && VALID_AGENT_PHASES.has(v as AgentPhase) ? v as AgentPhase : undefined;
}
export function toAgentResolution(v: unknown): AgentResolution | undefined {
  return v && VALID_RESOLUTIONS.has(v as AgentResolution) ? v as AgentResolution : undefined;
}
export function toSpecialistType(v: unknown): SpecialistType | undefined {
  return VALID_SPECIALIST_TYPES.has(v as SpecialistType) ? v as SpecialistType : undefined;
}
export function toSpecialistState(v: unknown): SpecialistState {
  return VALID_SPECIALIST_STATES.has(v as SpecialistState) ? v as SpecialistState : "uninitialized";
}
export function toReviewStatus(v: unknown): ReviewStatusValue | undefined {
  return v && VALID_REVIEW_STATUSES.has(v as ReviewStatusValue) ? v as ReviewStatusValue : undefined;
}
export function toTestStatus(v: unknown): TestStatusValue | undefined {
  return v && VALID_TEST_STATUSES.has(v as TestStatusValue) ? v as TestStatusValue : undefined;
}
export function toMergeStatus(v: unknown): MergeStatusValue | undefined {
  return v && VALID_MERGE_STATUSES.has(v as MergeStatusValue) ? v as MergeStatusValue : undefined;
}
export function toVerificationStatus(v: unknown): VerificationStatusValue | undefined {
  return v && VALID_VERIFICATION_STATUSES.has(v as VerificationStatusValue) ? v as VerificationStatusValue : undefined;
}

export function toReviewStatusSnapshot(status: Pick<ReviewStatus, 'issueId' | 'reviewStatus' | 'testStatus' | 'mergeStatus' | 'verificationStatus' | 'verificationNotes' | 'verificationCycleCount' | 'readyForMerge' | 'updatedAt' | 'prUrl' | 'stuck' | 'stuckReason' | 'stuckAt' | 'stuckDetails' | 'reviewedAtCommit' | 'reviewSpawnedAt' | 'testRetryCount' | 'reviewRetryCount' | 'recoveryStartedAt' | 'deaconIgnored' | 'deaconIgnoredAt' | 'deaconIgnoredReason'> & { reviewSessionNames?: string[]; reviewSubStatuses?: Record<string, 'running' | 'done'> }): ReviewStatusSnapshot {
  return {
    issueId: status.issueId,
    reviewStatus: toReviewStatus(status.reviewStatus),
    testStatus: toTestStatus(status.testStatus),
    mergeStatus: toMergeStatus(status.mergeStatus),
    verificationStatus: toVerificationStatus(status.verificationStatus),
    verificationNotes: status.verificationNotes || undefined,
    verificationCycleCount: typeof status.verificationCycleCount === 'number' ? status.verificationCycleCount : undefined,
    readyForMerge: status.readyForMerge === true,
    updatedAt: status.updatedAt,
    prUrl: status.prUrl || undefined,
    stuck: status.stuck === true ? true : undefined,
    stuckReason: status.stuckReason || undefined,
    stuckAt: status.stuckAt || undefined,
    stuckDetails: status.stuckDetails || undefined,
    reviewedAtCommit: status.reviewedAtCommit || undefined,
    reviewSpawnedAt: status.reviewSpawnedAt || undefined,
    testRetryCount: typeof status.testRetryCount === 'number' ? status.testRetryCount : undefined,
    reviewRetryCount: typeof status.reviewRetryCount === 'number' ? status.reviewRetryCount : undefined,
    recoveryStartedAt: status.recoveryStartedAt || undefined,
    deaconIgnored: status.deaconIgnored === true ? true : undefined,
    deaconIgnoredAt: status.deaconIgnoredAt || undefined,
    deaconIgnoredReason: status.deaconIgnoredReason || undefined,
    reviewSessionNames: status.reviewSessionNames && status.reviewSessionNames.length > 0 ? status.reviewSessionNames : undefined,
    reviewSubStatuses: status.reviewSubStatuses,
  };
}

// ─── ReadModelService ────────────────────────────────────────────────────────

export interface ReadModelServiceShape {
  /** Return the current read model state as a DashboardSnapshot. */
  readonly getSnapshot: Effect.Effect<DashboardSnapshot>;
  /** Apply a domain event to the read model (called by event store on append). */
  readonly applyEvent: (event: DomainEvent) => void;
  /** Bootstrap the read model from existing lib module state. */
  readonly bootstrap: Effect.Effect<void>;
}

export class ReadModelService extends ServiceMap.Service<
  ReadModelService,
  ReadModelServiceShape
>()('panopticon/dashboard/ReadModelService') {}

// ─── Live implementation ─────────────────────────────────────────────────────

export const ReadModelServiceLive = Layer.effect(
  ReadModelService,
  Effect.gen(function* () {
    let state: ReadModelState = { ...INITIAL_READ_MODEL_STATE };

    // Reference to projection cache — set during bootstrap once the event store initializes it
    let projectionCache: import('./services/projection-cache.js').ProjectionCache | null = null;

    function buildSnapshot(): DashboardSnapshot {
      return {
        sequence: state.sequence,
        agents: Object.values(state.agentsById),
        specialists: Object.values(state.specialistsByName),
        reviewStatuses: Object.values(state.reviewStatusByIssueId),
        issues: state.issuesRaw,
        resources: state.resources ?? undefined,
        timestamp: new Date().toISOString(),
      };
    }

    const applyEvent = (event: DomainEvent): void => {
      state = applyEventReducer(state, event);
      // Persist updated projection on every event (debounced inside the cache service)
      projectionCache?.save(buildSnapshot());
    };

    const getSnapshot: Effect.Effect<DashboardSnapshot> = Effect.gen(function* () {
      // Refresh review statuses from DB before building snapshot.
      // Defensive: the event-driven path should keep these in sync, but if an
      // event is lost (e.g. pipeline notifier throws silently) the read model
      // can drift. Reloading from SQLite guarantees the snapshot is authoritative.
      try {
        const { loadReviewStatuses: loadStatuses } = yield* Effect.promise(
          () => import('../../lib/review-status.js'),
        );
        const { enrichReviewStatusFromSessions } = yield* Effect.promise(
          () => import('../../lib/review-status-enrichment.js'),
        );
        const { listSessionNamesAsync } = yield* Effect.promise(
          () => import('../../lib/tmux.js'),
        );
        const statusMap = loadStatuses();
        // One tmux call for all issues — O(1) tmux cost per snapshot build.
        const allSessions = yield* Effect.promise(() => listSessionNamesAsync()).pipe(
          Effect.catchAll(() => Effect.succeed([] as string[])),
        );
        state = {
          ...state,
          reviewStatusByIssueId: Object.fromEntries(
            Object.values(statusMap).map((status) => {
              const enriched = enrichReviewStatusFromSessions(status.issueId, status, allSessions);
              return [status.issueId, toReviewStatusSnapshot(enriched)];
            }),
          ),
        };
      } catch (err) {
        console.error('[ReadModel] Failed to refresh review statuses for snapshot:', err);
      }

      // Refresh issues from the shared issue service before building snapshot.
      // IssueDataService polls trackers in the background; its cached issues are
      // the freshest available without blocking on API calls.
      try {
        const { getSharedIssueService } = yield* Effect.promise(
          () => import('./services/issue-service-singleton.js'),
        );
        const issueService = getSharedIssueService();
        const currentIssues = JSON.parse(JSON.stringify(issueService.getIssues()));
        if (currentIssues.length > 0 || state.issuesRaw.length === 0) {
          state = { ...state, issuesRaw: currentIssues };
        }
      } catch (err) {
        console.error('[ReadModel] Failed to refresh issues for snapshot:', err);
      }

      return buildSnapshot();
    });

    // ── Bootstrap inline during layer construction ───────────────────────────
    yield* Effect.gen(function* () {
      const { loadReviewStatuses } = yield* Effect.promise(
        () => import('../../lib/review-status.js'),
      );

      // ── Fast path: projection cache ──────────────────────────────────────────
      // Try to load the full snapshot from SQLite — sub-millisecond if available.
      // Falls back to the slow lib-module path on first boot or corruption.
      let usedProjectionCache = false;
      try {
        const { getProjectionCache } = yield* Effect.promise(
          () => import('./services/projection-cache.js'),
        );
        projectionCache = getProjectionCache();
        const cached = projectionCache.load();
        if (cached && cached.sequence > 0) {
          // Validate cached agents against actual state files — remove stale entries
          // from agents that were wiped/removed while the server was down
          const { existsSync: existsSyncFs } = yield* Effect.promise(() => import('node:fs'));
          const { join: joinPath } = yield* Effect.promise(() => import('node:path'));
          const { homedir: homedirFn } = yield* Effect.promise(() => import('node:os'));
          const agentsDir = joinPath(homedirFn(), '.panopticon', 'agents');
          const validAgents = (cached.agents ?? []).filter((a: any) => {
            const stateFile = joinPath(agentsDir, a.id, 'state.json');
            return existsSyncFs(stateFile);
          });
          const pruned = (cached.agents ?? []).length - validAgents.length;
          if (pruned > 0) {
            console.log(`[ReadModel] Pruned ${pruned} stale agents from projection cache`);
          }

          // Also pick up agents created after the last cache save (new state files not in cache)
          const cachedIds = new Set(validAgents.map((a: any) => a.id));
          const { readdir: readdirAsync, readFile: readFileAsync } = yield* Effect.promise(() => import('node:fs/promises'));
          const newAgentIds: string[] = [];
          const dirEntries = yield* Effect.promise(() => readdirAsync(agentsDir).catch(() => [] as string[]));
          for (const entry of dirEntries) {
            if (!cachedIds.has(entry) && existsSyncFs(joinPath(agentsDir, entry, 'state.json'))) {
              newAgentIds.push(entry);
            }
          }

          // Load new agent state files and add them to the snapshot
          const newAgents: any[] = [];
          for (const agentId of newAgentIds) {
            try {
              const raw = yield* Effect.promise(() => readFileAsync(joinPath(agentsDir, agentId, 'state.json'), 'utf-8'));
              newAgents.push(JSON.parse(raw));
            } catch { /* skip unreadable state files */ }
          }
          if (newAgents.length > 0) {
            console.log(`[ReadModel] Found ${newAgents.length} agent(s) created after last cache save: ${newAgents.map((a) => a.id).join(', ')}`);
          }

          const allAgents = [...validAgents, ...newAgents];
          const statusMap = loadReviewStatuses();
          state = {
            ...INITIAL_READ_MODEL_STATE,
            sequence: cached.sequence,
            agentsById: Object.fromEntries(allAgents.map((a: any) => [a.id, a])),
            specialistsByName: Object.fromEntries((cached.specialists ?? []).map((s) => [s.name, s])),
            reviewStatusByIssueId: Object.fromEntries(
              Object.values(statusMap).map((status) => [status.issueId, toReviewStatusSnapshot(status)]),
            ),
            issuesRaw: cached.issues ?? [],
            resources: cached.resources,
          };
          usedProjectionCache = true;
          console.log(
            `[ReadModel] Fast bootstrap from projection cache: seq=${cached.sequence}, ` +
            `agents=${allAgents.length} (${validAgents.length} cached + ${newAgents.length} new), issues=${(cached.issues ?? []).length}`,
          );
        }
      } catch {
        // Projection cache not initialized yet (first boot) — fall through to slow path
      }

      // ── Slow path: bootstrap from lib modules ────────────────────────────────
      if (!usedProjectionCache) {
        // Lazy imports to avoid circular dependency issues
        const [{ listRunningAgentsAsync, warnOnBareNumericIssueIds }, { getAllSpecialists, getSpecialistState }, { getReviewStatus }, { computeAgentEnrichment }] =
          yield* Effect.all([
            Effect.promise(() => import('../../lib/agents.js')),
            Effect.promise(() => import('../../lib/cloister/specialists.js')),
            Effect.promise(() => import('../../lib/review-status.js')),
            Effect.promise(() => import('../../lib/agent-enrichment.js')),
          ]);

        // Warn on legacy state files with bare numeric issueIds (PAN-489)
        warnOnBareNumericIssueIds();

        // ── Agents ────────────────────────────────────────────────────────────
        const running = yield* Effect.promise(() => listRunningAgentsAsync());
        const agentsById: Record<string, AgentSnapshot> = {};

        // Compute enrichment for all agents in parallel during bootstrap
        // so the initial snapshot already has badges/buttons data (no 3s gap).
        const enrichmentResults = yield* Effect.promise(() =>
          Promise.all(
            running.map(async (a) => {
              const reviewStatus = getReviewStatus(a.issueId)
              const hasActiveSpecialist =
                reviewStatus?.reviewStatus === 'reviewing' ||
                reviewStatus?.testStatus === 'testing' ||
                reviewStatus?.mergeStatus === 'merging'
              try {
                return await computeAgentEnrichment(a.id, a.startedAt, hasActiveSpecialist)
              } catch {
                return undefined
              }
            })
          )
        )

        for (let i = 0; i < running.length; i++) {
          const a = running[i]
          const enrichment = enrichmentResults[i]
          // Check if the agent completed normally (completed/completed.processed marker).
          // This distinguishes "session lost mid-review" from "agent finished and transitioned to in_review".
          const agentDir = join(AGENTS_DIR, a.id);
          const completedNormally =
            existsSync(join(agentDir, 'completed')) ||
            existsSync(join(agentDir, 'completed.processed'));
          agentsById[a.id] = {
            id: a.id,
            issueId: a.issueId,
            workspace: a.workspace || undefined,
            runtime: a.runtime || undefined,
            model: a.model || undefined,
            // Reconcile on-disk status with live tmux state:
            // - tmux active but state.json says 'stopped' → actually running (resumed outside API)
            // - tmux inactive but state.json says 'running' → actually stopped (reboot/crash)
            status: (() => {
              let reconciled = a.status as AgentStatus | string;
              if (a.tmuxActive && a.status === 'stopped') {
                reconciled = 'running';
                logDeaconEvent(`readModel bootstrap: ${a.id} reconciled stopped→running (tmux session alive, resumed outside API)`);
              } else if (!a.tmuxActive && a.status === 'running') {
                reconciled = 'stopped';
                logDeaconEvent(`readModel bootstrap: ${a.id} reconciled running→stopped (tmux session dead, likely reboot/crash)`);
              }
              return toAgentStatus(reconciled);
            })(),
            startedAt: a.startedAt || undefined,
            lastActivity: a.lastActivity || undefined,
            branch: a.branch || undefined,
            costSoFar: a.costSoFar,
            sessionId: a.sessionId || undefined,
            phase: toAgentPhase(a.phase),
            runtimeState: completedNormally ? 'completed' : undefined,
            // Enrichment fields (PAN-440)
            agentPhase: enrichment ? toAgentPhase(enrichment.agentPhase) : undefined,
            hasPendingQuestion: enrichment?.hasPendingQuestion,
            pendingQuestionCount: enrichment?.pendingQuestionCount,
            resolution: enrichment ? toAgentResolution(enrichment.resolution) : undefined,
            resolutionCount: enrichment?.resolutionCount,
          };
        }

        // ── Specialists ────────────────────────────────────────────────────────
        const allSpecs = getAllSpecialists();
        const specialistsByName: Record<string, SpecialistSnapshot> = {};
        for (const s of allSpecs) {
          const specType = toSpecialistType(s.name);
          if (!specType) continue; // Skip unknown specialist types
          const specState = getSpecialistState(s.name);
          specialistsByName[s.name] = {
            name: specType,
            state: toSpecialistState(specState),
            isRunning: specState === 'active',
            lastWake: s.lastWake || undefined,
          };
        }

        // ── Review statuses ────────────────────────────────────────────────────
        const statusMap = loadReviewStatuses();
        const reviewStatusByIssueId: Record<string, ReviewStatusSnapshot> = {};
        for (const rs of Object.values(statusMap)) {
          reviewStatusByIssueId[rs.issueId] = toReviewStatusSnapshot(rs);
        }

        // ── Sequence from event store ──────────────────────────────────────────
        let sequence = 0;
        try {
          const { getEventStore } = yield* Effect.promise(
            () => import('./event-store.js'),
          );
          sequence = getEventStore().getLatestSequence();
        } catch {
          // Event store may not be initialized yet
        }

        // Agents, specialists, and review statuses are already clean — validators
        // map unknown values to concrete typed defaults. No JSON round-trip needed.
        state = {
          ...INITIAL_READ_MODEL_STATE,
          sequence,
          agentsById,
          specialistsByName,
          reviewStatusByIssueId,
          issuesRaw: [],
        };

        console.log(
          `[ReadModel] Bootstrapped: ${Object.keys(agentsById).length} agents, ` +
          `${Object.keys(specialistsByName).length} specialists, ` +
          `${Object.keys(reviewStatusByIssueId).length} review statuses, seq=${sequence}`,
        );
      }

      // ── Issue listener (always) ──────────────────────────────────────────────
      // Issues come from external trackers (Linear/GitHub) with unpredictable shapes.
      // JSON round-trip strips undefined values that can't be serialized over WebSocket.
      try {
        const { getSharedIssueService } = yield* Effect.promise(
          () => import('./services/issue-service-singleton.js'),
        );
        const issueService = getSharedIssueService();

        // Get current issues (may already have fresh data from background fetch)
        const currentIssues = JSON.parse(JSON.stringify(issueService.getIssues()));
        if (currentIssues.length > 0 || !usedProjectionCache) {
          state = { ...state, issuesRaw: currentIssues };
        }

        // Wire live issue updates — when IssueDataService polls new data,
        // update the read model directly AND emit to event store for
        // WebSocket subscribers (PAN-433).
        issueService.onIssuesChanged((issues) => {
          const cleaned = JSON.parse(JSON.stringify(issues));
          state = { ...state, issuesRaw: cleaned };
          // Persist updated snapshot to projection cache
          projectionCache?.save(buildSnapshot());

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

    return { getSnapshot, applyEvent, bootstrap: Effect.void };
  }),
);
