/**
 * Reconciler GitHub client (PAN-805).
 *
 * Wrapped fetch with:
 *   - mandatory .ok check
 *   - 429 / 5xx exponential backoff (1 s → 60 s, max 5 attempts)
 *   - Retry-After header honoured
 *   - structured error logging
 */

import type { ReconcilerConfig } from './types.js';

export interface GitHubClient {
  addLabel(issueNumber: number, label: string): Promise<GitHubResult>;
  removeLabel(issueNumber: number, label: string): Promise<GitHubResult>;
  listIssueLabels(issueNumber: number): Promise<string[]>;
  closeIssue(issueNumber: number): Promise<GitHubResult>;
  listIssues(params: ListIssuesParams): Promise<ListedIssue[]>;
}

export interface GitHubResult {
  ok: boolean;
  status: number;
  retryAfter?: number;
  retryCount: number;
}

export interface ListIssuesParams {
  state?: 'open' | 'closed' | 'all';
  labels?: string;
  perPage?: number;
  page?: number;
}

export interface ListedIssue {
  number: number;
  state: string;
  labels: Array<{ name: string }>;
}

const MAX_RETRIES = 5;
const INITIAL_BACKOFF_MS = 1000;
const MAX_BACKOFF_MS = 60000;

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function isRetryable(status: number): boolean {
  return status === 429 || (status >= 500 && status < 600);
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  attempt: number,
): Promise<{ response: Response; attemptsMade: number }> {
  const res = await fetch(url, init);

  if (!res.ok && isRetryable(res.status) && attempt < MAX_RETRIES) {
    const retryAfter = res.headers.get('retry-after');
    const backoffMs = retryAfter
      ? Math.min(parseInt(retryAfter, 10) * 1000, MAX_BACKOFF_MS)
      : Math.min(INITIAL_BACKOFF_MS * 2 ** (attempt - 1), MAX_BACKOFF_MS);

    console.warn(
      `[github-client] ${init.method || 'GET'} ${url} → ${res.status} (attempt ${attempt}/${MAX_RETRIES}), retrying after ${backoffMs}ms`
    );

    await sleep(backoffMs);
    return fetchWithRetry(url, init, attempt + 1);
  }

  return { response: res, attemptsMade: attempt };
}

function makeAuthHeaders(token: string): Record<string, string> {
  return {
    Authorization: `Bearer ${token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'Content-Type': 'application/json',
  };
}

export function createGitHubClient(config: ReconcilerConfig): GitHubClient {
  const [owner, repo] = config.repo.split('/');
  const base = `https://api.github.com/repos/${owner}/${repo}`;
  const headers = makeAuthHeaders(config.githubToken);

  return {
    async addLabel(issueNumber: number, label: string): Promise<GitHubResult> {
      const url = `${base}/issues/${issueNumber}/labels`;
      const { response: res, attemptsMade } = await fetchWithRetry(
        url,
        { method: 'POST', headers, body: JSON.stringify({ labels: [label] }) },
        1,
      );
      return {
        ok: res.ok,
        status: res.status,
        retryAfter: res.headers.get('retry-after')
          ? parseInt(res.headers.get('retry-after')!, 10)
          : undefined,
        retryCount: attemptsMade - 1,
      };
    },

    async removeLabel(issueNumber: number, label: string): Promise<GitHubResult> {
      const url = `${base}/issues/${issueNumber}/labels/${encodeURIComponent(label)}`;
      const { response: res, attemptsMade } = await fetchWithRetry(
        url,
        { method: 'DELETE', headers },
        1,
      );
      return {
        ok: res.ok,
        status: res.status,
        retryAfter: res.headers.get('retry-after')
          ? parseInt(res.headers.get('retry-after')!, 10)
          : undefined,
        retryCount: attemptsMade - 1,
      };
    },

    async listIssueLabels(issueNumber: number): Promise<string[]> {
      const url = `${base}/issues/${issueNumber}/labels`;
      const { response: res } = await fetchWithRetry(url, { method: 'GET', headers }, 1);
      if (!res.ok) {
        throw new Error(
          `[github-client] listIssueLabels #${issueNumber} failed: ${res.status}`
        );
      }
      const data = (await res.json()) as Array<{ name: string }>;
      return data.map((l) => l.name);
    },

    async closeIssue(issueNumber: number): Promise<GitHubResult> {
      const url = `${base}/issues/${issueNumber}`;
      const { response: res, attemptsMade } = await fetchWithRetry(
        url,
        { method: 'PATCH', headers, body: JSON.stringify({ state: 'closed' }) },
        1,
      );
      return {
        ok: res.ok,
        status: res.status,
        retryAfter: res.headers.get('retry-after')
          ? parseInt(res.headers.get('retry-after')!, 10)
          : undefined,
        retryCount: attemptsMade - 1,
      };
    },

    async listIssues(params: ListIssuesParams): Promise<ListedIssue[]> {
      const query = new URLSearchParams();
      if (params.state) query.set('state', params.state);
      if (params.labels) query.set('labels', params.labels);
      if (params.perPage) query.set('per_page', String(params.perPage));
      if (params.page) query.set('page', String(params.page));

      const url = `${base}/issues?${query.toString()}`;
      const { response: res } = await fetchWithRetry(url, { method: 'GET', headers }, 1);
      if (!res.ok) {
        throw new Error(`[github-client] listIssues failed: ${res.status}`);
      }
      return (await res.json()) as ListedIssue[];
    },
  };
}
