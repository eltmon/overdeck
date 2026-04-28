/**
 * GitHubClient Effect service (PAN-449)
 *
 * Wraps the GitHub REST API in an Effect service with typed errors.
 */

import { Effect, Layer, Context } from 'effect';
import { getGitHubConfig } from './tracker-config.js';
import {
  IssueNotFound,
  RateLimited,
  TrackerApiError,
  TrackerNotConfigured,
} from './typed-errors.js';

// ─── Domain types ─────────────────────────────────────────────────────────────

export interface GitHubIssue {
  readonly number: number;
  readonly title: string;
  readonly body: string;
  readonly state: 'open' | 'closed';
  readonly labels: ReadonlyArray<{ readonly id: number; readonly name: string }>;
  readonly htmlUrl: string;
}

export interface GitHubLabel {
  readonly id: number;
  readonly name: string;
  readonly color: string;
}

export interface GitHubComment {
  readonly id: number;
  readonly body: string;
  readonly user: string;
  readonly createdAt: string;
}

// ─── Service interface ────────────────────────────────────────────────────────

export interface GitHubClientShape {
  /**
   * Get a GitHub issue by owner/repo/number.
   */
  readonly getIssue: (
    owner: string,
    repo: string,
    number: number,
  ) => Effect.Effect<GitHubIssue, IssueNotFound | TrackerApiError>;

  /**
   * Close a GitHub issue.
   */
  readonly closeIssue: (
    owner: string,
    repo: string,
    number: number,
  ) => Effect.Effect<void, TrackerApiError>;

  /**
   * Reopen a GitHub issue.
   */
  readonly reopenIssue: (
    owner: string,
    repo: string,
    number: number,
  ) => Effect.Effect<void, TrackerApiError>;

  /**
   * Add a label to an issue. Creates the label in the repo if it does not exist.
   */
  readonly addLabel: (
    owner: string,
    repo: string,
    number: number,
    label: string,
  ) => Effect.Effect<void, TrackerApiError>;

  /**
   * Remove a label from an issue. Non-fatal if label is not present.
   */
  readonly removeLabel: (
    owner: string,
    repo: string,
    number: number,
    label: string,
  ) => Effect.Effect<void, TrackerApiError>;

  /**
   * Ensure a label exists in the repo (create if absent).
   */
  readonly ensureLabel: (
    owner: string,
    repo: string,
    name: string,
    color?: string,
    description?: string,
  ) => Effect.Effect<GitHubLabel, TrackerApiError>;

  /**
   * Add a comment to an issue.
   */
  readonly addComment: (
    owner: string,
    repo: string,
    number: number,
    body: string,
  ) => Effect.Effect<void, TrackerApiError>;

  /**
   * Get comments on an issue.
   */
  readonly getComments: (
    owner: string,
    repo: string,
    number: number,
    perPage?: number,
  ) => Effect.Effect<ReadonlyArray<GitHubComment>, TrackerApiError>;
}

// ─── Service tag ──────────────────────────────────────────────────────────────

export class GitHubClient extends Context.Service<GitHubClient, GitHubClientShape>()(
  'panopticon/dashboard/GitHubClient',
) {}

// ─── Live layer ───────────────────────────────────────────────────────────────

function wrapGitHubError(err: unknown): TrackerApiError | RateLimited {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('rate limit') || msg.includes('429')) {
    return new RateLimited({ retryAfter: 60 });
  }
  return new TrackerApiError({ tracker: 'github', message: msg, cause: err });
}

function makeGitHubClientImpl(token: string): GitHubClientShape {
  const headers = {
    Authorization: `token ${token}`,
    Accept: 'application/vnd.github.v3+json',
    'Content-Type': 'application/json',
  };

  // Track rate limit state across requests
  let rateLimitRemaining = 5000;
  let rateLimitResetAt = 0; // Unix timestamp in seconds

  async function ghFetch(url: string, init?: RequestInit): Promise<Response> {
    // If we're near the rate limit, wait until reset time
    if (rateLimitRemaining < 5 && rateLimitResetAt > 0) {
      const nowSec = Math.floor(Date.now() / 1000);
      const waitSec = rateLimitResetAt - nowSec;
      if (waitSec > 0) {
        await new Promise((r) => setTimeout(r, waitSec * 1000));
      }
    }

    const res = await fetch(url, { ...init, headers: { ...headers, ...init?.headers } });

    // Track rate limit headers from every response (headers may be absent in tests/mocks)
    if (res.headers && typeof res.headers.get === 'function') {
      const remaining = res.headers.get('x-ratelimit-remaining');
      const resetAt = res.headers.get('x-ratelimit-reset');
      if (remaining !== null) rateLimitRemaining = parseInt(remaining, 10);
      if (resetAt !== null) rateLimitResetAt = parseInt(resetAt, 10);
    }

    if (res.status === 404) throw new IssueNotFound({ id: url });
    if (res.status === 429) {
      // Respect Retry-After header if present
      const retryAfter = res.headers && typeof res.headers.get === 'function'
        ? res.headers.get('Retry-After')
        : null;
      const retryAfterSec = retryAfter ? parseInt(retryAfter, 10) : 60;
      throw new RateLimited({ retryAfter: retryAfterSec });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`GitHub API ${res.status}: ${body}`);
    }
    return res;
  }

  return {
    getIssue: (owner, repo, number) =>
      Effect.tryPromise({
        try: async () => {
          const res = await ghFetch(
            `https://api.github.com/repos/${owner}/${repo}/issues/${number}`,
          );
          const data = (await res.json()) as any;
          return {
            number: data.number as number,
            title: data.title as string,
            body: (data.body ?? '') as string,
            state: data.state as 'open' | 'closed',
            labels: (data.labels ?? []).map((l: any) => ({ id: l.id, name: l.name })),
            htmlUrl: data.html_url as string,
          } satisfies GitHubIssue;
        },
        catch: (err) => {
          if (err instanceof IssueNotFound || err instanceof RateLimited) return err;
          return wrapGitHubError(err);
        },
      }),

    closeIssue: (owner, repo, number) =>
      Effect.tryPromise({
        try: async () => {
          await ghFetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, {
            method: 'PATCH',
            body: JSON.stringify({ state: 'closed' }),
          });
        },
        catch: (err) => {
          if (err instanceof RateLimited) return err;
          return wrapGitHubError(err);
        },
      }),

    reopenIssue: (owner, repo, number) =>
      Effect.tryPromise({
        try: async () => {
          await ghFetch(`https://api.github.com/repos/${owner}/${repo}/issues/${number}`, {
            method: 'PATCH',
            body: JSON.stringify({ state: 'open' }),
          });
        },
        catch: (err) => {
          if (err instanceof RateLimited) return err;
          return wrapGitHubError(err);
        },
      }),

    addLabel: (owner, repo, number, label) =>
      Effect.tryPromise({
        try: async () => {
          await ghFetch(
            `https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels`,
            {
              method: 'POST',
              body: JSON.stringify({ labels: [label] }),
            },
          );
        },
        catch: (err) => {
          if (err instanceof RateLimited) return err;
          return wrapGitHubError(err);
        },
      }),

    removeLabel: (owner, repo, number, label) =>
      Effect.tryPromise({
        try: async () => {
          try {
            await ghFetch(
              `https://api.github.com/repos/${owner}/${repo}/issues/${number}/labels/${encodeURIComponent(label)}`,
              { method: 'DELETE' },
            );
          } catch (err) {
            // 404 means label was not on the issue — non-fatal
            if (err instanceof IssueNotFound) return;
            throw err;
          }
        },
        catch: (err) => {
          if (err instanceof RateLimited) return err;
          return wrapGitHubError(err);
        },
      }),

    ensureLabel: (owner, repo, name, color = '0075ca', description = '') =>
      Effect.tryPromise({
        try: async () => {
          // Try to create; if the label already exists (422), fall back to fetching it.
          let createRes: Response;
          try {
            createRes = await ghFetch(`https://api.github.com/repos/${owner}/${repo}/labels`, {
              method: 'POST',
              body: JSON.stringify({ name, color, description }),
            });
          } catch (err) {
            // ghFetch throws on !res.ok including 422 (label already exists)
            if (err instanceof Error && err.message.startsWith('GitHub API 422')) {
              const getRes = await ghFetch(
                `https://api.github.com/repos/${owner}/${repo}/labels/${encodeURIComponent(name)}`,
              );
              const data = (await getRes.json()) as any;
              return { id: data.id, name: data.name, color: data.color } satisfies GitHubLabel;
            }
            throw err;
          }
          const data = (await createRes.json()) as any;
          return { id: data.id, name: data.name, color: data.color } satisfies GitHubLabel;
        },
        catch: (err) => {
          if (err instanceof RateLimited) return err;
          return wrapGitHubError(err);
        },
      }),

    addComment: (owner, repo, number, body) =>
      Effect.tryPromise({
        try: async () => {
          await ghFetch(
            `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments`,
            {
              method: 'POST',
              body: JSON.stringify({ body }),
            },
          );
        },
        catch: (err) => {
          if (err instanceof RateLimited) return err;
          return wrapGitHubError(err);
        },
      }),

    getComments: (owner, repo, number, perPage = 50) =>
      Effect.tryPromise({
        try: async () => {
          const res = await ghFetch(
            `https://api.github.com/repos/${owner}/${repo}/issues/${number}/comments?per_page=${perPage}`,
          );
          const data = (await res.json()) as any[];
          return data.map((c) => ({
            id: c.id as number,
            body: c.body as string,
            user: c.user?.login ?? 'unknown',
            createdAt: c.created_at as string,
          })) satisfies GitHubComment[];
        },
        catch: (err) => {
          if (err instanceof IssueNotFound || err instanceof RateLimited) return err;
          return wrapGitHubError(err);
        },
      }),
  };
}

export const GitHubClientLive = Layer.effect(
  GitHubClient,
  Effect.gen(function* () {
    const config = getGitHubConfig();
    if (!config) {
      return yield* Effect.fail(new TrackerNotConfigured({ tracker: 'github' }));
    }
    return makeGitHubClientImpl(config.token);
  }),
);

/**
 * Layer that provides a no-op GitHubClient when GitHub is not configured.
 */
export const GitHubClientOptionalLive = Layer.effect(
  GitHubClient,
  Effect.gen(function* () {
    const config = getGitHubConfig();
    if (!config) {
      const fail = Effect.fail(new TrackerNotConfigured({ tracker: 'github' }));
      return {
        getIssue: () => fail,
        closeIssue: () => fail,
        reopenIssue: () => fail,
        addLabel: () => fail,
        removeLabel: () => fail,
        ensureLabel: () => fail,
        addComment: () => fail,
        getComments: () => fail,
      } as GitHubClientShape;
    }
    return makeGitHubClientImpl(config.token);
  }),
);
