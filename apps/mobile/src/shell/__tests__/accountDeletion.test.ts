import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const http = vi.hoisted(() => ({ request: vi.fn() }));
const browser = vi.hoisted(() => ({ open: vi.fn(async () => undefined) }));

vi.mock('@capacitor/core', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@capacitor/core')>()),
  CapacitorHttp: http,
}));
vi.mock('@capacitor/browser', () => ({ Browser: browser }));

import {
  clearSignedOutNotice,
  deleteAccount,
  DELETE_ACCOUNT_TIMEOUT_MS,
  openAccountPage,
  readSignedOutNotice,
  requestAccountDeletion,
  SIGNED_OUT_NOTICE_KEY,
  writeSignedOutNotice,
} from '../accountDeletion';
import { ACCOUNT_BASE_URL } from '../config';
import type { SignOutDeps } from '../signOut';
import type { PairedMachine } from '../types';

const ACCOUNT = { token: 'odd_token', deviceId: 'dev-1', label: 'Pixel' };

function machine(id: string, label: string): PairedMachine {
  return {
    environmentId: id,
    label,
    machineKeyHex: 'ab'.repeat(32),
    linkPublicKeyHex: 'cd'.repeat(32),
    linkSecretKeyHex: 'ef'.repeat(32),
    token: `opt_${label}`,
    tokenId: `tok-${label}`,
    pairedAt: '2026-11-03T00:00:00.000Z',
  };
}

const DESK = machine('e-desk', 'desk');
const LAPTOP = machine('e-laptop', 'laptop');

function cleanupDeps(calls: string[]): SignOutDeps {
  return {
    machines: [DESK, LAPTOP],
    account: ACCOUNT,
    removeSelf: async (m) => {
      calls.push(`phones/self ${m.label}`);
    },
    directory: {
      state: 'online',
      send: (frame) => {
        calls.push(frame.type);
        return true;
      },
    },
    deleteDevice: async (account) => {
      calls.push(`DELETE /v1/devices/${account.deviceId}`);
    },
    unregisterPush: async () => {
      calls.push('push token');
    },
    resetKeys: async () => {
      calls.push('reset');
    },
    clearStorage: () => {
      calls.push('localStorage.clear');
    },
    reload: () => {
      calls.push('reload');
    },
    log: () => undefined,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
  sessionStorage.clear();
  http.request.mockReset();
  browser.open.mockClear();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('requestAccountDeletion', () => {
  it('sends DELETE to /v1/account with the device token and 15s timeouts', async () => {
    http.request.mockResolvedValue({ status: 202, data: null });
    await requestAccountDeletion(ACCOUNT);
    expect(DELETE_ACCOUNT_TIMEOUT_MS).toBe(15_000);
    expect(http.request).toHaveBeenCalledWith({
      method: 'DELETE',
      url: `${ACCOUNT_BASE_URL}/v1/account`,
      headers: { Authorization: 'Bearer odd_token' },
      connectTimeout: 15_000,
      readTimeout: 15_000,
    });
  });

  it('returns requested on 202', async () => {
    http.request.mockResolvedValue({ status: 202, data: null });
    await expect(requestAccountDeletion(ACCOUNT)).resolves.toBe('requested');
  });

  it('returns requested on 401 account_deleted with an object body', async () => {
    http.request.mockResolvedValue({ status: 401, data: { error: 'account_deleted' } });
    await expect(requestAccountDeletion(ACCOUNT)).resolves.toBe('requested');
  });

  it('returns requested on 401 account_deleted with a string body', async () => {
    http.request.mockResolvedValue({ status: 401, data: JSON.stringify({ error: 'account_deleted' }) });
    await expect(requestAccountDeletion(ACCOUNT)).resolves.toBe('requested');
  });

  it('returns token-gone on 401 invalid_token', async () => {
    http.request.mockResolvedValue({ status: 401, data: { error: 'invalid_token' } });
    await expect(requestAccountDeletion(ACCOUNT)).resolves.toBe('token-gone');
  });

  it('returns token-gone on 403', async () => {
    http.request.mockResolvedValue({ status: 403, data: null });
    await expect(requestAccountDeletion(ACCOUNT)).resolves.toBe('token-gone');
  });

  it('rejects with the status on any other response', async () => {
    http.request.mockResolvedValue({ status: 503, data: null });
    await expect(requestAccountDeletion(ACCOUNT)).rejects.toThrow('overdeck.ai answered HTTP 503.');
  });

  it('propagates a network rejection', async () => {
    http.request.mockRejectedValue(new Error('network down'));
    await expect(requestAccountDeletion(ACCOUNT)).rejects.toThrow('network down');
  });
});

describe('deleteAccount', () => {
  it('requested: runs the signOut FR-12 order minus the revoke step and writes deletion-requested', async () => {
    const calls: string[] = [];
    const result = await deleteAccount({
      account: ACCOUNT,
      cleanup: cleanupDeps(calls),
      request: async () => 'requested',
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['phones/self desk', 'phones/self laptop', 'push token', 'push-unregister', 'forget-client', 'reset', 'localStorage.clear', 'reload']);
    expect(readSignedOutNotice()).toBe('deletion-requested');
  });

  it('token-gone: writes finish-on-web and runs the same cleanup without the revoke step', async () => {
    const calls: string[] = [];
    const result = await deleteAccount({
      account: ACCOUNT,
      cleanup: cleanupDeps(calls),
      request: async () => 'token-gone',
    });
    expect(result).toEqual({ ok: true });
    expect(calls).toEqual(['phones/self desk', 'phones/self laptop', 'push token', 'push-unregister', 'forget-client', 'reset', 'localStorage.clear', 'reload']);
    expect(readSignedOutNotice()).toBe('finish-on-web');
  });

  it('network error: returns ok:false with the message, writes no notice and runs no cleanup', async () => {
    const calls: string[] = [];
    const result = await deleteAccount({
      account: ACCOUNT,
      cleanup: cleanupDeps(calls),
      request: async () => {
        throw new Error('network down');
      },
    });
    expect(result).toEqual({ ok: false, message: 'network down' });
    expect(calls).toEqual([]);
    expect(readSignedOutNotice()).toBeNull();
  });
});

describe('signed-out notice storage', () => {
  it('round-trips through sessionStorage and clears', () => {
    writeSignedOutNotice('finish-on-web');
    expect(sessionStorage.getItem(SIGNED_OUT_NOTICE_KEY)).toBe('finish-on-web');
    expect(readSignedOutNotice()).toBe('finish-on-web');
    clearSignedOutNotice();
    expect(readSignedOutNotice()).toBeNull();
  });

  it('ignores an unknown stored value', () => {
    sessionStorage.setItem(SIGNED_OUT_NOTICE_KEY, 'something-else');
    expect(readSignedOutNotice()).toBeNull();
  });
});

describe('openAccountPage', () => {
  it('opens the account page in the system browser', async () => {
    await openAccountPage();
    expect(browser.open).toHaveBeenCalledWith({ url: `${ACCOUNT_BASE_URL}/account` });
  });
});
