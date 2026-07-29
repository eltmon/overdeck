/**
 * Delivers durable review-verdict feedback to the work agent. Agent messages
 * use a key derived from the issue and review run so one review cycle is
 * model-visible at most once; callers without a run ID fall back to the
 * reviewed anchor, or deliver unkeyed if neither identity exists. ACP and
 * Channels targets fall back to unkeyed delivery because those transports
 * cannot enforce the key.
 * Repeated keyed suppressions surface a needs-you escalation before duplicate
 * delivery attempts consume the work agent's context window.
 */
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { messageAgent } from '../agents.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { clearFeedbackDeliveryStuck, getReviewStatusSync } from '../review-status.js';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { resolveIssueFeedbackTarget, surfaceIssueFeedbackNeedsYou } from './feedback-target.js';
import { findVerdictReport } from './review-verdict-report.js';

const execFileAsync = promisify(execFile);

// PAN-1837: bounded same-key retries for ambiguous keyed deliveries. The
// common ambiguity source is a delivery racing an agent resume, which
// resolves within seconds once the supervisor finishes binding its socket.
const AMBIGUOUS_DELIVERY_RETRIES = 3;
const AMBIGUOUS_DELIVERY_RETRY_MS = 2_000;

type ReviewVerdict = 'blocked' | 'failed';

export interface DeliverReviewVerdictFeedbackOptions {
  issueId: string;
  verdict: ReviewVerdict;
  notes?: string;
  workspacePath?: string;
  prUrl?: string;
  slotItemId?: string;
  runId?: string;
}

export interface DeliverReviewVerdictFeedbackResult {
  feedbackPath?: string;
  synthesisPath?: string;
  prCommentPosted: boolean;
  agentMessageSent: boolean;
}

async function findLatestSynthesis(workspacePath: string): Promise<{ path: string; body: string } | null> {
  const reviewRoot = join(workspacePath, PAN_DIRNAME, 'review');
  if (!existsSync(reviewRoot)) return null;

  let latest: { path: string; mtimeMs: number } | null = null;
  const entries = await readdir(reviewRoot, { withFileTypes: true });
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const report = findVerdictReport(join(reviewRoot, entry.name));
    if (!report) continue;
    const fileStat = await stat(report.path);
    if (!latest || fileStat.mtimeMs > latest.mtimeMs) {
      latest = { path: report.path, mtimeMs: fileStat.mtimeMs };
    }
  }

  if (!latest) return null;
  return { path: latest.path, body: await readFile(latest.path, 'utf-8') };
}

function parseGitHubPrUrl(prUrl: string | undefined): { owner: string; repo: string; number: string } | null {
  const match = prUrl?.match(/github\.com\/([^/]+)\/([^/]+)\/pull\/(\d+)/);
  if (!match) return null;
  return { owner: match[1]!, repo: match[2]!, number: match[3]! };
}

function buildReviewFeedbackBody(opts: {
  issueId: string;
  verdict: ReviewVerdict;
  notes?: string;
  synthesisBody?: string;
  synthesisPath?: string;
}): string {
  const verdictLabel = opts.verdict === 'blocked' ? 'CHANGES REQUESTED' : 'FAILED';
  const synthesis = opts.synthesisBody?.trim() || opts.notes?.trim() || 'Review did not provide a synthesis summary.';
  const sourceLine = opts.synthesisPath ? `\n\nSource: ${opts.synthesisPath}` : '';

  return `# Review ${verdictLabel} for ${opts.issueId}\n\n${synthesis}${sourceLine}\n\n## Required action\n\nFix every blocking review finding, commit the fixes, then re-request review with:\n\n\`pan review request ${opts.issueId} -m "Fixed review issues"\``;
}

// PAN-2518: the PR-comment POST is advisory — the review verdict is already
// durable (setReviewStatusSync + writeFeedbackFile) before we get here. A `gh
// api` call that STALLS (not rejects) on a network hiccup must never block the
// caller: `pan admin specialists done` is shelled out from the review agent's
// own session, so a hung POST leaves that agent waiting on a never-returning
// command and the issue stalls in-review. A bounded timeout turns a stall into
// a rejection the caller already swallows.
const PR_COMMENT_TIMEOUT_MS = 15_000;
const suppressedReviewFeedbackDeliveries = new Map<string, number>();
const REPEATED_DELIVERY_LOOP_MESSAGE =
  'Review feedback for this verdict was already delivered to the agent; the pipeline re-triggered delivery 3+ times — possible stuck loop. Investigate before the agent context burns.';

export async function postPrComment(prUrl: string | undefined, body: string): Promise<boolean> {
  const parsed = parseGitHubPrUrl(prUrl);
  if (!parsed) return false;

  await execFileAsync(
    'gh',
    ['api', `repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/comments`, '--field', `body=${body}`],
    { encoding: 'utf-8', timeout: PR_COMMENT_TIMEOUT_MS, killSignal: 'SIGKILL' },
  );
  return true;
}

async function deliverReviewVerdictFeedbackPromise(
  opts: DeliverReviewVerdictFeedbackOptions,
): Promise<DeliverReviewVerdictFeedbackResult> {
  const issueId = opts.issueId.toUpperCase();
  const resolved = resolveProjectFromIssueSync(issueId);
  const workspacePath = opts.workspacePath
    ?? (resolved ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`) : undefined);
  const existingStatus = getReviewStatusSync(issueId);

  // PAN-3151: check if review loop is stuck in non-converging state
  const isReviewNotConverging = existingStatus?.stuckReason === 'review-not-converging';

  const deliveryIdentity = opts.runId
    ? `run:${opts.runId}`
    : existingStatus?.reviewedAtCommit
      ? `anchor:${existingStatus.reviewedAtCommit}`
      : undefined;
  const dedupKey = deliveryIdentity
    ? `review-feedback:${issueId.toLowerCase()}:${createHash('sha256')
      .update(deliveryIdentity)
      .digest('hex')
      .slice(0, 16)}`
    : undefined;
  const synthesis = workspacePath && existsSync(workspacePath)
    ? await findLatestSynthesis(workspacePath)
    : null;
  const markdownBody = buildReviewFeedbackBody({
    issueId,
    verdict: opts.verdict,
    notes: opts.notes,
    synthesisBody: synthesis?.body,
    synthesisPath: synthesis?.path,
  });

  let prCommentPosted = false;
  try {
    prCommentPosted = await postPrComment(opts.prUrl ?? existingStatus?.prUrl, markdownBody);
  } catch (err) {
    console.warn(`[review-verdict-feedback] Failed to post PR comment for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
  }

  const fileResult = await Effect.runPromise(writeFeedbackFile({
    issueId,
    workspacePath,
    specialist: 'review-agent',
    outcome: opts.verdict === 'blocked' ? 'changes-requested' : 'failed',
    summary: `Review ${opts.verdict.toUpperCase()}: ${(opts.notes ?? synthesis?.body ?? '').slice(0, 80)}`,
    markdownBody,
  }));

  let agentMessageSent = false;
  if (fileResult.success && fileResult.filePath) {
    if (isReviewNotConverging) {
      // PAN-3151: review loop not converging — suppress agent re-drive, surface needs-you instead
      const countSeries = existingStatus?.reviewCycleHistory
        ?.map(e => e.blockingCount)
        .join(' → ') ?? 'unknown';
      const needsYouMessage = `Review loop not converging (cycle counts: ${countSeries}). ` +
        `Consider decomposing the remaining work into sibling issues, or unstick to continue rework.`;
      try {
        await surfaceIssueFeedbackNeedsYou(issueId, needsYouMessage, {
          specialist: 'review-agent',
          feedbackPath: fileResult.filePath,
          slotItemId: opts.slotItemId,
        });
      } catch (err) {
        console.warn(`[review-verdict-feedback] Could not surface convergence gate for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
      }
      agentMessageSent = false;
    } else {
      const message = `SPECIALIST FEEDBACK: review-agent reported ${opts.verdict.toUpperCase()} for ${issueId}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then fix ALL review findings. Do NOT stop at the prompt.`;
      try {
        // PAN-2209/PAN-2461: resolveIssueFeedbackTarget's built-in resurrection ladder
        // (unpause pipeline pauses, clear troubled gates, resume stopped agents) handles
        // every non-live target; no local reviver override.
        const target = await resolveIssueFeedbackTarget(issueId, {
          itemId: opts.slotItemId,
        });
        if ('agentId' in target) {
          try {
            // PAN-2668: a blocked/failed review verdict owes rework — re-drive a
            // stopped-by-user agent with a completed handoff instead of queueing.
            let deliveryOutcome;
            let ambiguousRetries = 0;
            for (;;) {
              try {
                deliveryOutcome = await messageAgent(target.agentId, message, 'internal', {
                  owesRework: true,
                  ...(dedupKey ? { dedupKey } : {}),
                });
                break;
              } catch (err) {
                const reason = err instanceof Error ? err.message : String(err);
                // An ambiguous keyed outcome means the supervisor may or may not
                // have completed the injection; its contract (delivery.ts,
                // AmbiguousKeyedDeliveryError) is to retry the SAME key at the
                // SAME tier — the supervisor's dedup store absorbs a duplicate.
                // Without this retry a delivery that raced an agent resume
                // stranded rework behind feedback_delivery_needs_you (PAN-1837).
                if (
                  err instanceof Error
                  && err.name === 'AmbiguousKeyedDeliveryError'
                  && ambiguousRetries < AMBIGUOUS_DELIVERY_RETRIES
                ) {
                  ambiguousRetries += 1;
                  console.warn(
                    `[review-verdict-feedback] ambiguous keyed delivery to ${target.agentId} — retrying the same key (${ambiguousRetries}/${AMBIGUOUS_DELIVERY_RETRIES}): ${reason}`,
                  );
                  await new Promise((resolve) => setTimeout(resolve, AMBIGUOUS_DELIVERY_RETRY_MS));
                  continue;
                }
                if (!reason.includes('cannot enforce a dedup key')) throw err;
                // ACP and explicit Channels targets cannot enforce keyed delivery.
                // Delivery still wins over deduplication for those transports.
                console.warn(
                  `[review-verdict-feedback] ${target.agentId} cannot enforce keyed delivery; retrying unkeyed`,
                );
                deliveryOutcome = await messageAgent(
                  target.agentId,
                  message,
                  'internal',
                  { owesRework: true },
                );
                break;
              }
            }
            agentMessageSent = true;
            let repeatedDeliveryLoop = false;
            if (deliveryOutcome.deduplicated && dedupKey) {
              const suppressedCount = (suppressedReviewFeedbackDeliveries.get(dedupKey) ?? 0) + 1;
              suppressedReviewFeedbackDeliveries.set(dedupKey, suppressedCount);
              repeatedDeliveryLoop = suppressedCount >= 2;
              if (suppressedCount === 2) {
                try {
                  await surfaceIssueFeedbackNeedsYou(issueId, REPEATED_DELIVERY_LOOP_MESSAGE, {
                    specialist: 'review-agent',
                    feedbackPath: fileResult.filePath,
                  });
                } catch (err) {
                  console.warn(`[review-verdict-feedback] Could not surface repeated delivery loop for ${issueId}: ${err instanceof Error ? err.message : String(err)}`);
                }
              }
            } else if (dedupKey) {
              suppressedReviewFeedbackDeliveries.delete(dedupKey);
            }
            // PAN-3074: a fresh delivery clears stale feedback-delivery state. Once
            // repeated suppressions surface a loop, preserve that operator-visible
            // state until a non-deduplicated delivery proves the loop ended.
            if (!repeatedDeliveryLoop) clearFeedbackDeliveryStuck(issueId);
          } catch (err) {
            // PAN-2228: a resolved-but-unreachable target is a real delivery failure,
            // not a shrug. Surface it as needs-you so the stall is visible instead of
            // the issue silently parking with an unread feedback file.
            const reason = err instanceof Error ? err.message : String(err);
            console.warn(`[review-verdict-feedback] Could not message ${target.agentId}; feedback file remains available: ${reason}`);
            try {
              await surfaceIssueFeedbackNeedsYou(issueId, `Feedback delivery to ${target.agentId} failed: ${reason}`, {
                specialist: 'review-agent',
                feedbackPath: fileResult.filePath,
                slotItemId: opts.slotItemId,
              });
            } catch { /* best-effort — the warn above still records the failure */ }
          }
        } else {
          try {
            await surfaceIssueFeedbackNeedsYou(issueId, target.reason, {
              specialist: 'review-agent',
              feedbackPath: fileResult.filePath,
              slotItemId: opts.slotItemId,
            });
          } catch (err) {
            console.warn(`[review-verdict-feedback] Could not mark ${issueId} as needing human attention; feedback file remains available: ${err instanceof Error ? err.message : String(err)}`);
          }
        }
      } catch (err) {
        console.warn(`[review-verdict-feedback] Could not resolve a feedback target for ${issueId}; feedback file remains available: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  } else if (!fileResult.success) {
    console.error(`[review-verdict-feedback] Failed to write feedback file for ${issueId}: ${fileResult.error}`);
  }

  return {
    feedbackPath: fileResult.filePath,
    synthesisPath: synthesis?.path,
    prCommentPosted,
    agentMessageSent,
  };
}

// ─── Effect variant (PAN-1249) ───────────────────────────────────────────────

/**
 * Effect variant of {@link deliverReviewVerdictFeedback}. The Promise version
 * already swallows recoverable errors (PR comment failures, agent messaging,
 * synthesis lookup), so the Effect form mirrors that contract: callers see a
 * successful Effect carrying the same result shape and inspect the flags to
 * decide what surfaced. The single non-recoverable boundary — feedback file
 * write — keeps its existing error reporting through {@link writeFeedbackFile}.
 */
export const deliverReviewVerdictFeedback = (
  opts: DeliverReviewVerdictFeedbackOptions,
): Effect.Effect<DeliverReviewVerdictFeedbackResult> =>
  Effect.promise(() => deliverReviewVerdictFeedbackPromise(opts));
