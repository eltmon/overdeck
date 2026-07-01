import { existsSync, readdirSync } from 'fs';
import { readdir } from 'fs/promises';
import { join } from 'path';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';
import { Effect } from 'effect';
import { AGENTS_DIR } from '../paths.js';
import { emitActivityEntrySync } from '../activity-logger.js';
import { getAgentRuntimeStateSync, getAgentStateSync, listRunningAgentsSync, type AgentState } from '../agents.js';
import { withConcurrencyLimit } from '../concurrency.js';
import { loadReviewStatuses, setReviewStatusSync, reviewGatesPassedSync } from '../review-status.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';
import { sessionExistsSync, sendKeys } from '../tmux.js';
import { isAgentIdleForNudge } from './agent-idle.js';
import { loadCloisterConfig } from './config.js';
import { getAutoCloseOutCanonicalState, sweepAutoCloseOutCache } from './deacon-canonical-state.js';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);

interface MergeReminderState {
  mergeStuckAttempts?: Record<string, number>;
}

export interface MergeReadyReminderDeps<State extends MergeReminderState = MergeReminderState> {
  loadState: () => State;
  saveState: (state: State) => void;
  hasMergeReadyNotifier: () => boolean;
  notifyMergeReady: (issueId: string) => void;
}

// ============================================================================
// CI transient retry tracking (shared by checkPostReviewCommits + checkFailedMergeRetry)
// ============================================================================

// In-memory CI failure retry tracking — separate from mergeRetryCount because
// CI failures are transient and should not permanently block merge attempts.
// Declared here so checkPostReviewCommits can clear it when new commits arrive.
export const ciRetryMap = new Map<string, { count: number; lastAttempt: number }>();

// ============================================================================
// Ready-for-merge stuck detection (PAN-344)
// ============================================================================

// Minimum age (ms) of a readyForMerge status before deacon sends a merge-ready reminder.
// This is NOT a stuck detection — it's a courtesy notification that a merge is waiting
// for the human to click MERGE. One hour is reasonable; the human may be reviewing,
// working on other things, or intentionally waiting.
const MERGE_READY_REMINDER_MS = 60 * 60 * 1000; // 1 hour
// Minimum wait (ms) between successive merge-ready reminders for the same issue
const MERGE_READY_REMINDER_COOLDOWN_MS = 60 * 60 * 1000; // 1 hour
// Circuit breaker: stop reminding after this many times (per server lifetime)
const MERGE_READY_REMINDER_MAX = 3;

// In-memory cooldowns for stuck-merge detection (reset on server restart is acceptable —
// cooldowns are a performance optimisation, not critical state)
const mergeStuckCooldowns = new Map<string, number>();

/**
 * Safety-net patrol: find issues that are readyForMerge but not yet merging/merged
 * and whose readyForMerge status is older than MERGE_STUCK_STALENESS_MS.
 *
 * Previously this auto-triggered the merge API. Now it is notify-only: it emits
 * a merge:ready Socket.io event so the dashboard can prompt the user to click
 * the MERGE button. The MERGE button is the sole merge trigger (PAN-354).
 *
 * Guards:
 *   - Staleness: status must be at least 2 min old (avoids racing with primary trigger)
 *   - Per-issue cooldown: 10 min between successive attempts
 *   - Circuit breaker: max 3 attempts per issue per process lifetime
 */
export async function checkReadyForMergeStuck<State extends MergeReminderState>(deps: MergeReadyReminderDeps<State>): Promise<string[]> {
  const actions: string[] = [];

  try {
    const statuses = loadReviewStatuses();

    const now = Date.now();
    const state = deps.loadState();
    const attemptCounts = state.mergeStuckAttempts ?? {};
    let stateModified = false;

    for (const [key, status] of Object.entries(statuses)) {
      // Only act on issues that are ready but not yet merging/merged/failed
      if (!status.readyForMerge) continue;
      if (status.mergeStatus === 'merging' || status.mergeStatus === 'merged' || status.mergeStatus === 'failed') continue;

      // Wait at least 1 hour before sending a merge-ready reminder.
      // The human controls when to merge — this is just a courtesy notification.
      if (!status.updatedAt) continue;
      const statusAge = now - new Date(status.updatedAt).getTime();
      if (statusAge < MERGE_READY_REMINDER_MS) continue;

      // Per-issue cooldown (in-memory — reset on restart is acceptable for a rate-limiter)
      const lastAttempt = mergeStuckCooldowns.get(key);
      if (lastAttempt && (now - lastAttempt) < MERGE_READY_REMINDER_COOLDOWN_MS) continue;

      // Circuit breaker (persisted to deacon state so restart doesn't reset the count)
      const attempts = attemptCounts[key] ?? 0;
      if (attempts >= MERGE_READY_REMINDER_MAX) continue;

      const ageHours = Math.round((now - new Date(status.updatedAt).getTime()) / 3600000 * 10) / 10;
      console.log(`[deacon] Merge-ready reminder for ${key} (ready for ${ageHours}h, reminder ${attempts + 1}/${MERGE_READY_REMINDER_MAX})`);

      // Record attempt before notifying so a crash doesn't leave us in a retry loop
      mergeStuckCooldowns.set(key, now);
      attemptCounts[key] = attempts + 1;
      stateModified = true;

      // Notify the dashboard via Socket.io so the user knows to click MERGE.
      // Auto-triggering merge was removed in PAN-354; the MERGE button is the sole trigger.
      const msg = `Merge ready: ${key} has been waiting for merge for ${ageHours}h — click MERGE when ready`;
      if (deps.hasMergeReadyNotifier()) {
        deps.notifyMergeReady(status.issueId ?? key);
        actions.push(msg);
        console.log(`[deacon] merge:ready notification sent for ${key}`);
      } else {
        actions.push(msg);
        console.warn(`[deacon] No mergeReadyNotifier registered — dashboard will not be notified for ${key}`);
      }
    }

    // Persist updated attempt counts so circuit breaker survives server restarts
    if (stateModified) {
      state.mergeStuckAttempts = attemptCounts;
      deps.saveState(state);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error in checkReadyForMergeStuck:', msg);
  }

  return actions;
}

/**
 * Detect issues whose feature branch is merged to main but mergeStatus is stale.
 * Happens when a merge bypasses the dashboard (manual git merge, direct push, or
 * deploy script crash). Sets mergeStatus='merged' so the dashboard shows the
 * correct state and close-out can proceed.
 */
const staleMergeReconciled = new Set<string>();

export async function reconcileStaleMergeStatus(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const statuses = loadReviewStatuses();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.mergeStatus === 'merged') continue;
      if (staleMergeReconciled.has(issueId)) continue;

      const project = resolveProjectFromIssueSync(issueId);
      if (!project) continue;

      // Closed-out issues are TERMINAL: close-out flips the spec to
      // completed/cancelled and clears review status. Treating the cleared/
      // resurrected row as "stale" here re-fires the post-merge handoff,
      // which REOPENS the closed tracker issue (PAN-1190, 2026-06-11).
      try {
        const { findSpecByIssue } = await import('../pan-dir/specs.js');
        const spec = await Effect.runPromise(findSpecByIssue(project.projectPath, issueId));
        if (spec && (spec.status === 'completed' || spec.status === 'cancelled')) {
          staleMergeReconciled.add(issueId);
          continue;
        }
      } catch {
        // Spec unreadable — fall through to the normal checks.
      }

      const branch = `feature/${issueId.toLowerCase()}`;
      let isMerged = false;

      // Check 1: diagnostic only. Branch topology alone is not proof of a
      // completed pipeline merge: a branch created at main with no
      // implementation commits also satisfies merge-base --is-ancestor. Keep
      // the stale-merge reconciler PR-backed so re-planning cannot
      // phantom-merge an already planned issue.
      try {
        const [branchTip, mainTip] = await Promise.all([
          execFileAsync('git', ['rev-parse', branch], { cwd: project.projectPath }),
          execFileAsync('git', ['rev-parse', 'main'], { cwd: project.projectPath }),
        ]);
        if (branchTip.stdout.trim() === mainTip.stdout.trim()) {
          console.log(`[deacon] ${issueId}: branch ${branch} points at main; not treating zero-commit branch as merged`);
        }
      } catch {
        // Branch is absent/unreadable — leave merge detection to the PR API.
      }

      // Check 2: query GitHub for PR mergedAt/mergeCommit. The
      // old regex-based detection (`\(PAN-XXXX[ )]` against `git log --pretty=%s`)
      // matched ANY commit that mentioned the issue in a trailer, not just
      // genuine squash merges. That's how PAN-977/945/913/544/457 got
      // mergeStatus=merged and rolled into close-out without an actual merge:
      // unrelated commits landed on main with `(PAN-977)` references and the
      // deacon trusted them. GitHub's API is the only authoritative source.
      if (!isMerged) {
        const { resolveGitHubIssueSync: _resolveGitHubIssue } = await import('../tracker-utils.js');
        const ghResolved = _resolveGitHubIssue(issueId);
        if (ghResolved.isGitHub) {
          try {
            const repoArg = `${ghResolved.owner}/${ghResolved.repo}`;
            const { stdout } = await execFileAsync(
              'gh', ['pr', 'list', '--repo', repoArg, '--head', branch, '--state', 'all', '--json', 'number,mergedAt,mergeCommit', '--limit', '5'],
              { cwd: project.projectPath },
            );
            const prs = JSON.parse(stdout || '[]') as Array<{ number: number; mergedAt: string | null; mergeCommit: unknown | null }>;
            if (prs.some((pr) => pr.mergedAt || pr.mergeCommit)) {
              isMerged = true;
            }
          } catch {
            // gh query failed — leave isMerged as false rather than guess.
          }
        }
      }

      if (isMerged) {
        // PAN-1994: Skip the entire reconcile (including setReviewStatusSync) if
        // a planning or work agent is actively running. Setting mergeStatus=merged
        // while a fresh re-plan is in progress would contaminate the new pipeline
        // cycle with stale prior-merge state. Leave staleMergeReconciled unset so
        // the next patrol re-evaluates once the active agent has finished.
        const issueLower = issueId.toLowerCase();
        const planState = getAgentStateSync(`planning-${issueLower}`);
        const workState = getAgentStateSync(`agent-${issueLower}`);
        const hasActiveAgent =
          planState?.status === 'running' || planState?.status === 'starting' ||
          workState?.status === 'running' || workState?.status === 'starting';

        if (hasActiveAgent) {
          console.log(`[deacon] ${issueId}: active agent in progress — deferring stale-merge reconcile (PAN-1994)`);
          continue;
        }

        setReviewStatusSync(issueId, { mergeStatus: 'merged', readyForMerge: false });
        staleMergeReconciled.add(issueId);
        const msg = `Reconciled stale mergeStatus for ${issueId} — branch ${branch} is merged to main`;
        actions.push(msg);
        console.log(`[deacon] ${msg}`);

        // PAN-1027: also run the post-merge handoff so labels get cleaned, work
        // agent tmux session is killed, beads compacted, etc. Without this the
        // dashboard knows the issue is merged but GitHub labels stay stale
        // ("in-progress"/"in-review") and orphaned tmux sessions leak memory.
        // skipDeploy avoids respawning the server — best-effort reconciliation.
        try {
          const { postMergeLifecycle } = await import('./merge-agent.js');
          postMergeLifecycle(issueId, project.projectPath, branch, { skipDeploy: true }).catch(err =>
            console.warn(`[deacon] postMergeLifecycle (reconcile) failed for ${issueId}: ${err}`)
          );
        } catch (err) {
          console.warn(`[deacon] Could not import postMergeLifecycle: ${err}`);
        }
      }
    }
  } catch (err: unknown) {
    console.warn(`[deacon] Error in reconcileStaleMergeStatus: ${err instanceof Error ? err.message : String(err)}`);
  }
  return actions;
}
/**
 * PAN-1027 reverse direction: detect issues whose internal mergeStatus='merged' but
 * whose GitHub PR is NOT merged (open, closed-without-merge, or reverted). When the
 * dashboard previously detected a merge that later got reverted (or the deacon's
 * forward-direction reconciler matched a squash-commit grep that wasn't actually a
 * merge), the issue gets stuck because every gate that checks `mergeStatus !== 'merged'`
 * skips it. This sweep resets the stale merged status so the issue can flow through
 * the pipeline again.
 */
const falseMergedReset = new Set<string>();

export async function reconcileFalseMerged(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { getPullRequestState, isGitHubAppConfigured } = await import('../github-app.js');
    if (!isGitHubAppConfigured()) return actions;

    const statuses = loadReviewStatuses();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.mergeStatus !== 'merged') continue;
      if (!status.prUrl) continue;
      if (falseMergedReset.has(issueId)) continue;

      const prRef = status.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!prRef) continue;

      try {
        const prState = await Effect.runPromise(getPullRequestState(prRef[1], prRef[2], Number.parseInt(prRef[3], 10)));
        if (!prState.merged) {
          // GitHub says not merged but our DB says merged — reset internal state.
          // Leave reviewStatus alone (it may legitimately be passed/failed/blocked from
          // the prior cycle); the issue can proceed through the pipeline once mergeStatus
          // is no longer blocking.
          setReviewStatusSync(issueId, { mergeStatus: 'pending' });
          falseMergedReset.add(issueId);
          const msg = `Reset stale mergeStatus=merged for ${issueId} — PR ${status.prUrl} is not merged on GitHub`;
          actions.push(msg);
          console.log(`[deacon] ${msg}`);
        }
      } catch (err: unknown) {
        // Non-fatal: GitHub API hiccup. Try again next patrol.
        console.warn(`[deacon] Failed false-merged check for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } catch (err: unknown) {
    console.warn(`[deacon] Error in reconcileFalseMerged: ${err instanceof Error ? err.message : String(err)}`);
  }
  return actions;
}
/**
 * Detect issues whose merge_status='merged' but review_status is still in a
 * non-terminal state (reviewing, pending, etc.). If the merge actually
 * happened, the review must have passed at some point even if the dashboard
 * missed the transition (e.g. coordinator crashed mid-run, dashboard restart
 * dropped an in-flight update). Reconciling to review_status='passed' clears
 * the "running reviewers with no data" UI state PAN-1028 reproduced.
 */
const mergedReviewingReconciled = new Set<string>();
/**
 * Per-issue throttle for the closed-PR readyForMerge reconciler so a transient
 * GitHub API failure doesn't burn the rate budget on the same issues every
 * patrol. Cleared when the issue's state changes.
 */
const closedPrReadyReconcileCooldowns = new Map<string, number>();
const CLOSED_PR_RECONCILE_COOLDOWN_MS = 10 * 60 * 1000;/**
 * Reconciler: issues with readyForMerge=true whose PR is no longer OPEN.
 *
 * The "Awaiting Merge" view filters on readyForMerge=true, so an issue whose
 * PR was closed without merging (cancel-flow, manual `gh pr close`, branch
 * deleted) stays in that list forever — the merge button points at a dead PR
 * and would only get cleared the next time the user clicks it (PAN-509-style
 * defensive check in `/api/issues/:id/merge`). That UX is bad: the page
 * actively lies to the human about what's ready to ship.
 *
 * This patrol catches it proactively: for every readyForMerge=true issue with
 * a GitHub PR URL, ask the forge for the current PR state. If MERGED, flip
 * mergeStatus to 'merged' (post-merge lifecycle catches up elsewhere). If
 * CLOSED-without-merge, reset readyForMerge=false and surface why on
 * mergeNotes so the human sees what happened instead of a missing button.
 */
export async function reconcileClosedPrReadyForMerge(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { getPullRequestState, isGitHubAppConfigured } = await import('../github-app.js');
    if (!isGitHubAppConfigured()) return actions;

    const statuses = loadReviewStatuses();
    const now = Date.now();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (!status.readyForMerge) continue;
      if (!status.prUrl) continue;

      const cooledUntil = closedPrReadyReconcileCooldowns.get(issueId);
      if (cooledUntil && now < cooledUntil) continue;

      const match = status.prUrl.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
      if (!match) continue;
      const [, owner, repo, numberStr] = match;
      const prNumber = parseInt(numberStr, 10);
      if (!Number.isFinite(prNumber)) continue;

      try {
        const prState = await Effect.runPromise(getPullRequestState(owner, repo, prNumber));
        if (prState.state === 'OPEN' && !prState.merged) continue;

        if (prState.merged) {
          setReviewStatusSync(issueId, {
            readyForMerge: false,
            mergeStatus: 'merged',
            mergeNotes: undefined,
          });
          const msg = `Reset readyForMerge for ${issueId} — PR #${prNumber} is already merged`;
          actions.push(msg);
          console.log(`[deacon] ${msg}`);
        } else {
          setReviewStatusSync(issueId, {
            readyForMerge: false,
            mergeStatus: 'failed',
            mergeNotes: `PR #${prNumber} was closed without merging — reopen the PR or reset review state to re-queue this issue`,
          });
          const msg = `Reset readyForMerge for ${issueId} — PR #${prNumber} is ${prState.state} (not OPEN)`;
          actions.push(msg);
          console.log(`[deacon] ${msg}`);
        }
        // Don't re-check for 10 min even if state somehow gets re-set.
        closedPrReadyReconcileCooldowns.set(issueId, now + CLOSED_PR_RECONCILE_COOLDOWN_MS);
      } catch (prErr: unknown) {
        // Throttle on API failure so we don't hammer GitHub.
        closedPrReadyReconcileCooldowns.set(issueId, now + CLOSED_PR_RECONCILE_COOLDOWN_MS);
        console.warn(`[deacon] reconcileClosedPrReadyForMerge: ${issueId} PR state lookup failed: ${prErr instanceof Error ? prErr.message : String(prErr)}`);
      }
    }
  } catch (err: unknown) {
    console.warn(`[deacon] Error in reconcileClosedPrReadyForMerge: ${err instanceof Error ? err.message : String(err)}`);
  }
  return actions;
}

const staleMergeBlockerCooldowns = new Map<string, number>();
const STALE_MERGE_BLOCKER_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes

/**
 * Reconciler: re-evaluate stale merge-blockers so resolved conflicts unstick.
 *
 * resolveConflictGate() already clears a stale merge_conflict/not_mergeable
 * blocker once the branch is mergeable against main again — but it only runs
 * on-demand from the review-dispatch routes. An issue that picks up a
 * merge-blocker (so readyForMerge stays false) and then falls out of the active
 * review flow is therefore never re-evaluated: the blocker persists forever and
 * the merge train never picks it up. That is the "stuck after review" failure
 * mode (PAN-2143) — a PR that was conflicting while main moved stays blocked
 * even after the conflict is resolved.
 *
 * This patrol runs resolveConflictGate for every in-pipeline issue still
 * carrying a merge-blocker. When the branch became mergeable again it clears the
 * stale blocker (which lets setReviewStatus recompute readyForMerge so the merge
 * train resumes); when the branch is genuinely conflicting, resolveConflictGate
 * dispatches the conflict resolver on its existing throttle. A per-issue 2-min
 * cooldown bounds the git-probe cost; resolveConflictGate also caches its
 * mergeability probe.
 */
export async function reconcileStaleMergeBlockers(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const { resolveConflictGate, buildRealConflictGateDeps } = await import('./conflict-gate.js');
    const statuses = loadReviewStatuses();
    const now = Date.now();
    const deps = buildRealConflictGateDeps();

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.mergeStatus === 'merged') continue;
      const hasMergeBlocker = (status.blockerReasons ?? []).some(
        (b) => b.type === 'merge_conflict' || b.type === 'not_mergeable',
      );
      if (!hasMergeBlocker) continue;

      const cooledUntil = staleMergeBlockerCooldowns.get(issueId);
      if (cooledUntil && now < cooledUntil) continue;
      staleMergeBlockerCooldowns.set(issueId, now + STALE_MERGE_BLOCKER_COOLDOWN_MS);

      const resolved = resolveProjectFromIssueSync(issueId);
      if (!resolved) continue;
      const workspacePath = join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
      if (!existsSync(workspacePath)) continue;

      try {
        const result = await resolveConflictGate(issueId, workspacePath, 'main', deps);
        if (result.clearedStaleBlocker) {
          const msg = `Cleared stale merge blocker for ${issueId} — branch is mergeable again; readyForMerge will recompute`;
          actions.push(msg);
          console.log(`[deacon] ${msg}`);
        }
      } catch (gateErr: unknown) {
        console.warn(`[deacon] reconcileStaleMergeBlockers: ${issueId} conflict-gate failed: ${gateErr instanceof Error ? gateErr.message : String(gateErr)}`);
      }
    }
  } catch (err: unknown) {
    console.warn(`[deacon] Error in reconcileStaleMergeBlockers: ${err instanceof Error ? err.message : String(err)}`);
  }
  return actions;
}

/**
 * Reconciler (PAN-2198): periodic twin of the boot-only fixStuckReadyForMerge,
 * for the NO-BLOCKER strand of "stuck after review".
 *
 * readyForMerge is re-derived on every setReviewStatusSync write. When the last
 * write left it false and there is NO merge-blocker, nothing re-derives it until
 * the next write — so a PR whose review+test+verify all passed but whose
 * readyForMerge was left false (e.g. a verdict that landed via a write path that
 * didn't recompute, or a gate that was transiently non-final) converges ONLY on
 * server restart (PAN-1758: "readyForMerge only flips via the startup repair
 * sweep"). This patrol re-derives it on the 60s deacon tick instead.
 *
 * Blocker strands are deliberately excluded — those are owned by
 * reconcileStaleMergeBlockers, and excluding them also avoids fighting the
 * setReviewStatus deriver's hasBlockers override (which would flip readyForMerge
 * straight back to false). Loop-safe: it writes ONLY readyForMerge (no
 * review/test status transition, so no review/test re-dispatch events fire), and
 * is idempotent — once flipped true, the readyForMerge!==false guard excludes the
 * issue, so steady state is zero writes. Flipping readyForMerge=true only makes
 * the issue merge-ELIGIBLE; the merge train / MERGE button remains the trigger.
 */
export function reconcileStuckReadyForMerge(): string[] {
  const actions: string[] = [];
  try {
    for (const [issueId, status] of Object.entries(loadReviewStatuses())) {
      if (status.readyForMerge !== false) continue;
      if ((status.blockerReasons?.length ?? 0) > 0) continue; // blocker strand → reconcileStaleMergeBlockers
      if (!reviewGatesPassedSync(status)) continue;
      setReviewStatusSync(issueId, { readyForMerge: true });
      const msg = `Restored readyForMerge for ${issueId} — review+test+verify passed, no blocker (was stuck false)`;
      actions.push(msg);
      console.log(`[deacon] ${msg}`);
    }
  } catch (err: unknown) {
    console.warn(`[deacon] Error in reconcileStuckReadyForMerge: ${err instanceof Error ? err.message : String(err)}`);
  }
  return actions;
}

export async function reconcileMergedButReviewing(): Promise<string[]> {
  const actions: string[] = [];
  try {
    const statuses = loadReviewStatuses();
    const nonTerminal = new Set(['reviewing', 'pending', undefined, null]);

    for (const [issueId, status] of Object.entries(statuses)) {
      if (status.mergeStatus !== 'merged') continue;
      const reviewNonTerminal = nonTerminal.has(status.reviewStatus as string | undefined);
      const testNonTerminal = nonTerminal.has(status.testStatus as string | undefined);
      if (!reviewNonTerminal && !testNonTerminal) continue;
      if (mergedReviewingReconciled.has(issueId)) continue;

      // Set BOTH review and test to 'passed' atomically. Setting only review='passed'
      // trips the canSkipTests dispatch path in setReviewStatus and spawns a test-agent
      // for an already-merged issue — pure waste. The merge is terminal, no test needed.
      setReviewStatusSync(issueId, {
        reviewStatus: 'passed',
        testStatus: 'passed',
        testNotes: status.testNotes ?? 'Skipped: issue is already merged',
      });
      mergedReviewingReconciled.add(issueId);
      const msg = `Reconciled review_status=${status.reviewStatus ?? 'null'}, test_status=${status.testStatus ?? 'null'} → passed for ${issueId} (merge_status=merged is terminal)`;
      actions.push(msg);
      console.log(`[deacon] ${msg}`);
    }
  } catch (err: unknown) {
    console.warn(`[deacon] Error in reconcileMergedButReviewing: ${err instanceof Error ? err.message : String(err)}`);
  }
  return actions;
}

// Track per-issue cooldowns for failed-merge retry to avoid rapid re-queuing
const failedMergeRetryCooldowns = new Map<string, number>();
// Track per-issue cooldowns for timeout nudges to avoid spamming the work agent
const timeoutNudgeCooldowns = new Map<string, number>();

// Minimum time (ms) after merge failure before attempting a retry
const FAILED_MERGE_RETRY_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
// Minimum time (ms) between timeout nudges to the same work agent
const TIMEOUT_NUDGE_COOLDOWN_MS = 30 * 60 * 1000; // 30 minutes
// Shorter cooldown for CI-transient failures (pending checks that resolve quickly)
const CI_TRANSIENT_RETRY_COOLDOWN_MS = 2 * 60 * 1000; // 2 minutes
// Max number of automatic retries before requiring manual intervention
export const FAILED_MERGE_MAX_RETRIES = 3;

/**
 * Auto-retry issues whose mergeStatus='failed' due to transient post-rebase
 * verification failures (e.g. flaky tests or tests fixed on main after failure).
 *
 * CI check failures (pending/failing) are handled differently from real merge
 * failures: they may resolve without any code change (e.g. CI queue clears,
 * GitHub status updates). These get a separate retry mechanism with a shorter
 * cooldown (2 min) and their own counter — they do NOT saturate mergeRetryCount.
 *
 * When review+test both passed but the post-rebase gate failed, the issue is
 * stuck: the deacon's merge-ready loop skips mergeStatus='failed' entries and
 * there is no other retry mechanism. After a 30-min cooldown, this patrol resets
 * the issue to readyForMerge=true so it reappears on the Awaiting Merge page.
 *
 * Guards:
 *   - Review + test must both be 'passed' (don't retry if code quality failed)
 *   - 30-min per-issue cooldown for non-CI failures, 2-min for CI transient
 *   - Circuit breaker: max 3 retries (mergeRetryCount) for non-CI
 *   - CI transient failures: max 5 retries with flat 2-minute cooldown
 */
export async function checkFailedMergeRetry(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const statuses = loadReviewStatuses();

    const now = Date.now();

    for (const [key, status] of Object.entries(statuses)) {
      // Only act on issues where merge failed but review+test both passed
      if (status.mergeStatus !== 'failed') continue;
      if (status.reviewStatus !== 'passed' || status.testStatus !== 'passed') continue;

      const isCiCheckFailure = typeof status.mergeNotes === 'string' &&
        status.mergeNotes.includes('failing required checks');
      const issueId = status.issueId || key;

      if (isCiCheckFailure) {
        // CI failures may be transient (pending checks, GitHub status lag).
        // Use a separate retry counter that does NOT saturate mergeRetryCount.
        const ciEntry = ciRetryMap.get(issueId) ?? { count: 0, lastAttempt: 0 };
        const timeSinceLastCi = now - ciEntry.lastAttempt;

        if (ciEntry.count >= 5) {
          // After 5 CI retries, back off to avoid hammering GitHub API.
          // Notify the work agent exactly once (when count first reaches 5) so it
          // can investigate rather than silently dead-ending the issue.
          if (ciEntry.count === 5) {
            console.log(`[deacon] CI check failure for ${issueId} — retries exhausted, notifying work agent`);
            const ciNotes = status.mergeNotes || 'CI checks are failing on the PR';
            const { writeFeedbackFile } = await import('./feedback-writer.js');
            const ciFileResult = await Effect.runPromise(writeFeedbackFile({
              issueId,
              specialist: 'merge-agent',
              outcome: 'ci-failure',
              summary: 'CI checks still failing after 5 transient retries — merge blocked',
              markdownBody: `## CI Check Failure — Merge Blocked\n\n${ciNotes}\n\n### Action Required\n\nFix the failing CI checks, commit, and push. Overdeck will detect the new commits and re-run the review pipeline automatically.\n\nAlternatively:\n\n\`\`\`\npan done ${issueId}\n\`\`\``,
            }).pipe(Effect.catch((err) => {
              console.error(`[deacon] Failed to write CI failure feedback for ${issueId}:`, err instanceof Error ? err.message : String(err));
              return Effect.succeed({ success: false, error: err instanceof Error ? err.message : String(err) });
            })));
            const agentSession = `agent-${issueId.toLowerCase()}`;
            if (sessionExistsSync(agentSession)) {
              const ciPath = (ciFileResult as { filePath?: string } | undefined)?.filePath;
              const ciMsg = ciPath
                ? `CI checks are failing on the PR after 5 retries.\n\nMUST READ: ${ciPath}\n\nFix the failures, commit, then run: pan done ${issueId}`
                : `CI checks are failing on the PR after 5 retries. Fix the failures, commit, then run: pan done ${issueId}`;
              await Effect.runPromise(sendKeys(agentSession, ciMsg));
            }
            ciEntry.count++; // increment past 5 so this block only fires once
            ciRetryMap.set(issueId, ciEntry);
            actions.push(`CI retry exhausted for ${issueId} — wrote feedback, notified agent`);
          } else {
            console.log(`[deacon] CI check failure for ${issueId} — max retries (5) exhausted, awaiting agent fix`);
          }
          continue;
        }
        if (timeSinceLastCi < CI_TRANSIENT_RETRY_COOLDOWN_MS) {
          continue; // still in cooldown
        }

        ciEntry.count++;
        ciEntry.lastAttempt = now;
        ciRetryMap.set(issueId, ciEntry);

        // Notify the work agent to re-submit via pan done, which re-enters the merge
        // queue from scratch. Merge is user-triggered (PAN-354) — deacon cannot
        // auto-retry; the agent must run pan done to create a fresh merge attempt.
        console.log(`[deacon] CI check failure for ${issueId} — notifying agent to re-submit (attempt ${ciEntry.count}/5)`);
        const ciNotes = status.mergeNotes || 'CI checks are failing on the PR';
        const { writeFeedbackFile } = await import('./feedback-writer.js');
        const ciFileResult2 = await Effect.runPromise(writeFeedbackFile({
          issueId,
          specialist: 'merge-agent',
          outcome: 'ci-failure',
          summary: 'CI checks failed at merge — re-submit to re-enter merge queue',
          markdownBody: `## CI Check Failure\n\n${ciNotes}\n\nCI checks failed at merge time. This may be transient (pending checks, GitHub status lag). Re-submit to re-enter the merge queue:\n\n\`\`\`\npan done ${issueId}\n\`\`\``,
        }).pipe(Effect.catch((err) => {
          console.error(`[deacon] Failed to write CI failure feedback for ${issueId}:`, err instanceof Error ? err.message : String(err));
          return Effect.succeed({ success: false, error: err instanceof Error ? err.message : String(err) });
        })));
        const agentSessionCi = `agent-${issueId.toLowerCase()}`;
        if (sessionExistsSync(agentSessionCi)) {
          const ciPath2 = (ciFileResult2 as { filePath?: string } | undefined)?.filePath;
          const ciMsg2 = ciPath2
            ? `CI checks failed on the PR for ${issueId}. This may be transient.\n\nMUST READ: ${ciPath2}\n\nFix any failures, commit, then run: pan done ${issueId}`
            : `CI checks failed on the PR for ${issueId}. This may be transient. Fix any failures, commit, then run: pan done ${issueId}`;
          await Effect.runPromise(sendKeys(agentSessionCi, ciMsg2));
        }
        actions.push(`CI failure notification for ${issueId} (attempt ${ciEntry.count}/5)`);
        continue;
      }

      // Timeout failures: the work agent didn't finish the rebase in time.
      // Write feedback and nudge the agent so it knows to continue/finish the rebase.
      // Then retry so the merge can proceed once the agent pushes.
      const isTimeoutFailure = typeof status.mergeNotes === 'string' &&
        (status.mergeNotes.includes('did not push') || status.mergeNotes.includes('stopped before completing'));
      if (isTimeoutFailure) {
        const issueIdForFb = status.issueId || key;
        const lastNudge = timeoutNudgeCooldowns.get(issueIdForFb);
        if (!lastNudge || (now - lastNudge) >= TIMEOUT_NUDGE_COOLDOWN_MS) {
          const timeoutNotes = status.mergeNotes!;
          const { writeFeedbackFile } = await import('./feedback-writer.js');
          await Effect.runPromise(writeFeedbackFile({
            issueId: issueIdForFb,
            specialist: 'merge-agent',
            outcome: 'timeout',
            summary: 'Merge timed out waiting for rebase — please rebase and push',
            markdownBody: `## Merge Timed Out — Rebase Required\n\n${timeoutNotes}\n\n### Action Required\n\nThe merge was requested but the rebased branch was not pushed in time. Please:\n\n1. Run \`git fetch origin\` and \`git rebase origin/main\` (or the target branch)\n2. Resolve any conflicts\n3. Run \`git push --force-with-lease\`\n4. Run \`pan done ${issueIdForFb}\`\n\nAfter pushing, the merge will be retried automatically.`,
          }).pipe(Effect.catch((err) => {
            console.error(`[deacon] Failed to write timeout feedback for ${issueIdForFb}:`, err instanceof Error ? err.message : String(err));
            return Effect.void;
          })));
          const agentSession = `agent-${issueIdForFb.toLowerCase()}`;
          if (sessionExistsSync(agentSession)) {
            await Effect.runPromise(sendKeys(agentSession,
              `Merge timed out — the rebased branch was not pushed in time. Please rebase onto the target branch, resolve any conflicts, push with --force-with-lease, then run "pan done ${issueIdForFb}". After pushing, the merge will proceed automatically.`
            ));
          }
          timeoutNudgeCooldowns.set(issueIdForFb, now);
          actions.push(`Timeout failure for ${issueIdForFb} — wrote feedback, nudged work agent`);
        } else {
          actions.push(`Timeout failure for ${issueIdForFb} — nudge on cooldown (${Math.round((now - lastNudge) / 60000)}m ago)`);
        }
      }

      // Circuit breaker: max retries to avoid infinite loop on permanent failures
      const retryCount = status.mergeRetryCount || 0;
      if (retryCount >= FAILED_MERGE_MAX_RETRIES) {
        console.log(`[deacon] Failed-merge circuit breaker for ${key} (${retryCount}/${FAILED_MERGE_MAX_RETRIES} retries used)`);
        continue;
      }

      // Cooldown: wait at least 30 min after the merge failure before retrying
      if (status.updatedAt) {
        const statusAge = now - new Date(status.updatedAt).getTime();
        if (statusAge < FAILED_MERGE_RETRY_COOLDOWN_MS) continue;
      }

      // Per-issue in-memory cooldown to avoid re-triggering on the same patrol cycle
      const lastRetry = failedMergeRetryCooldowns.get(key);
      if (lastRetry && (now - lastRetry) < FAILED_MERGE_RETRY_COOLDOWN_MS) continue;

      failedMergeRetryCooldowns.set(key, now);

      const nextRetry = retryCount + 1;
      console.log(`[deacon] Auto-retrying failed merge for ${issueId} (attempt ${nextRetry}/${FAILED_MERGE_MAX_RETRIES})`);

      setReviewStatusSync(issueId, {
        mergeStatus: 'pending',
        readyForMerge: true,
        mergeRetryCount: nextRetry,
      });

      actions.push(`Reset failed merge for ${issueId} — retry ${nextRetry}/${FAILED_MERGE_MAX_RETRIES} (readyForMerge restored)`);
    }
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('[deacon] Error in checkFailedMergeRetry:', msg);
  }

  return actions;
}


// Track per-agent cooldowns for first-completion nudges
const firstCompletionCooldowns = new Map<string, number>();
const FIRST_COMPLETION_IDLE_MS = 10 * 60 * 1000; // 10 minutes idle before nudging
const FIRST_COMPLETION_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes between nudges
function recordAutoCloseOutFailure(issueId: string, message: string): void {
  console.warn(`[deacon] Auto close-out failed for ${issueId}: ${message}`);
  setReviewStatusSync(issueId, {
    mergeNotes: `Auto close-out failed: ${message}`,
    updatedAt: new Date().toISOString(),
  });
  emitActivityEntrySync({
    source: 'cloister',
    level: 'warn',
    issueId,
    message: `Auto close-out failed for ${issueId}: ${message}`,
  });
}

export async function autoCloseOut(now = new Date()): Promise<string[]> {
  const closeOutConfig = (await Effect.runPromise(loadCloisterConfig())).close_out;
  if (closeOutConfig?.auto !== true) return [];

  // Evict stale cache entries before each patrol cycle
  sweepAutoCloseOutCache();

  const delayMinutes = Math.max(0, closeOutConfig.auto_delay_minutes ?? 60);
  const cutoff = now.getTime() - delayMinutes * 60 * 1000;
  const actions: string[] = [];
  const statuses = loadReviewStatuses();

  const candidates: Array<{ issueId: string }> = [];
  for (const [key, status] of Object.entries(statuses)) {
    const issueId = (status.issueId || key).toUpperCase();
    if (status.mergeStatus !== 'merged') continue;
    if (status.stuck || status.deaconIgnored) continue;

    const updatedAt = Date.parse(status.updatedAt || '');
    if (!Number.isFinite(updatedAt) || updatedAt > cutoff) continue;

    candidates.push({ issueId });
  }

  const tasks = candidates.map(({ issueId }) => Effect.tryPromise({
    try: async () => {
    let canonicalState: string | null;
    try {
      canonicalState = await getAutoCloseOutCanonicalState(issueId);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordAutoCloseOutFailure(issueId, message);
      return `Auto close-out failed for ${issueId}: ${message}`;
    }
    if (canonicalState !== 'verifying_on_main') return null;

    const resolvedProject = resolveProjectFromIssueSync(issueId);
    if (!resolvedProject) {
      const message = 'no project configured';
      recordAutoCloseOutFailure(issueId, message);
      return `Auto close-out failed for ${issueId}: ${message}`;
    }

    const ghResolved = resolveGitHubIssueSync(issueId);
    const ctx = {
      issueId,
      projectPath: resolvedProject.projectPath,
      auto: true,
      ...(ghResolved.isGitHub
        ? { github: { owner: ghResolved.owner, repo: ghResolved.repo, number: ghResolved.number } }
        : {}),
    };

    try {
      const { closeOut } = await import('../lifecycle/workflows.js');
      // PAN-1249: closeOut returns Effect<WorkflowResult>; bridge to Promise.
      const result = await Effect.runPromise(closeOut(ctx));
      if (!result.success) {
        const failed = result.steps.find(step => !step.success && !step.skipped);
        throw new Error(failed?.error ?? 'closeOut workflow failed');
      }
      const message = `Auto close-out completed for ${issueId}`;
      console.log(`[deacon] ${message}`);
      emitActivityEntrySync({ source: 'cloister', level: 'info', issueId, message });
      return message;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      recordAutoCloseOutFailure(issueId, message);
      return `Auto close-out failed for ${issueId}: ${message}`;
    }
    },
    catch: (cause) => cause,
  }));

  const results = await Effect.runPromise(withConcurrencyLimit(tasks, 5));
  for (const result of results) {
    if (result !== null) actions.push(result);
  }

  return actions;
}

/**
 * Detect work agents that finished implementation but never called `pan done`.
 *
 * This is the Layer 3 safety net. Layer 2 (work-agent-stop-hook) should catch most
 * cases within seconds of the agent going idle. This catches agents where the stop-hook
 * failed, was skipped, or where the AI analysis was inconclusive.
 *
 * Heuristics: agent is idle for >10 minutes, no completion marker exists, no review
 * status exists (meaning it never entered the specialist pipeline), and the agent
 * has committed code (git log shows commits on the feature branch).
 */
export async function checkFirstCompletionAgents(): Promise<string[]> {
  const actions: string[] = [];

  try {
    const agents = listRunningAgentsSync();
    const now = Date.now();

    for (const agent of agents) {
      // Only check work agents (agent-min-XXX, agent-pan-XXX)
      // Guard against agents with undefined id (planning agents, test artifacts, etc.)
      const agentId = agent.id;
      if (!agentId || !agentId.startsWith('agent-') || !agent.tmuxActive) continue;
      if (agentId.startsWith('specialist-')) continue;

      // Skip if completion marker already exists (or was already processed by cloister)
      const completedFile = join(AGENTS_DIR, agent.id, 'completed');
      const processedMarker = join(AGENTS_DIR, agent.id, 'completed.processed');
      if (existsSync(completedFile) || existsSync(processedMarker)) continue;

      // Check idle duration and idle state via Stop hook
      // isAgentIdleForNudge uses FIRST_COMPLETION_IDLE_MS as the stale-active threshold:
      // if the agent's heartbeat is older than the idle minimum, it's safe to treat as idle.
      if (!isAgentIdleForNudge(agent.id, FIRST_COMPLETION_IDLE_MS)) continue;

      const runtimeState = getAgentRuntimeStateSync(agent.id)!;
      const lastActivity = new Date(runtimeState.lastActivity);
      const idleMs = now - lastActivity.getTime();
      if (idleMs < FIRST_COMPLETION_IDLE_MS) continue;

      // Check cooldown
      const lastNudge = firstCompletionCooldowns.get(agent.id);
      if (lastNudge && (now - lastNudge) < FIRST_COMPLETION_COOLDOWN_MS) continue;

      // HARD GATE: Never nudge agents that have been through the review pipeline.
      // Check review-status.json — if ANY entry exists for this issue, the agent
      // has entered the specialist pipeline and must NOT receive a "pan done" nudge.
      // (Dead-end detection handles agents stuck in review/test cycles.)
      const issueId = agent.issueId || agent.id.replace('agent-', '').toUpperCase();
      const issueKey = issueId.toLowerCase();
      try {
        const statuses = loadReviewStatuses();
        // Keys are stored in original case (e.g., "MIN-727") — check all case variants
        const hasStatus = statuses[issueKey] || statuses[issueId] || statuses[issueId.toUpperCase()];
        if (hasStatus) {
          console.log(`[deacon] First-completion gate: skipping ${agent.id} — has review status entry (readyForMerge=${hasStatus.readyForMerge ?? false})`);
          continue;
        }
      } catch { /* load error, proceed with check */ }

      // HARD GATE: Also check for review feedback files in the workspace.
      // If a feedback directory exists and is non-empty, a review agent has already
      // processed this workspace — never send a "pan done" nudge.
      const agentStateForGate = getAgentStateSync(agent.id);
      if (agentStateForGate?.workspace) {
        const feedbackDir = join(agentStateForGate.workspace, '.pan', 'feedback');
        if (existsSync(feedbackDir)) {
          try {
            const feedbackFiles = readdirSync(feedbackDir);
            if (feedbackFiles.length > 0) {
              console.log(`[deacon] First-completion gate: skipping ${agent.id} — has ${feedbackFiles.length} review feedback file(s) in .pan/feedback/`);
              continue;
            }
          } catch { /* can't read feedback dir */ }
        }
      }

      // PAN-1185: SWARM slot agents must NOT receive issue-level `pan done`
      // nudges. They work on a single plan item; the issue-level done flow opens
      // a premature feature → main PR. Detect slots by workspace path suffix
      // `-slot-N/` — the workspace dir convention is stable across PAN-1176.
      if (agentStateForGate?.workspace && /-slot-\d+\/?$/.test(agentStateForGate.workspace)) {
        console.log(`[deacon] First-completion gate: skipping ${agent.id} — SWARM slot agent (workspace: ${agentStateForGate.workspace})`);
        continue;
      }

      // Check if the agent has commits (sign that work was done)
      const agentState = getAgentStateSync(agent.id);
      if (!agentState?.workspace || !existsSync(agentState.workspace)) continue;

      // For polyrepo workspaces, check inside sub-repos (fe/, api/, etc.)
      // For monorepo workspaces, check the workspace root directly
      let hasCommits = false;
      try {
        const { stdout: gitLog } = await execAsync(
          'git log --oneline -3 2>/dev/null',
          { cwd: agentState.workspace }
        );
        hasCommits = gitLog.trim().length > 0;
      } catch {
        // Workspace root may not be a git repo (polyrepo) — check subdirectories
        try {
          const subdirs = readdirSync(agentState.workspace, { withFileTypes: true })
            .filter(d => d.isDirectory() && !d.name.startsWith('.'));
          for (const sub of subdirs) {
            try {
              const { stdout: subLog } = await execAsync(
                'git log --oneline -3 2>/dev/null',
                { cwd: join(agentState.workspace, sub.name) }
              );
              if (subLog.trim().length > 0) {
                hasCommits = true;
                break;
              }
            } catch { /* not a git repo */ }
          }
        } catch { /* can't read workspace dir */ }
      }
      if (!hasCommits) continue; // No commits — agent may not have started yet

      // All heuristics passed: agent likely forgot pan done
      const idleMinutes = Math.round(idleMs / 60000);
      console.log(`[deacon] First-completion gap detected: ${agent.id} (${issueId}) idle for ${idleMinutes}m with commits but no completion marker`);

      firstCompletionCooldowns.set(agent.id, now);

      try {
        const nudgeMessage = `You appear to have stopped working without calling \`pan done\`. If your implementation is complete, run this now:\n\npan done ${issueId} -c "Implementation complete"\n\nIf you still have remaining tasks, continue working on them.`;
        await Effect.runPromise(sendKeys(agent.id, nudgeMessage));
        actions.push(`First-completion nudge: ${agent.id} (idle ${idleMinutes}m)`);
        console.log(`[deacon] Sent first-completion nudge to ${agent.id}`);
      } catch (error: unknown) {
        const msg = error instanceof Error ? error.message : String(error);
        console.error(`[deacon] Failed to send first-completion nudge to ${agent.id}:`, msg);
      }
    }
  } catch (error: unknown) {
    console.error('[deacon] Error in first-completion detection:', error);
  }

  return actions;
}
