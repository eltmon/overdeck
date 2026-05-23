/**
 * pan sync-main <id>
 *
 * Sync the latest main branch into a workspace's feature branch.
 * Uses git merge (not rebase) and delegates conflict resolution to the merge-agent.
 */

import chalk from 'chalk';
import ora from 'ora';
import { getDashboardApiUrlSync } from '../../lib/config.js';

const DASHBOARD_URL = getDashboardApiUrlSync();

interface SyncMainResponse {
  success: boolean;
  alreadyUpToDate?: boolean;
  commitCount?: number;
  changedFiles?: string[];
  conflictFiles?: string[];
  message?: string;
  error?: string;
}

export async function syncMainCommand(id: string): Promise<void> {
  const issueId = id.toUpperCase();
  const spinner = ora(`Syncing main into ${issueId}...`).start();

  try {
    const response = await fetch(`${DASHBOARD_URL}/api/issues/${issueId}/sync-main`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await response.json() as SyncMainResponse;

    if (!response.ok) {
      spinner.fail(chalk.red(`Sync failed: ${result.error || 'Unknown error'}`));
      if (result.conflictFiles && result.conflictFiles.length > 0) {
        console.error(chalk.yellow('\nConflict files:'));
        result.conflictFiles.forEach(f => console.error(chalk.yellow(`  - ${f}`)));
      }
      process.exit(1);
    }

    if (result.alreadyUpToDate) {
      spinner.succeed(chalk.green(`${issueId} is already up to date with main`));
      return;
    }

    spinner.succeed(chalk.green(`✓ ${result.message || 'Sync complete'}`));

    if (result.commitCount !== undefined) {
      console.log(chalk.dim(`  Commits merged: ${result.commitCount}`));
    }

    if (result.changedFiles && result.changedFiles.length > 0) {
      const shown = result.changedFiles.slice(0, 10);
      console.log(chalk.dim(`  Changed files (${result.changedFiles.length}):`));
      shown.forEach(f => console.log(chalk.dim(`    ${f}`)));
      if (result.changedFiles.length > 10) {
        console.log(chalk.dim(`    ... and ${result.changedFiles.length - 10} more`));
      }
    }
  } catch (error: any) {
    spinner.fail(chalk.red(`Failed to reach dashboard: ${error.message}`));
    console.error(chalk.dim(`Make sure the dashboard is running: pan up`));
    process.exit(1);
  }
}
