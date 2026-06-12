const ISSUE_TITLE_MAP_TTL_MS = 30_000;
let issueTitleMapCache: { timestamp: number; data: ReadonlyMap<string, string> } | null = null;

export function sanitizeDisplayTitle(title: string): string {
  return title
    .replace(/<!--\s*panopticon:[\s\S]*?-->/gi, '')
    .replace(/\s+/g, ' ')
    .trim();
}

async function getIssueDataService() {
  const { getSharedIssueService } = await import('./issue-service-singleton.js');
  return getSharedIssueService();
}

export async function buildIssueTitleMap(): Promise<ReadonlyMap<string, string>> {
  if (issueTitleMapCache && issueTitleMapCache.timestamp > Date.now() - ISSUE_TITLE_MAP_TTL_MS) {
    return issueTitleMapCache.data;
  }

  const issueTitles = new Map<string, string>();
  try {
    const issueDataService = await getIssueDataService();
    const allIssues = issueDataService.getIssues() as Array<Record<string, unknown>>;
    for (const issue of allIssues) {
      const identifier = typeof issue['identifier'] === 'string' ? issue['identifier'] : null;
      const title = typeof issue['title'] === 'string' ? sanitizeDisplayTitle(issue['title']) : '';
      if (!identifier || !title) continue;
      issueTitles.set(identifier, title);
      issueTitles.set(identifier.toLowerCase(), title);
    }
  } catch {
    // non-fatal: callers fall back to planning prompt or issue id
  }

  issueTitleMapCache = { timestamp: Date.now(), data: issueTitles };
  return issueTitles;
}
