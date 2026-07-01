import { execFile } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { Effect } from 'effect';

import { messageAgent } from '../agents.js';
import { listSlotAgents } from '../agents/slot-reconcile.js';
import { resolveProjectFromIssueSync } from '../projects.js';
import { getReviewStatusSync } from '../review-status.js';
import { PAN_DIRNAME } from '../pan-dir/types.js';
import { readWorkspacePlanSync } from '../vbrief/io.js';
import { writeFeedbackFile } from './feedback-writer.js';
import { resolveSlotFeedbackAgentId } from './test-verdict.js';
import type { VBriefDocument } from '../vbrief/types.js';

const execFileAsync = promisify(execFile);

type ReviewVerdict = 'blocked' | 'failed';

export interface DeliverReviewVerdictFeedbackOptions {
  issueId: string;
  verdict: ReviewVerdict;
  notes?: string;
  workspacePath?: string;
  prUrl?: string;
  slotItemId?: string;
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
    const synthesisPath = join(reviewRoot, entry.name, 'synthesis.md');
    if (!existsSync(synthesisPath)) continue;
    const fileStat = await stat(synthesisPath);
    if (!latest || fileStat.mtimeMs > latest.mtimeMs) {
      latest = { path: synthesisPath, mtimeMs: fileStat.mtimeMs };
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

async function postPrComment(prUrl: string | undefined, body: string): Promise<boolean> {
  const parsed = parseGitHubPrUrl(prUrl);
  if (!parsed) return false;

  await execFileAsync(
    'gh',
    ['api', `repos/${parsed.owner}/${parsed.repo}/issues/${parsed.number}/comments`, '--field', `body=${body}`],
    { encoding: 'utf-8' },
  );
  return true;
}

function readWorkspacePlanBestEffort(workspacePath: string | undefined): VBriefDocument | null {
  if (!workspacePath || !existsSync(workspacePath)) return null;
  try {
    return readWorkspacePlanSync(workspacePath)
      ?? JSON.parse(readFileSync(join(workspacePath, PAN_DIRNAME, 'spec.vbrief.json'), 'utf-8')) as VBriefDocument;
  } catch {
    return null;
  }
}

async function deliverReviewVerdictFeedbackPromise(
  opts: DeliverReviewVerdictFeedbackOptions,
): Promise<DeliverReviewVerdictFeedbackResult> {
  const issueId = opts.issueId.toUpperCase();
  const resolved = resolveProjectFromIssueSync(issueId);
  const workspacePath = opts.workspacePath
    ?? (resolved ? join(resolved.projectPath, 'workspaces', `feature-${issueId.toLowerCase()}`) : undefined);
  const existingStatus = getReviewStatusSync(issueId);
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
    const doc = readWorkspacePlanBestEffort(workspacePath);
    const agentId = resolveSlotFeedbackAgentId(issueId, opts.slotItemId, doc, listSlotAgents(issueId)) ?? `agent-${issueId.toLowerCase()}`;
    const message = `SPECIALIST FEEDBACK: review-agent reported ${opts.verdict.toUpperCase()} for ${issueId}.\n\nMUST READ: ${fileResult.filePath}\n\nUse your Read tool to open this file, read every line, then fix ALL review findings. Do NOT stop at the prompt.`;
    try {
      await messageAgent(agentId, message);
      agentMessageSent = true;
    } catch (err) {
      console.log(`[review-verdict-feedback] Could not message ${agentId}; feedback file remains available: ${err instanceof Error ? err.message : String(err)}`);
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
