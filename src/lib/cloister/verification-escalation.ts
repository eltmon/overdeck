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
import { messageAgent, setAgentPaused, stopAgent } from '../agents.js';
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

export async function escalateVerificationStuck(
  issueId: string,
  failedCheck: string,
  cycleCount: number,
  summary: string,
  logPrefix: string,
): Promise<void> {
  if (await skipMergedVerification(issueId, logPrefix)) return;

  const agentId = `agent-${issueId.toLowerCase()}`;
  const reason = `needs-you: verification stuck after ${cycleCount}/${VERIFICATION_MAX_CYCLES} attempts (${failedCheck})`;

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

  const target = await resolveIssueFeedbackTarget(issueId);
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
    console.warn(`[${logPrefix}] Could not message ${target.agentId}; verification feedback for ${issueId} not delivered: ${reason}`);
    await surfaceIssueFeedbackNeedsYou(issueId, `Feedback delivery to ${target.agentId} failed: ${reason}`, {
      specialist: 'verification-gate',
      ...details,
    });
    return false;
  }

  await surfaceIssueFeedbackNeedsYou(issueId, target.reason, {
    specialist: 'verification-gate',
    ...details,
  });
  return false;
}
