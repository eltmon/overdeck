import type { PermissionState } from '@capacitor/core';
import type { DirectoryWebState } from '@overdeck/anywhere-channel/web';
import type { ClientToDirectoryFrame } from '@overdeck/contracts';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import {
  NOTIFICATIONS_PREF_KEY,
  PUSH_ASKED_KEY,
  PUSH_TOKEN_KEY,
  type PushDeps,
  type PushDirectory,
  pushSupported,
  startPush,
  unregisterPush,
} from '../push';

const TOKEN = 'a1b2c3d4'.repeat(8);

type Listener = (event: never) => void;

function fakePlugin(checked: PermissionState = 'granted', requested: PermissionState = 'granted') {
  const listeners = new Map<string, Listener>();
  const calls: string[] = [];
  const removed: string[] = [];
  const plugin = {
    checkPermissions: vi.fn(async () => {
      calls.push('checkPermissions');
      return { receive: checked };
    }),
    requestPermissions: vi.fn(async () => {
      calls.push('requestPermissions');
      return { receive: requested };
    }),
    register: vi.fn(async () => {
      calls.push('register');
    }),
    addListener: vi.fn(async (event: string, listener: Listener) => {
      calls.push(`addListener:${event}`);
      listeners.set(event, listener);
      return {
        remove: async () => {
          removed.push(event);
          listeners.delete(event);
        },
      };
    }),
  };
  const emit = (event: string, payload: unknown) => (listeners.get(event) as ((p: unknown) => void) | undefined)?.(payload);
  return { plugin: plugin as unknown as NonNullable<PushDeps['plugin']>, calls, removed, listeners, emit };
}

function fakeDirectory(initial: DirectoryWebState = 'connecting') {
  const sent: ClientToDirectoryFrame[] = [];
  const listeners = new Set<(state: DirectoryWebState) => void>();
  const directory: PushDirectory & { set(state: DirectoryWebState): void; listenerCount(): number } = {
    state: initial,
    send(frame) {
      if (this.state !== 'online') return false;
      sent.push(frame);
      return true;
    },
    onStateChange(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    set(state) {
      (this as { state: DirectoryWebState }).state = state;
      for (const listener of listeners) listener(state);
    },
    listenerCount: () => listeners.size,
  };
  return { directory, sent };
}

const keys = { pushEnvironment: vi.fn(async () => ({ apsEnvironment: 'sandbox' as const })) };
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  localStorage.clear();
  keys.pushEnvironment.mockClear();
});

describe('pushSupported', () => {
  it('is true on iOS and Android only', () => {
    expect(pushSupported('ios')).toBe(true);
    expect(pushSupported('android')).toBe(true);
    expect(pushSupported('web')).toBe(false);
  });
});

describe('startPush', () => {
  it('R1: adds the registration listeners before calling register()', async () => {
    const fake = fakePlugin();
    startPush({ directory: fakeDirectory().directory, platform: 'ios', plugin: fake.plugin, keys, log: () => {} });
    await settle();
    expect(fake.calls.indexOf('addListener:registration')).toBeGreaterThan(-1);
    expect(fake.calls.indexOf('addListener:registrationError')).toBeGreaterThan(-1);
    expect(fake.calls.indexOf('register')).toBeGreaterThan(fake.calls.indexOf('addListener:registration'));
    expect(fake.calls.indexOf('register')).toBeGreaterThan(fake.calls.indexOf('addListener:registrationError'));
  });

  it('R2: asks while iOS says prompt, registers when granted, and maps the permission', async () => {
    const asked = fakePlugin('prompt', 'granted');
    const control = startPush({ directory: fakeDirectory().directory, platform: 'ios', plugin: asked.plugin, keys, log: () => {} });
    expect(control.permission).toBe('unknown');
    await settle();
    expect(asked.calls).toEqual(['addListener:registration', 'addListener:registrationError', 'checkPermissions', 'requestPermissions', 'register']);
    expect(control.permission).toBe('granted');

    // A separate install: it has not asked yet.
    localStorage.removeItem(PUSH_ASKED_KEY);
    const denied = fakePlugin('prompt-with-rationale', 'denied');
    const deniedControl = startPush({ directory: fakeDirectory().directory, platform: 'ios', plugin: denied.plugin, keys, log: () => {} });
    await settle();
    expect(denied.calls).not.toContain('register');
    expect(deniedControl.permission).toBe('denied');

    const granted = fakePlugin('granted');
    startPush({ directory: fakeDirectory().directory, platform: 'ios', plugin: granted.plugin, keys, log: () => {} });
    await settle();
    expect(granted.calls).not.toContain('requestPermissions');
    expect(granted.calls).toContain('register');
  });

  it('R3: stores a valid token and sends a register; rejects a bad one without logging it', async () => {
    const fake = fakePlugin();
    const { directory, sent } = fakeDirectory('online');
    const log = vi.fn();
    startPush({ directory, platform: 'ios', plugin: fake.plugin, keys, log });
    await settle();

    fake.emit('registration', { value: TOKEN });
    await settle();
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBe(TOKEN);
    expect(sent).toEqual([{ type: 'push-register', platform: 'ios', token: TOKEN, apsEnvironment: 'sandbox' }]);

    fake.emit('registration', { value: 'bad token!' });
    await settle();
    expect(localStorage.getItem(PUSH_TOKEN_KEY)).toBe(TOKEN);
    expect(log).toHaveBeenCalledWith('push token rejected');
    expect(JSON.stringify(log.mock.calls)).not.toContain('bad token!');
    expect(sent).toHaveLength(1);
  });

  it('R4: registers on each change into online, and a machine-list update while online sends nothing', async () => {
    localStorage.setItem(PUSH_TOKEN_KEY, TOKEN);
    const { directory, sent } = fakeDirectory('connecting');
    startPush({ directory, platform: 'ios', plugin: fakePlugin().plugin, keys, log: () => {} });
    await settle();
    expect(sent).toEqual([]);

    directory.set('online');
    await settle();
    expect(sent).toHaveLength(1);

    directory.set('online');
    await settle();
    expect(sent).toHaveLength(1);

    directory.set('connecting');
    directory.set('online');
    await settle();
    expect(sent).toHaveLength(2);
  });

  it('R4: acts once at start when already online, and unregisters on online when switched off', async () => {
    localStorage.setItem(PUSH_TOKEN_KEY, TOKEN);
    const online = fakeDirectory('online');
    startPush({ directory: online.directory, platform: 'ios', plugin: fakePlugin().plugin, keys, log: () => {} });
    await settle();
    expect(online.sent).toEqual([{ type: 'push-register', platform: 'ios', token: TOKEN, apsEnvironment: 'sandbox' }]);

    localStorage.setItem(NOTIFICATIONS_PREF_KEY, 'off');
    const off = fakeDirectory('connecting');
    const fake = fakePlugin();
    startPush({ directory: off.directory, platform: 'ios', plugin: fake.plugin, keys, log: () => {} });
    off.directory.set('online');
    await settle();
    expect(off.sent).toEqual([{ type: 'push-unregister' }]);
    expect(fake.calls).not.toContain('register');
  });

  it('R5: sends no register without a token or while offline, and omits apsEnvironment off iOS', async () => {
    const { directory, sent } = fakeDirectory('online');
    startPush({ directory, platform: 'ios', plugin: fakePlugin().plugin, keys, log: () => {} });
    await settle();
    expect(sent).toEqual([]);

    const offline = fakeDirectory('connecting');
    const fake = fakePlugin();
    startPush({ directory: offline.directory, platform: 'ios', plugin: fake.plugin, keys, log: () => {} });
    await settle();
    fake.emit('registration', { value: TOKEN });
    await settle();
    expect(offline.sent).toEqual([]);

    const android = fakeDirectory('online');
    startPush({ directory: android.directory, platform: 'android', plugin: fakePlugin().plugin, keys, log: () => {} });
    await settle();
    expect(android.sent).toEqual([{ type: 'push-register', platform: 'android', token: TOKEN }]);
    expect(keys.pushEnvironment).toHaveBeenCalledTimes(2);
  });

  it('R6: disable stores off, unregisters while online and notifies', async () => {
    const { directory, sent } = fakeDirectory('online');
    const control = startPush({ directory, platform: 'ios', plugin: fakePlugin().plugin, keys, log: () => {} });
    await settle();
    const changed = vi.fn();
    control.onChange(changed);
    control.disable();
    expect(localStorage.getItem(NOTIFICATIONS_PREF_KEY)).toBe('off');
    expect(control.enabled).toBe(false);
    expect(sent).toEqual([{ type: 'push-unregister' }]);
    expect(changed).toHaveBeenCalled();
  });

  it('R7: enable clears off, checks permission, re-sends the kept token and notifies', async () => {
    localStorage.setItem(NOTIFICATIONS_PREF_KEY, 'off');
    localStorage.setItem(PUSH_TOKEN_KEY, TOKEN);
    const fake = fakePlugin('prompt', 'granted');
    const { directory, sent } = fakeDirectory('connecting');
    const control = startPush({ directory, platform: 'ios', plugin: fake.plugin, keys, log: () => {} });
    await settle();
    expect(control.enabled).toBe(false);
    expect(fake.calls).not.toContain('checkPermissions');

    directory.set('online');
    sent.length = 0;
    const changed = vi.fn();
    control.onChange(changed);
    await control.enable();
    expect(localStorage.getItem(NOTIFICATIONS_PREF_KEY)).toBeNull();
    expect(control.enabled).toBe(true);
    expect(fake.calls).toEqual(expect.arrayContaining(['checkPermissions', 'requestPermissions', 'register']));
    expect(control.permission).toBe('granted');
    expect(sent).toEqual([{ type: 'push-register', platform: 'ios', token: TOKEN, apsEnvironment: 'sandbox' }]);
    expect(changed).toHaveBeenCalled();
  });

  it('R8: stop removes both plugin listeners and the state subscription', async () => {
    localStorage.setItem(PUSH_TOKEN_KEY, TOKEN);
    const fake = fakePlugin();
    const { directory, sent } = fakeDirectory('connecting');
    const control = startPush({ directory, platform: 'ios', plugin: fake.plugin, keys, log: () => {} });
    await settle();
    expect(directory.listenerCount()).toBe(1);
    control.stop();
    await settle();
    expect(fake.removed.sort()).toEqual(['registration', 'registrationError']);
    expect(directory.listenerCount()).toBe(0);
    directory.set('online');
    await settle();
    expect(sent).toEqual([]);
  });
});

describe('startPush on Android (PAN-4840)', () => {
  const firebase = (configured: boolean) => ({ status: vi.fn(async () => ({ configured })) });

  it('never asks or registers without a Firebase config, and reports unavailable', async () => {
    const fake = fakePlugin('prompt');
    const { directory, sent } = fakeDirectory('online');
    const push = startPush({ directory, platform: 'android', plugin: fake.plugin, keys, overdeckPush: firebase(false), log: () => {} });
    await settle();
    expect(push.permission).toBe('unavailable');
    expect(fake.plugin.checkPermissions).not.toHaveBeenCalled();
    expect(fake.plugin.register).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
    expect(keys.pushEnvironment).not.toHaveBeenCalled();
  });

  it('asks on first start after sign-in, registers when granted and sends the FCM token without apsEnvironment', async () => {
    const fake = fakePlugin('prompt', 'granted');
    const { directory, sent } = fakeDirectory('online');
    const push = startPush({ directory, platform: 'android', plugin: fake.plugin, keys, overdeckPush: firebase(true), log: () => {} });
    await settle();
    expect(fake.plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(fake.plugin.register).toHaveBeenCalledTimes(1);
    expect(push.permission).toBe('granted');
    fake.emit('registration', { value: TOKEN });
    await settle();
    expect(sent).toEqual([{ type: 'push-register', platform: 'android', token: TOKEN }]);
  });

  it('asks on its own only once per sign-in; a dismissed dialog does not return on the next start', async () => {
    const first = fakePlugin('prompt', 'prompt');
    startPush({ directory: fakeDirectory('online').directory, platform: 'android', plugin: first.plugin, keys, overdeckPush: firebase(true), log: () => {} });
    await settle();
    expect(first.plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem(PUSH_ASKED_KEY)).toBe('1');

    // The next page load (a machine switch reloads the page) still sees `prompt`.
    const second = fakePlugin('prompt', 'prompt');
    const push = startPush({ directory: fakeDirectory('online').directory, platform: 'android', plugin: second.plugin, keys, overdeckPush: firebase(true), log: () => {} });
    await settle();
    expect(second.plugin.requestPermissions).not.toHaveBeenCalled();
    expect(push.permission).toBe('prompt');

    // The Notifications switch always asks.
    await push.enable();
    expect(second.plugin.requestPermissions).toHaveBeenCalledTimes(1);
  });

  it('does not register when Android says denied', async () => {
    const fake = fakePlugin('prompt', 'denied');
    const { directory } = fakeDirectory('online');
    const push = startPush({ directory, platform: 'android', plugin: fake.plugin, keys, overdeckPush: firebase(true), log: () => {} });
    await settle();
    expect(fake.plugin.requestPermissions).toHaveBeenCalledTimes(1);
    expect(fake.plugin.register).not.toHaveBeenCalled();
    expect(push.permission).toBe('denied');
  });

  it('sends one push-register per change into online and one per new token', async () => {
    const fake = fakePlugin();
    const { directory, sent } = fakeDirectory('connecting');
    startPush({ directory, platform: 'android', plugin: fake.plugin, keys, overdeckPush: firebase(true), log: () => {} });
    await settle();
    fake.emit('registration', { value: TOKEN });
    await settle();
    expect(sent).toEqual([]);

    const frame = { type: 'push-register', platform: 'android', token: TOKEN };
    directory.set('online');
    await settle();
    expect(sent).toEqual([frame]);

    // A machine-list update repeats the unchanged state.
    directory.set('online');
    await settle();
    expect(sent).toHaveLength(1);

    directory.set('connecting');
    directory.set('online');
    await settle();
    expect(sent).toEqual([frame, frame]);

    const next = 'f9e8d7c6'.repeat(8);
    fake.emit('registration', { value: next });
    await settle();
    expect(sent).toEqual([frame, frame, { type: 'push-register', platform: 'android', token: next }]);
  });

  it('treats a failing status call as unavailable', async () => {
    const fake = fakePlugin();
    const { directory } = fakeDirectory('online');
    const overdeckPush = { status: vi.fn(async () => Promise.reject(new Error('not implemented'))) };
    const push = startPush({ directory, platform: 'android', plugin: fake.plugin, keys, overdeckPush, log: () => {} });
    await settle();
    expect(push.permission).toBe('unavailable');
    expect(fake.plugin.register).not.toHaveBeenCalled();
  });
});

describe('unregisterPush (PAN-4840 FR-10)', () => {
  const unregisterPlugin = () => ({ unregister: vi.fn(async () => undefined) });

  it('deletes the FCM token on a configured Android build', async () => {
    const plugin = unregisterPlugin();
    await unregisterPush('android', { plugin, overdeckPush: { status: async () => ({ configured: true }) } });
    expect(plugin.unregister).toHaveBeenCalledTimes(1);
  });

  it('does nothing on iOS or without a Firebase config', async () => {
    const plugin = unregisterPlugin();
    await unregisterPush('ios', { plugin, overdeckPush: { status: async () => ({ configured: true }) } });
    await unregisterPush('android', { plugin, overdeckPush: { status: async () => ({ configured: false }) } });
    expect(plugin.unregister).not.toHaveBeenCalled();
  });

  it('swallows an unregister failure', async () => {
    const plugin = { unregister: vi.fn(async () => Promise.reject(new Error('no token'))) };
    await expect(unregisterPush('android', { plugin, overdeckPush: { status: async () => ({ configured: true }) } })).resolves.toBeUndefined();
  });
});
