/**
 * The Settings → Anywhere Account card's data (PRD PAN-4960 WI-4, FR-2, FR-8, D-8, D-9, D-12).
 *
 * Joins three sources: `account.json` (who is signed in, and the account service's base URL),
 * a cached `GET /v1/me` (the plan), and the directory client (the relay allowance, and the plan
 * when overdeck.ai is unreachable). The `/v1/me` cache holds one entry keyed by the device token
 * and lives `ME_CACHE_TTL_MS`, so the card's polling sends at most one request per token per
 * 5 minutes (NFR-4). Unreachable results are not cached, so the next view retries.
 */
import type { RelayStatusView } from '@overdeck/contracts';

import { getMe, type MeResult } from '../../../lib/account/client.js';
import { readAccount, type AccountRecord } from '../../../lib/account/store.js';
import { currentDirectoryClient } from './directory-client.js';

export const ME_CACHE_TTL_MS = 300_000;
const ME_TIMEOUT_MS = 5_000;

export type AccountPlan = 'free' | 'tester';

export interface AccountSignInView {
  state: 'idle' | 'pending' | 'succeeded' | 'failed';
  /** Only for viewers who may sign in, and only while pending. */
  authorizeUrl: string | null;
  message: string | null;
}

export interface AccountView {
  signedIn: boolean;
  githubLogin: string | null;
  /** `<baseUrl>/account` when signed in. */
  manageUrl: string | null;
  plan: AccountPlan | null;
  tokenRejected: boolean;
  relay: RelayStatusView | null;
  /** The viewer is a root session from a trusted local request (FR-4, D-4). */
  canSignIn: boolean;
  /** readAccount()'s message when account.json is unreadable. */
  accountError: string | null;
  signIn: AccountSignInView;
}

export interface AccountViewDeps {
  readAccount(): Promise<AccountRecord | null>;
  getMe(baseUrl: string, token: string): Promise<MeResult>;
  directoryPlan(): AccountPlan | null;
  directoryRelay(): RelayStatusView | null;
  now(): number;
}

interface MeCacheEntry {
  accessToken: string;
  result: MeResult;
  fetchedAt: number;
}

export class AccountViewService {
  private meCache: MeCacheEntry | null = null;

  constructor(private readonly deps: AccountViewDeps) {}

  async view(input: { canSignIn: boolean; signIn: AccountSignInView }): Promise<AccountView> {
    const base = {
      relay: this.deps.directoryRelay(),
      canSignIn: input.canSignIn,
      signIn: input.signIn,
    };
    let account: AccountRecord | null;
    try {
      account = await this.deps.readAccount();
    } catch (error) {
      return {
        ...base,
        signedIn: false,
        githubLogin: null,
        manageUrl: null,
        plan: null,
        tokenRejected: false,
        accountError: error instanceof Error ? error.message : String(error),
      };
    }
    if (!account) {
      return { ...base, signedIn: false, githubLogin: null, manageUrl: null, plan: null, tokenRejected: false, accountError: null };
    }

    const me = await this.me(account);
    let plan: AccountPlan | null = null;
    if (me.ok) plan = me.me.entitlement?.plan ?? null;
    else if (me.kind === 'unreachable') plan = this.deps.directoryPlan();
    return {
      ...base,
      signedIn: true,
      githubLogin: account.githubLogin,
      manageUrl: `${account.baseUrl}/account`,
      plan,
      tokenRejected: !me.ok && me.kind === 'unauthorized',
      accountError: null,
    };
  }

  /** Drop the cached /v1/me result (called after a dashboard sign-in). */
  clearMeCache(): void {
    this.meCache = null;
  }

  private async me(account: AccountRecord): Promise<MeResult> {
    const cached = this.meCache;
    if (cached && cached.accessToken === account.accessToken && this.deps.now() - cached.fetchedAt < ME_CACHE_TTL_MS) {
      return cached.result;
    }
    // The 5 s timeout can abort while the body is still being read, after getMe's own catch.
    const result = await this.deps
      .getMe(account.baseUrl, account.accessToken)
      .catch((error: unknown): MeResult => ({ ok: false, kind: 'unreachable', detail: error instanceof Error ? error.message : String(error) }));
    if (result.ok || result.kind !== 'unreachable') {
      this.meCache = { accessToken: account.accessToken, result, fetchedAt: this.deps.now() };
    }
    return result;
  }
}

export function defaultAccountViewDeps(): AccountViewDeps {
  const timedFetch = Object.assign(
    (input: Parameters<typeof fetch>[0], init?: RequestInit) => fetch(input, { ...init, signal: AbortSignal.timeout(ME_TIMEOUT_MS) }),
    fetch,
  );
  return {
    readAccount,
    getMe: (baseUrl, token) => getMe(baseUrl, token, { fetch: timedFetch }),
    directoryPlan: () => currentDirectoryClient()?.status().plan ?? null,
    directoryRelay: () => currentDirectoryClient()?.relayStatus() ?? null,
    now: () => Date.now(),
  };
}

let singleton: AccountViewService | null = null;

export function accountViewService(): AccountViewService {
  singleton ??= new AccountViewService(defaultAccountViewDeps());
  return singleton;
}
