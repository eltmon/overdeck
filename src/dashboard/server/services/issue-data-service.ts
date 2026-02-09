/**
 * IssueDataService — Central orchestrator for issue data
 *
 * Replaces the inline fetching in /api/issues with:
 * - Background polling per tracker on independent timers
 * - GitHub REST + ETags (304s are FREE, don't count against rate limit)
 * - Linear incremental fetching via updatedAt filter
 * - Rally TTL-based caching
 * - Change detection + socket.io push
 * - Adaptive backoff on rate limit pressure
 * - Instant serve from cache (sub-100ms dashboard loads)
 */

import { Octokit } from '@octokit/rest';
import type { Server as SocketIOServer } from 'socket.io';
import { CacheService, DEFAULT_TTLS } from './cache-service.js';
import { getGitHubConfig, getLinearApiKey, getRallyConfig, validateRallyConfig } from './tracker-config.js';
import type { GitHubConfig, RallyConfig } from './tracker-config.js';

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
 * Map GitHub issue state + labels to canonical dashboard status string.
 */
function mapGitHubStateToCanonical(state: string, labels: string[]): string {
  const stateLower = state.toLowerCase();

  if (stateLower === 'closed') return 'done';

  const labelNames = labels.map(l => l.toLowerCase());

  if (labelNames.some(l => l === 'done' || l.includes('completed'))) return 'in_review';
  if (labelNames.some(l => l.includes('in review') || l.includes('in-review') || l.includes('review') || l.includes('qa'))) return 'in_review';
  if (labelNames.some(l => l.includes('in progress') || l.includes('in-progress') || l.includes('wip'))) return 'in_progress';
  if (labelNames.some(l => l.includes('planning') || l.includes('discovery'))) return 'planning';
  if (labelNames.some(l => l === 'planned')) return 'planned';
  if (labelNames.some(l => l.includes('backlog') || l.includes('icebox'))) return 'backlog';
  if (labelNames.some(l => l.includes('todo') || l.includes('ready'))) return 'todo';

  return 'todo';
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

function getOneDayAgo(): Date {
  const date = new Date();
  date.setDate(date.getDate() - 1);
  return date;
}

export class IssueDataService {
  private cache: CacheService;
  private io: SocketIOServer;
  private trackers: Record<string, TrackerState> = {};
  private linearLastFullRefresh = 0;
  private started = false;
  private shadowStateModule: any = null;

  constructor(io: SocketIOServer, cache: CacheService) {
    this.io = io;
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
   * Start background polling. Immediately does one full fetch for instant data.
   */
  async start(): Promise<void> {
    if (this.started) return;
    this.started = true;

    // Pre-load shadow state module
    await this.ensureShadowStateLoaded();

    // Load any cached data from SQLite so getIssues() works instantly
    this.loadCachedData();

    // Immediately fetch all trackers (cold start)
    await Promise.allSettled([
      this.pollGitHub(),
      this.pollLinear(),
      this.pollRally(),
    ]);

    // Push initial snapshot to any connected clients
    this.pushSnapshot();

    // Start recurring timers
    this.scheduleNext('github');
    this.scheduleNext('linear');
    this.scheduleNext('rally');

    // On new client connection, send cached snapshot immediately
    this.io.on('connection', (socket) => {
      const issues = this.getIssues();
      socket.emit('issues:snapshot', issues);

      // Client can request a fresh snapshot (e.g., on tab re-focus)
      socket.on('issues:request-snapshot', () => {
        socket.emit('issues:snapshot', this.getIssues());
      });
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
   * Get all issues from cache. Applies shadow state and filtering.
   * This is the hot path — must be fast.
   */
  getIssues(options?: { cycle?: string; includeCompleted?: boolean }): any[] {
    let allIssues = [
      ...this.trackers.github.lastFetchedIssues,
      ...this.trackers.linear.lastFetchedIssues,
      ...this.trackers.rally.lastFetchedIssues,
    ];

    // Merge shadow state (module is pre-loaded by ensureShadowStateLoaded)
    try {
      if (this.shadowStateModule) {
        const shadowStates = this.shadowStateModule.listShadowedIssues();
        const shadowMap = new Map<string, any>();
        for (const state of shadowStates) {
          shadowMap.set(state.issueId.toLowerCase(), state);
        }

        allIssues = allIssues.map(issue => {
          const shadowState = shadowMap.get(issue.identifier.toLowerCase());
          if (shadowState) {
            return {
              ...issue,
              shadowStatus: shadowState.shadowStatus,
              targetCanonicalState: shadowState.targetCanonicalState,
              shadowedAt: shadowState.shadowedAt,
            };
          }
          return { ...issue, shadowStatus: null, targetCanonicalState: null };
        });
      }
    } catch (e) {
      allIssues = allIssues.map(issue => ({ ...issue, shadowStatus: null }));
    }

    // Filter completed issues (only keep last 24h)
    const includeCompleted = options?.includeCompleted ?? false;
    if (!includeCompleted) {
      const oneDayAgoTime = getOneDayAgo().getTime();
      allIssues = allIssues.filter(issue => {
        const isDone = issue.status === 'Done' || issue.status === 'Completed' || issue.status === 'Closed';
        const isCanceled = issue.status === 'Canceled' || issue.status === 'Cancelled';

        if (!isDone && !isCanceled) return true;

        if (issue.completedAt) {
          return new Date(issue.completedAt).getTime() >= oneDayAgoTime;
        }
        return false;
      });
    }

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
  async invalidateTracker(tracker: string): Promise<void> {
    this.cache.invalidate(tracker);

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
    } catch {
      // Shadow state not available — issues will work without it
    }
  }

  private loadCachedData(): void {
    for (const tracker of ['github', 'linear', 'rally']) {
      const cached = this.cache.getStale(tracker, 'issues');
      if (cached?.data) {
        this.trackers[tracker].lastFetchedIssues = cached.data;
        this.trackers[tracker].lastFetchedAt = cached.lastFetchedAt;
      }
    }
  }

  private pushSnapshot(): void {
    const issues = this.getIssues();
    this.io.emit('issues:snapshot', issues);
  }

  private pushUpdated(): void {
    const issues = this.getIssues();
    this.io.emit('issues:updated', issues);
  }

  /**
   * Push rate limit/meta info to connected clients.
   */
  private pushMeta(): void {
    this.io.emit('issues:meta', this.getDiagnostics());
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
          octokit, owner, repo, 'open', prefix || repo.toUpperCase(),
          `github:open:${owner}/${repo}`
        );

        // Fetch recently closed issues
        const closedIssues = await this.fetchGitHubRepoIssues(
          octokit, owner, repo, 'closed', prefix || repo.toUpperCase(),
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
      headers: cachedEtag ? { 'If-None-Match': cachedEtag } : {},
    };

    // For closed issues, only get recently closed ones
    if (state === 'closed') {
      requestParams.since = getOneDayAgo().toISOString();
      requestParams.per_page = 50;
    }

    try {
      const response = await octokit.issues.listForRepo(requestParams);

      // Extract rate limit from headers
      const remaining = parseInt(response.headers['x-ratelimit-remaining'] as string);
      const total = parseInt(response.headers['x-ratelimit-limit'] as string);
      const resetAt = new Date(parseInt(response.headers['x-ratelimit-reset'] as string) * 1000).toISOString();

      if (!isNaN(remaining) && !isNaN(total)) {
        this.cache.updateRateLimit('github', { remaining, total, resetAt });
      }

      // Store new ETag
      const newEtag = response.headers.etag as string | undefined;

      // Filter out PRs (they have pull_request key)
      const issues = response.data.filter((issue: any) => !issue.pull_request);

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
                  canonicalStatus === 'planning' ? 'In Planning' :
                  canonicalStatus === 'planned' ? 'Planned' :
                  canonicalStatus === 'in_progress' ? 'In Progress' :
                  canonicalStatus === 'in_review' ? 'In Review' :
                  canonicalStatus === 'done' ? 'Done' :
                  canonicalStatus === 'backlog' ? 'Backlog' : 'Todo',
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
        return cached?.data || [];
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
    // Default: current cycle, exclude completed
    filterConditions.push('cycle: { isActive: { eq: true } }');
    filterConditions.push('state: { type: { nin: ["completed", "canceled"] } }');

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
  // Rally polling — TTL-based caching only
  // ---------------------------------------------------------------

  private async pollRally(): Promise<void> {
    const config = getRallyConfig();
    if (!config) {
      this.trackers.rally.lastFetchedIssues = [];
      return;
    }

    // Validate config on first poll and log warnings
    if (!this.trackers.rally.lastFetchedAt) {
      const validation = validateRallyConfig(config);
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

      const tracker = new RallyTracker({
        apiKey: config.apiKey,
        server: config.server,
        workspace: config.workspace,
        project: config.project,
      });

      const issues = await tracker.listIssues({
        includeClosed: false,
        limit: 100,
      });

      const formatted = issues.map((issue: any) => {
        const canonicalStatus = mapRallyStateToCanonical(issue.state);
        const identifier = issue.ref || issue.id || 'unknown';
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
          project: {
            id: 'rally-project',
            name: 'Rally',
            color: '#00C7B1',
            icon: 'rally',
          },
          source: 'rally',
        };
      });

      const oldData = this.trackers.rally.lastFetchedIssues;
      const changed = JSON.stringify(formatted) !== JSON.stringify(oldData);

      this.trackers.rally.lastFetchedIssues = formatted;
      this.trackers.rally.lastFetchedAt = new Date().toISOString();
      this.trackers.rally.lastError = null;

      this.cache.set('rally', 'issues', formatted, { ttlSeconds: DEFAULT_TTLS.rally });

      if (changed) {
        console.log(`[IssueDataService] Rally: ${formatted.length} issues (changed)`);
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
