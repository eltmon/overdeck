/**
 * GitHub OAuth App client (PRD PAN-4293 §7.5, D-8, D-9). Outbound HTTP goes through rc.deps.fetch.
 * The access token is used once to read the user's id and login and is never written anywhere.
 */
import type { Config, Deps } from './env.ts';

export const GITHUB_AUTHORIZE_URL = 'https://github.com/login/oauth/authorize';
export const GITHUB_TOKEN_URL = 'https://github.com/login/oauth/access_token';
export const GITHUB_USER_URL = 'https://api.github.com/user';
export const GITHUB_USERS_URL = 'https://api.github.com/users/';
export const GITHUB_SCOPE = 'read:user';
const USER_AGENT = 'overdeck-account';

export interface GitHubIdentity {
  githubId: number;
  login: string;
}

export type GitHubContext = { config: Config; deps: Deps };

export function callbackUrl(config: Config): string {
  return `${config.publicBaseUrl}/auth/github/callback`;
}

export function authorizeUrl(config: Config, state: string): string {
  const url = new URL(GITHUB_AUTHORIZE_URL);
  url.searchParams.set('client_id', config.githubClientId);
  url.searchParams.set('redirect_uri', callbackUrl(config));
  url.searchParams.set('scope', GITHUB_SCOPE);
  url.searchParams.set('state', state);
  url.searchParams.set('allow_signup', 'true');
  return url.toString();
}

/** Exchanges the callback code for an access token; null on any failure. */
export async function exchangeCode(rc: GitHubContext, code: string): Promise<string | null> {
  const body = new URLSearchParams({
    client_id: rc.config.githubClientId,
    client_secret: rc.config.githubClientSecret,
    code,
    redirect_uri: callbackUrl(rc.config),
  });
  try {
    const res = await rc.deps.fetch(GITHUB_TOKEN_URL, {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': USER_AGENT },
      body: body.toString(),
    });
    if (res.status !== 200) return null;
    const data = (await res.json()) as { access_token?: unknown };
    return typeof data.access_token === 'string' && data.access_token !== '' ? data.access_token : null;
  } catch {
    return null;
  }
}

function parseIdentity(data: unknown): GitHubIdentity | null {
  if (typeof data !== 'object' || data === null) return null;
  const { id, login } = data as { id?: unknown; login?: unknown };
  if (typeof id !== 'number' || !Number.isInteger(id) || id <= 0) return null;
  if (typeof login !== 'string' || login === '') return null;
  return { githubId: id, login };
}

/** Reads the signed-in user's numeric id and login; null on any failure. */
export async function fetchUser(rc: GitHubContext, accessToken: string): Promise<GitHubIdentity | null> {
  try {
    const res = await rc.deps.fetch(GITHUB_USER_URL, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
    });
    if (res.status !== 200) return null;
    return parseIdentity(await res.json());
  } catch {
    return null;
  }
}

export type LookupResult =
  | { ok: true; identity: GitHubIdentity }
  | { ok: false; error: 'not_found' | 'rate_limited' | 'upstream' };

/** D-9: unauthenticated lookup used by the admin add form to resolve a username to its numeric id. */
export async function lookupUserByLogin(rc: GitHubContext, login: string): Promise<LookupResult> {
  try {
    const res = await rc.deps.fetch(`${GITHUB_USERS_URL}${encodeURIComponent(login)}`, {
      headers: { Accept: 'application/vnd.github+json', 'User-Agent': USER_AGENT },
    });
    if (res.status === 404) return { ok: false, error: 'not_found' };
    if (res.status === 403 || res.status === 429) return { ok: false, error: 'rate_limited' };
    if (res.status !== 200) return { ok: false, error: 'upstream' };
    const identity = parseIdentity(await res.json());
    return identity ? { ok: true, identity } : { ok: false, error: 'upstream' };
  } catch {
    return { ok: false, error: 'upstream' };
  }
}
