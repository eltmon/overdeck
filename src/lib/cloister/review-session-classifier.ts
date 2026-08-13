/** Return whether a tmux session belongs to the review pipeline for an issue. */
export function isReviewSessionForIssue(
  sessionName: string,
  projectKey: string | undefined,
  issueId: string,
): boolean {
  const session = sessionName.toLowerCase();
  const issue = issueId.toLowerCase();
  const project = projectKey?.toLowerCase();

  // User conversation sessions must never be swept into reviewer cleanup.
  if (session.startsWith('conv-')) return false;

  if (session === `agent-${issue}-review` || session.startsWith(`agent-${issue}-review-`)) return true;
  if (session.startsWith(`review-${issue}-`) || session.startsWith(`review-coordinator-${issue}-`)) return true;
  if (!project) return false;
  if (session === `specialist-${project}-${issue}-review-agent`) return true;
  return session.startsWith(`specialist-${project}-${issue}-review-`);
}
