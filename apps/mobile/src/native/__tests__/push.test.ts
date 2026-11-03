import type { ClientToDirectoryFrame } from '@overdeck/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  platform: 'android' as 'android' | 'ios',
  configured: true,
  receive: 'granted' as string,
  afterRequest: 'granted' as string,
  listeners: new Map<string, (event: { value: string }) => void>(),
  removed: [] as string[],
}));

vi.mock('../../shell/platform', () => ({ shellPlatform: () => harness.platform }));

vi.mock('@capacitor/core', () => ({
  registerPlugin: () => ({ status: async () => ({ configured: harness.configured }) }),
}));

vi.mock('@capacitor/push-notifications', () => ({
  PushNotifications: {
    checkPermissions: vi.fn(async () => ({ receive: harness.receive })),
    requestPermissions: vi.fn(async () => {
      harness.receive = harness.afterRequest;
      return { receive: harness.receive };
    }),
    register: vi.fn(async () => undefined),
    unregister: vi.fn(async () => undefined),
    addListener: vi.fn(async (event: string, listener: (event: { value: string }) => void) => {
      harness.listeners.set(event, listener);
      return {
        remove: async () => {
          harness.removed.push(event);
          harness.listeners.delete(event);
        },
      };
    }),
  },
}));

import { PushNotifications } from '@capacitor/push-notifications';

import { type PushDirectory, pushState, startPushRegistration, unregisterPush } from '../push';

/** A directory whose state the test drives by calling the stored onStateChange listener. */
function directory(initial: string) {
  const sent: ClientToDirectoryFrame[] = [];
  const listeners = new Set<(state: string) => void>();
  const client = {
    state: initial,
    send: (frame: ClientToDirectoryFrame) => {
      if (client.state !== 'online') return false;
      sent.push(frame);
      return true;
    },
    onStateChange: (listener: (state: string) => void) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
  const go = (state: string) => {
    client.state = state;
    for (const listener of listeners) listener(state);
  };
  return { client: client as unknown as PushDirectory, sent, go, listeners };
}

const token = (value: string) => harness.listeners.get('registration')?.({ value });

beforeEach(() => {
  vi.clearAllMocks();
  harness.platform = 'android';
  harness.configured = true;
  harness.receive = 'granted';
  harness.afterRequest = 'granted';
  harness.listeners.clear();
  harness.removed = [];
});

describe('pushState', () => {
  it('maps the permission to on, off and prompt', async () => {
    expect(await pushState()).toBe('on');
    harness.receive = 'denied';
    expect(await pushState()).toBe('off');
    harness.receive = 'prompt';
    expect(await pushState()).toBe('prompt');
    harness.receive = 'prompt-with-rationale';
    expect(await pushState()).toBe('prompt');
  });

  it('is unavailable without a Firebase config', async () => {
    harness.configured = false;
    expect(await pushState()).toBe('unavailable');
    expect(PushNotifications.checkPermissions).not.toHaveBeenCalled();
  });

  it('is unavailable on iOS', async () => {
    harness.platform = 'ios';
    expect(await pushState()).toBe('unavailable');
  });

  it('is unavailable when the plugin throws', async () => {
    vi.mocked(PushNotifications.checkPermissions).mockRejectedValueOnce(new Error('not implemented'));
    expect(await pushState()).toBe('unavailable');
  });
});

describe('startPushRegistration', () => {
  it('never registers or sends without a Firebase config', async () => {
    harness.configured = false;
    const d = directory('online');
    await startPushRegistration(d.client);
    expect(PushNotifications.register).not.toHaveBeenCalled();
    expect(d.sent).toEqual([]);
  });

  it('asks once when the permission was never asked', async () => {
    harness.receive = 'prompt';
    await startPushRegistration(directory('online').client);
    expect(PushNotifications.requestPermissions).toHaveBeenCalledTimes(1);
    expect(PushNotifications.register).toHaveBeenCalledTimes(1);
  });

  it('does not register when the permission is denied', async () => {
    harness.receive = 'prompt';
    harness.afterRequest = 'denied';
    await startPushRegistration(directory('online').client);
    expect(PushNotifications.register).not.toHaveBeenCalled();
  });

  it('sends push-register once per transition to online', async () => {
    const d = directory('connecting');
    await startPushRegistration(d.client);
    token('fcm-token-1');
    expect(d.sent).toEqual([]);

    d.go('online');
    expect(d.sent).toEqual([{ type: 'push-register', platform: 'android', token: 'fcm-token-1' }]);

    // A machine-list update calls the listener with the unchanged state.
    d.go('online');
    expect(d.sent).toHaveLength(1);

    d.go('connecting');
    d.go('online');
    expect(d.sent).toHaveLength(2);
    expect(d.sent[1]).toEqual({ type: 'push-register', platform: 'android', token: 'fcm-token-1' });
  });

  it('sends a new token while online', async () => {
    const d = directory('online');
    await startPushRegistration(d.client);
    token('fcm-token-1');
    token('fcm-token-2');
    expect(d.sent).toEqual([
      { type: 'push-register', platform: 'android', token: 'fcm-token-1' },
      { type: 'push-register', platform: 'android', token: 'fcm-token-2' },
    ]);
  });

  it('stops listening when stopped', async () => {
    const d = directory('online');
    const stop = await startPushRegistration(d.client);
    const registration = harness.listeners.get('registration');
    stop();
    registration?.({ value: 'late-token' });
    d.go('online');
    expect(d.sent).toEqual([]);
    expect(d.listeners.size).toBe(0);
    expect(harness.removed.sort()).toEqual(['registration', 'registrationError']);
  });
});

describe('unregisterPush', () => {
  it('deletes the token where push is available', async () => {
    await unregisterPush();
    expect(PushNotifications.unregister).toHaveBeenCalledTimes(1);
  });

  it('does nothing where push is unavailable', async () => {
    harness.configured = false;
    await unregisterPush();
    expect(PushNotifications.unregister).not.toHaveBeenCalled();
  });

  it('swallows an unregister failure', async () => {
    vi.mocked(PushNotifications.unregister).mockRejectedValueOnce(new Error('no firebase'));
    await expect(unregisterPush()).resolves.toBeUndefined();
  });
});
