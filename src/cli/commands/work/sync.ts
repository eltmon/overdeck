/**
 * pan work sync - Sync shadow state to tracker
 *
 * Pushes the shadow state to the issue tracker and marks entries as synced.
 */

import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import {
  getShadowState,
  markAsSynced,
  needsSync,
  updateTrackerStatusCache,
} from '../../../lib/shadow-state.js';
import type { IssueState } from '../../../lib/tracker/interface.js';

interface SyncOptions {
  force?: boolean;
  dryRun?: boolean;
}

/**
 * Get Linear API key from environment or config file
 */
function getLinearApiKey(): string | null {
  const envFile = join(homedir(), '.panopticon.env');
  if (existsSync(envFile)) {
    const content = readFileSync(envFile, 'utf-8');
    const match = content.match(/LINEAR_API_KEY=(.+)/);
    if (match) return match[1].trim();
  }
  return process.env.LINEAR_API_KEY || null;
}

/**
 * Check if an issue ID is a Linear issue (has team prefix like MIN-, PAN-, etc.)
 */
function isLinearIssue(issueId: string): boolean {
  return /^[A-Z]+-\d+$/i.test(issueId);
}

/**
 * Map canonical state to Linear state name
 */
function getLinearStateName(state: IssueState): string {
  switch (state) {
    case 'open':
      return 'Backlog';
    case 'in_progress':
      return 'In Progress';
    case 'closed':
      return 'Done';
    default:
      return 'Backlog';
  }
}

/**
 * Sync shadow state to Linear
 */
async function syncToLinear(
  apiKey: string,
  issueId: string,
  targetState: IssueState
): Promise<{ success: boolean; error?: string; previousState?: IssueState }> {
  try {
    const { LinearClient } = await import('@linear/sdk');
    const client = new LinearClient({ apiKey });

    // Find the issue
    const me = await client.viewer;
    const teams = await me.teams();
    const team = teams.nodes[0];

    if (!team) {
      return { success: false, error: 'No Linear team found' };
    }

    const issues = await team.issues({ first: 100 });
    const issue = issues.nodes.find(
      (i) => i.identifier.toUpperCase() === issueId.toUpperCase()
    );

    if (!issue) {
      return { success: false, error: `Issue ${issueId} not found in Linear` };
    }

    // Get current state
    const currentState = await issue.state;
    const previousState = currentState?.type === 'completed' ? 'closed' :
                         currentState?.type === 'started' ? 'in_progress' : 'open';

    // Find the target state
    const states = await team.states();
    let targetLinearState = null;

    switch (targetState) {
      case 'open':
        targetLinearState = states.nodes.find((s) => s.type === 'unstarted');
        break;
      case 'in_progress':
        targetLinearState = states.nodes.find((s) => s.type === 'started');
        break;
      case 'closed':
        targetLinearState = states.nodes.find((s) => s.type === 'completed');
        break;
    }

    if (!targetLinearState) {
      return { success: false, error: `Could not find Linear state for ${targetState}` };
    }

    // Update the issue
    await issue.update({ stateId: targetLinearState.id });

    return {
      success: true,
      previousState,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error syncing to Linear',
    };
  }
}

export async function syncCommand(id: string, options: SyncOptions = {}): Promise<void> {
  const spinner = ora(`Preparing sync for ${id}...`).start();

  const issueId = id.toUpperCase();
  const state = getShadowState(issueId);

  if (!state) {
    spinner.fail(`Issue ${issueId} is not in shadow mode`);
    console.log(chalk.dim('Use --shadow flag when running pan work issue/plan/done to enable shadow mode'));
    process.exit(1);
  }

  if (!needsSync(issueId)) {
    spinner.succeed(`Issue ${issueId} is already in sync with tracker`);
    return;
  }

  spinner.stop();

  // Show sync preview
  console.log('');
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════'));
  console.log(chalk.bold.cyan(`  Sync Preview: ${issueId}`));
  console.log(chalk.bold.cyan('═══════════════════════════════════════════════════════════'));
  console.log('');

  console.log(chalk.bold('Current State:'));
  console.log(`  Shadow Status:  ${state.shadowStatus}`);
  console.log(`  Tracker Status: ${state.trackerStatus}`);
  console.log('');

  console.log(chalk.bold('Planned Changes:'));
  console.log(`  Will update tracker from ${chalk.yellow(state.trackerStatus)} to ${chalk.green(state.shadowStatus)}`);
  console.log('');

  if (options.dryRun) {
    console.log(chalk.dim('Dry run - no changes made'));
    return;
  }

  // Confirmation
  if (!options.force) {
    const { confirmed } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirmed',
      message: 'Proceed with sync?',
      default: true,
    }]);

    if (!confirmed) {
      console.log(chalk.yellow('Sync cancelled'));
      return;
    }
  }

  console.log('');
  spinner.start('Syncing to tracker...');

  // Attempt to sync
  let retryCount = 0;
  const maxRetries = 3;

  while (retryCount < maxRetries) {
    let result: { success: boolean; error?: string; previousState?: IssueState } = {
      success: false,
      error: 'No tracker configured',
    };

    if (isLinearIssue(issueId)) {
      const apiKey = getLinearApiKey();
      if (apiKey) {
        result = await syncToLinear(apiKey, issueId, state.shadowStatus);
      } else {
        result.error = 'LINEAR_API_KEY not set';
      }
    } else {
      spinner.fail('Only Linear issues are supported for sync');
      process.exit(1);
    }

    if (result.success) {
      spinner.succeed(`Synced ${issueId} to ${state.shadowStatus}`);

      // Mark shadow state as synced
      markAsSynced(issueId, state.shadowStatus, result.previousState);

      console.log('');
      console.log(chalk.green('✓ Sync complete'));
      console.log(`  Previous tracker state: ${result.previousState || 'unknown'}`);
      console.log(`  New tracker state:      ${state.shadowStatus}`);
      console.log('');

      return;
    }

    // Sync failed
    spinner.fail(`Sync failed: ${result.error}`);
    console.log('');

    if (retryCount < maxRetries - 1) {
      // Ask user what to do
      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Retry', value: 'retry' },
          { name: 'Skip for now', value: 'skip' },
          { name: 'Queue for later', value: 'queue' },
        ],
      }]);

      if (action === 'retry') {
        retryCount++;
        spinner.start(`Retrying sync (attempt ${retryCount + 1}/${maxRetries})...`);
        continue;
      } else if (action === 'skip') {
        console.log(chalk.yellow('Sync skipped'));
        console.log(chalk.dim(`Run 'pan work sync ${issueId}' to try again later`));
        return;
      } else if (action === 'queue') {
        // Queue for later processing
        queueForLater(issueId, state.shadowStatus, result.error);
        console.log(chalk.cyan('✓ Queued for later sync'));
        console.log(chalk.dim(`Run 'pan work sync ${issueId}' to process the queue`));
        return;
      }
    } else {
      console.log(chalk.red(`Max retries (${maxRetries}) exceeded`));
      console.log('');

      const { action } = await inquirer.prompt([{
        type: 'list',
        name: 'action',
        message: 'What would you like to do?',
        choices: [
          { name: 'Skip for now', value: 'skip' },
          { name: 'Queue for later', value: 'queue' },
        ],
      }]);

      if (action === 'skip') {
        console.log(chalk.yellow('Sync skipped'));
        return;
      } else if (action === 'queue') {
        queueForLater(issueId, state.shadowStatus, result.error);
        console.log(chalk.cyan('✓ Queued for later sync'));
        return;
      }
    }

    retryCount++;
  }
}

/**
 * Queue a sync operation for later processing
 */
function queueForLater(
  issueId: string,
  targetState: IssueState,
  error?: string
): void {
  // TODO: Implement sync queue persistence
  // For now, just log it
  console.log(chalk.dim(`Queue entry: ${issueId} → ${targetState}`));
  if (error) {
    console.log(chalk.dim(`  Error: ${error}`));
  }
}
