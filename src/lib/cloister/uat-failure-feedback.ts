/**
 * UAT failure feedback relay (PAN-3575, re-attached by PAN-4030).
 *
 * A failed browser UAT owes rework, so it uses the same feedback-target door
 * as review and verification failures to start work-agent rework or surface a
 * durable needs-you escalation.
 *
 * The caller is `pan admin specialists done` (test role with `--uat-status`,
 * or the uat role): the one place a UAT result is observed after PAN-3917.
 * That is a fresh CLI process per verdict, so the in-process anchor map below
 * only guards repeats inside one process. Once-per-failing-anchor across
 * processes comes from the keyed delivery store (PTY supervisor reservation /
 * tmux user options): the message carries `uat-feedback:<issue>:<anchor hash>`
 * and a repeat for the same PR head is reported `deduplicated`, not re-sent.
 */

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { Effect } from 'effect';
import { messageAgent } from '../agents/messaging.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { resolveIssueFeedbackTarget, surfaceIssueFeedbackNeedsYou } from './feedback-target.js';

export interface UatFailureFeedbackOptions {
  issueId: string;
  uatNotes?: string;
  workspacePath?: string;
  /** Stable UAT verdict identity (the PR head SHA) used to deliver once per failing anchor. */
  anchor?: string;
}

export interface UatFailureFeedbackResult {
  feedbackPath?: string;
  agentMessageSent: boolean;
  needsYouSurfaced: boolean;
  deduplicated: boolean;
  /** Keyed-delivery identity, present whenever an anchor was supplied. */
  dedupKey?: string;
}

// PAN-1837: bounded same-key retries for an ambiguous keyed delivery (one that
// raced an agent resume). The supervisor's dedup store absorbs a duplicate.
const AMBIGUOUS_DELIVERY_RETRIES = 3;
export const UAT_AMBIGUOUS_DELIVERY_RETRY_MS = 2_000;

/** Keyed-delivery identity for one failing UAT anchor of one issue. */
export function uatFeedbackDedupKey(issueId: string, anchor: string): string {
  const digest = createHash('sha256').update(anchor).digest('hex').slice(0, 16);
  return `uat-feedback:${issueId.toLowerCase()}:${digest}`;
}

type DeliveryOutcome = Awaited<ReturnType<typeof messageAgent>>;

/**
 * Keyed delivery with the same recovery contract review feedback uses: an
 * ambiguous outcome retries the SAME key, and a transport that cannot enforce
 * a key (ACP, Channels) falls back to one unkeyed delivery — delivery wins
 * over deduplication there.
 */
async function deliverUatFeedbackMessage(
  agentId: string,
  message: string,
  dedupKey: string | undefined,
): Promise<DeliveryOutcome> {
  const baseOpts = { owesRework: true, feedbackRedelivery: true };
  let ambiguousRetries = 0;
  for (;;) {
    try {
      return await messageAgent(agentId, message, 'internal', dedupKey ? { ...baseOpts, dedupKey } : baseOpts);
    } catch (err) {
      if (!dedupKey) throw err;
      const reason = err instanceof Error ? err.message : String(err);
      if (
        err instanceof Error
        && err.name === 'AmbiguousKeyedDeliveryError'
        && ambiguousRetries < AMBIGUOUS_DELIVERY_RETRIES
      ) {
        ambiguousRetries += 1;
        console.warn(`[uat-failure-feedback] ambiguous keyed delivery to ${agentId} — retrying the same key (${ambiguousRetries}/${AMBIGUOUS_DELIVERY_RETRIES}): ${reason}`);
        await new Promise((resolve) => setTimeout(resolve, UAT_AMBIGUOUS_DELIVERY_RETRY_MS));
        continue;
      }
      if (!reason.includes('cannot enforce a dedup key')) throw err;
      console.warn(`[uat-failure-feedback] ${agentId} cannot enforce keyed delivery; retrying unkeyed`);
      return messageAgent(agentId, message, 'internal', baseOpts);
    }
  }
}

/** Bound process-local dedup state even if terminal cleanup is delayed. */
export const MAX_UAT_FAILURE_FEEDBACK_ANCHORS = 256;
const lastNotifiedAnchor = new Map<string, string | undefined>();

function rememberUatFailureFeedbackAnchor(issueId: string, anchor: string | undefined): void {
  // Refresh matching entries so actively failing issues are retained under LRU eviction.
  lastNotifiedAnchor.delete(issueId);
  lastNotifiedAnchor.set(issueId, anchor);
  while (lastNotifiedAnchor.size > MAX_UAT_FAILURE_FEEDBACK_ANCHORS) {
    const oldestIssueId = lastNotifiedAnchor.keys().next().value;
    if (oldestIssueId === undefined) return;
    lastNotifiedAnchor.delete(oldestIssueId);
  }
}

/** Clear one UAT verdict anchor when a new UAT cycle or terminal lifecycle begins. */
export function clearUatFailureFeedbackAnchor(issueId: string): void {
  lastNotifiedAnchor.delete(issueId.toUpperCase());
}

/** Reset internal UAT feedback state for isolated unit tests. */
export function resetUatFailureFeedbackStateForTests(): void {
  lastNotifiedAnchor.clear();
}

function buildUatFailureFeedbackBody(issueId: string, uatNotes: string): string {
  return `# UAT FAILED for ${issueId}

## Failed acceptance criteria

${uatNotes}

## Required action

Read the failed UAT acceptance criteria above, reproduce each failure, then implement and verify the required rework before committing and pushing your fix.
`;
}

export async function relayUatFailureFeedbackPromise(
  opts: UatFailureFeedbackOptions,
): Promise<UatFailureFeedbackResult> {
  const issueId = opts.issueId.toUpperCase();
  const uatNotes = opts.uatNotes?.trim() || 'No UAT notes were provided.';
  const dedupKey = opts.anchor ? uatFeedbackDedupKey(issueId, opts.anchor) : undefined;
  const result: UatFailureFeedbackResult = {
    agentMessageSent: false,
    needsYouSurfaced: false,
    deduplicated: false,
    ...(dedupKey ? { dedupKey } : {}),
  };

  if (lastNotifiedAnchor.has(issueId) && lastNotifiedAnchor.get(issueId) === opts.anchor) {
    return { ...result, deduplicated: true };
  }

  const resolved = resolveProjectFromIssueSync(issueId);
  const workspacePath = opts.workspacePath
    ?? (resolved ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`) : undefined);

  let fileResult;
  try {
    fileResult = await Effect.runPromise(writeFeedbackFile({
      issueId,
      workspacePath,
      specialist: 'uat-agent',
      outcome: 'failed',
      summary: `UAT FAILED: ${uatNotes.slice(0, 80)}`,
      markdownBody: buildUatFailureFeedbackBody(issueId, uatNotes),
    }));
  } catch (err) {
    console.warn(`[uat-failure-feedback] Failed to write feedback for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  if (!fileResult.success || !fileResult.filePath) {
    console.warn(`[uat-failure-feedback] Failed to write feedback for ${issueId}: ${fileResult.error ?? 'no feedback path returned'}`);
    return result;
  }

  rememberUatFailureFeedbackAnchor(issueId, opts.anchor);
  result.feedbackPath = fileResult.filePath;

  const message = `SPECIALIST FEEDBACK: uat-agent reported UAT FAILED for ${issueId}.

MUST READ: ${fileResult.filePath}

Use your Read tool to open this file, read every line, then fix every failed UAT acceptance criterion. Do NOT stop at the prompt.`;

  let target: Awaited<ReturnType<typeof resolveIssueFeedbackTarget>>;
  try {
    target = await resolveIssueFeedbackTarget(issueId);
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[uat-failure-feedback] Could not resolve a feedback target for ${issueId}: ${reason}`);
    await surfaceIssueFeedbackNeedsYou(issueId, `Could not resolve UAT feedback target: ${reason}`, {
      specialist: 'uat-agent',
      feedbackPath: fileResult.filePath,
    });
    result.needsYouSurfaced = true;
    return result;
  }

  if (!('agentId' in target)) {
    await surfaceIssueFeedbackNeedsYou(issueId, target.reason, {
      specialist: 'uat-agent',
      feedbackPath: fileResult.filePath,
    });
    result.needsYouSurfaced = true;
    return result;
  }

  try {
    const outcome = await deliverUatFeedbackMessage(target.agentId, message, dedupKey);
    if (outcome.delivered && outcome.deduplicated) {
      // The keyed store already holds this anchor: the agent was told once.
      result.deduplicated = true;
      return result;
    }
    if (outcome.delivered) {
      result.agentMessageSent = true;
      return result;
    }

    const reason = outcome.reason ?? 'delivery was not accepted';
    console.warn(`[uat-failure-feedback] Could not message ${target.agentId}; feedback file remains available: ${reason}`);
    await surfaceIssueFeedbackNeedsYou(issueId, `Feedback delivery to ${target.agentId} failed: ${reason}`, {
      specialist: 'uat-agent',
      feedbackPath: fileResult.filePath,
    });
    result.needsYouSurfaced = true;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.warn(`[uat-failure-feedback] Could not message ${target.agentId}; feedback file remains available: ${reason}`);
    await surfaceIssueFeedbackNeedsYou(issueId, `Feedback delivery to ${target.agentId} failed: ${reason}`, {
      specialist: 'uat-agent',
      feedbackPath: fileResult.filePath,
    });
    result.needsYouSurfaced = true;
  }

  return result;
}

/** Effect variant of {@link relayUatFailureFeedbackPromise}. */
export const relayUatFailureFeedback = (
  opts: UatFailureFeedbackOptions,
): Effect.Effect<UatFailureFeedbackResult> => Effect.promise(() => relayUatFailureFeedbackPromise(opts));
