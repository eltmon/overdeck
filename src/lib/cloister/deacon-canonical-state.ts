import { execFile } from 'child_process';
import { promisify } from 'util';
import { mapGitHubStateToCanonical } from '../../core/state-mapping.js';
import { resolveGitHubIssueSync } from '../tracker-utils.js';

const execFileAsync = promisify(execFile);

// Cache for auto-close-out canonical state queries to avoid N+1 shell execs on patrol
const autoCloseOutCache = new Map<string, { state: string | null; timestamp: number }>();
const AUTO_CLOSE_OUT_CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

export function sweepAutoCloseOutCache(): void {
  const now = Date.now();
  for (const [issueId, entry] of autoCloseOutCache.entries()) {
    if (now - entry.timestamp > AUTO_CLOSE_OUT_CACHE_TTL_MS) {
      autoCloseOutCache.delete(issueId);
    }
  }
}

export async function getAutoCloseOutCanonicalState(issueId: string): Promise<string | null> {
  const cached = autoCloseOutCache.get(issueId);
  if (cached && Date.now() - cached.timestamp < AUTO_CLOSE_OUT_CACHE_TTL_MS) {
    return cached.state;
  }

  const ghResolved = resolveGitHubIssueSync(issueId);
  if (!ghResolved.isGitHub) {
    autoCloseOutCache.set(issueId, { state: null, timestamp: Date.now() });
    return null;
  }

  try {
    const { stdout } = await execFileAsync('gh', [
      'issue',
      'view',
      String(ghResolved.number),
      '--repo',
      `${ghResolved.owner}/${ghResolved.repo}`,
      '--json',
      'state,labels',
    ], { encoding: 'utf-8' });
    const parsed = JSON.parse(stdout) as { state?: string; labels?: Array<string | { name?: string }> };
    const labels = (parsed.labels ?? [])
      .map(label => typeof label === 'string' ? label : label.name)
      .filter((label): label is string => typeof label === 'string');
    const result = mapGitHubStateToCanonical(parsed.state ?? 'open', labels);
    autoCloseOutCache.set(issueId, { state: result, timestamp: Date.now() });
    return result;
  } catch {
    autoCloseOutCache.set(issueId, { state: null, timestamp: Date.now() });
    return null;
  }
}
