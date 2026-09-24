/**
 * Verification escalation (extracted from verification-runner.ts for PAN-3965).
 *
 * The attempt budget, the no-progress rule, the stuck pause, and feedback
 * delivery shared by the two places that fail verification: the local gate
 * run (verification-runner.ts) and a red CI test job on the PR head
 * (ci-failure-feedback.ts, for `verification.tests: ci` projects). Both count
 * against the same per-run artifacts (verification-cycles.ts).
 */
import { Effect } from 'effect';

import { emitActivityEntrySync } from '../activity-logger.js';
import { clearAgentPaused, getAgentStateSync, messageAgent, setAgentPaused, stopAgent } from '../agents.js';
import { resolveIssueFeedbackTarget, surfaceIssueFeedbackNeedsYou } from './feedback-target.js';
import { getPrFacts } from './pr-facts.js';
import type { VerificationRunnerOutcome } from './verification-types.js';
import { VERIFICATION_MAX_CYCLES } from './verification-cycles.js';

// The attempt rules are pure and live with the counter they read.
export {
  isFinalVerificationAttempt,
  NO_PROGRESS_REPEAT_THRESHOLD,
  shouldEscalateVerificationFailure,
  VERIFICATION_MAX_CYCLES,
} from './verification-cycles.js';

export const MERGED_VERIFICATION_REASON =
  'The pull request already merged; pre-merge verification no longer applies.';

/**
 * PAN-3917: the forge says whether the PR merged. Nothing is stamped when it
 * has — a merged PR is the merge state, for every reader.
 */
export async function skipMergedVerification(
  issueId: string,
  logPrefix: string,
): Promise<VerificationRunnerOutcome | null> {
  const facts = await getPrFacts(issueId);
  if (!facts.merged) return null;
  console.log(`[${logPrefix}] Skipping pre-merge verification for ${issueId}: ${MERGED_VERIFICATION_REASON}`);
  return { outcome: 'skipped', reason: MERGED_VERIFICATION_REASON };
}

/**
 * Announce a verification failure the gates themselves could not record (an
 * incomplete checklist, an empty changeset). The artifact holds the gate runs;
 * this puts the state-derived failure on the activity stream, where it used to
 * go as a `stuck` flag on the review row.
 */
export function announceVerificationFailure(issueId: string, failedCheck: string, summary: string): void {
  try {
    emitActivityEntrySync({
      source: 'cloister',
      level: 'warn',
      message: `Verification failed for ${issueId} at ${failedCheck}`,
      issueId,
      details: summary,
    });
  } catch { /* announcement is best-effort */ }
}

/**
 * The pause reason prefix `escalateVerificationStuck` writes. While it holds,
 * verification feedback never resurrects the agent (#4019). It is lifted by a
 * verification pass — the local gate's (verification-runner.ts) or a green CI
 * test job on the PR head (ci-failure-feedback.ts) — through
 * `liftVerificationStuckPause`, or by the operator (`pan unpause`,
 * `pan start --force`).
 */
export const VERIFICATION_STUCK_PAUSE_PREFIX = 'needs-you: verification stuck';

/**
 * PAN-3847 (FR-10), re-pointed by PAN-3917: a verification pass lifts the
 * pause escalateVerificationStuck set. The pause IS the state, and the gate
 * that set it clears it. Any other pause (operator, governor) is left alone.
 * Resolves true when a stuck pause was lifted.
 */
export async function liftVerificationStuckPause(issueId: string, logPrefix: string): Promise<boolean> {
  const agentId = `agent-${issueId.toLowerCase()}`;
  if (!isVerificationStuckPaused(issueId)) return false;
  try {
    await Effect.runPromise(clearAgentPaused(agentId));
    console.log(`[${logPrefix}] Lifted verification-stuck pause for ${agentId}`);
    return true;
  } catch (err) {
    console.error(`[${logPrefix}] Failed to lift verification-stuck pause for ${agentId}: ${err instanceof Error ? err.message : String(err)}`);
    return false;
  }
}

export async function escalateVerificationStuck(
  issueId: string,
  failedCheck: string,
  cycleCount: number,
  summary: string,
  logPrefix: string,
): Promise<void> {
  if (await skipMergedVerification(issueId, logPrefix)) return;

  const agentId = `agent-${issueId.toLowerCase()}`;
  const reason = `${VERIFICATION_STUCK_PAUSE_PREFIX} after ${cycleCount}/${VERIFICATION_MAX_CYCLES} attempts (${failedCheck})`;

  announceVerificationFailure(issueId, failedCheck, `${reason}\n\n${summary}`);

  try {
    await Effect.runPromise(setAgentPaused(agentId, reason, true));
    await Effect.runPromise(stopAgent(agentId));
    console.log(`[${logPrefix}] Verification stuck for ${issueId} — paused ${agentId}; the pause is the operator signal`);
  } catch (err) {
    console.error(`[${logPrefix}] Failed to pause ${agentId} after verification stuck:`, err);
  }
}

/**
 * Deliver verification feedback. Resolves true only when the agent accepted
 * the message; false when the PR merged, or delivery failed and the failure
 * was surfaced as needs-you (review of #3993: callers report real delivery).
 * Exported for focused delivery-outcome tests (PR #3874 review).
 */
export async function deliverVerificationFeedback(
  issueId: string,
  message: string,
  details: Record<string, unknown>,
  logPrefix: string,
): Promise<boolean> {
  if (await skipMergedVerification(issueId, logPrefix)) return false;

  // #4019: the stuck escalation paused this agent for the operator a moment
  // ago. The feedback door's resurrection ladder treats a `needs-you:` pause as
  // a pipeline pause and lifts it (PAN-2461), so the stuck notice itself would
  // un-pause the agent it just paused. While the stuck pause holds, nothing is
  // revived: a live target gets the notice (a paused agent's messageAgent
  // queues it to mail without resuming), and the operator is told either way.
  // The CI relay and the local gate deliver independently, so the other one
  // may escalate while this delivery is resolving its target: `keepPause`
  // re-checks the reason at the moment of resurrection.
  const stuckPaused = isVerificationStuckPaused(issueId);
  const target = await resolveIssueFeedbackTarget(
    issueId,
    stuckPaused
      ? { revivePipelinePausedAgent: async () => false }
      : { keepPause: (reason) => reason.startsWith(VERIFICATION_STUCK_PAUSE_PREFIX) },
  );
  if (await skipMergedVerification(issueId, logPrefix)) return false;

  if ('agentId' in target) {
    // PAN-2668: verification feedback owes rework — a stopped-by-user agent
    // with a completed handoff is re-driven, not silently queued mail.
    // PR #3874 review: delivered:false no longer throws — escalate instead of
    // logging success, the same contract as review-verdict-feedback.
    let outcome: Awaited<ReturnType<typeof messageAgent>>;
    try {
      outcome = await messageAgent(target.agentId, message, 'internal', { owesRework: true, feedbackRedelivery: true });
    } catch (err) {
      outcome = { delivered: false, queuedToMail: false, reason: err instanceof Error ? err.message : String(err) };
    }
    if (outcome.delivered) {
      console.log(`[${logPrefix}] Sent verification feedback for ${issueId} to ${target.agentId}`);
      return true;
    }
    const reason = outcome.reason ?? 'delivery was not accepted';
    if (stuckPaused && outcome.queuedToMail) {
      console.log(`[${logPrefix}] ${target.agentId} is paused for verification stuck; the notice for ${issueId} is queued to its mail`);
      await surfaceIssueFeedbackNeedsYou(
        issueId,
        `Verification stuck: ${target.agentId} is paused for the operator; the stuck notice is queued to its mail (${reason})`,
        { specialist: 'verification-gate', ...details },
      );
      return false;
    }
    console.warn(`[${logPrefix}] Could not message ${target.agentId}; verification feedback for ${issueId} not delivered: ${reason}`);
    await surfaceIssueFeedbackNeedsYou(issueId, `Feedback delivery to ${target.agentId} failed: ${reason}`, {
      specialist: 'verification-gate',
      ...details,
    });
    return false;
  }

  await surfaceIssueFeedbackNeedsYou(
    issueId,
    stuckPaused
      ? `Verification stuck: agent-${issueId.toLowerCase()} is paused for the operator and was not resumed to receive the notice. ${target.reason}`
      : target.reason,
    { specialist: 'verification-gate', ...details },
  );
  return false;
}

/** True while the whole-issue agent holds the stuck pause escalation set. */
function isVerificationStuckPaused(issueId: string): boolean {
  try {
    const state = getAgentStateSync(`agent-${issueId.toLowerCase()}`);
    return state?.paused === true && (state.pausedReason ?? '').startsWith(VERIFICATION_STUCK_PAUSE_PREFIX);
  } catch {
    return false;
  }
}
