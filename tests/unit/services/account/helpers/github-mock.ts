/**
 * Outbound GitHub mock for deps.fetch. Any URL it does not know fails the test by throwing.
 * Also exposes the one access token it hands out so tests can assert it was never persisted (NFR-2).
 */
import type { GitHubIdentity } from '../../../../../services/account/src/github.ts';

export const MOCK_ACCESS_TOKEN = 'gho_mocked_access_token_0123456789';

export interface GitHubMockOptions {
  identity?: GitHubIdentity | null;
  /** Status for the token exchange; default 200 with MOCK_ACCESS_TOKEN. */
  tokenStatus?: number;
  /** Status for GET /user; default 200. */
  userStatus?: number;
  /** Responses for GET /users/<login>, keyed by login. */
  users?: Record<string, { status: number; body?: unknown }>;
}

export interface GitHubMock {
  fetch: typeof fetch;
  calls: Array<{ url: string; method: string; headers: Record<string, string>; body: string | null }>;
}

export function githubMock(opts: GitHubMockOptions = {}): GitHubMock {
  const calls: GitHubMock['calls'] = [];
  const fetchImpl: typeof fetch = async (input, init) => {
    const url = input instanceof Request ? input.url : String(input);
    const headers: Record<string, string> = {};
    new Headers(init?.headers ?? (input instanceof Request ? input.headers : undefined)).forEach((v, k) => {
      headers[k] = v;
    });
    const body = typeof init?.body === 'string' ? init.body : null;
    calls.push({ url, method: init?.method ?? 'GET', headers, body });

    if (url === 'https://github.com/login/oauth/access_token') {
      const status = opts.tokenStatus ?? 200;
      return new Response(status === 200 ? JSON.stringify({ access_token: MOCK_ACCESS_TOKEN, token_type: 'bearer', scope: 'read:user' }) : JSON.stringify({ error: 'bad_verification_code' }), {
        status,
        headers: { 'Content-Type': 'application/json' },
      });
    }
    if (url === 'https://api.github.com/user') {
      const status = opts.userStatus ?? 200;
      const identity = opts.identity === undefined ? { githubId: 1, login: 'owner' } : opts.identity;
      if (status !== 200 || !identity) return new Response(JSON.stringify({ message: 'Bad credentials' }), { status: status === 200 ? 401 : status });
      return new Response(JSON.stringify({ id: identity.githubId, login: identity.login, node_id: 'x' }), { status: 200, headers: { 'Content-Type': 'application/json' } });
    }
    if (url.startsWith('https://api.github.com/users/')) {
      const login = decodeURIComponent(url.slice('https://api.github.com/users/'.length));
      const entry = opts.users?.[login];
      if (!entry) return new Response(JSON.stringify({ message: 'Not Found' }), { status: 404 });
      return new Response(JSON.stringify(entry.body ?? {}), { status: entry.status, headers: { 'Content-Type': 'application/json' } });
    }
    throw new Error(`github mock: unexpected outbound fetch ${url}`);
  };
  return { fetch: fetchImpl, calls };
}
