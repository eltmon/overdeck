/**
 * Admin-screen test helpers: an owner session planted directly in admin_sessions, and a POST helper that sends the
 * D-20 cookie, csrf field and Origin header.
 */
import { ADMIN_SESSION_TTL_MS } from '../../../../../services/account/src/admin/session.ts';
import { sha256Hex } from '../../../../../services/account/src/crypto.ts';
import type { Deps, Env } from '../../../../../services/account/src/env.ts';
import { call, form, TEST_BASE_URL, TEST_OWNER_GITHUB_ID } from './harness.ts';

export interface AdminClient {
  cookie: string;
  csrf: string;
  get(path?: string): Promise<Response>;
  post(path: string, fields?: Record<string, string>, opts?: { origin?: string | null; csrf?: string | null }): Promise<Response>;
}

export async function makeAdminClient(env: Env, deps: Deps, githubId = TEST_OWNER_GITHUB_ID): Promise<AdminClient> {
  const sessionId = 'ab'.repeat(32);
  const csrf = 'cd'.repeat(16);
  await env.DB.prepare('INSERT OR REPLACE INTO admin_sessions (session_hash, github_id, csrf_token, created_at, expires_at) VALUES (?, ?, ?, ?, ?)')
    .bind(await sha256Hex(sessionId), githubId, csrf, deps.now(), deps.now() + ADMIN_SESSION_TTL_MS)
    .run();
  const cookie = `__Host-od_admin=${sessionId}`;
  return {
    cookie,
    csrf,
    get: (path = '/admin') => call('GET', path, { env, deps, headers: { Cookie: cookie } }),
    post: (path, fields = {}, opts = {}) => {
      const body = form({ ...(opts.csrf === null ? {} : { csrf: opts.csrf ?? csrf }), ...fields });
      const headers: Record<string, string> = { Cookie: cookie, ...body.headers };
      if (opts.origin !== null) headers.Origin = opts.origin ?? TEST_BASE_URL;
      return call('POST', path, { env, deps, headers, body: body.body });
    },
  };
}
