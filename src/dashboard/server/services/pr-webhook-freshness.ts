/**
 * PAN-5224: wires the PR freshness policy's webhook-health provider to the
 * primary dashboard's system-health sampler. Only the process that receives
 * `POST /api/webhooks/github` can vouch for the relay, so a peer dashboard
 * (which reads the same smee pidfile but never receives the webhook) never
 * registers — it keeps the library default, "not healthy". This module also
 * hosts the per-repo webhook coalescer: a webhook handler calls
 * `notePullRequestWebhook` to invalidate that repo's PR listing/membership
 * snapshot and refresh derived issue state, at most once every
 * `PR_WEBHOOK_REFRESH_SPACING_MS`.
 */
import { resolve } from 'node:path';
import { resolveProjectForRepo } from '../../../lib/ci/project-ci-observation.js';
import { invalidateOpenPullRequestsSnapshot } from '../../../lib/pipeline-membership-gather.js';
import { invalidateOpenRepoPullRequests, invalidateRepoPullRequests } from '../../../lib/overdeck/pr-listing.js';
import { setWebhookHealthProvider } from '../../../lib/overdeck/pr-freshness.js';
import { getProjectSync, resolveProjectFromIssueSync } from '../../../lib/projects.js';
import { getSharedIssueService } from './issue-service-singleton.js';
import { isWebhookRelayRunningInLastSample } from './system-health-service.js';

/** Registers the webhook-health provider for the primary dashboard; a no-op for a peer. Returns the restore function. */
export function startPrWebhookFreshness(options: { isPeerDashboard: boolean }): () => void {
  if (options.isPeerDashboard) return () => undefined;
  return setWebhookHealthProvider(() => isWebhookRelayRunningInLastSample());
}

export const PR_WEBHOOK_REFRESH_SPACING_MS = 6_000;

/**
 * PAN-5261: `pr-state` (any `pull_request` action) invalidates the repo's
 * open read, closed read and membership PR snapshot, as before. `pr-status`
 * (review, check, status webhooks) invalidates only the open read — those
 * events can change only an open PR's fields.
 */
export type PrWebhookChange = 'pr-state' | 'pr-status';

interface CoalescerEntry {
  lastFireAt: number;
  timer: NodeJS.Timeout | null;
  issueIds: Set<string>;
  reasons: Set<string>;
  change: PrWebhookChange;
}

const coalescer = new Map<string, CoalescerEntry>();

function warnStep(repoFullName: string, step: string, err: unknown): void {
  console.warn(`[pr-webhook] ${repoFullName}: ${step} failed: ${err instanceof Error ? err.message : String(err)}`);
}

/**
 * Each step is independently guarded so one failure never stops the rest.
 * An untracked or unresolvable repo (not in the project registry) has no PR
 * data of ours to invalidate, so nothing is invalidated for it.
 */
function fire(repoFullName: string, issueIds: ReadonlySet<string>, reasons: ReadonlySet<string>, change: PrWebhookChange): void {
  let resolved: ReturnType<typeof resolveProjectForRepo> = null;
  try {
    resolved = resolveProjectForRepo(repoFullName);
  } catch (err) {
    warnStep(repoFullName, 'resolve project', err);
  }

  if (resolved) {
    try {
      const invalidate = change === 'pr-status' ? invalidateOpenRepoPullRequests : invalidateRepoPullRequests;
      const project = getProjectSync(resolved.projectKey);
      if (project?.path) {
        invalidate(project.path);
        invalidate(resolve(project.path));
      }
      // The derived refresh below reads each issue's routed path
      // (`resolveProjectPath`), which can differ from `project.path` for an
      // `issue_routing` project.
      for (const issueId of issueIds) {
        const routedPath = resolveProjectFromIssueSync(issueId)?.projectPath;
        if (routedPath && routedPath !== project?.path) invalidate(routedPath);
      }
    } catch (err) {
      warnStep(repoFullName, 'invalidate repo PR listing', err);
    }

    if (change === 'pr-state') {
      try {
        const [owner, repo] = repoFullName.split('/');
        if (owner && repo) invalidateOpenPullRequestsSnapshot(owner, repo);
      } catch (err) {
        warnStep(repoFullName, 'invalidate membership snapshot', err);
      }
    }
  }

  if (issueIds.size > 0) {
    try {
      getSharedIssueService().scheduleDerivedStateRefreshForIssues(
        [...issueIds].map((identifier) => ({ identifier })),
      );
    } catch (err) {
      warnStep(repoFullName, 'schedule derived-state refresh', err);
    }
  }

  console.log(`[pr-webhook] ${repoFullName}: refreshed (${[...reasons].join(',')}, ${issueIds.size} issue(s), ${change})`);
}

/**
 * A webhook for `repoFullName` changed something a PR listing shows. Fires at
 * once when the repo has not fired in the last `PR_WEBHOOK_REFRESH_SPACING_MS`,
 * else once at lastFire + spacing with every issue id and reason seen
 * meanwhile. Never throws. `change` defaults to `'pr-state'` so any caller
 * not updated for PAN-5261 keeps today's full invalidation; a fire acts as
 * `'pr-state'` when any event merged into it was `'pr-state'`.
 */
export function notePullRequestWebhook(
  repoFullName: string,
  issueIds: readonly string[],
  reason: string,
  change: PrWebhookChange = 'pr-state',
): void {
  try {
    const now = Date.now();
    const entry = coalescer.get(repoFullName);
    if (!entry || now - entry.lastFireAt >= PR_WEBHOOK_REFRESH_SPACING_MS) {
      coalescer.set(repoFullName, { lastFireAt: now, timer: null, issueIds: new Set(), reasons: new Set(), change: 'pr-status' });
      fire(repoFullName, new Set(issueIds), new Set([reason]), change);
      return;
    }
    for (const id of issueIds) entry.issueIds.add(id);
    entry.reasons.add(reason);
    if (change === 'pr-state') entry.change = 'pr-state';
    if (entry.timer) return;
    const delay = Math.max(0, entry.lastFireAt + PR_WEBHOOK_REFRESH_SPACING_MS - now);
    entry.timer = setTimeout(() => {
      const fireIssueIds = entry.issueIds;
      const fireReasons = entry.reasons;
      const fireChange = entry.change;
      entry.lastFireAt = Date.now();
      entry.timer = null;
      entry.issueIds = new Set();
      entry.reasons = new Set();
      entry.change = 'pr-status';
      fire(repoFullName, fireIssueIds, fireReasons, fireChange);
    }, delay);
    entry.timer.unref();
  } catch (err) {
    warnStep(repoFullName, 'notePullRequestWebhook', err);
  }
}

/** Tests only. */
export function resetPrWebhookCoalescerForTests(): void {
  for (const entry of coalescer.values()) {
    if (entry.timer) clearTimeout(entry.timer);
  }
  coalescer.clear();
}
