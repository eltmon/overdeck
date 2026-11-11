/**
 * `pan done` for Jira issues (PAN-5152, FR-8, FR-10).
 *
 * Links each pull request to the Jira issue, moves the issue to In Review
 * and, with `--comment`, posts the same agent-completed comment Linear gets.
 * Every write goes through the non-failing Jira seam, so `pan done` never
 * fails over a Jira call.
 */

import chalk from 'chalk';
import { Effect } from 'effect';
import { createJiraTrackerForIssue } from '../../lib/tracker/factory.js';
import { commentOnJiraIssue, linkJiraPullRequest, transitionJiraIssue } from '../../lib/tracker/jira-lifecycle.js';

/** Link the PRs, move the issue to In Review, then comment. True when the issue reached In Review. */
export async function updateJiraToInReview(issueId: string, prUrls: string[], comment?: string): Promise<boolean> {
  for (const prUrl of prUrls) await linkJiraPullRequest(issueId, prUrl);
  const moved = await transitionJiraIssue(issueId, 'in_review');
  if (comment) await commentOnJiraIssue(issueId, `🤖 **Agent completed work:**\n\n${comment}`);
  return moved.kind === 'transitioned' || moved.kind === 'already';
}

/**
 * Refuse a done on a Jira issue already in Done or Canceled. A Jira read
 * error only warns: it never blocks `pan done`.
 */
export async function refuseIfJiraIssueClosed(issueId: string): Promise<string | null> {
  try {
    const issue = await Effect.runPromise(createJiraTrackerForIssue(issueId).getIssue(issueId));
    return issue.canonicalState === 'done' || issue.canonicalState === 'canceled'
      ? `${issueId} is already closed in Jira (${issue.rawState ?? issue.canonicalState}).`
      : null;
  } catch (error) {
    const message = error instanceof Error ? error.message : String((error as { message?: unknown })?.message ?? error);
    console.warn(chalk.yellow(`Could not verify Jira state: ${message}`));
    return null;
  }
}
