/**
 * pan show - Refresh tracker status cache
 *
 * Fetches current status from tracker and updates the shadow state cache.
 */

import chalk from 'chalk';
import ora from 'ora';
import {
  getShadowState,
  updateTrackerStatusCache,
} from '../../lib/shadow-state.js';
import type { IssueState } from '../../lib/tracker/interface.js';
import { Effect } from 'effect';
import { getLinearApiKey, isLinearIssue, formatState } from '../../lib/shadow-utils.js';

interface RefreshOptions {
  json?: boolean;
}

/**
 * Refresh tracker status from Linear
 */
async function refreshFromLinear(
  apiKey: string,
  issueId: string
): Promise<{ success: boolean; error?: string; state?: IssueState }> {
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
    const linearState = await issue.state;
    const canonicalState: IssueState = linearState?.type === 'completed' ? 'closed' :
                                        linearState?.type === 'started' ? 'in_progress' : 'open';

    return {
      success: true,
      state: canonicalState,
    };
  } catch (error: any) {
    return {
      success: false,
      error: error.message || 'Unknown error refreshing from Linear',
    };
  }
}

export async function refreshCommand(id: string, options: RefreshOptions = {}): Promise<void> {
  const spinner = ora(`Refreshing tracker status for ${id}...`).start();

  const issueId = id.toUpperCase();
  const state = await Effect.runPromise(getShadowState(issueId));

  if (!state) {
    spinner.fail(`Issue ${issueId} is not in shadow mode`);
    console.log(chalk.dim('Use --shadow flag when running pan start/plan/done to enable shadow mode'));
    process.exit(1);
  }

  let result: { success: boolean; error?: string; state?: IssueState } = {
    success: false,
    error: 'No tracker configured',
  };

  if (isLinearIssue(issueId)) {
    const apiKey = await Effect.runPromise(getLinearApiKey());
    if (apiKey) {
      result = await refreshFromLinear(apiKey, issueId);
    } else {
      spinner.fail('LINEAR_API_KEY not set');
      process.exit(1);
    }
  } else {
    spinner.fail('Only Linear issues are supported for refresh');
    process.exit(1);
  }

  if (!result.success) {
    spinner.fail(`Refresh failed: ${result.error}`);
    process.exit(1);
  }

  // Update the cache
  await Effect.runPromise(updateTrackerStatusCache(issueId, result.state!));

  spinner.succeed(`Refreshed tracker status for ${issueId}`);

  if (options.json) {
    console.log(JSON.stringify({
      issueId,
      trackerState: result.state,
      shadowState: state.shadowStatus,
      inSync: result.state === state.shadowStatus,
      refreshedAt: new Date().toISOString(),
    }, null, 2));
    return;
  }

  // Display results
  console.log('');
  console.log(chalk.bold('Status Update:'));
  console.log(`  Tracker Status: ${formatState(result.state!)}`);
  console.log(`  Shadow Status:  ${formatState(state.shadowStatus)}`);

  if (result.state !== state.shadowStatus) {
    console.log('');
    console.log(chalk.yellow('⚠ Status mismatch detected'));
    console.log(chalk.dim('  Shadow state differs from tracker state'));
    console.log(chalk.dim(`  Run: pan show ${issueId}  (to push shadow → tracker)`));
    console.log(chalk.dim(`  Or:  pan show ${issueId} (to review history)`));
  } else {
    console.log('');
    console.log(chalk.green('✓ Shadow state is in sync with tracker'));
  }

  console.log('');
}
