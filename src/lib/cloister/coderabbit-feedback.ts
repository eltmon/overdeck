/**
 * PAN-4773: route a CodeRabbit review's findings to the issue's work agent.
 *
 * CodeRabbit is advisory (PAN-2374, memory `coderabbit-advisory-not-blocking`):
 * it reviews only sometimes, and nothing ever waits for it. When it does post
 * inline findings on a pipeline PR, the work agent is told, the same way a
 * review verdict is: a feedback file listing each thread, then a keyed message
 * through the resurrection ladder's target (`resolveIssueFeedbackTarget`). The
 * agent fixes the findings it agrees with and replies on the thread with its
 * reason for each one it rejects.
 *
 * - The trigger is the `pull_request_review` webhook for a CodeRabbit review
 *   on a `feature/` head (`webhook-handlers.ts`). A review with no inline
 *   threads routes nothing.
 * - One delivery per review: the key is the review id, checked against the
 *   journal (`feedback.delivered`, kind `coderabbit`) and against relays still
 *   running in this process, since GitHub can deliver one event twice.
 * - No reachable agent (an adopted PR has none), or a delivery that is not
 *   accepted, raises Needs-you with the feedback file.
 *
 * Nothing here touches merge readiness, and no merge gate reads it.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';

import { messageAgent, type MessageDeliveryOutcome } from '../agents/messaging.js';
import { runGh } from '../github-quota/run-gh.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { fetchCodeRabbitReviewThreads, type CodeRabbitThread, type GhRunner } from './coderabbit-ingestion.js';
import { feedbackAlreadyDelivered, recordFeedbackDelivered } from './feedback-delivery-record.js';
import {
  resolveIssueFeedbackTarget,
  surfaceIssueFeedbackNeedsYou,
  type IssueFeedbackTarget,
} from './feedback-target.js';
import { writeFeedbackFile, type WriteFeedbackResult } from './feedback-writer.js';

export const CODERABBIT_LOGIN = 'coderabbitai[bot]';
const SOURCE = 'coderabbit-feedback';

export interface CodeRabbitReviewEvent {
  issueId: string;
  /** owner/name */
  repo: string;
  prNumber: number;
  reviewId: number;
  headRef: string;
}

export type CodeRabbitRelayOutcome =
  | { kind: 'skipped'; reason: string }
  | { kind: 'no-findings' }
  | { kind: 'already-delivered' }
  | { kind: 'delivered'; agentId: string; threads: number; feedbackPath: string }
  | { kind: 'needs-you'; reason: string; threads: number; feedbackPath?: string };

export interface CodeRabbitFeedbackDeps {
  workspacePathFor?: (issueId: string) => string | null;
  fetchThreads?: (repo: string, prNumber: number, reviewId: number) => Promise<CodeRabbitThread[]>;
  writeFeedback?: typeof writeFeedbackFile;
  alreadyDelivered?: (workspacePath: string, dedupKey: string) => boolean;
  recordDelivered?: typeof recordFeedbackDelivered;
  resolveTarget?: (issueId: string) => Promise<IssueFeedbackTarget>;
  deliver?: (agentId: string, message: string, dedupKey: string) => Promise<MessageDeliveryOutcome>;
  surfaceNeedsYou?: (issueId: string, reason: string, details: Record<string, unknown>) => Promise<void>;
  log?: (line: string) => void;
}

const inFlight = new Map<string, Promise<CodeRabbitRelayOutcome>>();

/** Test hook: forget relays still running in this process. */
export function __resetCodeRabbitRelaysForTests(): void {
  inFlight.clear();
}

const ghRunner: GhRunner = async (args) => (await runGh(args, { caller: 'other', timeout: 20_000 })).stdout;

function defaultWorkspacePathFor(issueId: string): string | null {
  const project = resolveProjectFromIssueSync(issueId);
  if (!project) return null;
  const path = join(project.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`);
  return existsSync(path) ? path : null;
}

/** Keyed delivery; a transport that cannot enforce the key gets one unkeyed retry (`conflict-repair.ts`). */
async function defaultDeliver(agentId: string, message: string, dedupKey: string): Promise<MessageDeliveryOutcome> {
  try {
    return await messageAgent(agentId, message, SOURCE, { owesRework: true, feedbackRedelivery: true, dedupKey });
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    if (!reason.includes('cannot enforce a dedup key')) throw err;
    return messageAgent(agentId, message, SOURCE, { owesRework: true, feedbackRedelivery: true });
  }
}

export function codeRabbitDedupKey(issueId: string, reviewId: number): string {
  return `coderabbit-feedback:${issueId.toLowerCase()}:${reviewId}`;
}

function threadLine(thread: CodeRabbitThread): string {
  const location = thread.path ? `${thread.path}${thread.line != null ? `:${thread.line}` : ''}` : 'general';
  const severity = thread.severity ? ` [${thread.severity}]` : '';
  return `- Thread ${thread.id} · ${location}${severity}: ${thread.title}${thread.url ? `\n  ${thread.url}` : ''}`;
}

/** The feedback file body: every thread, then what to do with each. */
export function buildCodeRabbitFeedbackBody(event: CodeRabbitReviewEvent, threads: readonly CodeRabbitThread[]): string {
  const id = event.issueId.toUpperCase();
  return [
    `# CodeRabbit findings for ${id} (PR #${event.prNumber})`,
    '',
    `CodeRabbit posted ${threads.length} inline finding(s). CodeRabbit is advisory: nothing waits for these,`,
    'but each one gets an answer, either a fix or a reply with your reason.',
    '',
    ...threads.map(threadLine),
    '',
    '## What to do',
    '',
    '1. Read each thread (open its link, or the code at the path and line).',
    '2. If you agree with a finding, fix it.',
    '3. If you reject a finding, reply on its thread with your reason:',
    `   \`gh api repos/${event.repo}/pulls/${event.prNumber}/comments/<thread id>/replies -f body="<reason>"\``,
    `4. If you changed code: run the quality gates on what you touched, commit, push, then run \`pan review request ${id}\`.`,
    '   If you only replied, you are done.',
    `5. If PR #${event.prNumber} has already merged when you read this, nothing more lands on it: open a follow-up issue`,
    '   for the findings you agree with instead of pushing.',
  ].join('\n');
}

/** Route one CodeRabbit review's inline findings to the work agent. Never throws. */
export function relayCodeRabbitReview(
  event: CodeRabbitReviewEvent,
  deps: CodeRabbitFeedbackDeps = {},
): Promise<CodeRabbitRelayOutcome> {
  const key = codeRabbitDedupKey(event.issueId, event.reviewId);
  const running = inFlight.get(key);
  if (running) return running.then(() => ({ kind: 'already-delivered' as const }));
  const run = runRelay({ ...event, issueId: event.issueId.toUpperCase() }, key, deps)
    .catch((err): CodeRabbitRelayOutcome => {
      const reason = err instanceof Error ? err.message : String(err);
      (deps.log ?? console.warn)(`[${SOURCE}] ${event.issueId}: relay of review ${event.reviewId} failed: ${reason}`);
      return { kind: 'skipped', reason };
    })
    .finally(() => inFlight.delete(key));
  inFlight.set(key, run);
  return run;
}

async function runRelay(event: CodeRabbitReviewEvent, dedupKey: string, deps: CodeRabbitFeedbackDeps): Promise<CodeRabbitRelayOutcome> {
  const log = deps.log ?? ((line: string) => console.log(line));
  const { issueId } = event;
  const skip = (reason: string): CodeRabbitRelayOutcome => {
    log(`[${SOURCE}] ${issueId}: review ${event.reviewId} not routed: ${reason}`);
    return { kind: 'skipped', reason };
  };

  if (!event.headRef.toLowerCase().startsWith('feature/')) return skip(`${event.headRef} is not a pipeline branch`);
  const workspacePath = (deps.workspacePathFor ?? defaultWorkspacePathFor)(issueId);
  if (!workspacePath) return skip('the issue has no pipeline workspace');
  if ((deps.alreadyDelivered ?? feedbackAlreadyDelivered)(workspacePath, dedupKey)) return { kind: 'already-delivered' };

  const fetchThreads = deps.fetchThreads ?? ((repo, pr, review) => fetchCodeRabbitReviewThreads(repo, pr, review, ghRunner));
  const threads = await fetchThreads(event.repo, event.prNumber, event.reviewId);
  if (threads.length === 0) {
    log(`[${SOURCE}] ${issueId}: review ${event.reviewId} has no inline findings; nothing routed`);
    return { kind: 'no-findings' };
  }

  const surface = deps.surfaceNeedsYou ?? surfaceIssueFeedbackNeedsYou;
  const needsYou = async (reason: string, feedbackPath?: string): Promise<CodeRabbitRelayOutcome> => {
    try {
      await surface(issueId, reason, { specialist: 'coderabbit', prNumber: event.prNumber, ...(feedbackPath ? { feedbackPath } : {}) });
    } catch (err) {
      log(`[${SOURCE}] ${issueId}: could not raise Needs-you: ${err instanceof Error ? err.message : String(err)}`);
    }
    return { kind: 'needs-you', reason, threads: threads.length, ...(feedbackPath ? { feedbackPath } : {}) };
  };

  const file: WriteFeedbackResult = await (deps.writeFeedback ?? writeFeedbackFile)({
    issueId,
    workspacePath,
    specialist: 'coderabbit',
    outcome: 'findings',
    summary: `CodeRabbit: ${threads.length} finding(s) on PR #${event.prNumber}`,
    markdownBody: buildCodeRabbitFeedbackBody(event, threads),
  });
  if (!file.success || !file.filePath) {
    return needsYou(`CodeRabbit posted ${threads.length} finding(s) on PR #${event.prNumber}, and the feedback file could not be written: ${file.error ?? 'unknown error'}`);
  }

  const target = await (deps.resolveTarget ?? ((id: string) => resolveIssueFeedbackTarget(id)))(issueId);
  if (!('agentId' in target)) {
    return needsYou(`CodeRabbit posted ${threads.length} finding(s) on PR #${event.prNumber}, and no work agent can take them: ${target.reason}`, file.filePath);
  }

  const message = `CODERABBIT FINDINGS for ${issueId}: ${threads.length} inline finding(s) on PR #${event.prNumber}.\n\n`
    + `MUST READ: ${file.filePath}\n\n`
    + 'Fix each finding you agree with. For each one you reject, reply on its PR thread with your reason (the file has the command). '
    + `If you changed code, commit, push, and run pan review request ${issueId}. Nothing waits for these findings.`;
  let outcome: MessageDeliveryOutcome;
  try {
    outcome = await (deps.deliver ?? defaultDeliver)(target.agentId, message, dedupKey);
  } catch (err) {
    return needsYou(`CodeRabbit findings could not reach ${target.agentId}: ${err instanceof Error ? err.message : String(err)}`, file.filePath);
  }
  if (!outcome.delivered) {
    return needsYou(`CodeRabbit findings could not reach ${target.agentId}: ${outcome.reason ?? 'delivery was not accepted'}`, file.filePath);
  }
  (deps.recordDelivered ?? recordFeedbackDelivered)(workspacePath, {
    issueId, kind: 'coderabbit', dedupKey, agentId: target.agentId, source: SOURCE,
  });
  log(`[${SOURCE}] ${issueId}: routed ${threads.length} CodeRabbit finding(s) from review ${event.reviewId} to ${target.agentId}`);
  return { kind: 'delivered', agentId: target.agentId, threads: threads.length, feedbackPath: file.filePath };
}

/**
 * The webhook's entry: relay a submitted CodeRabbit review, ignore anything
 * else. Returns null when the payload is not one.
 */
export function maybeRelayCodeRabbitReview(payload: {
  action?: string;
  repository?: { full_name?: string };
  pull_request?: { number: number; head: { ref: string } };
  review?: { id?: number; state?: string; user?: { login?: string } | null };
}, issueId: string): Promise<CodeRabbitRelayOutcome> | null {
  const { review, pull_request: pr, repository } = payload;
  if (payload.action !== 'submitted' || !review || !pr || !repository?.full_name) return null;
  if (review.user?.login !== CODERABBIT_LOGIN || typeof review.id !== 'number') return null;
  if ((review.state ?? '').toLowerCase() === 'dismissed') return null;
  return relayCodeRabbitReview({
    issueId,
    repo: repository.full_name,
    prNumber: pr.number,
    reviewId: review.id,
    headRef: pr.head.ref,
  });
}
