import { Command } from 'commander';
import chalk from 'chalk';
import { getDashboardApiUrlSync } from '../../lib/config.js';

interface CancelAutoMergeResponse {
  cancelled?: boolean;
  error?: string;
}

async function readCancelResponse(response: Response): Promise<CancelAutoMergeResponse> {
  return response.json().catch(() => ({})) as Promise<CancelAutoMergeResponse>;
}

export async function cancelAutoMergeCommand(id: string): Promise<void> {
  const issueId = id.toUpperCase();
  const dashboardUrl = getDashboardApiUrlSync();
  let response: Response;
  let result: CancelAutoMergeResponse;

  try {
    response = await fetch(`${dashboardUrl}/api/issues/${encodeURIComponent(issueId)}/merge/cancel`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ reason: 'cli' }),
    });
    result = await readCancelResponse(response);
  } catch (error) {
    console.error(chalk.red(`Failed to cancel auto-merge for ${issueId}: ${error instanceof Error ? error.message : String(error)}`));
    process.exit(1);
    return;
  }

  if (response.status === 409) {
    console.error(chalk.yellow(`Cannot cancel — auto-merge for ${issueId} is already executing`));
    process.exit(2);
    return;
  }

  if (!response.ok) {
    console.error(chalk.red(`Failed to cancel auto-merge for ${issueId}: ${result.error ?? `HTTP ${response.status}`}`));
    process.exit(1);
    return;
  }

  if (result.cancelled) {
    console.log(chalk.green(`Cancelled auto-merge for ${issueId}`));
    return;
  }

  console.log(chalk.dim(`No pending auto-merge for ${issueId}`));
}

export function registerMergeCommands(program: Command): void {
  const merge = program
    .command('merge')
    .description('Manage merge operations');

  merge
    .command('cancel <issueId>')
    .description('Cancel a pending auto-merge cooldown for an issue')
    .action(cancelAutoMergeCommand);
}
