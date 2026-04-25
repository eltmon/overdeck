/**
 * pan review abort <id>
 *
 * Kill all running reviewer tmux sessions for an issue and reset reviewStatus
 * to 'pending'. Does NOT message the work agent — leaves the worker idle.
 */

import chalk from 'chalk';
import { getDashboardApiUrl } from '../../lib/config.js';

const DASHBOARD_URL = getDashboardApiUrl();

export async function abortReviewCommand(id: string): Promise<void> {
  const issueId = id.toUpperCase();

  console.log(chalk.dim(`Aborting reviewers for ${issueId}...`));

  try {
    const response = await fetch(`${DASHBOARD_URL}/api/review/${issueId}/abort`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });

    const result = await response.json() as {
      success: boolean;
      message?: string;
      error?: string;
      killed?: string[];
      failed?: string[];
    };

    if (!response.ok) {
      console.error(chalk.red(`\nError: ${result.error || 'Failed to abort reviewers'}`));
      process.exit(1);
    }

    console.log(chalk.green(`\n✓ ${result.message}`));

    if (result.killed && result.killed.length > 0) {
      for (const s of result.killed) {
        console.log(chalk.dim(`  killed: ${s}`));
      }
    }
    if (result.failed && result.failed.length > 0) {
      console.log(chalk.yellow(`  Warning: ${result.failed.length} session(s) could not be killed`));
    }

  } catch (error: any) {
    if (error.code === 'ECONNREFUSED') {
      console.error(chalk.red('\nError: Dashboard not running'));
      console.error(chalk.dim('Start the dashboard with: pan up'));
      process.exit(1);
    }
    console.error(chalk.red(`\nError: ${error.message}`));
    process.exit(1);
  }
}
