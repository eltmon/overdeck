import type { EventStore } from '../event-store.js';
import { initEventStore } from '../event-store.js';
import { CacheService } from './cache-service.js';
import { getGitHubConfig, type GitHubConfig } from './tracker-config.js';
import {
  getByIssueId,
  markFixed,
  upsert,
  type FlywheelSubstrateBug,
  type FlywheelSubstrateBugFiledBy,
} from '../../../lib/database/flywheel-substrate-bugs-db.js';

type Severity = 'P0' | 'P1' | 'P2';

export interface SubstrateBugTrailer {
  runId?: string;
  filedBy?: FlywheelSubstrateBugFiledBy;
  discoveredIn?: string;
}

export interface GitHubSearchIssue {
  number: number;
  title?: string | null;
  body?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
  labels?: Array<{ name?: string | null } | string>;
  user?: { login?: string | null } | null;
  pull_request?: unknown;
}

interface GitHubPullRequest {
  number: number;
  title?: string | null;
  body?: string | null;
  merged_at?: string | null;
  merge_commit_sha?: string | null;
}

interface GitHubCommit {
  sha?: string | null;
  commit?: { message?: string | null } | null;
}

interface SearchResponse<T> {
  items?: T[];
}

interface SubstrateBugRepository {
  getByIssueId(issueId: string): FlywheelSubstrateBug | null;
  upsert(input: Parameters<typeof upsert>[0]): FlywheelSubstrateBug;
  markFixed(issueId: string, commitSha: string, mergedAt: string): FlywheelSubstrateBug | null;
}

interface RateLimitStore {
  shouldBackoff(): boolean;
  updateFromHeaders(headers: Headers): void;
}

export interface SubstrateBugPollerOptions {
  intervalMs?: number;
  lookbackMs?: number;
  getConfig?: () => GitHubConfig | null;
  fetchImpl?: typeof fetch;
  repository?: SubstrateBugRepository;
  eventStore?: EventStore;
  rateLimitStore?: RateLimitStore;
  now?: () => Date;
  log?: Pick<Console, 'warn' | 'log'>;
}

const DEFAULT_INTERVAL_MS = 60_000;
const DEFAULT_LOOKBACK_MS = 5 * 60_000;
const BOT_LOGIN = 'panopticon-agent[bot]';

class CacheServiceRateLimitStore implements RateLimitStore {
  private cache: CacheService | null = null;

  private getCache(): CacheService {
    this.cache ??= new CacheService();
    return this.cache;
  }

  shouldBackoff(): boolean {
    return this.getCache().shouldBackoff('github');
  }

  updateFromHeaders(headers: Headers): void {
    const remaining = parseIntegerHeader(headers, 'x-ratelimit-remaining');
    const total = parseIntegerHeader(headers, 'x-ratelimit-limit');
    const resetSeconds = parseIntegerHeader(headers, 'x-ratelimit-reset');
    if (remaining === null || total === null || resetSeconds === null) return;

    this.getCache().updateRateLimit('github', {
      remaining,
      total,
      resetAt: new Date(resetSeconds * 1000).toISOString(),
    });
  }
}

const defaultRepository: SubstrateBugRepository = { getByIssueId, upsert, markFixed };
let activePoller: ReturnType<typeof createSubstrateBugPoller> | null = null;

function parseIntegerHeader(headers: Headers, name: string): number | null {
  const raw = headers.get(name);
  if (!raw) return null;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseSubstrateBugTrailer(body: string | null | undefined): SubstrateBugTrailer {
  const text = body ?? '';
  const runId = text.match(/^Flywheel-Run-Id:\s*(\S+)\s*$/im)?.[1];
  const filedByRaw = text.match(/^Flywheel-Filed-By:\s*(agent|operator)\s*$/im)?.[1];
  const discoveredIn = text.match(/^Flywheel-Discovered-In:\s*([A-Z][A-Z0-9]*-\d+)\s*$/im)?.[1];
  return {
    ...(runId ? { runId } : {}),
    ...(filedByRaw === 'agent' || filedByRaw === 'operator' ? { filedBy: filedByRaw } : {}),
    ...(discoveredIn ? { discoveredIn } : {}),
  };
}

export function severityFromLabels(labels: GitHubSearchIssue['labels'] = []): Severity {
  const names = labels.map((label) => typeof label === 'string' ? label : label.name ?? '');
  if (names.includes('P0')) return 'P0';
  if (names.includes('P1')) return 'P1';
  if (names.includes('P2')) return 'P2';
  return 'P2';
}

export function extractClosingIssueNumbers(text: string): number[] {
  const numbers = new Set<number>();
  const re = /\b(?:close[sd]?|fix(?:es|ed)?|resolve[sd]?)\s+#(\d+)\b/gi;
  for (const match of text.matchAll(re)) {
    const number = Number.parseInt(match[1] ?? '', 10);
    if (Number.isInteger(number)) numbers.add(number);
  }
  return [...numbers];
}

function issueIdFor(prefix: string | undefined, number: number): string | null {
  return prefix ? `${prefix.toUpperCase()}-${number}` : null;
}

function searchQuery(params: string[]): string {
  return `/search/issues?q=${encodeURIComponent(params.join(' '))}&per_page=50`;
}

function isoLookback(now: Date, lookbackMs: number): string {
  return new Date(now.getTime() - lookbackMs).toISOString();
}

async function appendSubstrateBugFiledEvent(store: EventStore, bug: FlywheelSubstrateBug): Promise<void> {
  const payload: {
    issueId: string;
    runId?: string;
    filedBy: FlywheelSubstrateBugFiledBy;
    discoveredIn?: string;
    severity: Severity;
  } = {
    issueId: bug.issueId,
    filedBy: bug.filedBy,
    severity: bug.severity === 'P0' || bug.severity === 'P1' ? bug.severity : 'P2',
  };
  if (bug.runId) payload.runId = bug.runId;
  if (bug.discoveredInIssueId) payload.discoveredIn = bug.discoveredInIssueId;

  await store.appendAsync({
    type: 'substrate.bug_filed',
    timestamp: bug.filedAt,
    payload,
  });
}

export function createSubstrateBugPoller(options: SubstrateBugPollerOptions = {}) {
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const lookbackMs = options.lookbackMs ?? DEFAULT_LOOKBACK_MS;
  const fetchImpl = options.fetchImpl ?? fetch;
  const getConfig = options.getConfig ?? getGitHubConfig;
  const repository = options.repository ?? defaultRepository;
  const rateLimitStore = options.rateLimitStore ?? new CacheServiceRateLimitStore();
  const now = options.now ?? (() => new Date());
  const log = options.log ?? console;
  let timer: ReturnType<typeof setInterval> | null = null;
  let running = false;

  async function githubGet<T>(token: string, path: string): Promise<T | null> {
    if (rateLimitStore.shouldBackoff()) return null;

    const response = await fetchImpl(`https://api.github.com${path}`, {
      headers: {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
      },
    });
    rateLimitStore.updateFromHeaders(response.headers);

    if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') return null;
    if (!response.ok) throw new Error(`GitHub API ${response.status}: ${await response.text().catch(() => '')}`);
    return await response.json() as T;
  }

  async function fetchSearch(token: string, query: string): Promise<GitHubSearchIssue[] | null> {
    const result = await githubGet<SearchResponse<GitHubSearchIssue>>(token, query);
    return result?.items ?? null;
  }

  async function scanIssueCandidates(config: GitHubConfig, store: EventStore): Promise<void> {
    const since = isoLookback(now(), lookbackMs);
    for (const repo of config.repos) {
      const repoQualifier = `repo:${repo.owner}/${repo.repo}`;
      const authorResults = await fetchSearch(config.token, searchQuery([
        repoQualifier,
        'is:issue',
        '-is:pr',
        `author:${BOT_LOGIN}`,
        `updated:>=${since}`,
      ]));
      if (authorResults === null) return;

      const substrateResults = await fetchSearch(config.token, searchQuery([
        repoQualifier,
        'is:issue',
        '-is:pr',
        'label:substrate',
        `updated:>=${since}`,
      ]));
      if (substrateResults === null) return;

      const byNumber = new Map<number, GitHubSearchIssue>();
      for (const issue of [...authorResults, ...substrateResults]) byNumber.set(issue.number, issue);

      for (const issue of byNumber.values()) {
        const issueId = issueIdFor(repo.prefix, issue.number);
        if (!issueId) continue;
        const trailer = parseSubstrateBugTrailer(issue.body);
        const filedBy = trailer.filedBy ?? (issue.user?.login === BOT_LOGIN ? 'agent' : 'operator');
        const existing = repository.getByIssueId(issueId);
        const bug = repository.upsert({
          issueId,
          filedAt: issue.created_at ?? issue.updated_at ?? now().toISOString(),
          runId: trailer.runId ?? null,
          filedBy,
          discoveredInIssueId: trailer.discoveredIn ?? null,
          severity: severityFromLabels(issue.labels),
          updatedAt: issue.updated_at ?? now().toISOString(),
        });
        if (!existing) await appendSubstrateBugFiledEvent(store, bug);
      }
    }
  }

  async function scanMergedPullRequests(config: GitHubConfig): Promise<void> {
    const since = isoLookback(now(), lookbackMs);
    for (const repo of config.repos) {
      const repoQualifier = `repo:${repo.owner}/${repo.repo}`;
      const pullResults = await fetchSearch(config.token, searchQuery([
        repoQualifier,
        'is:pr',
        'is:merged',
        `updated:>=${since}`,
      ]));
      if (pullResults === null) return;

      for (const pull of pullResults) {
        const details = await githubGet<GitHubPullRequest>(config.token, `/repos/${repo.owner}/${repo.repo}/pulls/${pull.number}`);
        if (!details?.merged_at) continue;
        const commits = await githubGet<GitHubCommit[]>(config.token, `/repos/${repo.owner}/${repo.repo}/pulls/${pull.number}/commits`);
        if (commits === null) return;

        const text = [
          details.title ?? pull.title ?? '',
          details.body ?? pull.body ?? '',
          ...commits.map((commit) => commit.commit?.message ?? ''),
        ].join('\n');
        const closingNumbers = extractClosingIssueNumbers(text);
        const fixedAt = details.merged_at;
        const commitSha = details.merge_commit_sha ?? commits.at(-1)?.sha;
        if (!commitSha) continue;

        for (const number of closingNumbers) {
          const issueId = issueIdFor(repo.prefix, number);
          if (!issueId || !repository.getByIssueId(issueId)) continue;
          repository.markFixed(issueId, commitSha, fixedAt);
        }
      }
    }
  }

  async function pollOnce(): Promise<void> {
    if (running) return;
    const config = getConfig();
    if (!config) return;
    running = true;
    try {
      const store = options.eventStore ?? await initEventStore();
      await scanIssueCandidates(config, store);
      await scanMergedPullRequests(config);
    } catch (err) {
      log.warn('[substrate-bug-poller] poll failed:', err instanceof Error ? err.message : err);
    } finally {
      running = false;
    }
  }

  function start(): void {
    if (timer) return;
    void pollOnce();
    timer = setInterval(() => void pollOnce(), intervalMs);
  }

  function stop(): void {
    if (!timer) return;
    clearInterval(timer);
    timer = null;
  }

  return { pollOnce, start, stop };
}

export function startSubstrateBugPoller(options: SubstrateBugPollerOptions = {}): void {
  if (activePoller) return;
  activePoller = createSubstrateBugPoller(options);
  activePoller.start();
  (options.log ?? console).log('[panopticon] SubstrateBugPoller started');
}

export function stopSubstrateBugPoller(): void {
  activePoller?.stop();
  activePoller = null;
}
