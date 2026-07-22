import chalk from 'chalk';
import { getDashboardApiUrlSync } from '../../lib/config.js';

const DASHBOARD_URL = getDashboardApiUrlSync();

interface ResyncReviewResponse {
  ok: boolean;
  error?: string;
  status?: {
    reviewStatus: string;
    testStatus: string;
    readyForMerge: boolean;
  };
}

export async function resyncReviewCommand(id: string): Promise<void> {
  const issueId = id.toUpperCase();

  try {
    const response = await fetch(`${DASHBOARD_URL}/api/review/${issueId}/resync`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    });
    const result = await response.json() as ResyncReviewResponse;

    if (!response.ok || !result.ok || !result.status) {
      console.error(chalk.red(`Error: ${result.error || 'Failed to re-sync review status'}`));
      process.exit(1);
    }

    console.log(chalk.green(
      `✓ Re-synced ${issueId}: review=${result.status.reviewStatus} ` +
      `test=${result.status.testStatus} readyForMerge=${result.status.readyForMerge}`,
    ));
  } catch (error: unknown) {
    const failure = error as { code?: string; message?: string };
    if (failure.code === 'ECONNREFUSED') {
      console.error(chalk.red('Error: Dashboard not running'));
      console.error(chalk.dim('Start the dashboard with: pan up'));
      process.exit(1);
    }
    console.error(chalk.red(`Error: ${failure.message ?? String(error)}`));
    process.exit(1);
  }
}
