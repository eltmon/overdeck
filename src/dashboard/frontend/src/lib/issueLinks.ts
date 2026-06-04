// PAN-1610 quick-win: make it easy to jump from any issue surface to the full
// issue on its tracker. Prefer the issue's canonical tracker `url` when we have
// it (covers Linear/GitLab/etc.); otherwise derive a GitHub issues URL for the
// known GitHub-tracked prefixes. Returns null when we can't resolve a URL, so
// callers can fall back to plain text.

const GITHUB_REPO_BY_PREFIX: Record<string, string> = {
  PAN: 'eltmon/panopticon-cli',
  KRUX: 'eltmon/krux',
};

export function trackerIssueUrl(issueId: string, explicitUrl?: string | null): string | null {
  if (explicitUrl) return explicitUrl;
  const match = /^([A-Za-z]+)-(\d+)$/.exec(issueId.trim());
  if (!match) return null;
  const repo = GITHUB_REPO_BY_PREFIX[match[1].toUpperCase()];
  return repo ? `https://github.com/${repo}/issues/${match[2]}` : null;
}
