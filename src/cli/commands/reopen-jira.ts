/**
 * `pan reopen` for Jira issues (PAN-5152, FR-10).
 *
 * Moves the Jira issue back to To Do through its workflow and posts a reopen
 * comment, both through the non-failing Jira write seam. The caller then
 * resets the workspace state, as it does for GitHub and Linear issues.
 */

import chalk from 'chalk';
import inquirer from 'inquirer';
import { commentOnJiraIssue, transitionJiraIssue } from '../../lib/tracker/jira-lifecycle.js';
/** The `pan reopen` options this command reads (a subset of ReopenOptions). */
export interface JiraReopenOptions {
  force?: boolean;
  json?: boolean;
  reason?: string;
}

/** Reopen a Jira issue. Returns false when the operator cancels. */
export async function reopenJiraIssueCommand(issueId: string, options: JiraReopenOptions): Promise<boolean> {
  const key = issueId.toUpperCase();
  if (!options.force && !options.json) {
    const { proceed } = await inquirer.prompt([
      { type: 'confirm', name: 'proceed', message: `Reopen ${key} and reset workspace state?`, default: true },
    ]);
    if (!proceed) {
      console.log(chalk.yellow('Cancelled'));
      return false;
    }
  }

  const outcome = await transitionJiraIssue(key, 'todo');
  const color = outcome.kind === 'transitioned' || outcome.kind === 'already' ? chalk.green : chalk.yellow;
  console.log(color(outcome.message));

  const reasonText = options.reason ? ` Reason: ${options.reason}.` : '';
  const comment = await commentOnJiraIssue(key, `Issue reopened for re-work via Overdeck.${reasonText}`);
  if (comment.kind === 'error') console.log(chalk.yellow(`Could not add the reopen comment: ${comment.message}`));
  return true;
}
