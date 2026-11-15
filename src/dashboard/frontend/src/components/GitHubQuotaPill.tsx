import type { GitHubQuotaCallerUsage, GitHubQuotaSnapshot } from '@overdeck/contracts';
import { selectGitHubQuota, useDashboardStore } from '../lib/store';

const TOP_CALLERS = 5;

function totalPoints(usage: GitHubQuotaCallerUsage): number {
  return usage.graphql.points + usage.rest.points;
}

/** The top callers by GraphQL + REST points in the last hour, highest first. */
export function topGitHubQuotaCallers(quota: GitHubQuotaSnapshot): GitHubQuotaCallerUsage[] {
  return [...quota.callers]
    .filter((usage) => totalPoints(usage) > 0)
    .sort((a, b) => totalPoints(b) - totalPoints(a))
    .slice(0, TOP_CALLERS);
}

/** The top-callers list and the unattributed row. */
function QuotaCallers({ quota }: { quota: GitHubQuotaSnapshot }) {
  const callers = topGitHubQuotaCallers(quota);
  return (
    <>
      {callers.length === 0 ? (
        <p className="text-xs text-muted-foreground">No metered GitHub calls this hour.</p>
      ) : (
        <ul className="space-y-1" data-testid="github-quota-callers">
          {callers.map((usage) => (
            <li key={usage.caller} className="flex items-center justify-between gap-3 text-xs">
              <span className="font-mono text-foreground">{usage.caller}</span>
              <span className="font-mono tabular-nums text-muted-foreground">
                {totalPoints(usage)} pts{usage.estimated ? ' (est.)' : ''}
              </span>
            </li>
          ))}
        </ul>
      )}
      <div className="mt-2 flex items-center justify-between gap-3 border-t border-border pt-2 text-xs text-muted-foreground">
        <span>Unattributed (other tools and installs)</span>
        <span className="font-mono tabular-nums">{quota.unattributed} pts</span>
      </div>
    </>
  );
}

/**
 * GitHubQuotaSection (PAN-5292 WI-E4, E-D12) — the GitHub quota block inside
 * the top bar's health-dot popover. It shows the user account's GraphQL budget
 * from the latest `rateLimit` sample, then the five callers that spent the most
 * points this hour and the points no metered caller claims. The label turns
 * amber while GitHub calls are paused. Renders nothing until the server's
 * publisher first reports, so the popover shows no empty heading.
 */
export function GitHubQuotaSection() {
  const quota = useDashboardStore(selectGitHubQuota);
  if (!quota) return null;

  const sample = quota.samples.find((s) => s.pool === 'user' && s.bucket === 'graphql');
  const paused = quota.pauses.length > 0;

  return (
    <section aria-label="GitHub quota" data-testid="github-quota-section" className="mt-3 border-t border-border pt-3">
      <div className="eyebrow mb-2">GitHub quota</div>
      <p
        data-testid="github-quota-label"
        className={`mb-2 text-xs tabular-nums ${paused ? 'text-warning-foreground' : 'text-foreground'}`}
      >
        {sample ? `${sample.remaining} of ${sample.limit} GraphQL points left this hour` : 'No sample yet'}
      </p>
      <QuotaCallers quota={quota} />
    </section>
  );
}
