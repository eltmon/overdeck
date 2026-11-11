/**
 * The non-failing Jira write seam (PAN-5152, FR-6, FR-8, D-8).
 *
 * Every lifecycle write to a Jira issue (status transition, comment, pull
 * request link) goes through these three functions. Each one always
 * resolves: network, auth and "no transition reaches the status" all come
 * back as outcome values and are logged here, so a Jira write can never
 * block a merge or a close-out. Callers branch on
 * `resolveTrackerType(issueId) === 'jira'` and call the seam.
 */

import { Effect } from 'effect';
import { loadProjectsConfig, resolveProjectFromIssue } from '../projects.js';
import { createJiraTrackerForProject } from './factory.js';
import type { JiraTracker } from './jira.js';
import type { JiraTransitionOutcome, JiraTransitionTarget } from './jira-status.js';

export type JiraWriteOutcome =
  | { kind: 'ok'; message: string }
  | { kind: 'error'; message: string };

const NOT_JIRA = 'not a Jira issue';

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === 'object' && error !== null && 'message' in error) return String((error as { message: unknown }).message);
  return String(error);
}

/** The JiraTracker for an issue's project, or null when the project is not `tracker: jira`. */
async function jiraTrackerForIssue(issueId: string): Promise<JiraTracker | null> {
  const resolved = await Effect.runPromise(resolveProjectFromIssue(issueId));
  if (!resolved) return null;
  const { projects } = await Effect.runPromise(loadProjectsConfig());
  const project = projects[resolved.projectKey];
  if (project?.tracker !== 'jira') return null;
  return createJiraTrackerForProject(resolved.projectKey, project);
}

async function runWrite(
  issueId: string,
  verb: string,
  write: (tracker: JiraTracker) => Effect.Effect<unknown, unknown>,
): Promise<JiraWriteOutcome> {
  try {
    const tracker = await jiraTrackerForIssue(issueId);
    if (!tracker) return { kind: 'error', message: NOT_JIRA };
    await Effect.runPromise(write(tracker));
    console.log(`[jira] ${issueId}: ${verb} ok`);
    return { kind: 'ok', message: `${verb} ok` };
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`[jira] ${issueId}: ${verb} failed: ${message}`);
    return { kind: 'error', message };
  }
}

/** Move a Jira issue toward `target`. Never rejects. */
export async function transitionJiraIssue(issueId: string, target: JiraTransitionTarget): Promise<JiraTransitionOutcome> {
  try {
    const tracker = await jiraTrackerForIssue(issueId);
    if (!tracker) return { kind: 'error', message: NOT_JIRA };
    const outcome = await Effect.runPromise(tracker.transitionToCanonical(issueId, target));
    if (outcome.kind === 'no-transition') console.warn(`[jira] ${outcome.message}`);
    else console.log(`[jira] ${issueId}: transition to ${target} ok (${outcome.kind})`);
    return outcome;
  } catch (error) {
    const message = errorMessage(error);
    console.warn(`[jira] ${issueId}: transition to ${target} failed: ${message}`);
    return { kind: 'error', message };
  }
}

/** Post a Markdown comment on a Jira issue. Never rejects. */
export function commentOnJiraIssue(issueId: string, markdown: string): Promise<JiraWriteOutcome> {
  return runWrite(issueId, 'comment', tracker => tracker.addComment(issueId, markdown));
}

/** Attach a pull request URL to a Jira issue as a remote link. Never rejects. */
export function linkJiraPullRequest(issueId: string, prUrl: string): Promise<JiraWriteOutcome> {
  return runWrite(issueId, 'link pull request', tracker => tracker.linkPR(issueId, prUrl));
}
