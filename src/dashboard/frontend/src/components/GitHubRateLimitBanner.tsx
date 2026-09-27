import type { GitHubQuotaPause, GitHubQuotaSnapshot } from '@overdeck/contracts';
import { PauseCircle } from 'lucide-react';

import { selectGitHubQuota, useDashboardStore } from '../lib/store';

/** Local `HH:MM` for an ISO time. */
function localTime(iso: string): string {
  const date = new Date(iso);
  return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
}

/** The pause to explain: the one that ends last. */
function latestPause(pauses: readonly GitHubQuotaPause[]): GitHubQuotaPause | null {
  let latest: GitHubQuotaPause | null = null;
  for (const pause of pauses) {
    if (!latest || Date.parse(pause.until) > Date.parse(latest.until)) latest = pause;
  }
  return latest;
}

/**
 * The banner text for an active pause (PAN-4264 decision table). `N` and the
 * top caller count points in the paused bucket over the last hour.
 */
export function gitHubRateLimitBannerText(quota: GitHubQuotaSnapshot, pause: GitHubQuotaPause): string {
  const who = quota.login ?? 'your account';
  const until = localTime(pause.until);
  if (pause.kind === 'secondary') {
    return `GitHub secondary rate limit for ${who}: calls paused until ${until}. Overdeck sent requests too fast; pollers resume automatically.`;
  }

  const bucketPoints = (usage: GitHubQuotaSnapshot['callers'][number]) => usage[pause.bucket].points;
  const machinePoints = quota.callers.reduce((sum, usage) => sum + bucketPoints(usage), 0);
  if (quota.ownUsageLow) {
    return `GitHub rate limit for ${who}: calls paused until ${until}; not caused by this machine (this machine used ${machinePoints} points in the last hour). Another tool or Overdeck install using this account is spending the shared limit.`;
  }

  const top = [...quota.callers].sort((a, b) => bucketPoints(b) - bucketPoints(a))[0];
  if (top && bucketPoints(top) > 0) {
    return `GitHub rate limit for ${who}: calls paused until ${until}. This machine used ${machinePoints} points in the last hour; top caller: ${top.caller} (${bucketPoints(top)} points).`;
  }
  return `GitHub rate limit for ${who}: calls paused until ${until}.`;
}

/**
 * GitHubRateLimitBanner (PAN-4264) — shown while GitHub calls are paused after
 * a rate-limit refusal. Read-model pollers (pipeline membership, PR sync, CI
 * repair, the issue poller, the close-out reaper) skip GitHub until the pause
 * ends; merges, verdicts and agents keep running. The banner says when the
 * pause ends and whether this machine's own use explains it.
 *
 * State arrives through the read model (snapshot, then `github_quota.changed`);
 * the banner never polls. Amber: the operator should know, but nothing is
 * broken and nothing needs a click.
 */
export function GitHubRateLimitBanner() {
  const quota = useDashboardStore(selectGitHubQuota);
  const pause = quota ? latestPause(quota.pauses) : null;
  if (!quota || !pause) return null;

  const text = gitHubRateLimitBannerText(quota, pause);
  return (
    <div className="bg-warning/10 flex flex-1 items-center gap-2 px-4 py-1.5" data-testid="github-rate-limit-banner">
      <PauseCircle className="w-3.5 h-3.5 text-warning-foreground shrink-0" />
      <p className="flex-1 truncate text-xs text-warning-foreground" title={text}>
        {text}
      </p>
    </div>
  );
}
