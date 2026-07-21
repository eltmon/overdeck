/**
 * PAN-2908 · C-SIMPLE — "Get help" routing.
 *
 * In simple mode the operator IS the human on the other side, so "Get help"
 * routes to the issue tracker: a new GitHub issue prefilled with a [HELP]
 * pointer back to this task, or the tracker's new-issue page when the URL
 * shape is recognized. Returns null when we can't derive one — the link is
 * then rendered as plain text rather than a dead end.
 */
export function getHelpUrl(issue: { identifier: string; title: string; url?: string | null }): string | null {
  const url = issue.url ?? '';
  const github = /^https?:\/\/github\.com\/([^/]+\/[^/]+)\/issues\/\d+/.exec(url);
  if (github) {
    const title = encodeURIComponent(`[HELP] ${issue.identifier}: ${issue.title}`.slice(0, 200));
    return `https://github.com/${github[1]}/issues/new?title=${title}`;
  }
  const linear = /^https?:\/\/linear\.app\/([^/]+)\/issue\//.exec(url);
  if (linear) {
    return `https://linear.app/${linear[1]}/new`;
  }
  return null;
}
