import { exitCli } from '../../exit.js';
/**
 * Specialist Done Command
 *
 * Deterministic way for specialist agents to signal completion.
 * No output parsing needed - just run this command.
 *
 * Usage:
 *   pan specialists done review MIN-665 --status passed --notes "Code looks good" --run-id "agent-min-665-review-abc12345"
 *   pan specialists done review MIN-665 --status blocked --notes "Changes requested" --run-id "agent-min-665-review-abc12345"
 *   pan specialists done test PAN-97 --status failed --notes "3 tests failing"
 *   pan specialists done merge PAN-83 --status passed
 */

import chalk from 'chalk';
import {
  setReviewStatusSync,
  type ReviewStatus,
  type ReviewStatusUpdate,
} from '../../../lib/review-status.js';

interface DoneOptions {
  status: 'passed' | 'failed' | 'blocked';
  /** xBRIEF item receiving an inspect verdict. Required for inspect. */
  item?: string;
  /** Review cycle identity used to deduplicate blocked feedback delivery. */
  runId?: string;
  /** PAN-1862 (FR-6): "security=passed,correctness=blocked" per-reviewer verdicts. */
  reviewers?: string;
  notes?: string;
  uatStatus?: 'passed' | 'failed';
  uatNotes?: string;
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
    return exitCli(1);
  }

  if (!options.status) {
    console.error(chalk.red('--status is required'));
    return exitCli(1);
  }

  const normalizedIssueId = issueId.toUpperCase();
  const validStatuses = specialist === 'review'
    ? ['passed', 'failed', 'blocked']
    : ['passed', 'failed'];

  if (!validStatuses.includes(options.status)) {
    console.error(chalk.red(`Invalid status: ${options.status}`));
    console.error(chalk.dim(`Valid options for ${specialist}: ${validStatuses.join(', ')}`));
    return exitCli(1);
  }

  if (options.uatStatus && (specialist !== 'test' || !['passed', 'failed'].includes(options.uatStatus))) {
    console.error(chalk.red('--uat-status applies only to test verdicts and must be passed or failed'));
    return exitCli(1);
  }

  const callerAgentId = process.env.OVERDECK_AGENT_ID;
  if (specialist === 'review') {
    const expectedReviewAgentId = `agent-${normalizedIssueId.toLowerCase()}-review`;
    if (!options.runId || (callerAgentId && callerAgentId !== expectedReviewAgentId)) {
      throw new Error('Review report compatibility signal requires --run-id and the matching review identity when called from an agent');
    }
    console.log(chalk.green(`✓ Review report ready for host attestation: ${normalizedIssueId}`));
    console.log(chalk.dim('  The host observes the settled report and records the verdict; this command cannot attest or write review state.'));
    return;
  }

  if (specialist === 'inspect') {
    if (!options.item) throw new Error('--item is required for inspect verdicts');

    const { resolveProjectFromIssueSync } = await import('../../../lib/projects.js');
    const { readWorkspacePlanSync } = await import('../../../lib/xbrief/io.js');
    const { join } = await import('node:path');
    const project = resolveProjectFromIssueSync(normalizedIssueId);
    const workspacePath = project && join(project.projectPath, 'workspaces', `feature-${normalizedIssueId.toLowerCase()}`);
    const plan = workspacePath ? readWorkspacePlanSync(workspacePath) : undefined;
    if (!plan?.plan.items.some(item => item.id === options.item)) {
      throw new Error(`Item "${options.item}" does not exist in the xBRIEF for ${normalizedIssueId}`);
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
  const update: ReviewStatusUpdate = {};

  switch (specialist) {
    case 'test':
      update.testStatus = options.status as ReviewStatus['testStatus'];
      if (options.notes) update.testNotes = options.notes;
      if (options.uatStatus) update.uatStatus = options.uatStatus;
      if (options.uatNotes) update.uatNotes = options.uatNotes;
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
        console.log(chalk.dim('  Agent can proceed to the next xBRIEF task'));
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
  const {
    flushReviewStatusJournalWrites,
    readWorkspaceVerdictFallbackSync,
    workspaceVerdictFallbackPath,
  } = await import('../../../lib/overdeck/review-status-record-sync.js');
  await flushReviewStatusJournalWrites();
  // PAN-3092: the flush waited out the verdict-write backoff. A fallback that
  // still exists means the record lock is contended, NOT that the verdict was
  // lost — MIN-902's reviewer re-ran this command for an hour at ~$5/hr because
  // nothing said so. Say it plainly, once.
  const normalized = issueId.toUpperCase();
  if (readWorkspaceVerdictFallbackSync(normalized)) {
    const path = workspaceVerdictFallbackPath(normalized) ?? 'the workspace fallback file';
    console.log(chalk.yellow(
      `\n⚠ The journal write is contended — the verdict is already durable at ${path}.\n` +
      `  The host folds it into the canonical record automatically (the fallback drain\n` +
      `  plus the deacon's stranded-fallback sweep). Do NOT re-run this signal: repeated\n` +
      `  signals add lock pressure and burn tokens without making the verdict any safer.`,
    ));
  }
  return exitCli(0);
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
