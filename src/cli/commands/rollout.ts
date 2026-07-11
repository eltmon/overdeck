import { Command } from 'commander';
import chalk, { type ChalkInstance } from 'chalk';
import { parseIssueIdSync } from '../../lib/issue-id.js';
import { resolveProjectFromIssueSync } from '../../lib/projects.js';
import { getReleaseSetSync, type ReleaseSet } from '../../lib/release-set.js';
import { runRelease } from '../../lib/release/release-engine.js';

export function registerRolloutCommands(program: Command): void {
  const rollout = program
    .command('rollout')
    .description('Post-merge release status and retry');

  rollout
    .command('status <issueId>')
    .description('Print the release set for an issue (releaseStatus + per-component status)')
    .action(rolloutStatusCommand);

  rollout
    .command('retry <issueId>')
    .description('Re-run the release engine for an issue and print the resulting status')
    .action(rolloutRetryCommand);
}

function statusColor(status: string): ChalkInstance {
  switch (status) {
    case 'passed':
      return chalk.green;
    case 'failed':
    case 'rolled_back':
      return chalk.red;
    case 'partial':
      return chalk.yellow;
    case 'releasing':
      return chalk.cyan;
    default:
      return chalk.gray;
  }
}

function formatReleaseSet(releaseSet: ReleaseSet): string {
  const lines: string[] = [];
  lines.push(`Release status: ${statusColor(releaseSet.status)(releaseSet.status)}`);
  lines.push(`Project: ${releaseSet.projectKey} (${releaseSet.workspaceType})`);
  lines.push('');
  lines.push('Components:');
  const keyWidth = Math.max(...releaseSet.components.map(c => c.componentKey.length));
  for (const component of releaseSet.components) {
    const note = component.notes ? ` — ${component.notes}` : '';
    lines.push(
      `  ${component.componentKey.padEnd(keyWidth)}  order=${component.releaseOrder}  ${statusColor(component.status)(component.status)}${note}`,
    );
  }
  return lines.join('\n');
}

export async function rolloutStatusCommand(issueId: string): Promise<void> {
  if (!parseIssueIdSync(issueId)) {
    console.error(chalk.red(`Invalid issue ID: ${issueId}`));
    process.exit(1);
  }

  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) {
    console.error(chalk.red(`No project configured for ${issueId}`));
    process.exit(1);
  }

  const releaseSet = getReleaseSetSync(issueId);
  if (!releaseSet) {
    console.log(`No release set found for ${issueId}.`);
    return;
  }

  console.log(formatReleaseSet(releaseSet));
}

export async function rolloutRetryCommand(issueId: string): Promise<void> {
  if (!parseIssueIdSync(issueId)) {
    console.error(chalk.red(`Invalid issue ID: ${issueId}`));
    process.exit(1);
  }

  const resolved = resolveProjectFromIssueSync(issueId);
  if (!resolved) {
    console.error(chalk.red(`No project configured for ${issueId}`));
    process.exit(1);
  }

  const releaseSet = await runRelease(issueId, resolved.projectPath);
  if (!releaseSet) {
    console.log(`${issueId}: no release config — skipped.`);
    return;
  }

  console.log(formatReleaseSet(releaseSet));
}
