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

import { Effect, Layer, ServiceMap } from 'effect';
import type { DashboardSnapshot, DomainEvent } from '@panopticon/contracts';
import {
  type ReadModelState,
  INITIAL_READ_MODEL_STATE,
  applyEvent as applyEventReducer,
} from '@panopticon/contracts';
import type { AgentSnapshot, AgentStatus, AgentPhase, AgentResolution, ReviewStatusSnapshot, SpecialistSnapshot, SpecialistType, SpecialistState, ReviewStatusValue, TestStatusValue, MergeStatusValue } from '@panopticon/contracts';

// ─── Value validators for strict literal types ──────────────────────────────

const VALID_AGENT_STATUSES = new Set<AgentStatus>(["starting", "running", "stopped", "error", "unknown"]);
const VALID_AGENT_PHASES = new Set<AgentPhase>(["planning", "exploration", "implementation", "testing", "documentation", "pre_push", "post_push"]);
const VALID_RESOLUTIONS = new Set<AgentResolution>(["working", "done", "needs_input", "stuck", "completed", "unclear"]);
const VALID_SPECIALIST_TYPES = new Set<SpecialistType>(["review-agent", "test-agent", "merge-agent", "inspect-agent", "uat-agent"]);
const VALID_SPECIALIST_STATES = new Set<SpecialistState>(["active", "sleeping", "uninitialized"]);
const VALID_REVIEW_STATUSES = new Set<ReviewStatusValue>(["pending", "reviewing", "passed", "failed", "blocked"]);
const VALID_TEST_STATUSES = new Set<TestStatusValue>(["pending", "testing", "passed", "failed", "skipped", "dispatch_failed"]);
const VALID_MERGE_STATUSES = new Set<MergeStatusValue>(["pending", "merging", "merged", "failed"]);

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

    const applyEvent = (event: DomainEvent): void => {
      state = applyEventReducer(state, event);
    };

    const getSnapshot: Effect.Effect<DashboardSnapshot> = Effect.sync(() => {
      return {
        sequence: state.sequence,
        agents: Object.values(state.agentsById),
        specialists: Object.values(state.specialistsByName),
        reviewStatuses: Object.values(state.reviewStatusByIssueId),
        issues: state.issuesRaw,
        resources: state.resources ?? undefined,
        timestamp: new Date().toISOString(),
      };
    });

    // ── Bootstrap inline during layer construction ───────────────────────────
    yield* Effect.gen(function* () {
      // Lazy imports to avoid circular dependency issues
      const [{ listRunningAgents }, { getAllSpecialists, getSpecialistState }, { loadReviewStatuses }, { computeAgentEnrichment }, { getReviewStatus }] =
        yield* Effect.all([
          Effect.promise(() => import('../../lib/agents.js')),
          Effect.promise(() => import('../../lib/cloister/specialists.js')),
          Effect.promise(() => import('../../lib/review-status.js')),
          Effect.promise(() => import('../../lib/agent-enrichment.js')),
          Effect.promise(() => import('../../lib/review-status.js')),
        ]);

      // Import IssueDataService singleton for issue data
      const { getSharedIssueService } = yield* Effect.promise(
        () => import('./services/issue-service-singleton.js'),
      );

      // ── Agents ──────────────────────────────────────────────────────────────
      const running = listRunningAgents();
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
        agentsById[a.id] = {
          id: a.id,
          issueId: a.issueId,
          workspace: a.workspace || undefined,
          runtime: a.runtime || undefined,
          model: a.model || undefined,
          status: toAgentStatus(a.status),
          startedAt: a.startedAt || undefined,
          lastActivity: a.lastActivity || undefined,
          branch: a.branch || undefined,
          costSoFar: a.costSoFar,
          sessionId: a.sessionId || undefined,
          phase: toAgentPhase(a.phase),
          // Enrichment fields (PAN-440)
          agentPhase: enrichment ? toAgentPhase(enrichment.agentPhase) : undefined,
          hasPendingQuestion: enrichment?.hasPendingQuestion,
          pendingQuestionCount: enrichment?.pendingQuestionCount,
          resolution: enrichment ? toAgentResolution(enrichment.resolution) : undefined,
          resolutionCount: enrichment?.resolutionCount,
        };
      }

      // ── Specialists ──────────────────────────────────────────────────────────
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

      // ── Review statuses ──────────────────────────────────────────────────────
      const statusMap = loadReviewStatuses();
      const reviewStatusByIssueId: Record<string, ReviewStatusSnapshot> = {};
      for (const rs of Object.values(statusMap)) {
        reviewStatusByIssueId[rs.issueId] = {
          issueId: rs.issueId,
          reviewStatus: toReviewStatus(rs.reviewStatus),
          testStatus: toTestStatus(rs.testStatus),
          mergeStatus: toMergeStatus(rs.mergeStatus),
          readyForMerge: rs.reviewStatus === 'passed' && rs.testStatus === 'passed',
          updatedAt: new Date().toISOString(),
          prUrl: rs.prUrl || undefined,
        };
      }

      // ── Issues ───────────────────────────────────────────────────────────────
      // Issues come from external trackers (Linear/GitHub) with unpredictable shapes.
      // JSON round-trip strips undefined values that can't be serialized over WebSocket.
      let issuesRaw: unknown[] = [];
      try {
        const issueService = getSharedIssueService();
        issuesRaw = JSON.parse(JSON.stringify(issueService.getIssues()));

        // Wire live issue updates — when IssueDataService polls new data,
        // update the read model directly AND emit to event store for
        // WebSocket subscribers (PAN-433).
        issueService.onIssuesChanged((issues) => {
          const cleaned = JSON.parse(JSON.stringify(issues));
          state = { ...state, issuesRaw: cleaned };

          // Emit issues.snapshot event to event store (async import to avoid circular deps)
          import('./event-store.js').then(({ getEventStore }) => {
            try {
              getEventStore().append({
                type: 'issues.snapshot',
                timestamp: new Date().toISOString(),
                payload: { issues: cleaned },
              } as any);
            } catch { /* event store not ready yet */ }
          }).catch(() => { /* module not loaded yet */ });
        });
      } catch {
        console.warn('[ReadModel] IssueDataService not available at bootstrap, starting with empty issues');
      }

      // ── Sequence from event store ────────────────────────────────────────────
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
        issuesRaw,
      };

      console.log(
        `[ReadModel] Bootstrapped: ${Object.keys(agentsById).length} agents, ` +
        `${Object.keys(specialistsByName).length} specialists, ` +
        `${Object.keys(reviewStatusByIssueId).length} review statuses, ` +
        `${issuesRaw.length} issues, seq=${sequence}`,
      );
    });

    return { getSnapshot, applyEvent, bootstrap: Effect.void };
  }),
);
