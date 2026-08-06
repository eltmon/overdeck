/**
 * UAT failure feedback relay (PAN-3575).
 *
 * A failed UAT verdict blocks merge, so it must use the same feedback-target
 * door as review and verification failures to start work-agent rework or
 * surface a durable needs-you escalation.
 */

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
  /** Stable UAT verdict identity used to suppress duplicate status posts. */
  anchor?: string;
}

export interface UatFailureFeedbackResult {
  feedbackPath?: string;
  agentMessageSent: boolean;
  needsYouSurfaced: boolean;
  deduplicated: boolean;
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
  const result: UatFailureFeedbackResult = {
    agentMessageSent: false,
    needsYouSurfaced: false,
    deduplicated: false,
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
    const outcome = await messageAgent(target.agentId, message, 'internal', { owesRework: true });
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
