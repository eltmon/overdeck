/**
 * pan work shadow - Display shadow state details for an issue
 *
 * Shows shadow state information including:
 * - Shadow status vs tracker status
 * - Shadow history timeline
 * - Sync status
 */

import chalk from 'chalk';
import ora from 'ora';
import { getShadowState, needsSync, getUnsyncedHistory } from '../../../lib/shadow-state.js';

export async function shadowCommand(id: string): Promise<void> {
  const spinner = ora(`Fetching shadow state for ${id}...`).start();

  const issueId = id.toUpperCase();
  const state = getShadowState(issueId);

  if (!state) {
    spinner.fail(`Issue ${issueId} is not in shadow mode`);
    console.log(chalk.dim('Use --shadow flag when running pan work issue/plan/done to enable shadow mode'));
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
  const needsSyncFlag = needsSync(issueId);
  console.log(`  Sync Status:    ${needsSyncFlag ? chalk.yellow('⚠ Out of sync') : chalk.green('✓ In sync')}`);
  console.log('');

  // Display history
  if (state.history.length > 0) {
    console.log(chalk.bold('History:'));
    console.log('');

    const unsyncedEntries = getUnsyncedHistory(issueId);

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
      console.log(chalk.dim(`   Run: pan work sync ${issueId}`));
      console.log('');
    }
  } else {
    console.log(chalk.dim('No history entries'));
    console.log('');
  }

  // Display actions
  console.log(chalk.bold('Actions:'));
  console.log(`  Sync to tracker:   pan work sync ${issueId}`);
  console.log(`  Refresh from tracker: pan work refresh ${issueId}`);
  console.log('');
}

/**
 * Format state for display
 */
function formatState(state: string): string {
  const colors: Record<string, (s: string) => string> = {
    'open': chalk.blue,
    'in_progress': chalk.yellow,
    'closed': chalk.green,
  };

  const display = state.replace('_', ' ').replace(/\b\w/g, l => l.toUpperCase());
  const colorFn = colors[state] || chalk.white;
  return colorFn(display);
}

/**
 * Format date for display
 */
function formatDate(dateStr: string): string {
  const date = new Date(dateStr);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  let relative = '';
  if (diffMins < 1) {
    relative = 'just now';
  } else if (diffMins < 60) {
    relative = `${diffMins}m ago`;
  } else if (diffHours < 24) {
    relative = `${diffHours}h ago`;
  } else {
    relative = `${diffDays}d ago`;
  }

  return `${date.toLocaleString()} ${chalk.dim(`(${relative})`)}`;
}
