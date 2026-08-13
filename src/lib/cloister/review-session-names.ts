/** Classifies reviewer tmux session names without importing review lifecycle modules. */
export function isReviewSessionForIssue(sessionName: string, projectKey: string | undefined, issueId: string): boolean {
  const session = sessionName.toLowerCase();
  const issue = issueId.toLowerCase();
  const project = projectKey?.toLowerCase();
  if (session.startsWith('conv-')) return false;
  if (session === `agent-${issue}-review` || session.startsWith(`agent-${issue}-review-`)) return true;
  if (session.startsWith(`review-${issue}-`) || session.startsWith(`review-coordinator-${issue}-`)) return true;
  if (!project) return false;
  return session === `specialist-${project}-${issue}-review-agent`
    || session.startsWith(`specialist-${project}-${issue}-review-`);
}
