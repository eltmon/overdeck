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
  setReviewStatus,
  getReviewStatus,
  type ReviewStatus,
} from '../../../lib/review-status.js';

interface DoneOptions {
  status: 'passed' | 'failed' | 'blocked';
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

  // Build the atomic update — setReviewStatus handles history, SQLite,
  // computed readyForMerge, and JSON persistence in one call.
  // This eliminates the read-modify-write race that caused duplicate
  // specialist runs to overwrite each other's results.
  const update: Partial<ReviewStatus> = {};

  switch (specialist) {
    case 'review':
      update.reviewStatus = options.status as ReviewStatus['reviewStatus'];
      if (options.notes) update.reviewNotes = options.notes;
      if (options.status === 'passed') {
        // Snapshot the workspace HEAD into reviewedAtCommit — the same way the
        // /api/specialists/done HTTP route does. The synthesis agent signals
        // via this CLI path, so without this the snapshot never happens:
        // canSkipTests can't fire and the deacon's post-review-commit drift
        // detection goes blind, jamming the issue at passed-but-no-anchor.
        // Included in `update` so it lands atomically before setReviewStatus
        // evaluates canSkipTests.
        try {
          const { resolveProjectFromIssue } = await import('../../../lib/projects.js');
          const { existsSync } = await import('node:fs');
          const { join } = await import('node:path');
          const project = resolveProjectFromIssue(normalizedIssueId);
          if (project) {
            const workspacePath = join(
              project.projectPath,
              'workspaces',
              `feature-${normalizedIssueId.toLowerCase()}`,
            );
            if (existsSync(workspacePath)) {
              const { getWorkspaceGitInfo } = await import('../../../lib/git-utils.js');
              const { HEAD } = await getWorkspaceGitInfo(workspacePath);
              if (HEAD) update.reviewedAtCommit = HEAD;
            }
          }
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err);
          console.warn(chalk.yellow(`  ⚠ Could not snapshot reviewedAtCommit: ${message}`));
        }
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
        console.log(chalk.dim('  Agent can proceed to next bead'));
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

  const status = setReviewStatus(normalizedIssueId, update);

  if (specialist === 'review' && (options.status === 'blocked' || options.status === 'failed')) {
    try {
      const { deliverReviewVerdictFeedback } = await import('../../../lib/cloister/review-verdict-feedback.js');
      await deliverReviewVerdictFeedback({
        issueId: normalizedIssueId,
        verdict: options.status,
        notes: options.notes,
        prUrl: status.prUrl,
      });
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
