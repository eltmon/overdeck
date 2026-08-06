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

const lastNotifiedAnchor = new Map<string, string | undefined>();

/** Clear one UAT verdict anchor when a new UAT cycle begins. */
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

  lastNotifiedAnchor.set(issueId, opts.anchor);
  result.feedbackPath = fileResult.filePath;

  const message = `SPECIALIST FEEDBACK: uat-agent reported UAT FAILED for ${issueId}.

MUST READ: ${fileResult.filePath}

Use your Read tool to open this file, read every line, then fix every failed UAT acceptance criterion. Do NOT stop at the prompt.`;

  try {
    const target = await resolveIssueFeedbackTarget(issueId);
    if ('agentId' in target) {
      try {
        await messageAgent(target.agentId, message, 'internal', { owesRework: true });
        result.agentMessageSent = true;
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.warn(`[uat-failure-feedback] Could not message ${target.agentId}; feedback file remains available: ${reason}`);
        await surfaceIssueFeedbackNeedsYou(issueId, `Feedback delivery to ${target.agentId} failed: ${reason}`, {
          specialist: 'uat-agent',
          feedbackPath: fileResult.filePath,
        });
        result.needsYouSurfaced = true;
      }
    } else {
      await surfaceIssueFeedbackNeedsYou(issueId, target.reason, {
        specialist: 'uat-agent',
        feedbackPath: fileResult.filePath,
      });
      result.needsYouSurfaced = true;
    }
  } catch (err) {
    console.warn(`[uat-failure-feedback] Could not route feedback for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  return result;
}

/** Effect variant of {@link relayUatFailureFeedbackPromise}. */
export const relayUatFailureFeedback = (
  opts: UatFailureFeedbackOptions,
): Effect.Effect<UatFailureFeedbackResult> => Effect.promise(() => relayUatFailureFeedbackPromise(opts));
