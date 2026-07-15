import { Effect } from 'effect';
/**
 * Specialist Done Command
 *
 * Deterministic way for specialist agents to signal completion.
 * No output parsing needed - just run this command.
 *
 * Usage:
 *   pan specialists done review MIN-665 --status passed --notes "Code looks good"
 *   pan specialists done review MIN-665 --status blocked --notes "Changes requested"
 *   pan specialists done test PAN-97 --status failed --notes "3 tests failing"
 *   pan specialists done merge PAN-83 --status passed
 */

import chalk from 'chalk';
import {
  setReviewStatusSync,
  getReviewStatusSync,
  type ReviewStatus,
} from '../../../lib/review-status.js';

interface DoneOptions {
  status: 'passed' | 'failed' | 'blocked';
  /** vBRIEF item receiving an inspect verdict. Required for inspect. */
  item?: string;
  /** PAN-1862 (FR-6): "security=passed,correctness=blocked" per-reviewer verdicts. */
  reviewers?: string;
  notes?: string;
}

export async function doneCommand(
  specialist: string,
  issueId: string,
  options: DoneOptions
): Promise<void> {
  const validSpecialists = ['review', 'test', 'merge', 'inspect', 'uat', 'ship'];

  if (!validSpecialists.includes(specialist)) {
    console.error(chalk.red(`Invalid specialist: ${specialist}`));
    console.error(chalk.dim(`Valid options: ${validSpecialists.join(', ')}`));
    process.exit(1);
  }

  if (!options.status) {
    console.error(chalk.red('--status is required'));
    process.exit(1);
  }

  const normalizedIssueId = issueId.toUpperCase();
  const validStatuses = specialist === 'review'
    ? ['passed', 'failed', 'blocked']
    : ['passed', 'failed'];

  if (!validStatuses.includes(options.status)) {
    console.error(chalk.red(`Invalid status: ${options.status}`));
    console.error(chalk.dim(`Valid options for ${specialist}: ${validStatuses.join(', ')}`));
    process.exit(1);
  }

  if (specialist === 'inspect') {
    if (!options.item) throw new Error('--item is required for inspect verdicts');

    const { resolveProjectFromIssueSync } = await import('../../../lib/projects.js');
    const { readWorkspacePlanSync } = await import('../../../lib/vbrief/io.js');
    const { join } = await import('node:path');
    const project = resolveProjectFromIssueSync(normalizedIssueId);
    const workspacePath = project && join(project.projectPath, 'workspaces', `feature-${normalizedIssueId.toLowerCase()}`);
    const plan = workspacePath ? readWorkspacePlanSync(workspacePath) : undefined;
    if (!plan?.plan.items.some(item => item.id === options.item)) {
      throw new Error(`Item "${options.item}" does not exist in the vBRIEF for ${normalizedIssueId}`);
    }

    const baseUrl = (process.env.OVERDECK_DASHBOARD_URL || process.env.DASHBOARD_URL || 'http://localhost:3011').replace(/\/$/, '');
    const response = await fetch(`${baseUrl}/api/specialists/done`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        specialist,
        issueId: normalizedIssueId,
        itemId: options.item,
        status: options.status,
        notes: options.notes,
      }),
    });
    if (!response.ok) {
      throw new Error(`Could not record inspect verdict (${response.status}): ${await response.text()}`);
    }
    console.log(chalk.green(`✓ Inspection ${options.status} for ${normalizedIssueId} item ${options.item}`));
    return;
  }

  // Build the atomic update — setReviewStatus handles history, SQLite,
  // computed readyForMerge, and JSON persistence in one call.
  // This eliminates the read-modify-write race that caused duplicate
  // specialist runs to overwrite each other's results.
  const update: Partial<ReviewStatus> = {};

  switch (specialist) {
    case 'review':
      update.reviewStatus = options.status as ReviewStatus['reviewStatus'];
      if (options.notes) update.reviewNotes = options.notes;
      // PAN-1862 (FR-6): persist per-reviewer verdicts so selective re-review
      // (reviewersToRerun) can skip provably-clean reviewers next cycle. The
      // synthesis agent passes --reviewers "security=passed,correctness=blocked".
      // Anchored to the workspace HEAD recorded below; malformed entries are
      // dropped with a warning rather than failing the verdict write.
      if (options.reviewers) {
        const verdicts: NonNullable<ReviewStatus['reviewerVerdicts']> = {};
        for (const pair of options.reviewers.split(',')) {
          const [subRole, verdict] = pair.split('=').map(t => t.trim().toLowerCase());
          if (subRole && (verdict === 'passed' || verdict === 'blocked')) {
            verdicts[subRole] = { status: verdict };
          } else if (pair.trim()) {
            console.warn(chalk.yellow(`  ⚠ Ignoring malformed --reviewers entry: "${pair.trim()}" (want subRole=passed|blocked)`));
          }
        }
        if (Object.keys(verdicts).length > 0) update.reviewerVerdicts = verdicts;
      }
      // Snapshot the workspace HEAD — the same way the /api/specialists/done HTTP
      // route does. The synthesis agent signals via this CLI path, so without this
      // the snapshot never happens: canSkipTests can't fire and the deacon's
      // post-review-commit drift detection goes blind, jamming the issue at
      // passed-but-no-anchor. Runs for passed verdicts (reviewedAtCommit) AND for
      // any verdict carrying --reviewers: per-reviewer verdicts need their atCommit
      // anchor on a BLOCKED aggregate too — that is exactly the cycle whose clean
      // reviewers selective re-review wants to skip next time (PAN-1862 FR-6/NFR-1).
      // A bare blocked verdict (no --reviewers) skips the git probe so the durable
      // write stays synchronous ahead of feedback delivery (PAN-2524).
      if (options.status === 'passed' || update.reviewerVerdicts) {
        let workspaceHead: string | undefined;
        try {
          const { resolveProjectFromIssueSync } = await import('../../../lib/projects.js');
          const { existsSync } = await import('node:fs');
          const { join } = await import('node:path');
          const project = resolveProjectFromIssueSync(normalizedIssueId);
          if (project) {
            const workspacePath = join(
              project.projectPath,
              'workspaces',
              `feature-${normalizedIssueId.toLowerCase()}`,
            );
            if (existsSync(workspacePath)) {
              const { getWorkspaceGitInfo } = await import('../../../lib/git-utils.js');
              const { HEAD } = await Effect.runPromise(getWorkspaceGitInfo(workspacePath));
              if (HEAD) workspaceHead = HEAD;
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(chalk.yellow(`  ⚠ Could not snapshot workspace HEAD: ${message}`));
        }
        if (workspaceHead && update.reviewerVerdicts) {
          for (const v of Object.values(update.reviewerVerdicts)) if (v) v.atCommit = workspaceHead;
        }
        if (workspaceHead && options.status === 'passed') update.reviewedAtCommit = workspaceHead;
      }
      if (options.status === 'passed') {
        // Clear any stale verificationStatus='failed' so the override unblocks
        // readyForMerge. A human passing review assumes responsibility for the gate.
        update.verificationStatus = 'passed';
        update.verificationNotes = 'Cleared by `pan specialists done review --status passed` override (PAN-1215)';
        console.log(chalk.green(`✓ Review passed for ${normalizedIssueId}`));
        console.log(chalk.dim('  Test agent can now proceed'));
      } else if (options.status === 'blocked') {
        console.log(chalk.yellow(`✗ Review blocked for ${normalizedIssueId}`));
      } else {
        console.log(chalk.red(`✗ Review failed for ${normalizedIssueId}`));
      }
      break;

    case 'test':
      update.testStatus = options.status as ReviewStatus['testStatus'];
      if (options.notes) update.testNotes = options.notes;
      if (options.status === 'passed') {
        console.log(chalk.green(`✓ Tests ${options.status} for ${normalizedIssueId}`));
        // readyForMerge is set only by the ship role after rebase/verify/push (PAN-1048).
      } else {
        console.log(chalk.yellow(`✗ Tests ${options.status} for ${normalizedIssueId}`));
      }
      break;

    case 'merge':
      update.mergeStatus = (options.status === 'passed' ? 'merged' : 'failed') as ReviewStatus['mergeStatus'];
      if (options.status === 'passed') {
        update.readyForMerge = false;
        console.log(chalk.green(`✓ Merge completed for ${normalizedIssueId}`));
      } else {
        console.log(chalk.red(`✗ Merge failed for ${normalizedIssueId}`));
      }
      break;

    case 'inspect':
      update.inspectStatus = options.status as ReviewStatus['inspectStatus'];
      if (options.notes) update.inspectNotes = options.notes;
      if (options.status === 'passed') {
        console.log(chalk.green(`✓ Inspection passed for ${normalizedIssueId}`));
        console.log(chalk.dim('  Agent can proceed to the next vBRIEF task'));
      } else {
        console.log(chalk.yellow(`✗ Inspection blocked for ${normalizedIssueId}`));
        console.log(chalk.dim('  Agent must fix issues and re-request inspection'));
      }
      break;

    case 'uat':
      update.uatStatus = options.status as ReviewStatus['uatStatus'];
      if (options.notes) update.uatNotes = options.notes;
      if (options.status === 'passed') {
        console.log(chalk.green(`✓ UAT passed for ${normalizedIssueId}`));
        console.log(chalk.dim('  Ready for merge'));
      } else {
        console.log(chalk.yellow(`✗ UAT blocked for ${normalizedIssueId}`));
        console.log(chalk.dim('  Agent must fix issues — visual/functional verification failed'));
      }
      break;

    case 'ship':
      if (options.status === 'passed') {
        update.readyForMerge = true;
        console.log(chalk.green(`✓ Ship completed for ${normalizedIssueId}`));
        console.log(chalk.dim('  Ready for merge'));
      } else {
        console.log(chalk.yellow(`✗ Ship failed for ${normalizedIssueId}`));
      }
      break;
  }

  const status = setReviewStatusSync(normalizedIssueId, update);

  if (specialist === 'review' && (options.status === 'blocked' || options.status === 'failed')) {
    // PAN-2518: the verdict is already durable (setReviewStatusSync above). Feedback
    // delivery (PR comment, agent messaging, needs-you surfacing) is advisory and
    // shells out to network + tmux, any of which can STALL. `pan admin specialists
    // done` is run from inside the review agent's own session, so a hung delivery
    // leaves that agent waiting on a never-returning command and the issue stalls
    // in-review. Bound the whole step in wall-clock time so the CLI always exits;
    // a missed comment/message is recovered by the deacon feedback janitor.
    const FEEDBACK_DELIVERY_TIMEOUT_MS = 30_000;
    try {
      const { deliverReviewVerdictFeedback } = await import('../../../lib/cloister/review-verdict-feedback.js');
      const delivery = Effect.runPromise(deliverReviewVerdictFeedback({
        issueId: normalizedIssueId,
        verdict: options.status,
        notes: options.notes,
        prUrl: status.prUrl,
      }));
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(
          () => reject(new Error(`feedback delivery timed out after ${FEEDBACK_DELIVERY_TIMEOUT_MS}ms`)),
          FEEDBACK_DELIVERY_TIMEOUT_MS,
        );
      });
      try {
        await Promise.race([delivery, timeout]);
      } finally {
        if (timer) clearTimeout(timer);
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      console.warn(chalk.yellow(`Could not deliver review feedback: ${message}`));
    }
  }

  if (specialist === 'test' && status.readyForMerge) {
    console.log(chalk.green('✓ Ready for merge!'));
  }

  if (options.notes) {
    console.log(chalk.dim(`  Notes: ${options.notes}`));
  }

  // Print current status summary
  console.log('');
  console.log(chalk.bold('Current Status:'));
  if (status.inspectStatus) {
    console.log(`  Inspect: ${formatStatus(status.inspectStatus)}`);
  }
  console.log(`  Review: ${formatStatus(status.reviewStatus)}`);
  console.log(`  Test:   ${formatStatus(status.testStatus)}`);
  if (status.uatStatus) {
    console.log(`  UAT:    ${formatStatus(status.uatStatus)}`);
  }
  if (status.mergeStatus) {
    console.log(`  Merge:  ${formatStatus(status.mergeStatus)}`);
  }
  console.log(`  Ready:  ${status.readyForMerge ? chalk.green('Yes') : chalk.dim('No')}`);

  // PAN-2579 (warm-by-default lifecycle): the PAN-1716 reap-on-verdict step that
  // used to run here is GONE. The session stays alive so the next cycle resumes
  // it with its context intact (fast re-review). Warm-idle advancing sessions no
  // longer count against the PAN-1665 ceiling (countRunningAgents excludes them)
  // and the memory governor sheds them first under HARD pressure — eviction is
  // the governor's job, never a side effect of recording a verdict.
}

/** CLI boundary: durable work finishes before forcing exit past stray open handles. */
export async function doneAndExitCommand(
  specialist: string,
  issueId: string,
  options: DoneOptions,
): Promise<never> {
  await doneCommand(specialist, issueId, options);
  // PAN-2689: setReviewStatusSync's journal write is fire-and-forget; in this
  // short-lived process an immediate exit kills it — and in a sandbox (readonly
  // DB) that write is the ONLY durable copy of the verdict. Drain it first.
  const { flushReviewStatusJournalWrites } = await import('../../../lib/overdeck/review-status-record-sync.js');
  await flushReviewStatusJournalWrites();
  process.exit(0);
}

function formatStatus(status: string): string {
  switch (status) {
    case 'passed':
      return chalk.green(status);
    case 'failed':
      return chalk.red(status);
    case 'pending':
      return chalk.dim(status);
    case 'reviewing':
    case 'testing':
    case 'merging':
      return chalk.yellow(status);
    default:
      return status;
  }
}
