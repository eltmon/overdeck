/**
 * Dashboard sign-in to overdeck.ai through the account service's PKCE loopback flow
 * (PRD PAN-4960 WI-5, FR-5, FR-6, FR-7, NFR-1, NFR-3).
 *
 * `begin()` creates the code verifier and keeps it in one pending slot on this server; only the
 * S256 challenge leaves, inside the authorize URL. The browser returns to
 * `http://127.0.0.1:<port>/oauth/account/callback`, and `complete()` consumes the slot once,
 * exchanges the code with the stored verifier and the identical redirect URI, reads `/v1/me`,
 * and writes `account.json` in the same shape as `pan account login`.
 *
 * One slot (D-5): a new `begin()` replaces the previous one; a callback whose state does not match
 * gets `expired` and leaves the slot, so a stray link cannot cancel a real sign-in. The slot lives
 * `PENDING_SIGN_IN_TTL_MS`, checked lazily against the injected clock; nothing here sets a timer.
 * The verifier never appears in a result, a view or a log line.
 */
import { createHash, timingSafeEqual } from 'node:crypto';

import { AccountClientError, exchangeAuthorizationCode, getMe, platformString, resolveBaseUrl } from '../../../lib/account/client.js';
import { authorizeUrl, createPkcePair, createSignInState } from '../../../lib/account/pkce.js';
import { readAccount, writeAccount, type AccountRecord } from '../../../lib/account/store.js';
import { ensureEnvironmentIdentity } from '../../../lib/environment-identity.js';
import { accountViewService, type AccountSignInView } from './account-view.js';
import { currentDirectoryClient } from './directory-client.js';

export const PENDING_SIGN_IN_TTL_MS = 600_000;
export const CALLBACK_PATH = '/oauth/account/callback';

/** D-3: binds that accept a connection on 127.0.0.1. */
const LOOPBACK_BINDS = new Set(['0.0.0.0', '::', '127.0.0.1', 'localhost']);

export const SIGN_IN_EXPIRED_MESSAGE = 'The sign-in expired. Click Sign in to try again.';
export const INVITE_ONLY_MESSAGE = 'This GitHub account is not on the overdeck.ai invite list. Ask the operator to allow it.';
export const NOT_LOOPBACK_BIND_MESSAGE =
  'This dashboard does not listen on 127.0.0.1, so it cannot receive the sign-in. Run pan account login instead.';

export interface AccountSignInDeps {
  env: NodeJS.ProcessEnv;
  now(): number;
  fetch: typeof fetch;
  readAccount(): Promise<AccountRecord | null>;
  writeAccount(record: AccountRecord): Promise<void>;
  environmentId(): Promise<string>;
  platform(): string | null;
  onSignedIn(): Promise<void>;
}

export type BeginResult = { ok: true; authorizeUrl: string } | { ok: false; status: 400 | 409; error: string };

export type CallbackResult =
  | { kind: 'expired' }
  | { kind: 'failed'; message: string }
  | { kind: 'succeeded'; githubLogin: string | null };

interface PendingSignIn {
  state: string;
  verifier: string;
  redirectUri: string;
  baseUrl: string;
  authorizeUrl: string;
  createdAt: number;
}

const IDLE: AccountSignInView = { state: 'idle', authorizeUrl: null, message: null };

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function digest(value: string): Buffer {
  return createHash('sha256').update(value, 'utf8').digest();
}

function statesMatch(received: string, expected: string): boolean {
  return timingSafeEqual(digest(received), digest(expected));
}

/** D-16: the message for an `error` the account service put on the callback URL. */
function callbackErrorMessage(error: string, description: string | null): string {
  switch (description) {
    case 'invite_only':
      return INVITE_ONLY_MESSAGE;
    case 'account_deleting':
      return 'This overdeck.ai account is being deleted.';
    case 'github_denied':
      return 'Sign-in was cancelled on GitHub.';
    default:
      return `overdeck.ai did not complete the sign-in (${error}).`;
  }
}

export class AccountSignInService {
  private pending: PendingSignIn | null = null;
  private last: AccountSignInView = IDLE;

  constructor(private readonly deps: AccountSignInDeps) {}

  async begin(): Promise<BeginResult> {
    let baseUrl: string;
    try {
      baseUrl = resolveBaseUrl(undefined, this.deps.env);
    } catch (error) {
      return { ok: false, status: 400, error: error instanceof AccountClientError ? error.message : errorMessage(error) };
    }
    const platform = this.deps.platform();
    if (platform === null) {
      return {
        ok: false,
        status: 409,
        error: `This platform (${process.platform}-${process.arch}) cannot sign in to overdeck.ai; supported: linux, darwin, win32 on x64 or arm64.`,
      };
    }
    const host = this.deps.env.HOST;
    if (host !== undefined && !LOOPBACK_BINDS.has(host)) {
      return { ok: false, status: 409, error: NOT_LOOPBACK_BIND_MESSAGE };
    }
    let environmentId: string;
    try {
      await this.deps.readAccount();
      environmentId = await this.deps.environmentId();
    } catch (error) {
      return { ok: false, status: 409, error: errorMessage(error) };
    }

    const { verifier, challenge } = createPkcePair();
    const state = createSignInState();
    const port = Number.parseInt(this.deps.env.API_PORT ?? this.deps.env.PORT ?? '3011', 10);
    const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
    const url = authorizeUrl(baseUrl, { redirectUri, state, challenge, platform, environmentId });
    this.pending = { state, verifier, redirectUri, baseUrl, authorizeUrl: url, createdAt: this.deps.now() };
    this.last = { state: 'pending', authorizeUrl: null, message: null };
    return { ok: true, authorizeUrl: url };
  }

  async complete(query: URLSearchParams): Promise<CallbackResult> {
    const pending = this.pending;
    if (!pending) return { kind: 'expired' };
    if (this.isExpired(pending)) {
      this.expire();
      return { kind: 'expired' };
    }
    if (!statesMatch(query.get('state') ?? '', pending.state)) return { kind: 'expired' };
    // Single use: the slot is gone before any network call.
    this.pending = null;

    const error = query.get('error');
    if (error !== null) return this.fail(callbackErrorMessage(error, query.get('error_description')));
    const code = query.get('code');
    if (!code) return this.fail('overdeck.ai sent no sign-in code.');

    const { baseUrl, redirectUri, verifier } = pending;
    const exchanged = await exchangeAuthorizationCode(baseUrl, { code, codeVerifier: verifier, redirectUri }, { fetch: this.deps.fetch });
    if (!exchanged.ok) {
      switch (exchanged.reason) {
        case 'access_denied':
          return this.fail(INVITE_ONLY_MESSAGE);
        case 'refused':
          return this.fail(`overdeck.ai refused the sign-in code (${exchanged.detail}).`);
        case 'unreachable':
          return this.fail(`Cannot reach ${baseUrl}: ${exchanged.detail}`);
      }
    }

    const me = await getMe(baseUrl, exchanged.accessToken, { fetch: this.deps.fetch }).catch(() => null);
    const githubLogin = me?.ok ? me.me.githubLogin : null;
    try {
      await this.deps.writeAccount({
        v: 1,
        baseUrl,
        accessToken: exchanged.accessToken,
        deviceId: exchanged.deviceId,
        label: exchanged.label,
        githubLogin,
        githubId: me?.ok ? me.me.githubId : null,
        signedInAt: new Date(this.deps.now()).toISOString(),
      });
    } catch (writeError) {
      return this.fail(`Signed in, but could not save account.json: ${errorMessage(writeError)}`);
    }
    await this.deps.onSignedIn().catch(() => undefined);
    this.last = { state: 'succeeded', authorizeUrl: null, message: githubLogin ? `Signed in as ${githubLogin}.` : 'Signed in.' };
    return { kind: 'succeeded', githubLogin };
  }

  view(canSignIn: boolean): AccountSignInView {
    const pending = this.pending;
    if (pending) {
      if (!this.isExpired(pending)) return { state: 'pending', authorizeUrl: canSignIn ? pending.authorizeUrl : null, message: null };
      this.expire();
    }
    return this.last;
  }

  private isExpired(pending: PendingSignIn): boolean {
    return this.deps.now() - pending.createdAt >= PENDING_SIGN_IN_TTL_MS;
  }

  private expire(): void {
    this.pending = null;
    this.last = { state: 'failed', authorizeUrl: null, message: SIGN_IN_EXPIRED_MESSAGE };
  }

  private fail(message: string): CallbackResult {
    this.last = { state: 'failed', authorizeUrl: null, message };
    return { kind: 'failed', message };
  }
}

export function defaultAccountSignInDeps(): AccountSignInDeps {
  return {
    env: process.env,
    now: () => Date.now(),
    fetch: globalThis.fetch,
    readAccount,
    writeAccount,
    environmentId: async () => (await ensureEnvironmentIdentity()).environmentId,
    platform: () => platformString(),
    onSignedIn: async () => {
      accountViewService().clearMeCache();
      await currentDirectoryClient()?.recheckAccount();
    },
  };
}

let singleton: AccountSignInService | null = null;

export function accountSignInService(): AccountSignInService {
  singleton ??= new AccountSignInService(defaultAccountSignInDeps());
  return singleton;
}
