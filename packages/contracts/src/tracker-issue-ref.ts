/**
 * Tracker issue references (PAN-4714): parse a tracker issue URL found in a
 * conversation (GitHub `/issues/<n>`, Linear `/issue/<KEY-n>`) and resolve it to
 * the Overdeck issue ID of a registered project, so the dashboard can open that
 * issue's drawer instead of the tracker. Resolution reads the project registry
 * (`/api/registered-projects`); there is no prefix table here.
 */

export type TrackerIssueUrlRef =
  | { readonly tracker: 'github'; readonly repository: string; readonly number: number }
  | { readonly tracker: 'linear'; readonly identifier: string };

/** The `/api/registered-projects` fields resolution reads. `linearTeam` is the issue prefix. */
export interface TrackerIssueProject {
  readonly linearTeam?: string | null;
  readonly githubRepo?: string | null;
  readonly tracker?: string | null;
}

const GITHUB_ISSUE = /^(?:https?:\/\/)?github\.com\/([\w.-]+\/[\w.-]+)\/issues\/(\d+)\/?(?:[?#].*)?$/i;
const LINEAR_ISSUE = /^(?:https?:\/\/)?linear\.app\/[\w.-]+\/issue\/([A-Za-z]+-\d+)(?:\/[^?#]*)?(?:[?#].*)?$/i;

export function parseTrackerIssueUrl(input: string): TrackerIssueUrlRef | null {
  const text = input.trim();
  const github = GITHUB_ISSUE.exec(text);
  if (github) {
    const number = Number(github[2]);
    if (!Number.isSafeInteger(number) || number <= 0) return null;
    return { tracker: 'github', repository: github[1]!.toLowerCase().replace(/\.git$/, ''), number };
  }
  const linear = LINEAR_ISSUE.exec(text);
  if (linear) return { tracker: 'linear', identifier: linear[1]!.toUpperCase() };
  return null;
}

export function resolveTrackerIssueId(ref: TrackerIssueUrlRef, projects: readonly TrackerIssueProject[]): string | null {
  for (const project of projects) {
    const prefix = typeof project?.linearTeam === 'string' ? project.linearTeam.trim().toUpperCase() : '';
    if (!prefix || project.tracker !== ref.tracker) continue;
    if (ref.tracker === 'github') {
      if (project.githubRepo?.toLowerCase() === ref.repository) return `${prefix}-${ref.number}`;
    } else if (ref.identifier.slice(0, ref.identifier.lastIndexOf('-')) === prefix) {
      return ref.identifier;
    }
  }
  return null;
}
