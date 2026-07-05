import { Command } from 'commander';
import { getMergeSetSync } from '../../lib/merge-set.js';
import { getReleaseSetSync, type ReleaseSet } from '../../lib/release-set.js';
import { getReviewStatusSync } from '../../lib/review-status.js';
import { runRelease } from '../../lib/release/release-engine.js';

function normalizeIssueId(issueId: string): string {
  return issueId.trim().toUpperCase();
}

function printReleaseSet(issueId: string, releaseSet: ReleaseSet): void {
  const reviewStatus = getReviewStatusSync(issueId);
  console.log(`${issueId} releaseStatus: ${reviewStatus?.releaseStatus ?? releaseSet.status}`);
  for (const component of releaseSet.components) {
    console.log(`${component.releaseOrder}. ${component.componentKey}: ${component.status}`);
  }
}

export async function rolloutStatusCommand(issueId: string): Promise<void> {
  const normalizedIssueId = normalizeIssueId(issueId);
  if (!normalizedIssueId) {
    console.error('Issue ID is required');
    process.exitCode = 1;
    return;
  }

  const releaseSet = getReleaseSetSync(normalizedIssueId);
  if (!releaseSet) {
    console.error(`No release set found for ${normalizedIssueId}`);
    process.exitCode = 1;
    return;
  }

  printReleaseSet(normalizedIssueId, releaseSet);
}

export async function rolloutRetryCommand(issueId: string): Promise<void> {
  const normalizedIssueId = normalizeIssueId(issueId);
  if (!normalizedIssueId) {
    console.error('Issue ID is required');
    process.exitCode = 1;
    return;
  }

  const existingReleaseSet = getReleaseSetSync(normalizedIssueId);
  const mergeSet = existingReleaseSet ? null : getMergeSetSync(normalizedIssueId);
  const projectPath = existingReleaseSet?.projectPath ?? mergeSet?.projectPath;

  if (!projectPath) {
    console.error(`No release or merge set found for ${normalizedIssueId}`);
    process.exitCode = 1;
    return;
  }

  const releaseSet = await runRelease(normalizedIssueId, projectPath);
  if (!releaseSet) {
    console.log(`${normalizedIssueId} releaseStatus: skipped`);
    return;
  }

  printReleaseSet(normalizedIssueId, releaseSet);
}

export function registerRolloutCommands(program: Command): void {
  const rollout = program
    .command('rollout')
    .description('Inspect and retry coordinated post-merge releases');

  rollout
    .command('status <id>')
    .description('Print release status and ordered component states')
    .action(rolloutStatusCommand);

  rollout
    .command('retry <id>')
    .description('Re-run the release for an issue')
    .action(rolloutRetryCommand);
}
