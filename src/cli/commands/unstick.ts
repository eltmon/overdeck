import chalk from 'chalk';
import type { Command } from 'commander';

import { getDashboardApiUrlSync } from '../../lib/config.js';

interface UnstickResponse {
  success: boolean;
  issueId?: string;
  previousReason?: string;
  error?: string;
}

export async function unstickCommand(
  rawIssueId: string,
  fetchImpl: typeof fetch = fetch,
  dashboardUrl = getDashboardApiUrlSync(),
): Promise<void> {
  const issueId = rawIssueId.toUpperCase();

  try {
    const response = await fetchImpl(`${dashboardUrl.replace(/\/$/, '')}/api/workspaces/${issueId}/unstick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await response.json() as UnstickResponse;

    if (!response.ok || !result.success) {
      console.error(chalk.red(`Error: ${result.error || `Failed to clear stuck gate for ${issueId}`}`));
      process.exitCode = 1;
      return;
    }

    console.log(chalk.green(
      `Cleared stuck gate for ${issueId}${result.previousReason ? ` (was: ${result.previousReason})` : ''}.`,
    ));
  } catch (error: unknown) {
    const failure = error as { code?: string; message?: string };
    if (failure.code === 'ECONNREFUSED') {
      console.error(chalk.red('Error: Dashboard not running'));
      console.error(chalk.dim('Start the dashboard with: pan up'));
    } else {
      console.error(chalk.red(`Error: ${failure.message ?? String(error)}`));
    }
    process.exitCode = 1;
  }
}

export function registerUnstickCommand(program: Command): void {
  program.command('unstick <id>')
    .description('Clear an issue stuck gate without resetting a merged lifecycle')
    .action((id: string) => unstickCommand(id));
}
