/**
 * PAN-4960 WI-4: the Account card's view. account.json, /v1/me and the directory client are
 * injected; the /v1/me cache runs on an injected clock, so no test waits on real time.
 */
import { describe, expect, it, vi } from 'vitest';

import type { Me, MeResult } from '../../../../lib/account/client.js';
import type { AccountRecord } from '../../../../lib/account/store.js';
import { AccountViewService, ME_CACHE_TTL_MS, type AccountViewDeps } from '../account-view.js';

const IDLE = { state: 'idle' as const, authorizeUrl: null, message: null };
const ACCOUNT: AccountRecord = {
  v: 1,
  baseUrl: 'https://account.overdeck.ai',
  accessToken: `odd_${'a'.repeat(64)}`,
  deviceId: 'device-1',
  label: 'desk',
  githubLogin: 'octocat',
  githubId: 100,
  signedInAt: '2026-11-04T00:00:00.000Z',
};

function me(plan: 'free' | 'tester'): MeResult {
  const value: Me = {
    userId: 'u1',
    githubId: 100,
    githubLogin: 'octocat',
    deviceId: 'device-1',
    entitlement: { plan, storageBytesCap: 5368709120, maxDevices: 3 },
    access: { status: 'active', expiresAt: null },
  };
  return { ok: true, me: value };
}

function harness(over: Partial<AccountViewDeps> = {}) {
  let account: AccountRecord | null = ACCOUNT;
  let now = 1_000_000;
  const getMe = vi.fn<AccountViewDeps['getMe']>(async () => me('tester'));
  const deps: AccountViewDeps = {
    readAccount: async () => account,
    getMe,
    directoryPlan: () => null,
    directoryRelay: () => null,
    now: () => now,
    ...over,
  };
  return {
    service: new AccountViewService(deps),
    getMe,
    setAccount: (next: AccountRecord | null) => {
      account = next;
    },
    advance: (ms: number) => {
      now += ms;
    },
  };
}

describe('AccountViewService (PAN-4960 WI-4)', () => {
  it('reports a signed-out machine with no manage link and no plan', async () => {
    const h = harness();
    h.setAccount(null);
    const view = await h.service.view({ canSignIn: true, signIn: IDLE });
    expect(view).toMatchObject({ signedIn: false, githubLogin: null, manageUrl: null, plan: null, tokenRejected: false, accountError: null, canSignIn: true });
    expect(h.getMe).not.toHaveBeenCalled();
  });

  it('returns the /v1/me plan, the login from account.json and the manage URL (ac1)', async () => {
    const relay = { month: '2026-11', bytesUsed: 1, capBytes: 2, stopped: false };
    const h = harness({ directoryRelay: () => relay });
    const view = await h.service.view({ canSignIn: false, signIn: IDLE });
    expect(view).toEqual({
      signedIn: true,
      githubLogin: 'octocat',
      manageUrl: 'https://account.overdeck.ai/account',
      plan: 'tester',
      tokenRejected: false,
      relay,
      canSignIn: false,
      accountError: null,
      signIn: IDLE,
    });
    expect(h.getMe).toHaveBeenCalledWith(ACCOUNT.baseUrl, ACCOUNT.accessToken);
  });

  it('calls /v1/me once per token per 300 000 ms (ac2)', async () => {
    const h = harness();
    await h.service.view({ canSignIn: false, signIn: IDLE });
    h.advance(ME_CACHE_TTL_MS - 1);
    await h.service.view({ canSignIn: false, signIn: IDLE });
    expect(h.getMe).toHaveBeenCalledTimes(1);
    h.advance(1);
    await h.service.view({ canSignIn: false, signIn: IDLE });
    expect(h.getMe).toHaveBeenCalledTimes(2);
  });

  it('calls /v1/me again for a changed token and after clearMeCache() (ac2)', async () => {
    const h = harness();
    await h.service.view({ canSignIn: false, signIn: IDLE });
    h.setAccount({ ...ACCOUNT, accessToken: `odd_${'b'.repeat(64)}` });
    await h.service.view({ canSignIn: false, signIn: IDLE });
    expect(h.getMe).toHaveBeenCalledTimes(2);
    h.service.clearMeCache();
    await h.service.view({ canSignIn: false, signIn: IDLE });
    expect(h.getMe).toHaveBeenCalledTimes(3);
  });

  it('marks a rejected token (ac3)', async () => {
    const h = harness({ getMe: async () => ({ ok: false, kind: 'unauthorized', error: 'device_revoked' }) });
    const view = await h.service.view({ canSignIn: true, signIn: IDLE });
    expect(view).toMatchObject({ signedIn: true, tokenRejected: true, plan: null });
  });

  it('falls back to the directory plan when /v1/me is unreachable, and does not cache the failure (ac3)', async () => {
    const getMe = vi.fn<AccountViewDeps['getMe']>(async () => ({ ok: false, kind: 'unreachable', detail: 'ECONNREFUSED' }));
    const h = harness({ getMe, directoryPlan: () => 'free' });
    const view = await h.service.view({ canSignIn: false, signIn: IDLE });
    expect(view).toMatchObject({ signedIn: true, plan: 'free', tokenRejected: false });
    await h.service.view({ canSignIn: false, signIn: IDLE });
    expect(getMe).toHaveBeenCalledTimes(2);
  });

  it('treats a thrown /v1/me read as unreachable', async () => {
    const h = harness({ getMe: async () => Promise.reject(new Error('aborted')), directoryPlan: () => 'tester' });
    expect(await h.service.view({ canSignIn: false, signIn: IDLE })).toMatchObject({ signedIn: true, plan: 'tester' });
  });

  it('reports an unreadable account.json as signed out with its message (ac3)', async () => {
    const h = harness({
      readAccount: async () => {
        throw new Error('Cannot read /h/account.json: unexpected shape. Delete it to sign out locally.');
      },
    });
    const view = await h.service.view({ canSignIn: true, signIn: IDLE });
    expect(view).toMatchObject({ signedIn: false, accountError: 'Cannot read /h/account.json: unexpected shape. Delete it to sign out locally.' });
  });
});
