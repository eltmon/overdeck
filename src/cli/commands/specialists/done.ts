/**
 * Specialist Done Command
 *
 * Deterministic way for specialist agents to signal completion.
 * No output parsing needed - just run this command.
 *
 * Usage:
 *   pan specialists done review MIN-665 --status passed --notes "Code looks good"
 *   pan specialists done test PAN-97 --status failed --notes "3 tests failing"
 *   pan specialists done merge PAN-83 --status passed
 */

import chalk from 'chalk';
import { existsSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

const REVIEW_STATUS_FILE = join(homedir(), '.panopticon', 'review-status.json');

interface ReviewStatus {
  issueId: string;
  reviewStatus: 'pending' | 'reviewing' | 'passed' | 'failed' | 'blocked';
  testStatus: 'pending' | 'testing' | 'passed' | 'failed' | 'skipped';
  mergeStatus?: 'pending' | 'merging' | 'merged' | 'failed';
  reviewNotes?: string;
  testNotes?: string;
  updatedAt: string;
  readyForMerge: boolean;
  autoRequeueCount?: number;
}

function loadReviewStatuses(): Record<string, ReviewStatus> {
  try {
    if (existsSync(REVIEW_STATUS_FILE)) {
      return JSON.parse(readFileSync(REVIEW_STATUS_FILE, 'utf-8'));
    }
  } catch (error) {
    console.error(chalk.yellow('Warning: Could not load review statuses'));
  }
  return {};
}

function saveReviewStatuses(statuses: Record<string, ReviewStatus>): void {
  writeFileSync(REVIEW_STATUS_FILE, JSON.stringify(statuses, null, 2));
}

interface DoneOptions {
  status: 'passed' | 'failed';
  notes?: string;
}

export async function doneCommand(
  specialist: string,
  issueId: string,
  options: DoneOptions
): Promise<void> {
  const validSpecialists = ['review', 'test', 'merge'];

  if (!validSpecialists.includes(specialist)) {
    console.error(chalk.red(`Invalid specialist: ${specialist}`));
    console.error(chalk.dim(`Valid options: ${validSpecialists.join(', ')}`));
    process.exit(1);
  }

  if (!options.status) {
    console.error(chalk.red('--status is required (passed or failed)'));
    process.exit(1);
  }

  if (!['passed', 'failed'].includes(options.status)) {
    console.error(chalk.red(`Invalid status: ${options.status}`));
    console.error(chalk.dim('Valid options: passed, failed'));
    process.exit(1);
  }

  // Normalize issue ID (e.g., min-665 -> MIN-665)
  const normalizedIssueId = issueId.toUpperCase();

  // Load current statuses
  const statuses = loadReviewStatuses();

  // Get or create status entry
  let status = statuses[normalizedIssueId];
  if (!status) {
    status = {
      issueId: normalizedIssueId,
      reviewStatus: 'pending',
      testStatus: 'pending',
      updatedAt: new Date().toISOString(),
      readyForMerge: false,
    };
  }

  // Update based on specialist type
  switch (specialist) {
    case 'review':
      status.reviewStatus = options.status;
      if (options.notes) {
        status.reviewNotes = options.notes;
      }
      // If review passed, test can proceed (but don't auto-mark ready for merge yet)
      console.log(chalk.green(`✓ Review ${options.status} for ${normalizedIssueId}`));
      if (options.status === 'passed') {
        console.log(chalk.dim('  Test agent can now proceed'));
      }
      break;

    case 'test':
      status.testStatus = options.status;
      if (options.notes) {
        status.testNotes = options.notes;
      }
      // If both review and test passed, mark ready for merge
      if (options.status === 'passed' && status.reviewStatus === 'passed') {
        status.readyForMerge = true;
        console.log(chalk.green(`✓ Tests ${options.status} for ${normalizedIssueId}`));
        console.log(chalk.green('✓ Ready for merge!'));
      } else if (options.status === 'passed') {
        console.log(chalk.green(`✓ Tests ${options.status} for ${normalizedIssueId}`));
      } else {
        console.log(chalk.yellow(`✗ Tests ${options.status} for ${normalizedIssueId}`));
        status.readyForMerge = false;
      }
      break;

    case 'merge':
      // Map passed/failed to merged/failed for mergeStatus type
      status.mergeStatus = options.status === 'passed' ? 'merged' : 'failed';
      if (options.status === 'passed') {
        console.log(chalk.green(`✓ Merge completed for ${normalizedIssueId}`));
        // Clear readyForMerge since it's done
        status.readyForMerge = false;
      } else {
        console.log(chalk.red(`✗ Merge failed for ${normalizedIssueId}`));
      }
      break;
  }

  // Update timestamp
  status.updatedAt = new Date().toISOString();

  // Save
  statuses[normalizedIssueId] = status;
  saveReviewStatuses(statuses);

  // Print notes if provided
  if (options.notes) {
    console.log(chalk.dim(`  Notes: ${options.notes}`));
  }

  // Print current status summary
  console.log('');
  console.log(chalk.bold('Current Status:'));
  console.log(`  Review: ${formatStatus(status.reviewStatus)}`);
  console.log(`  Test:   ${formatStatus(status.testStatus)}`);
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
