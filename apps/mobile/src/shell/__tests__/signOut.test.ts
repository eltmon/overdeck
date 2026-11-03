import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { removeSelfOver, signOut, SIGN_OUT_STEP_TIMEOUT_MS, type SignOutDeps } from '../signOut';
import type { PairedMachine } from '../types';

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
const ACCOUNT = { token: 'odd_token', deviceId: 'dev-1', label: 'Pixel' };

function deps(calls: string[], overrides: Partial<SignOutDeps> = {}): SignOutDeps {
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
    ...overrides,
  };
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('signOut', () => {
  it('runs every step in the FR-12 order', async () => {
    const calls: string[] = [];
    await signOut(deps(calls));
    expect(calls).toEqual([
      'phones/self desk',
      'phones/self laptop',
      'push-unregister',
      'forget-client',
      'DELETE /v1/devices/dev-1',
      'reset',
      'localStorage.clear',
      'reload',
    ]);
  });

  it('ends the Live Activity after forget-client and before revoking the device (PAN-4839)', async () => {
    const calls: string[] = [];
    await signOut(
      deps(calls, {
        endLiveActivity: async () => {
          calls.push('end live activity');
        },
      }),
    );
    expect(calls.slice(3, 6)).toEqual(['forget-client', 'end live activity', 'DELETE /v1/devices/dev-1']);
  });

  it('abandons a machine that never answers after 5 s and runs the rest', async () => {
    const calls: string[] = [];
    const log = vi.fn();
    let aborted = false;
    const done = signOut(
      deps(calls, {
        log,
        removeSelf: (m, signal) => {
          calls.push(`phones/self ${m.label}`);
          if (m.label === 'laptop') return Promise.resolve();
          signal.addEventListener('abort', () => (aborted = true));
          return new Promise(() => undefined);
        },
      }),
    );
    await vi.advanceTimersByTimeAsync(SIGN_OUT_STEP_TIMEOUT_MS - 1);
    expect(calls).toEqual(['phones/self desk']);
    await vi.advanceTimersByTimeAsync(1);
    await done;
    expect(aborted).toBe(true);
    expect(log).toHaveBeenCalledWith('remove from desk', expect.any(Error));
    expect(calls.slice(1)).toEqual([
      'phones/self laptop',
      'push-unregister',
      'forget-client',
      'DELETE /v1/devices/dev-1',
      'reset',
      'localStorage.clear',
      'reload',
    ]);
  });

  it('skips the two directory frames when the directory is not online', async () => {
    const calls: string[] = [];
    const directory = { state: 'connecting', send: vi.fn(() => false) };
    await signOut(deps(calls, { directory }));
    expect(directory.send).not.toHaveBeenCalled();
    expect(calls).not.toContain('push-unregister');
    expect(calls).toContain('reset');
  });

  it('keeps going when a step throws', async () => {
    const calls: string[] = [];
    await signOut(deps(calls, { deleteDevice: async () => Promise.reject(new Error('HTTP 500')) }));
    expect(calls.slice(-3)).toEqual(['reset', 'localStorage.clear', 'reload']);
  });
});

describe('removeSelfOver', () => {
  it('treats a channel the machine closed mid-answer as done', async () => {
    const destroy = vi.fn();
    const stream = {
      destroyed: false,
      write: () => true,
      end: () => undefined,
      destroy,
      on: (event: string, listener: () => void) => {
        if (event === 'close') queueMicrotask(listener);
      },
      off: () => undefined,
    };
    const remove = removeSelfOver({ openLink: async () => stream as never });
    await expect(remove(DESK, new AbortController().signal)).resolves.toBeUndefined();
    expect(destroy).toHaveBeenCalled();
  });
});
