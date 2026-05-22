import { Effect } from 'effect';
/**
 * pan show - Display shadow state details for an issue
 *
 * Shows shadow state information including:
 * - Shadow status vs tracker status
 * - Shadow history timeline
 * - Sync status
 */

import chalk from 'chalk';
import ora from 'ora';
import { getShadowState, needsSync, getUnsyncedHistory } from '../../lib/shadow-state.js';
import { formatState, formatDate } from '../../lib/shadow-utils.js';

export async function shadowCommand(id: string): Promise<void> {
  const spinner = ora(`Fetching shadow state for ${id}...`).start();

  const issueId = id.toUpperCase();
  const state = await Effect.runPromise(getShadowState(issueId));

  if (!state) {
    spinner.fail(`Issue ${issueId} is not in shadow mode`);
    console.log(chalk.dim('Use --shadow flag when running pan start/plan/done to enable shadow mode'));
    process.exit(1);
  }

  spinner.stop();

  // Display header
  console.log('');
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan(`  Shadow State: ${issueId}`));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════'));
  console.log('');

  // Display current status
  console.log(chalk.bold('Current Status:'));
  console.log(`  Shadow Status:  ${formatState(state.shadowStatus)}`);
  console.log(`  Tracker Status: ${formatState(state.trackerStatus)}`);
  console.log(`  Shadowed At:    ${formatDate(state.shadowedAt)}`);

  if (state.syncedAt) {
    console.log(`  Last Synced:    ${formatDate(state.syncedAt)}`);
  }

  // Show sync status
  const needsSyncFlag = await Effect.runPromise(needsSync(issueId));
  console.log(`  Sync Status:    ${needsSyncFlag ? chalk.yellow('⚠ Out of sync') : chalk.green('✓ In sync')}`);
  console.log('');

  // Display history
  if (state.history.length > 0) {
    console.log(chalk.bold('History:'));
    console.log('');

    const unsyncedEntries = await Effect.runPromise(getUnsyncedHistory(issueId));

    for (const entry of state.history) {
      const syncIndicator = entry.syncedToTracker ? chalk.green('✓') : chalk.yellow('○');
      const fromState = formatState(entry.from);
      const toState = formatState(entry.to);
      const date = formatDate(entry.at);

      console.log(`  ${syncIndicator} ${fromState} → ${toState}`);
      console.log(`    ${chalk.dim('at:')} ${date}`);
      console.log(`    ${chalk.dim('by:')} ${entry.by}`);
      console.log('');
    }

    if (unsyncedEntries.length > 0) {
      console.log(chalk.yellow(`⚠ ${unsyncedEntries.length} transition(s) pending sync to tracker`));
      console.log(chalk.dim(`   Run: pan show ${issueId}`));
      console.log('');
    }
  } else {
    console.log(chalk.dim('No history entries'));
    console.log('');
  }

  // Display actions
  console.log(chalk.bold('Actions:'));
  console.log(`  Sync to tracker:   pan show ${issueId}`);
  console.log(`  Refresh from tracker: pan show ${issueId}`);
  console.log('');
}
