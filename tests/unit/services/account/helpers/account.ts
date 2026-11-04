/**
 * Account-page test helpers (PAN-4959): a web session planted directly in user_sessions for a seeded users
 * row, and a POST helper that sends the cookie, csrf field and Origin header (NFR-1).
 *
 * requireUserSession joins users and checks access, so the users row is seeded here; the default user is
 * the owner (always allowed). Pass another GitHub id and seed a grants row for an ordinary user.
 */
import { ACCOUNT_COOKIE, ACCOUNT_SESSION_TTL_MS } from '../../../../../services/account/src/account-page/session.ts';
import { sha256Hex } from '../../../../../services/account/src/crypto.ts';
import type { Deps, Env } from '../../../../../services/account/src/env.ts';
import { call, form, TEST_BASE_URL, TEST_OWNER_GITHUB_ID, type FakeCtx } from './harness.ts';

export interface AccountUser {
  githubId: number;
  login: string;
}

export interface AccountClient {
  userId: string;
  cookie: string;
  csrf: string;
  get(path?: string): Promise<Response>;
  post(path: string, fields?: Record<string, string>, opts?: { origin?: string | null; csrf?: string | null; ctx?: FakeCtx }): Promise<Response>;
}

export async function makeAccountClient(
  env: Env,
  deps: Deps,
  userId: string,
  user: AccountUser = { githubId: TEST_OWNER_GITHUB_ID, login: 'owner' },
): Promise<AccountClient> {
  await env.DB.prepare('INSERT OR IGNORE INTO users (user_id, github_id, github_login, created_at) VALUES (?, ?, ?, ?)')
    .bind(userId, user.githubId, user.login, deps.now())
    .run();
  const sessionId = 'ef'.repeat(32);
  const csrf = '01'.repeat(16);
  await env.DB.prepare('INSERT OR REPLACE INTO user_sessions (session_hash, user_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(sessionId), userId, csrf, deps.now(), deps.now() + ACCOUNT_SESSION_TTL_MS)
    .run();
  const cookie = `${ACCOUNT_COOKIE}=${sessionId}`;
  return {
    userId,
    cookie,
    csrf,
    get: (path = '/account') => call('GET', path, { env, deps, headers: { Cookie: cookie } }),
    post: (path, fields = {}, opts = {}) => {
      const body = form({ ...(opts.csrf === null ? {} : { csrf: opts.csrf ?? csrf }), ...fields });
      const headers: Record<string, string> = { Cookie: cookie, ...body.headers };
      if (opts.origin !== null) headers.Origin = opts.origin ?? TEST_BASE_URL;
      return call('POST', path, { env, deps, headers, body: body.body, ...(opts.ctx ? { ctx: opts.ctx } : {}) });
    },
  };
}
