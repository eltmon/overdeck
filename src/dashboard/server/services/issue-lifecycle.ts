/**
 * IssueLifecycle Effect service (PAN-449)
 *
 * High-level issue state management that dispatches to the correct tracker
 * client (Linear, GitHub, Rally) based on the issue ID prefix.
 *
 * Routes should use IssueLifecycle instead of calling tracker clients directly.
 * The service handles:
 *   - State transitions (In Planning, In Progress, In Review, Done)
 *   - Label add/remove (GitHub only; no-op for Linear/Rally)
 *   - Issue close with label cleanup
 */

import { Effect, Layer, Option, Context } from 'effect';
import { resolveGitHubIssue, resolveTrackerType } from '../../../lib/tracker-utils.js';
import { GitHubClient } from './github-client.js';
import { GitHubClientOptionalLive } from './github-client.js';
import { LinearClient } from './linear-client.js';
import { LinearClientOptionalLive } from './linear-client.js';
import { RallyClient } from './rally-client.js';
import { RallyClientLive } from './rally-client.js';
import type { RallyClientShape } from './rally-client.js';
import type { LinearState } from './linear-client.js';
import { TrackerNotConfigured, TrackerApiError, IssueNotFound, RateLimited } from './typed-errors.js';
import { EventStoreService } from './domain-services.js';
import { getSharedIssueService } from './issue-service-singleton.js';

// ─── Event emission helper ────────────────────────────────────────────────────

/**
 * Attempt to emit a domain event via the shared event store.
 * Non-fatal: silently no-ops if EventStoreService is absent (e.g. in unit tests).
 */
function emitEvent(event: Record<string, unknown>): Effect.Effect<void, never> {
  return Effect.gen(function* () {
    const storeOption = yield* Effect.serviceOption(EventStoreService);
    if (Option.isSome(storeOption)) {
      yield* storeOption.value.append(event);
    }
  });
}

// ─── Types ────────────────────────────────────────────────────────────────────

export type IssueState = 'open' | 'in_planning' | 'in_progress' | 'in_review' | 'verifying_on_main' | 'closed' | 'canceled';

// ─── Service interface ────────────────────────────────────────────────────────

export interface IssueLifecycleShape {
  /**
   * Transition an issue to a new lifecycle state.
   *
   * For Linear: resolves the Linear state ID from team workflow.
   * For GitHub: adds/removes workflow labels (state change via labels).
   * For Rally: delegates to RallyClient.updateState.
   */
  readonly transitionTo: (
    issueId: string,
    state: IssueState,
  ) => Effect.Effect<
    void,
    TrackerNotConfigured | IssueNotFound | TrackerApiError | RateLimited
  >;

  /**
   * Add a label to an issue.
   * GitHub only: creates the label if it doesn't exist, then adds it.
   * Linear / Rally: no-op (trackers don't use workflow labels the same way).
   */
  readonly addLabel: (
    issueId: string,
    label: string,
  ) => Effect.Effect<void, TrackerNotConfigured | TrackerApiError | RateLimited>;

  /**
   * Remove a label from an issue.
   * GitHub only; non-fatal if label is not present.
   * Linear / Rally: no-op.
   */
  readonly removeLabel: (
    issueId: string,
    label: string,
  ) => Effect.Effect<void, TrackerNotConfigured | TrackerApiError | RateLimited>;

  /**
   * Close an issue and clean up workflow labels.
   *
   * - Transitions issue to 'closed' state.
   * - For GitHub: removes in-progress/in-review/planned labels.
   */
  readonly close: (
    issueId: string,
  ) => Effect.Effect<
    void,
    TrackerNotConfigured | IssueNotFound | TrackerApiError | RateLimited
  >;
}

// ─── Service tag ──────────────────────────────────────────────────────────────

export class IssueLifecycle extends Context.Service<IssueLifecycle, IssueLifecycleShape>()(
  'panopticon/dashboard/IssueLifecycle',
) {}

// ─── Linear state helpers ─────────────────────────────────────────────────────

/** Map a normalized IssueState to a Linear state type string. */
function linearStateType(state: IssueState): string {
  switch (state) {
    case 'open':
      return 'unstarted';
    case 'in_planning':
    case 'in_progress':
    case 'in_review':
    case 'verifying_on_main':
      return 'started';
    case 'closed':
      return 'completed';
    case 'canceled':
      return 'canceled';
  }
}

/** Find the best matching Linear state from a list given a target normalized state. */
function findLinearState(states: ReadonlyArray<LinearState>, state: IssueState): LinearState | null {
  if (state === 'in_review' || state === 'verifying_on_main') {
    const names = state === 'verifying_on_main'
      ? ['verifying on main', 'verifying', 'in review']
      : ['in review'];
    const explicit = states.find((s) => names.includes(s.name.toLowerCase()));
    if (explicit) return explicit;
    // Fall back to first "started" state
    return states.filter((s) => s.type === 'started')[0] ?? null;
  }

  if (state === 'in_planning') {
    // Prefer a state named "In Planning" or "Planning"
    const explicit = states.find(
      (s) => s.name.toLowerCase() === 'in planning' || s.name.toLowerCase() === 'planning',
    );
    if (explicit) return explicit;
    // Fall back to first "started" state
    return states.filter((s) => s.type === 'started')[0] ?? null;
  }

  const targetType = linearStateType(state);
  const matching = states.filter((s) => s.type === targetType);
  return matching[0] ?? null;
}

// ─── GitHub label helpers ─────────────────────────────────────────────────────

const GITHUB_STATE_LABELS: Record<IssueState, { add: string[]; remove: string[] }> = {
  open: { add: [], remove: ['in-progress', 'in-review', 'planned', 'in-planning', 'review-ready', 'done', 'merged', 'verifying-on-main', 'needs-close-out', 'closed-out', 'wontfix', 'duplicate'] },
  in_planning: { add: ['planned'], remove: ['in-progress', 'in-review', 'review-ready', 'done', 'merged', 'verifying-on-main', 'needs-close-out', 'closed-out', 'wontfix', 'duplicate'] },
  in_progress: { add: ['in-progress'], remove: ['planned', 'in-planning', 'in-review', 'review-ready', 'done', 'merged', 'verifying-on-main', 'needs-close-out', 'closed-out', 'wontfix', 'duplicate'] },
  in_review: { add: ['in-review'], remove: ['in-progress', 'planned', 'in-planning', 'done', 'merged', 'verifying-on-main', 'needs-close-out', 'closed-out', 'wontfix', 'duplicate'] },
  verifying_on_main: { add: ['verifying-on-main'], remove: ['in-progress', 'in-review', 'planned', 'in-planning', 'review-ready', 'ready-for-merge', 'done', 'needs-close-out', 'closed-out', 'wontfix', 'duplicate'] },
  closed: { add: [], remove: ['in-progress', 'in-review', 'planned', 'in-planning', 'review-ready', 'done', 'merged', 'verifying-on-main', 'needs-close-out', 'closed-out', 'wontfix', 'duplicate'] },
  canceled: { add: ['wontfix'], remove: ['in-progress', 'in-review', 'planned', 'in-planning', 'review-ready', 'done', 'merged', 'verifying-on-main', 'needs-close-out', 'closed-out', 'duplicate'] },
};

// ─── Live layer implementation ────────────────────────────────────────────────

/** Map IssueState to canonical status string for cache patching. */
function canonicalStatus(state: IssueState): string {
  switch (state) {
    case 'open': return 'open';
    case 'in_planning': return 'in_planning';
    case 'in_progress': return 'in_progress';
    case 'in_review': return 'in_review';
    case 'verifying_on_main': return 'verifying_on_main';
    case 'closed': return 'closed';
    case 'canceled': return 'canceled';
  }
}

export const IssueLifecycleLive = Layer.effect(
  IssueLifecycle,
  Effect.gen(function* () {
    const linear = yield* LinearClient;
    const github = yield* GitHubClient;
    const rally = yield* RallyClient;

    const impl: IssueLifecycleShape = {
      transitionTo: (issueId, state) =>
        Effect.gen(function* () {
          const trackerType = resolveTrackerType(issueId);

          if (trackerType === 'github') {
            // GitHub state is managed via labels
            const ghInfo = resolveGitHubIssue(issueId);
            if (!ghInfo.isGitHub) return;
            const labelOps = GITHUB_STATE_LABELS[state];
            for (const label of labelOps.add) {
              yield* github.addLabel(ghInfo.owner, ghInfo.repo, ghInfo.number, label);
            }
            for (const label of labelOps.remove) {
              yield* github.removeLabel(ghInfo.owner, ghInfo.repo, ghInfo.number, label);
            }
            if (state === 'closed' || state === 'canceled') {
              yield* github.closeIssue(ghInfo.owner, ghInfo.repo, ghInfo.number);
            } else {
              // Reopen the issue if it's currently closed (e.g. reopening after incorrect merge)
              yield* github.reopenIssue(ghInfo.owner, ghInfo.repo, ghInfo.number).pipe(
                Effect.catch(() => Effect.void) // Non-fatal if already open
              );
            }
          } else if (trackerType === 'rally') {
            const normalizedState =
              state === 'in_planning' || state === 'open' ? 'open'
              : state === 'in_progress' || state === 'in_review' || state === 'verifying_on_main' ? 'in_progress'
              : 'closed';
            yield* rally.updateState(issueId, normalizedState);
          } else {
            // Linear
            const issue = yield* linear.getIssue(issueId);
            const states = yield* linear.getTeamStates(issue.team.id);
            const target = findLinearState(states, state);
            // No-op if the issue is already in the target state
            if (target && issue.state?.id !== target.id) {
              yield* linear.updateState(issue.id, target.id);
            }
          }

          // Patch the in-memory cache and emit a domain event (non-fatal)
          yield* Effect.try({ try: () => getSharedIssueService().patchIssue(issueId, { canonicalStatus: canonicalStatus(state) }), catch: () => void 0 }).pipe(Effect.ignore);
          yield* emitEvent({
            type: 'issue.transitioned',
            timestamp: new Date().toISOString(),
            payload: { issueId, state },
          });
        }),

      addLabel: (issueId, label) =>
        Effect.gen(function* () {
          const trackerType = resolveTrackerType(issueId);
          if (trackerType !== 'github') return; // no-op for Linear/Rally

          const ghInfo = resolveGitHubIssue(issueId);
          if (!ghInfo.isGitHub) return;
          yield* github.addLabel(ghInfo.owner, ghInfo.repo, ghInfo.number, label);
        }),

      removeLabel: (issueId, label) =>
        Effect.gen(function* () {
          const trackerType = resolveTrackerType(issueId);
          if (trackerType !== 'github') return; // no-op for Linear/Rally

          const ghInfo = resolveGitHubIssue(issueId);
          if (!ghInfo.isGitHub) return;
          yield* github.removeLabel(ghInfo.owner, ghInfo.repo, ghInfo.number, label);
        }),

      close: (issueId) =>
        Effect.gen(function* () {
          const trackerType = resolveTrackerType(issueId);

          if (trackerType === 'github') {
            const ghInfo = resolveGitHubIssue(issueId);
            if (!ghInfo.isGitHub) return;
            // Remove workflow labels then close
            for (const label of ['in-progress', 'in-review', 'planned', 'in-planning', 'verifying-on-main', 'ready-for-merge']) {
              yield* github.removeLabel(ghInfo.owner, ghInfo.repo, ghInfo.number, label);
            }
            yield* github.closeIssue(ghInfo.owner, ghInfo.repo, ghInfo.number);
          } else if (trackerType === 'rally') {
            yield* rally.updateState(issueId, 'closed');
          } else {
            // Linear
            const issue = yield* linear.getIssue(issueId);
            const states = yield* linear.getTeamStates(issue.team.id);
            const target = findLinearState(states, 'closed');
            if (target) {
              yield* linear.updateState(issue.id, target.id);
            }
          }

          // Patch the in-memory cache and emit issue.closed domain event (non-fatal)
          yield* Effect.try({ try: () => getSharedIssueService().patchIssue(issueId, { canonicalStatus: 'closed' }), catch: () => void 0 }).pipe(Effect.ignore);
          yield* emitEvent({
            type: 'issue.closed',
            timestamp: new Date().toISOString(),
            payload: { issueId },
          });
        }),
    };

    return impl;
  }),
);

/**
 * Convenience layer that wires all tracker client dependencies.
 * Use this to provide IssueLifecycle without manually composing layers.
 */
export const IssueLifecycleWithClientLive = IssueLifecycleLive.pipe(
  Layer.provide(LinearClientOptionalLive),
  Layer.provide(GitHubClientOptionalLive),
  Layer.provide(
    // RallyClient is optional — provide a fallback that fails with TrackerNotConfigured
    Layer.effect(
      RallyClient,
      Effect.gen(function* () {
        // Dynamic: try to build RallyClientLive, fall back to stub if not configured
        return yield* Effect.gen(function* () {
          const { getRallyConfig } = yield* Effect.promise(() =>
            import('./tracker-config.js'),
          );
          const config = getRallyConfig();
          if (!config) {
            const fail = <A>(): Effect.Effect<A, TrackerNotConfigured> => Effect.fail(new TrackerNotConfigured({ tracker: 'rally' }));
            const fallback: RallyClientShape = {
              getIssue: () => fail(),
              getChildIssues: () => fail(),
              updateState: () => fail(),
              addComment: () => fail(),
            };
            return fallback;
          }
          // Delegate to RallyClientLive's logic
          return yield* RallyClient;
        }).pipe(Effect.provide(RallyClientLive));
      }),
    ),
  ),
);
