/**
 * IssueDataService — Central orchestrator for issue data
 *
 * Replaces the inline fetching in /api/issues with:
 * - Background polling per tracker on independent timers
 * - GitHub REST + ETags (304s are FREE, don't count against rate limit)
 * - Linear incremental fetching via updatedAt filter
 * - Rally TTL-based caching
 * - Change detection + event store push (via onIssuesChanged callback)
 * - Adaptive backoff on rate limit pressure
 * - Instant serve from cache (sub-100ms dashboard loads)
 */

import { Octokit } from '@octokit/rest';
import { existsSync } from 'fs';
import { join } from 'path';
import { mapGitHubStateToCanonical } from '../../../core/state-mapping.js';
import { CacheService, DEFAULT_TTLS } from './cache-service.js';
import { getGitHubConfig, getLinearApiKey, getRallyConfig, validateRallyConfig } from './tracker-config.js';
import type { GitHubConfig, RallyConfig } from './tracker-config.js';
import { loadReviewStatuses } from '../../../lib/review-status.js';
import { resolveProjectFromIssue } from '../../../lib/projects.js';
import { isPlanningComplete } from '../../../lib/vbrief/io.js';

/**
 * Map a raw status string to its canonical state.
 * Exported for testing.
 */
export function getCanonicalStatus(status: string | undefined, stateType?: string): string {
  if (!status) return 'backlog';
  const normalized = status.toLowerCase();
  // Direct backlog mappings
  if (normalized === 'backlog' || normalized === 'triage' || normalized === 'unknown') {
    return 'backlog';
  }
  // Other canonical states
  if (normalized === 'todo' || normalized === 'to do' || normalized === 'ready' || normalized === 'unstarted') {
    return 'todo';
  }
  if (normalized === 'in progress' || normalized === 'started' || normalized === 'active' || normalized === 'in planning') {
    return 'in_progress';
  }
  if (normalized === 'in review' || normalized === 'review' || normalized === 'qa' || normalized === 'testing') {
    return 'in_review';
  }
  if (normalized === 'done' || normalized === 'completed' || normalized === 'closed') {
    return 'done';
  }
  if (normalized === 'canceled' || normalized === 'cancelled' || normalized === 'duplicate' || normalized === "won't do" || normalized === 'wontfix') {
    return 'canceled';
  }
  // Fallback: use Linear stateType if available (handles custom status names)
  if (stateType) {
    const typeMap: Record<string, string> = {
      backlog: 'backlog',
      unstarted: 'todo',
      started: 'in_progress',
      completed: 'done',
      canceled: 'canceled',
      cancelled: 'canceled',
    };
    if (typeMap[stateType]) return typeMap[stateType];
  }
  return 'backlog'; // Default fallback
}

// Poll intervals (ms)
const POLL_INTERVALS = {
  github:  { default: 30_000, min: 15_000, max: 300_000 },
  linear:  { default: 30_000, min: 15_000, max: 300_000 },
  rally:   { default: 120_000, min: 60_000, max: 600_000 },
};

// Linear full refresh interval (safety net)
const LINEAR_FULL_REFRESH_MS = 5 * 60 * 1000; // 5 minutes

interface TrackerState {
  timer: ReturnType<typeof setTimeout> | null;
  currentInterval: number;
  lastFetchedIssues: any[];
  lastError: string | null;
  lastFetchedAt: string | null;
}

/**
 * Map normalized IssueState (open/in_progress/closed) to canonical dashboard status.
 * The Rally tracker already normalizes raw Rally states to IssueState in rally.ts.
 */
function mapRallyStateToCanonical(issueState: string): string {
  if (!issueState) return 'todo';
  const stateLower = issueState.toLowerCase();
  if (stateLower === 'in_progress') return 'in_progress';
  if (stateLower === 'closed') return 'done';
  // 'open' and anything unrecognized → 'todo'
  return 'todo';
}

/**
 * Compute planning-state for an issue via cheap filesystem checks.
 * No bd process, no dolt lock — just stat calls.
 */
function computePlanningState(identifier: string): {
  hasPlan: boolean;
  hasBeads: boolean;
  planningComplete: boolean;
  workspacePath: string;
} {
  try {
    const resolved = resolveProjectFromIssue(identifier);
    const projectPath = resolved?.projectPath ?? '';
    if (!projectPath) {
      return { hasPlan: false, hasBeads: false, planningComplete: false, workspacePath: '' };
    }
    const issueLower = identifier.toLowerCase();
    const workspacePath = join(projectPath, 'workspaces', `feature-${issueLower}`);
    if (!existsSync(workspacePath)) {
      return { hasPlan: false, hasBeads: false, planningComplete: false, workspacePath };
    }
    const hasPlan = existsSync(join(workspacePath, '.planning', 'plan.vbrief.json'));
    // planningComplete now means "plan.status indicates planning has finished" —
    // any of proposed/approved/pending/running/completed/blocked. Falls back to
    // the legacy `.planning-complete` marker for vBRIEFs without status fields.
    // It's the definitive signal for "tasks have been generated." No bd query.
    const planningComplete = isPlanningComplete(workspacePath);
    const hasBeads = planningComplete;
    return { hasPlan, hasBeads, planningComplete, workspacePath };
  } catch {
    return { hasPlan: false, hasBeads: false, planningComplete: false, workspacePath: '' };
  }
}

export class IssueDataService {
  private cache: CacheService;
  private trackers: Record<string, TrackerState> = {};
  private linearLastFullRefresh = 0;
  private started = false;
  private shadowStateModule: any = null;
  /** In-memory snapshot of shadow states, refreshed asynchronously. The hot
   * path (`getIssues`) reads from this map — no disk I/O on every request. */
  private shadowStatesCache: Map<string, any> = new Map();
  private _onIssuesChanged: ((issues: unknown[]) => void) | null = null;

  /** Register a callback invoked whenever issue data changes (PAN-433). */
  onIssuesChanged(fn: (issues: unknown[]) => void): void {
    this._onIssuesChanged = fn;
  }

  constructor(cache: CacheService) {
    this.cache = cache;

    for (const tracker of ['github', 'linear', 'rally'] as const) {
      this.trackers[tracker] = {
        timer: null,
        currentInterval: POLL_INTERVALS[tracker].default,
        lastFetchedIssues: [],
        lastError: null,
        lastFetchedAt: null,
      };
    }
  }

  /**
   * Start background polling. Returns immediately after loading cached data.
   * API fetches run in the background and push incremental updates.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Pre-load shadow state module
    await this.ensureShadowStateLoaded();

    // Load any cached data from SQLite so getIssues() works instantly
    this.loadCachedData();

    // Push snapshot immediately with stale cached data so read model has
    // something to work with before the background fetches complete.
    this.pushSnapshot();

    // Kick off all tracker fetches in the background — do NOT await.
    // Each poll calls pushUpdated() when done → incremental client updates.
    void Promise.allSettled([
      this.pollGitHub(),
      this.pollLinear(),
      this.pollRally(),
    ]).then(() => {
      // Final snapshot push after all initial fetches complete
      this.pushSnapshot();
      // Start recurring timers (after first fetch completes)
      this.scheduleNext('github');
      this.scheduleNext('linear');
      this.scheduleNext('rally');
    });
  }

  /**
   * Stop all polling timers.
   */
  stop(): void {
    this.started = false;
    for (const state of Object.values(this.trackers)) {
      if (state.timer) {
        clearTimeout(state.timer);
        state.timer = null;
      }
    }
  }

  /**
   * Clear all cached issue data and trigger a fresh re-fetch from all trackers.
   */
  async clearCacheAndRefresh(): Promise<void> {
    // Clear SQLite + L1 cache for all trackers
    for (const tracker of ['github', 'linear', 'rally']) {
      this.cache.invalidate(tracker);
      this.trackers[tracker].lastFetchedIssues = [];
      this.trackers[tracker].lastFetchedAt = null;
      this.trackers[tracker].lastError = null;
    }
    console.log('[IssueDataService] Cache cleared — re-fetching all trackers');
    // Re-fetch all trackers
    await Promise.allSettled([
      this.pollGitHub(),
      this.pollLinear(),
      this.pollRally(),
    ]);
    this.pushSnapshot();
  }

  /**
   * Look up which tracker an issue belongs to by its identifier.
   * Returns 'github' | 'linear' | 'rally' | null.
   */
  getIssueSource(identifier: string): 'github' | 'linear' | 'rally' | null {
    const id = identifier.toLowerCase();
    for (const [trackerName, state] of Object.entries(this.trackers)) {
      for (const issue of state.lastFetchedIssues) {
        if ((issue.identifier || '').toLowerCase() === id) {
          return trackerName as 'github' | 'linear' | 'rally';
        }
      }
    }
    return null;
  }

  /**
   * Get all issues from cache. Applies shadow state and filtering.
   * This is the hot path — must be fast.
   */
  getIssues(options?: { cycle?: string; includeCompleted?: boolean }): any[] {
    let allIssues = [
      ...this.trackers.github.lastFetchedIssues,
      ...this.trackers.linear.lastFetchedIssues,
      ...this.trackers.rally.lastFetchedIssues,
    ];

    // Merge shadow state from the in-memory cache. The cache is refreshed
    // asynchronously by `refreshShadowStatesCache()` — we never hit disk here,
    // keeping `getIssues()` (a hot path) off the event-loop-blocking path.
    try {
      allIssues = allIssues.map(issue => {
        const shadowState = this.shadowStatesCache.get(issue.identifier.toLowerCase());
        if (shadowState) {
          return {
            ...issue,
            shadowStatus: shadowState.shadowStatus,
            targetCanonicalState: shadowState.targetCanonicalState,
            shadowedAt: shadowState.shadowedAt,
            shadowTrackerStatus: shadowState.trackerStatus,
          };
        }
        return { ...issue, shadowStatus: null, targetCanonicalState: null };
      });
    } catch (e) {
      allIssues = allIssues.map(issue => ({ ...issue, shadowStatus: null }));
    }

    // Show all completed issues (label-based dismissal will be added later)

    // Apply cycle filter using canonical status mapping
    const cycle = options?.cycle ?? 'current';
    if (cycle === 'current') {
      // Current cycle: exclude Backlog and Canceled items, only show active cycle work
      allIssues = allIssues.filter(issue => {
        const canonical = getCanonicalStatus(issue.status);
        return canonical !== 'backlog' && canonical !== 'canceled';
      });
    } else if (cycle === 'backlog') {
      // Backlog view: only show Backlog items (including Triage, Unknown)
      allIssues = allIssues.filter(issue => {
        const canonical = getCanonicalStatus(issue.status, issue.stateType);
        return canonical === 'backlog';
      });
    } else if (cycle === 'canceled') {
      // Canceled view: only show Canceled items (Canceled, Duplicate, Won't Do)
      allIssues = allIssues.filter(issue => {
        const canonical = getCanonicalStatus(issue.status);
        return canonical === 'canceled';
      });
    }
    // cycle === 'all': no additional filtering, show everything

    // Augment with mergeStatus from review-status (used for MERGED badge)
    try {
      const reviewStatuses = loadReviewStatuses();
      allIssues = allIssues.map(issue => {
        const key = issue.identifier?.toUpperCase();
        const rs = key ? reviewStatuses[key] : null;
        if (rs?.mergeStatus) {
          return { ...issue, mergeStatus: rs.mergeStatus };
        }
        return issue;
      });
    } catch {
      // review-status.json may not exist yet
    }

    // Enrich with planning-state (filesystem checks, no bd process)
    allIssues = allIssues.map(issue => {
      const ps = computePlanningState(issue.identifier);
      return {
        ...issue,
        hasPlan: ps.hasPlan,
        hasBeads: ps.hasBeads,
        planningComplete: ps.planningComplete,
        workspacePath: ps.workspacePath || undefined,
      };
    });

    // Sort by updatedAt
    allIssues.sort((a, b) =>
      new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime()
    );

    return allIssues;
  }

  /**
   * Invalidate a tracker's cache and trigger immediate re-poll.
   * Called after mutations (move-status, label changes, etc.)
   */
  /**
   * Immediately patch a cached issue and push the update to all clients.
   * Use this after any state mutation so the dashboard reflects the change
   * instantly without waiting for the next poll cycle.
   *
   * @param identifier - Issue identifier (e.g. "MIN-734", "PAN-302")
   * @param patch - Fields to merge into the cached issue object
   */
  patchIssue(identifier: string, patch: Record<string, any>): void {
    const id = identifier.toLowerCase();
    for (const state of Object.values(this.trackers)) {
      const idx = state.lastFetchedIssues.findIndex(
        (i: any) => (i.identifier || '').toLowerCase() === id
      );
      if (idx !== -1) {
        state.lastFetchedIssues[idx] = { ...state.lastFetchedIssues[idx], ...patch };
        this.pushUpdated();
        return;
      }
    }
    // Issue not in cache yet (e.g. just created) — trigger a full refresh instead
    const source = patch.source || 'linear';
    this.invalidateTracker(source).catch(() => {});
  }

  async invalidateTracker(tracker: string): Promise<void> {
    this.cache.invalidate(tracker);

    // Force full refresh on next poll (not incremental) so new issues
    // added to the cycle externally are discovered immediately
    if (tracker === 'linear') {
      this.linearLastFullRefresh = 0;
    }

    // Cancel current timer and fetch immediately
    const state = this.trackers[tracker];
    if (state?.timer) {
      clearTimeout(state.timer);
      state.timer = null;
    }

    switch (tracker) {
      case 'github': await this.pollGitHub(); break;
      case 'linear': await this.pollLinear(); break;
      case 'rally': await this.pollRally(); break;
    }

    this.pushSnapshot();
    this.scheduleNext(tracker);
  }

  /**
   * Get diagnostics for /api/cache-status endpoint.
   */
  getDiagnostics(): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [tracker, state] of Object.entries(this.trackers)) {
      const limit = this.cache.getRateLimit(tracker);
      result[tracker] = {
        remaining: limit?.remaining ?? null,
        total: limit?.total ?? null,
        pollInterval: state.currentInterval,
        lastFetched: state.lastFetchedAt,
        lastError: state.lastError,
        issueCount: state.lastFetchedIssues.length,
      };
    }
    return result;
  }

  // ---------------------------------------------------------------
  // Private: polling methods
  // ---------------------------------------------------------------

  private scheduleNext(tracker: string): void {
    const state = this.trackers[tracker];
    if (!this.started || !state) return;

    // Compute effective interval with backoff
    const intervals = POLL_INTERVALS[tracker as keyof typeof POLL_INTERVALS];
    if (!intervals) return;

    const backoffMs = this.cache.getBackoffMs(tracker, intervals.default);
    const effectiveInterval = Math.min(
      Math.max(intervals.default + backoffMs, intervals.min),
      intervals.max
    );
    state.currentInterval = effectiveInterval;

    state.timer = setTimeout(async () => {
      try {
        switch (tracker) {
          case 'github': await this.pollGitHub(); break;
          case 'linear': await this.pollLinear(); break;
          case 'rally': await this.pollRally(); break;
        }
      } catch (err: any) {
        console.error(`[IssueDataService] Error polling ${tracker}:`, err.message);
        state.lastError = err.message;
      }
      this.scheduleNext(tracker);
    }, effectiveInterval);
  }

  private async ensureShadowStateLoaded(): Promise<void> {
    if (this.shadowStateModule) return;
    try {
      this.shadowStateModule = await import('../../../lib/shadow-state.js');
      await this.refreshShadowStatesCache();
    } catch {
      // Shadow state not available — issues will work without it
    }
  }

  /**
   * Populate the in-memory shadow-state cache by reading all shadow files
   * off the event loop (via fs/promises). Call after any write that may
   * have changed shadow state for any issue.
   */
  async refreshShadowStatesCache(): Promise<void> {
    if (!this.shadowStateModule) return;
    try {
      const states: Array<{ issueId: string; [k: string]: any }> =
        await this.shadowStateModule.listShadowedIssues();
      const next = new Map<string, any>();
      for (const state of states) {
        next.set(state.issueId.toLowerCase(), state);
      }
      this.shadowStatesCache = next;
    } catch {
      // Non-fatal — keep the previous cache
    }
  }

  private loadCachedData(): void {
    // Build a lookup of repo → prefix from current config for re-stamping stale identifiers
    const repoPrefixMap = new Map<string, string>();
    try {
      const ghConfig = getGitHubConfig();
      if (ghConfig) {
        for (const { owner, repo, prefix } of ghConfig.repos) {
          repoPrefixMap.set(`${owner}/${repo}`, prefix || repo.toUpperCase());
        }
      }
    } catch { /* ignore */ }

    for (const tracker of ['github', 'linear', 'rally']) {
      const cached = this.cache.getStale(tracker, 'issues');
      if (cached?.data) {
        // Sanitize stale Rally cache: rawTrackerState may be an object from pre-PAN-201 data
        if (tracker === 'rally') {
          let sanitizedCount = 0;
          cached.data = cached.data.map((issue: any) => {
            if (typeof issue.rawTrackerState === 'object' && issue.rawTrackerState !== null) {
              sanitizedCount++;
              return {
                ...issue,
                rawTrackerState: issue.rawTrackerState.Name || issue.rawTrackerState._refObjectName || 'Defined',
              };
            }
            return issue;
          });
          if (sanitizedCount > 0) {
            console.warn(`[IssueDataService] Rally cache: sanitized ${sanitizedCount} issues with object rawTrackerState (PAN-201)`);
          }
        }
        // Re-stamp GitHub identifiers in case prefix config changed since cache was written
        if (tracker === 'github') {
          cached.data = cached.data.map((issue: any) => {
            const repoKey = issue.sourceRepo;
            const prefix = repoKey ? repoPrefixMap.get(repoKey) : undefined;
            if (prefix) {
              // Extract issue number from id (github-owner-repo-NUMBER) or identifier (PREFIX-NUMBER)
              const issueNum = issue.id?.match(/-(\d+)$/)?.[1] || issue.identifier?.match(/-(\d+)$/)?.[1];
              if (issueNum) {
                const expectedId = `${prefix}-${issueNum}`;
                if (issue.identifier !== expectedId) {
                  return { ...issue, identifier: expectedId };
                }
              }
            }
            return issue;
          });
        }
        this.trackers[tracker].lastFetchedIssues = cached.data;
        this.trackers[tracker].lastFetchedAt = cached.lastFetchedAt;
      }
    }
  }

  private pushSnapshot(): void {
    this._onIssuesChanged?.(this.getIssues());
  }

  private pushUpdated(): void {
    this._onIssuesChanged?.(this.getIssues());
  }

  private pushMeta(): void {
    // Diagnostics are served via GET /api/issues/diagnostics — no push needed
  }

  // ---------------------------------------------------------------
  // GitHub polling — uses Octokit REST + ETags (304 = FREE)
  // ---------------------------------------------------------------

  private async pollGitHub(): Promise<void> {
    const config = getGitHubConfig();
    if (!config) {
      this.trackers.github.lastFetchedIssues = [];
      return;
    }

    const allIssues: any[] = [];
    const octokit = new Octokit({ auth: config.token });

    for (const { owner, repo, prefix } of config.repos) {
      try {
        // Fetch open issues with ETag support
        const openIssues = await this.fetchGitHubRepoIssues(
          octokit, owner, repo, 'open', prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, ''),
          `github:open:${owner}/${repo}`
        );

        // Fetch recently closed issues
        const closedIssues = await this.fetchGitHubRepoIssues(
          octokit, owner, repo, 'closed', prefix || repo.toUpperCase().replace(/-CLI$/, '').replace(/-/g, ''),
          `github:closed:${owner}/${repo}`
        );

        allIssues.push(...openIssues, ...closedIssues);
      } catch (error: any) {
        console.error(`[IssueDataService] Error fetching GitHub issues for ${owner}/${repo}:`, error.message);
        this.trackers.github.lastError = error.message;
      }
    }

    // Check if data actually changed
    const oldData = this.trackers.github.lastFetchedIssues;
    const changed = JSON.stringify(allIssues) !== JSON.stringify(oldData);

    this.trackers.github.lastFetchedIssues = allIssues;
    this.trackers.github.lastFetchedAt = new Date().toISOString();
    this.trackers.github.lastError = null;

    // Persist to cache
    this.cache.set('github', 'issues', allIssues, { ttlSeconds: DEFAULT_TTLS.github });

    if (changed) {
      console.log(`[IssueDataService] GitHub: ${allIssues.length} issues (changed)`);
      this.pushUpdated();
      this.pushMeta();
    }
  }

  private async fetchGitHubRepoIssues(
    octokit: Octokit,
    owner: string,
    repo: string,
    state: 'open' | 'closed',
    issuePrefix: string,
    cacheKey: string,
  ): Promise<any[]> {
    // Get stored ETag for conditional request
    const cachedEtag = this.cache.getEtag('github', cacheKey);

    const requestParams: any = {
      owner,
      repo,
      state,
      per_page: 100,
      sort: 'updated' as const,
      direction: 'desc' as const,
    };

    // Only send If-None-Match when we have a cached ETag
    if (cachedEtag) {
      requestParams.headers = { 'If-None-Match': cachedEtag };
    }

    // Fetch ALL closed issues (no date filter) so Done column is complete after restarts
    if (state === 'closed') {
      requestParams.per_page = 100;
    }

    try {
      // Use paginate to fetch ALL pages (not just the first 100)
      let newEtag: string | undefined;
      const allData = await octokit.paginate(octokit.issues.listForRepo, requestParams, (response) => {
        // Extract rate limit from each response
        const remaining = parseInt(response.headers['x-ratelimit-remaining'] as string);
        const total = parseInt(response.headers['x-ratelimit-limit'] as string);
        const resetAt = new Date(parseInt(response.headers['x-ratelimit-reset'] as string) * 1000).toISOString();

        if (!isNaN(remaining) && !isNaN(total)) {
          this.cache.updateRateLimit('github', { remaining, total, resetAt });
        }

        // Store ETag from first page (used for conditional requests on next poll)
        if (!newEtag && response.headers.etag) {
          newEtag = response.headers.etag as string;
        }

        return response.data;
      });

      // Filter out PRs (they have pull_request key)
      const issues = allData.filter((issue: any) => !issue.pull_request);

      // Format issues to match dashboard schema
      const formatted = issues.map((issue: any) => {
        const labelNames = issue.labels?.map((l: any) => typeof l === 'string' ? l : l.name) || [];
        const canonicalStatus = mapGitHubStateToCanonical(issue.state || '', labelNames);
        const identifier = `${issuePrefix}-${issue.number}`;

        const firstAssignee = issue.assignees?.[0] || issue.assignee;

        return {
          id: `github-${owner}-${repo}-${issue.number}`,
          identifier,
          title: issue.title,
          description: issue.body || '',
          status: canonicalStatus === 'todo' ? 'Todo' :
                  canonicalStatus === 'in_progress' ? 'In Progress' :
                  canonicalStatus === 'in_review' ? 'In Review' :
                  canonicalStatus === 'done' ? 'Done' :
                  canonicalStatus === 'backlog' ? 'Backlog' : 'Todo',
          canonicalStatus,
          state: canonicalStatus,
          priority: labelNames.some((l: string) => l.includes('priority') && l.includes('high')) ? 2 :
                    labelNames.some((l: string) => l.includes('priority') && l.includes('urgent')) ? 1 :
                    labelNames.some((l: string) => l.includes('priority') && l.includes('low')) ? 4 : 3,
          assignee: firstAssignee ? {
            name: firstAssignee.login,
            email: `${firstAssignee.login}@github`,
          } : undefined,
          labels: labelNames,
          url: issue.html_url,
          createdAt: issue.created_at,
          updatedAt: issue.updated_at,
          completedAt: issue.closed_at,
          project: {
            id: `github-${owner}-${repo}`,
            name: `${owner}/${repo}`,
            color: '#333',
            icon: 'github',
          },
          source: 'github',
          sourceRepo: `${owner}/${repo}`,
        };
      });

      // Cache with ETag
      this.cache.set('github', cacheKey, formatted, {
        etag: newEtag,
        ttlSeconds: DEFAULT_TTLS.github,
      });

      return formatted;
    } catch (err: any) {
      // 304 Not Modified — return cached data (this is FREE, no rate limit cost)
      if (err.status === 304) {
        const cached = this.cache.getStale('github', cacheKey);
        if (!cached?.data) return [];
        // Re-stamp identifiers in case the prefix changed since the cache was written
        return cached.data.map((issue: any) => {
          const issueNum = issue.id?.match(/-(\d+)$/)?.[1] || issue.identifier?.match(/-(\d+)$/)?.[1];
          if (issueNum) {
            const expectedId = `${issuePrefix}-${issueNum}`;
            return issue.identifier === expectedId ? issue : { ...issue, identifier: expectedId };
          }
          return issue;
        });
      }
      throw err;
    }
  }

  // ---------------------------------------------------------------
  // Linear polling — TTL + incremental updatedAt
  // ---------------------------------------------------------------

  private async pollLinear(): Promise<void> {
    const apiKey = getLinearApiKey();
    if (!apiKey) {
      this.trackers.linear.lastFetchedIssues = [];
      return;
    }

    const now = Date.now();
    const needsFullRefresh = now - this.linearLastFullRefresh > LINEAR_FULL_REFRESH_MS;

    // Get the most recent updatedAt from cached issues for incremental fetch
    let sinceUpdatedAt: string | null = null;
    if (!needsFullRefresh && this.trackers.linear.lastFetchedIssues.length > 0) {
      const maxUpdated = this.trackers.linear.lastFetchedIssues.reduce((max: string, issue: any) => {
        return issue.updatedAt > max ? issue.updatedAt : max;
      }, '');
      if (maxUpdated) sinceUpdatedAt = maxUpdated;
    }

    try {
      const fetchedIssues = await this.fetchLinearIssues(apiKey, sinceUpdatedAt);

      let allIssues: any[];
      if (sinceUpdatedAt && fetchedIssues.length > 0) {
        // Incremental: merge new/updated issues into existing list
        const existingMap = new Map(
          this.trackers.linear.lastFetchedIssues.map((i: any) => [i.identifier, i])
        );
        for (const issue of fetchedIssues) {
          existingMap.set(issue.identifier, issue);
        }
        allIssues = Array.from(existingMap.values());
      } else if (needsFullRefresh || sinceUpdatedAt === null) {
        // Full refresh
        allIssues = fetchedIssues;
        this.linearLastFullRefresh = now;
      } else {
        // No new data from incremental fetch
        allIssues = this.trackers.linear.lastFetchedIssues;
      }

      const oldData = this.trackers.linear.lastFetchedIssues;
      const changed = JSON.stringify(allIssues) !== JSON.stringify(oldData);

      this.trackers.linear.lastFetchedIssues = allIssues;
      this.trackers.linear.lastFetchedAt = new Date().toISOString();
      this.trackers.linear.lastError = null;

      this.cache.set('linear', 'issues', allIssues, { ttlSeconds: DEFAULT_TTLS.linear });

      if (changed) {
        console.log(`[IssueDataService] Linear: ${allIssues.length} issues (changed)`);
        this.pushUpdated();
        this.pushMeta();
      }
    } catch (err: any) {
      console.error('[IssueDataService] Linear poll error:', err.message);
      this.trackers.linear.lastError = err.message;
    }
  }

  private async fetchLinearIssues(apiKey: string, sinceUpdatedAt: string | null): Promise<any[]> {
    const allIssues: any[] = [];
    let hasMore = true;
    let cursor: string | undefined;

    // Build filter conditions
    const filterConditions: string[] = [];
    // Scope to active cycle only — completed/canceled filtering is handled
    // by getIssues() post-filter, NOT here. The GraphQL query must fetch
    // completed issues so that: (1) the "Include completed" toggle works,
    // (2) incremental updates correctly reflect state transitions, and
    // (3) internal getIssues() callers can look up recently-completed issues.
    filterConditions.push('cycle: { isActive: { eq: true } }');

    // Incremental: only issues updated after sinceUpdatedAt
    if (sinceUpdatedAt) {
      filterConditions.push(`updatedAt: { gt: "${sinceUpdatedAt}" }`);
    }

    let filterClause = '';
    if (filterConditions.length === 1) {
      filterClause = `filter: { ${filterConditions[0]} }`;
    } else if (filterConditions.length > 1) {
      filterClause = `filter: { and: [${filterConditions.map(c => `{ ${c} }`).join(', ')}] }`;
    }

    while (hasMore) {
      const query = `
        query GetIssues($after: String) {
          issues(first: 100, after: $after, ${filterClause ? filterClause + ', ' : ''}orderBy: updatedAt) {
            pageInfo {
              hasNextPage
              endCursor
            }
            nodes {
              id
              identifier
              title
              description
              priority
              url
              createdAt
              updatedAt
              completedAt
              state {
                name
                type
              }
              assignee {
                name
                email
              }
              labels {
                nodes {
                  name
                }
              }
              project {
                id
                name
                color
                icon
              }
              team {
                id
                name
                color
                icon
              }
              cycle {
                id
                name
                number
              }
            }
          }
        }
      `;

      const response = await fetch('https://api.linear.app/graphql', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': apiKey,
        },
        body: JSON.stringify({ query, variables: { after: cursor } }),
      });

      const json = await response.json();

      if (json.errors) {
        throw new Error(json.errors[0]?.message || 'Linear GraphQL error');
      }

      const issues = json.data?.issues;
      if (!issues) break;

      allIssues.push(...issues.nodes);
      hasMore = issues.pageInfo.hasNextPage;
      cursor = issues.pageInfo.endCursor;

      if (allIssues.length > 1000) break;
    }

    // Build project lookup for deduplication
    const projectByName = new Map<string, { id: string; name: string; color?: string; icon?: string }>();
    for (const issue of allIssues) {
      if (issue.project && !projectByName.has(issue.project.name)) {
        projectByName.set(issue.project.name, {
          id: issue.project.id,
          name: issue.project.name,
          color: issue.project.color,
          icon: issue.project.icon,
        });
      }
    }

    // Format to dashboard schema
    return allIssues.map((issue: any) => {
      let project;
      if (issue.project) {
        project = {
          id: issue.project.id,
          name: issue.project.name,
          color: issue.project.color,
          icon: issue.project.icon,
        };
      } else if (issue.team) {
        const existing = projectByName.get(issue.team.name);
        project = existing || {
          id: issue.team.id,
          name: issue.team.name,
          color: issue.team.color,
          icon: issue.team.icon,
        };
      }

      return {
        id: issue.id,
        identifier: issue.identifier,
        title: issue.title,
        description: issue.description,
        status: issue.state?.name || 'Backlog',
        stateType: issue.state?.type,
        priority: issue.priority,
        assignee: issue.assignee ? { name: issue.assignee.name, email: issue.assignee.email } : undefined,
        labels: issue.labels?.nodes?.map((l: any) => l.name) || [],
        url: issue.url,
        createdAt: issue.createdAt,
        updatedAt: issue.updatedAt,
        completedAt: issue.completedAt,
        project,
        cycle: issue.cycle ? {
          id: issue.cycle.id,
          name: issue.cycle.name,
          number: issue.cycle.number,
        } : undefined,
        source: 'linear',
      };
    });
  }

  // ---------------------------------------------------------------
  // Rally polling — TTL-based caching, per-project config support
  // ---------------------------------------------------------------

  /**
   * Format a raw Rally issue into the dashboard schema.
   */
  private formatRallyIssue(issue: any, projectInfo: { id: string; name: string; color: string; icon: string }): any {
    const canonicalStatus = mapRallyStateToCanonical(issue.state);
    const identifier = issue.ref || issue.id || 'unknown';
    if (typeof issue.rawState === 'object' && issue.rawState !== null) {
      console.warn(`[IssueDataService] Rally ${identifier}: rawState is object, normalizing (PAN-201)`);
    }
    return {
      id: `rally-${issue.id || identifier}`,
      identifier,
      title: issue.title || '',
      description: issue.description || '',
      status: canonicalStatus === 'todo' ? 'Todo' :
              canonicalStatus === 'in_progress' ? 'In Progress' :
              canonicalStatus === 'done' ? 'Done' : 'Todo',
      priority: issue.priority ?? 3,
      assignee: issue.assignee ? {
        name: issue.assignee,
        email: `${issue.assignee.replace(/\s+/g, '.').toLowerCase()}@rally`,
      } : undefined,
      labels: Array.isArray(issue.labels) ? issue.labels.filter((l: any) => typeof l === 'string') : [],
      url: issue.url || '',
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt,
      parentRef: issue.parentRef,
      artifactType: issue.artifactType,
      rawTrackerState: typeof issue.rawState === 'object' && issue.rawState !== null
        ? (issue.rawState.Name || issue.rawState._refObjectName || 'Defined')
        : issue.rawState,
      project: projectInfo,
      source: 'rally',
    };
  }

  /**
   * Compute derived feature status from child stories.
   * If ANY child is in progress, the feature is derived as 'in_progress'.
   * If ALL children are done, the feature is derived as 'closed'.
   * Attaches child counts for progress display.
   */
  private computeDerivedFeatureStatus(issues: any[]): any[] {
    // Build children-by-parent map (key: parent identifier, value: child issues)
    const childrenByParent = new Map<string, any[]>();
    for (const issue of issues) {
      if (issue.parentRef) {
        const existing = childrenByParent.get(issue.parentRef) || [];
        existing.push(issue);
        childrenByParent.set(issue.parentRef, existing);
      }
    }

    // For each Feature, compute derived status
    return issues.map(issue => {
      const isFeature = issue.artifactType?.includes('PortfolioItem');
      if (!isFeature) return issue;

      const children = childrenByParent.get(issue.identifier) || [];
      if (children.length === 0) return issue;

      const completedChildCount = children.filter(
        (c: any) => c.status === 'Done'
      ).length;
      const inProgressChildCount = children.filter(
        (c: any) => c.status === 'In Progress'
      ).length;
      const totalChildCount = children.length;

      let derivedStatus: string | undefined;
      if (completedChildCount === totalChildCount) {
        derivedStatus = 'closed';
      } else if (inProgressChildCount > 0) {
        derivedStatus = 'in_progress';
      }

      return {
        ...issue,
        derivedStatus,
        totalChildCount,
        completedChildCount,
        inProgressChildCount,
      };
    });
  }

  private async pollRally(): Promise<void> {
    const globalConfig = getRallyConfig();
    if (!globalConfig) {
      this.trackers.rally.lastFetchedIssues = [];
      return;
    }

    // Validate config on first poll and log warnings
    if (!this.trackers.rally.lastFetchedAt) {
      const validation = validateRallyConfig(globalConfig);
      if (validation.warnings.length > 0) {
        console.warn('[Rally] Configuration warnings:', validation.warnings.join('; '));
      }
    }

    // Only fetch if cache is stale
    if (!this.cache.isStale('rally', 'issues') && this.trackers.rally.lastFetchedIssues.length > 0) {
      return;
    }

    try {
      const { RallyTracker } = await import('../../../lib/tracker/rally.js');
      const { findProjectsByRallyProject } = await import('../../../lib/projects.js');

      const rallyProjects = findProjectsByRallyProject();
      let allFormatted: any[] = [];

      if (rallyProjects.length > 0) {
        // Per-project mode: create separate tracker per Rally project OID
        const projectQueries = rallyProjects.map(async ({ key, config: projConfig }) => {
          try {
            const tracker = new RallyTracker({
              apiKey: globalConfig.apiKey,
              server: globalConfig.server,
              workspace: globalConfig.workspace,
              project: projConfig.rally_project,
            });

            const issues = await tracker.listIssues({
              includeClosed: false,
              limit: 100,
            });

            const projectInfo = {
              id: `rally-${key}`,
              name: projConfig.name,
              color: '#00C7B1',
              icon: 'rally',
            };

            return issues.map((issue: any) => this.formatRallyIssue(issue, projectInfo));
          } catch (err: any) {
            console.error(`[IssueDataService] Rally poll error for project ${key}:`, err.message);
            return [];
          }
        });

        const results = await Promise.all(projectQueries);
        allFormatted = results.flat();
      } else {
        // Fallback: use global RALLY_PROJECT env (backward compat)
        const tracker = new RallyTracker({
          apiKey: globalConfig.apiKey,
          server: globalConfig.server,
          workspace: globalConfig.workspace,
          project: globalConfig.project,
        });

        const issues = await tracker.listIssues({
          includeClosed: false,
          limit: 100,
        });

        const projectInfo = {
          id: 'rally-project',
          name: 'Rally',
          color: '#00C7B1',
          icon: 'rally',
        };

        allFormatted = issues.map((issue: any) => this.formatRallyIssue(issue, projectInfo));
      }

      // Compute derived feature status from child stories
      allFormatted = this.computeDerivedFeatureStatus(allFormatted);

      const oldData = this.trackers.rally.lastFetchedIssues;
      const changed = JSON.stringify(allFormatted) !== JSON.stringify(oldData);

      this.trackers.rally.lastFetchedIssues = allFormatted;
      this.trackers.rally.lastFetchedAt = new Date().toISOString();
      this.trackers.rally.lastError = null;

      this.cache.set('rally', 'issues', allFormatted, { ttlSeconds: DEFAULT_TTLS.rally });

      if (changed) {
        console.log(`[IssueDataService] Rally: ${allFormatted.length} issues (changed)`);
        this.pushUpdated();
        this.pushMeta();
      }
    } catch (err: any) {
      const errorMsg = err.message?.includes('Could not parse')
        ? `${err.message} - Check Rally workspace/project configuration. Enable DEBUG=rally for query details.`
        : err.message;
      console.error('[IssueDataService] Rally poll error:', errorMsg);
      this.trackers.rally.lastError = errorMsg;
    }
  }
}
