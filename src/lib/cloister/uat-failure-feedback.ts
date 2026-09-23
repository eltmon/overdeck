/**
 * UAT failure feedback relay (PAN-3575, re-attached by PAN-4030).
 *
 * A failed browser UAT owes rework, so it uses the same feedback-target door
 * as review and verification failures to start work-agent rework or surface a
 * durable needs-you escalation.
 *
 * The caller is `pan admin specialists done` (test role with `--uat-status`,
 * or the uat role): the one place a UAT result is observed after PAN-3917.
 * That is a fresh CLI process per verdict, so "already told" is read from the
 * per-issue pipeline journal (#4035, feedback-delivery-record.ts) before a
 * target is resolved: a `feedback.delivered` entry with this key means the
 * agent was told, on every backend. The message also carries the key
 * `uat-feedback:<issue>:<hash>`, which the keyed tmux/PTY-supervisor tiers
 * enforce as a second layer. The key hashes the tested head plus the number
 * of passing UAT verdicts journaled so far, so a pass between two failures
 * on one head makes the second failure a new delivery.
 *
 * Keyed delivery also trades two guarantees, exactly as review feedback does:
 * for a Claude Code agent it confirms only that the text reached the agent's
 * input (composer-level), not that a transcript turn followed — the unkeyed
 * confirmed-turn path cannot enforce a key — and it skips the mail-dir backup,
 * because a keyed mail file would replay as a second copy. The feedback file
 * written here is the durable receipt. */

import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { messageAgent } from '../agents/messaging.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { resolveIssueFeedbackTarget, surfaceIssueFeedbackNeedsYou } from './feedback-target.js';
import {
  feedbackAlreadyDelivered,
  passingVerdictCount,
  recordFeedbackDelivered,
  verdictEpisodeIdentity,
} from './feedback-delivery-record.js';

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

/**
 * Keyed-delivery identity for one failing UAT anchor of one issue, in one pass
 * episode (`passCount` = passing UAT verdicts journaled so far; 0 keeps the
 * pre-#4035 key).
 */
export function uatFeedbackDedupKey(issueId: string, anchor: string, passCount = 0): string {
  const digest = createHash('sha256').update(verdictEpisodeIdentity(anchor, passCount)).digest('hex').slice(0, 16);
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

function buildUatFailureFeedbackBody(issueId: string, uatNotes: string): string {
  return `# UAT FAILED for ${issueId}

## Failed acceptance criteria

${uatNotes}

## Required action

Read the failed UAT acceptance criteria above, reproduce each failure, then implement and verify the required rework before committing and pushing your fix.
`;
}

/**
 * Relay a failed UAT verdict to the work agent: write the feedback file,
 * message the agent, or surface a needs-you escalation when delivery fails.
 */
export async function relayUatFailureFeedback(
  opts: UatFailureFeedbackOptions,
): Promise<UatFailureFeedbackResult> {
  const issueId = opts.issueId.toUpperCase();
  const uatNotes = opts.uatNotes?.trim() || 'No UAT notes were provided.';
  const resolved = resolveProjectFromIssueSync(issueId);
  const workspacePath = opts.workspacePath
    ?? (resolved ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`) : undefined);
  const dedupKey = opts.anchor
    ? uatFeedbackDedupKey(issueId, opts.anchor, passingVerdictCount(workspacePath, 'uat'))
    : undefined;
  const result: UatFailureFeedbackResult = {
    agentMessageSent: false,
    needsYouSurfaced: false,
    deduplicated: false,
    ...(dedupKey ? { dedupKey } : {}),
  };

  // #4035: the journal, not process memory, says whether this verdict's
  // feedback already reached the agent — checked before any target is
  // resolved (or revived) and before any backend prompt.
  if (dedupKey && feedbackAlreadyDelivered(workspacePath, dedupKey)) {
    return { ...result, deduplicated: true };
  }

  let fileResult;
  try {
    fileResult = await writeFeedbackFile({
      issueId,
      workspacePath,
      specialist: 'uat-agent',
      outcome: 'failed',
      summary: `UAT FAILED: ${uatNotes.slice(0, 80)}`,
      markdownBody: buildUatFailureFeedbackBody(issueId, uatNotes),
    });
  } catch (err) {
    console.warn(`[uat-failure-feedback] Failed to write feedback for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
    return result;
  }

  if (!fileResult.success || !fileResult.filePath) {
    console.warn(`[uat-failure-feedback] Failed to write feedback for ${issueId}: ${fileResult.error ?? 'no feedback path returned'}`);
    return result;
  }

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
      if (dedupKey) {
        recordFeedbackDelivered(workspacePath, {
          issueId, kind: 'uat', dedupKey, agentId: target.agentId, source: 'uat-failure-feedback',
        });
      }
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
