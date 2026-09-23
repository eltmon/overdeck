/**
 * `pan admin specialists done <role> <issue> --status <passed|failed|blocked>`
 *
 * PAN-3917: a specialist verdict is posted where the forge owns it — an
 * approval or a review comment on the pull/merge request — and nowhere else.
 * There is no review-status row and no stored verdict field: the ready set is
 * derived from approvals, checks and forge mergeability (FR-7, FR-9).
 *
 * Roles: `review`, `test`, `uat`. The `inspect` role went with the per-item
 * inspection gate (FR-14); `merge` and `ship` went with the stored merge
 * verdict — a merged PR is the fact those two used to record.
 */

import { exitCli } from '../../exit.js';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';

import chalk from 'chalk';
import { Effect } from 'effect';

import {
  commentOnArtifact,
  discoverArtifact,
  type ForgeType,
} from '../../../lib/forge.js';
import { getPrFacts, resetPrFactsCache } from '../../../lib/cloister/pr-facts.js';
import { bumpIssuePrTabCacheGeneration } from '../../../dashboard/server/services/pr-tab-cache.js';
import { postReviewVerdict } from '../../../lib/cloister/pr-review-verdict.js';
import { getIssueWorkspacePath } from '../../../lib/overdeck/issue-projects.js';
import { appendPipelineEntry } from '../../../lib/cloister/pipeline-journal.js';

const execFileAsync = promisify(execFile);

export type SpecialistRole = 'review' | 'test' | 'uat';

interface DoneOptions {
  status: 'passed' | 'failed' | 'blocked';
  /** Review cycle identity used to deduplicate blocked feedback delivery. */
  runId?: string;
  notes?: string;
  uatStatus?: 'passed' | 'failed';
  uatNotes?: string;
  /** The commit the test/UAT run exercised, recorded before the gates ran. */
  testedSha?: string;
}

// PAN-3642: this advisory deadline covers the PR comment, a stopped Claude
// agent's summary-resume path, and all four same-key supervisor attempts plus
// their retry sleeps.
export const FEEDBACK_DELIVERY_TIMEOUT_MS = 120_000;

class FeedbackDeliveryTimeoutError extends Error {
  constructor(readonly timeoutMs: number) {
    super(`feedback delivery timed out after ${timeoutMs}ms`);
    this.name = 'FeedbackDeliveryTimeoutError';
  }
}

/** Bound an advisory feedback delivery by {@link FEEDBACK_DELIVERY_TIMEOUT_MS}. */
async function withFeedbackDeadline<T>(delivery: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () => reject(new FeedbackDeliveryTimeoutError(FEEDBACK_DELIVERY_TIMEOUT_MS)),
      FEEDBACK_DELIVERY_TIMEOUT_MS,
    );
  });
  try {
    return await Promise.race([delivery, timeout]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

/** The forge that owns a workspace's review artifact, read from its origin remote. */
export async function forgeForWorkspace(cwd: string): Promise<ForgeType> {
  try {
    const { stdout } = await execFileAsync('git', ['remote', 'get-url', 'origin'], { cwd });
    return /gitlab/i.test(stdout) ? 'gitlab' : 'github';
  } catch {
    return 'github';
  }
}

/** The verdict body posted to the PR — the durable record of a specialist run. */
export function formatVerdictBody(
  role: SpecialistRole,
  status: DoneOptions['status'],
  notes?: string,
  uat?: { status?: string; notes?: string },
): string {
  const heading = `**${role} verdict: ${status}**`;
  const lines = [heading];
  if (notes) lines.push('', notes);
  if (uat?.status) lines.push('', `**browser UAT: ${uat.status}**`);
  if (uat?.notes) lines.push('', uat.notes);
  return lines.join('\n');
}

export async function doneCommand(
  specialist: string,
  issueId: string,
  options: DoneOptions,
): Promise<void> {
  const validSpecialists: SpecialistRole[] = ['review', 'test', 'uat'];

  if (!validSpecialists.includes(specialist as SpecialistRole)) {
    console.error(chalk.red(`Invalid specialist: ${specialist}`));
    console.error(chalk.dim(`Valid options: ${validSpecialists.join(', ')}`));
    return exitCli(1);
  }
  const role = specialist as SpecialistRole;

  if (!options.status) {
    console.error(chalk.red('--status is required'));
    return exitCli(1);
  }

  const normalizedIssueId = issueId.toUpperCase();
  const validStatuses = role === 'review' ? ['passed', 'failed', 'blocked'] : ['passed', 'failed'];

  if (!validStatuses.includes(options.status)) {
    console.error(chalk.red(`Invalid status: ${options.status}`));
    console.error(chalk.dim(`Valid options for ${role}: ${validStatuses.join(', ')}`));
    return exitCli(1);
  }

  if (options.testedSha !== undefined && (role === 'review' || !/^[0-9a-f]{7,40}$/i.test(options.testedSha))) {
    console.error(chalk.red('--tested-sha applies only to test and uat verdicts and must be a commit SHA'));
    return exitCli(1);
  }

  if (options.uatStatus && (role !== 'test' || !['passed', 'failed'].includes(options.uatStatus))) {
    console.error(chalk.red('--uat-status applies only to test verdicts and must be passed or failed'));
    return exitCli(1);
  }

  const workspacePath = getIssueWorkspacePath(normalizedIssueId);
  if (!workspacePath || !existsSync(workspacePath)) {
    console.error(chalk.red(`No workspace for ${normalizedIssueId}; cannot reach its review artifact.`));
    return exitCli(1);
  }

  const forge = await forgeForWorkspace(workspacePath);
  const sourceBranch = `feature/${normalizedIssueId.toLowerCase()}`;
  const artifact = await Effect.runPromise(
    discoverArtifact(forge, { sourceBranch, cwd: workspacePath }),
  );
  if (!artifact?.url) {
    console.error(chalk.red(
      `No open review artifact for ${sourceBranch}; run \`pan done ${normalizedIssueId}\` to open one before recording a verdict.`,
    ));
    return exitCli(1);
  }

  const body = formatVerdictBody(role, options.status, options.notes, {
    status: options.uatStatus,
    notes: options.uatNotes,
  });

  // FR-7: the reviewer's verdict IS the forge's review decision. A pass is an
  // approval; a blocked or failed verdict is `REQUEST_CHANGES`, not a comment —
  // a comment leaves `reviewDecision` untouched, so the merge-ready set would
  // keep reading the branch as merely unapproved and every reader that keys off
  // `CHANGES_REQUESTED` (rework delivery, the review-stale gate) sees nothing.
  // Completion fails when the post fails: an unrecorded verdict is not done.
  if (role === 'review') {
    const result = await postReviewVerdict({
      issueId: normalizedIssueId,
      verdict: options.status === 'passed' ? 'approve' : 'request-changes',
      body,
    });
    if (!result.posted) {
      console.error(chalk.red(
        `Could not post the review verdict on ${artifact.url}: ${result.reason}`,
      ));
      return exitCli(1);
    }
    // The verdict is on the forge; record that Overdeck posted it. This runs
    // in the reviewer's CLI process, so the notifier forwards over HTTP.
    appendPipelineEntry(workspacePath, {
      type: 'review.verdict',
      issueId: normalizedIssueId,
      source: 'pan-specialists-done',
      data: {
        verdict: options.status === 'passed' ? 'APPROVED' : 'CHANGES_REQUESTED',
        subRole: role,
        ...(result.via ? { via: result.via } : {}),
        ...(options.runId ? { runId: options.runId } : {}),
      },
    });
    const tint = options.status === 'passed' ? chalk.green : chalk.yellow;
    const how = result.via === 'comment'
      ? 'verdict comment posted (self-review refused by forge)'
      : 'review posted';
    console.log(tint(
      `${options.status === 'passed' ? '✓' : '✗'} review ${options.status} — ${result.verdict}: ${how} on ${artifact.url}`,
    ));
  } else {
    await Effect.runPromise(
      commentOnArtifact(forge, { forge, url: artifact.url, body, cwd: workspacePath }),
    );
    const tint = options.status === 'passed' ? chalk.green : chalk.yellow;
    console.log(tint(`${options.status === 'passed' ? '✓' : '✗'} ${role} ${options.status} — recorded on ${artifact.url}`));
  }

  if (role === 'review' && (options.status === 'blocked' || options.status === 'failed')) {
    // Drive the work agent only once the FORGE reports the rejection — a fresh
    // read, not the caller's own claim about what it just posted. GitHub says
    // so with `CHANGES_REQUESTED`; GitLab has no request-changes primitive at
    // all (pr-facts maps a rejected MR to REVIEW_REQUIRED), so there the fact
    // is an open MR that the note left unapproved.
    // `postReviewVerdict` read the forge a moment ago and both read caches
    // (pr-facts' own 60s TTL and the generation-keyed PR-tab cache) now hold
    // the PRE-verdict answer. Without dropping them this "fresh read" is a
    // cache hit that can never see the verdict that was just posted.
    resetPrFactsCache();
    bumpIssuePrTabCacheGeneration(normalizedIssueId);
    const facts = await getPrFacts(normalizedIssueId);
    const rejectionVisible = facts.changesRequested
      || (facts.forge === 'gitlab' && facts.open && !facts.approved);
    if (!rejectionVisible) {
      console.warn(chalk.yellow(
        `${artifact.url} does not report the rejection yet — not driving the work agent. `
        + 'Re-run this verdict once the forge reflects it.',
      ));
      return;
    }
    // PAN-2518: the verdict is already on the PR. Feedback delivery (agent
    // messaging, needs-you surfacing) is advisory and shells out to network +
    // tmux, either of which can STALL — and this runs inside the reviewer's own
    // session, so a hung delivery leaves that agent waiting forever. Bound it.
    try {
      const { deliverReviewVerdictFeedback } = await import('../../../lib/cloister/review-verdict-feedback.js');
      await withFeedbackDeadline(Effect.runPromise(deliverReviewVerdictFeedback({
        issueId: normalizedIssueId,
        verdict: options.status,
        notes: options.notes,
        prUrl: artifact.url,
        ...(options.runId ? { runId: options.runId } : {}),
      })));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof FeedbackDeliveryTimeoutError) {
        const { surfaceIssueFeedbackNeedsYou } = await import('../../../lib/cloister/feedback-target.js');
        await surfaceIssueFeedbackNeedsYou(
          normalizedIssueId,
          `Review feedback delivery exceeded the ${err.timeoutMs}ms advisory deadline before the keyed retry contract settled; the verdict is on ${artifact.url} and retry remains required.`,
          {
            specialist: 'review-agent',
            retryable: true,
            source: 'specialists-done-timeout',
            ...(options.runId ? { runId: options.runId } : {}),
          },
        );
      }
      console.warn(chalk.yellow(`Could not deliver review feedback: ${message}`));
    }
  }

  // PAN-4030: a browser UAT result is observed here and nowhere else — the
  // test role's `--uat-status`, or the uat role's own status. The verdict is
  // already on the PR; a failure owes rework, so relay the UAT notes to the
  // work agent (or a needs-you when none can be reached), once per failing PR
  // head. A passing UAT clears that anchor.
  const uatOutcome = role === 'test' ? options.uatStatus : role === 'uat' ? options.status : undefined;
  if (uatOutcome === 'failed') {
    const uatNotes = role === 'test' ? options.uatNotes : options.notes;
    try {
      const { relayUatFailureFeedbackPromise } = await import('../../../lib/cloister/uat-failure-feedback.js');
      // Anchor on the commit UAT actually exercised (pre-Cut: reviewedAtCommit).
      // The test agent records it before running the gates and passes it as
      // --tested-sha. Its workspace HEAD at verdict time is no better than the
      // PR head — the work agent shares that worktree and may have moved it —
      // so when the SHA was not reported, fall back to the PR head: a push
      // during the run then mis-anchors this failure onto the newer commit.
      // An unreadable PR head still relays; it only loses cross-run dedup.
      const anchor = options.testedSha?.toLowerCase() ?? await getPrFacts(normalizedIssueId)
        .then((facts) => facts.headSha ?? undefined, () => undefined);
      await withFeedbackDeadline(relayUatFailureFeedbackPromise({
        issueId: normalizedIssueId,
        uatNotes,
        workspacePath,
        ...(anchor ? { anchor } : {}),
      }));
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (err instanceof FeedbackDeliveryTimeoutError) {
        const { surfaceIssueFeedbackNeedsYou } = await import('../../../lib/cloister/feedback-target.js');
        await surfaceIssueFeedbackNeedsYou(
          normalizedIssueId,
          `UAT failure feedback delivery exceeded the ${err.timeoutMs}ms advisory deadline; the verdict is on ${artifact.url} and the work agent may not have been told.`,
          { specialist: 'uat-agent', retryable: true, source: 'specialists-done-timeout' },
        );
      }
      console.warn(chalk.yellow(`Could not deliver UAT failure feedback: ${message}`));
    }
  } else if (uatOutcome === 'passed') {
    const { clearUatFailureFeedbackAnchor } = await import('../../../lib/cloister/uat-failure-feedback.js');
    clearUatFailureFeedbackAnchor(normalizedIssueId);
  }

  // PAN-2579 (warm-by-default lifecycle): the session stays alive so the next
  // cycle resumes it with its context intact. Eviction is the memory
  // governor's job, never a side effect of recording a verdict.
}

/** CLI boundary: the verdict is durable on the forge before the process exits. */
export async function doneAndExitCommand(
  specialist: string,
  issueId: string,
  options: DoneOptions,
): Promise<never> {
  await doneCommand(specialist, issueId, options);
  return exitCli(0);
}
