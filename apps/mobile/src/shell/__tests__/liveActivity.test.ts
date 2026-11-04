import { afterEach, describe, expect, it, vi } from 'vitest';
import type { ClientToDirectoryFrame } from '@overdeck/contracts';
import type { DirectoryWebState } from '@overdeck/anywhere-channel/web';

import type { LiveActivityToken, OverdeckLiveActivityPlugin } from '../../native/liveActivity';
import {
  createLiveActivityController,
  LIVE_ACTIVITY_SETTING_KEY,
  liveActivityEnabled,
  setLiveActivityEnabled,
} from '../liveActivity';

const TOKEN = 'a1'.repeat(32);

function fakePlugin(status = { supported: true, enabled: true }) {
  let emit: (t: LiveActivityToken) => void = () => {};
  const remove = vi.fn(async () => {});
  const plugin = {
    status: vi.fn(async () => status),
    start: vi.fn(async () => ({ started: true })),
    end: vi.fn(async () => {}),
    addListener: vi.fn(async (_event: 'token', listener: (t: LiveActivityToken) => void) => {
      emit = listener;
      return { remove };
    }),
  } satisfies OverdeckLiveActivityPlugin;
  return { plugin, remove, emit: (t: LiveActivityToken) => emit(t) };
}

function fakeDirectory(state: DirectoryWebState = 'online') {
  const sent: ClientToDirectoryFrame[] = [];
  let listener: (s: DirectoryWebState) => void = () => {};
  const unsubscribe = vi.fn();
  const directory = {
    state,
    accept: true,
    send(frame: ClientToDirectoryFrame) {
      if (directory.state !== 'online' || !directory.accept) return false;
      sent.push(frame);
      return true;
    },
    onStateChange(l: (s: DirectoryWebState) => void) {
      listener = l;
      return unsubscribe;
    },
    change(next: DirectoryWebState) {
      directory.state = next;
      listener(next);
    },
  };
  return { directory, sent, unsubscribe };
}

/** Lets the controller's addListener promise settle. */
const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('Live Activity controller (PAN-4839 WI-9)', () => {
  afterEach(() => {
    localStorage.clear();
  });

  it('does nothing on Android', async () => {
    const { plugin } = fakePlugin();
    const { directory, sent } = fakeDirectory();
    const controller = createLiveActivityController({ plugin, directory, platform: 'android' });
    await controller.refresh();
    await controller.disable();
    controller.dispose();
    expect(plugin.addListener).not.toHaveBeenCalled();
    expect(plugin.status).not.toHaveBeenCalled();
    expect(plugin.start).not.toHaveBeenCalled();
    expect(plugin.end).not.toHaveBeenCalled();
    expect(sent).toEqual([]);
  });

  it('starts the card on refresh and registers its token once', async () => {
    const { plugin, emit } = fakePlugin();
    const { directory, sent } = fakeDirectory();
    const controller = createLiveActivityController({ plugin, directory, platform: 'ios', enabled: () => true });
    await settle();
    await controller.refresh();
    expect(plugin.start).toHaveBeenCalledTimes(1);
    emit({ token: TOKEN, apsEnvironment: 'sandbox' });
    expect(sent).toEqual([{ type: 'activity-register', token: TOKEN, apsEnvironment: 'sandbox' }]);
  });

  it('holds the token while the directory is offline and sends it when it comes online', async () => {
    const { plugin, emit } = fakePlugin();
    const { directory, sent } = fakeDirectory('connecting');
    createLiveActivityController({ plugin, directory, platform: 'ios', enabled: () => true });
    await settle();
    emit({ token: TOKEN, apsEnvironment: 'production' });
    expect(sent).toEqual([]);
    directory.change('online');
    expect(sent).toEqual([{ type: 'activity-register', token: TOKEN, apsEnvironment: 'production' }]);
    directory.change('online');
    expect(sent).toHaveLength(1);
  });

  it('keeps a refused registration pending', async () => {
    const { plugin, emit } = fakePlugin();
    const { directory, sent } = fakeDirectory();
    directory.accept = false;
    createLiveActivityController({ plugin, directory, platform: 'ios', enabled: () => true });
    await settle();
    emit({ token: TOKEN, apsEnvironment: 'production' });
    directory.accept = true;
    directory.change('online');
    expect(sent).toHaveLength(1);
  });

  it('re-sends the same token on a second refresh', async () => {
    const { plugin, emit } = fakePlugin();
    const { directory, sent } = fakeDirectory();
    const controller = createLiveActivityController({ plugin, directory, platform: 'ios', enabled: () => true });
    await settle();
    await controller.refresh();
    emit({ token: TOKEN, apsEnvironment: 'sandbox' });
    await controller.refresh();
    expect(sent).toEqual([
      { type: 'activity-register', token: TOKEN, apsEnvironment: 'sandbox' },
      { type: 'activity-register', token: TOKEN, apsEnvironment: 'sandbox' },
    ]);
  });

  it('does not start the card when the setting is off, or when iOS does not allow it', async () => {
    localStorage.setItem(LIVE_ACTIVITY_SETTING_KEY, 'off');
    const off = fakePlugin();
    await createLiveActivityController({ plugin: off.plugin, directory: fakeDirectory().directory, platform: 'ios' }).refresh();
    expect(off.plugin.start).not.toHaveBeenCalled();

    const disallowed = fakePlugin({ supported: true, enabled: false });
    await createLiveActivityController({ plugin: disallowed.plugin, directory: fakeDirectory().directory, platform: 'ios', enabled: () => true }).refresh();
    expect(disallowed.plugin.start).not.toHaveBeenCalled();
  });

  it('ends the card and unregisters on disable', async () => {
    const { plugin, emit } = fakePlugin();
    const { directory, sent } = fakeDirectory();
    const controller = createLiveActivityController({ plugin, directory, platform: 'ios', enabled: () => true });
    await settle();
    emit({ token: TOKEN, apsEnvironment: 'sandbox' });
    await controller.disable();
    expect(plugin.end).toHaveBeenCalledTimes(1);
    expect(sent.at(-1)).toEqual({ type: 'activity-unregister' });
    sent.length = 0;
    await controller.refresh();
    expect(sent).toEqual([]);
  });

  it('ignores a token that is not lowercase hex', async () => {
    const { plugin, emit } = fakePlugin();
    const { directory, sent } = fakeDirectory();
    createLiveActivityController({ plugin, directory, platform: 'ios', enabled: () => true });
    await settle();
    emit({ token: 'AB/CD', apsEnvironment: 'production' });
    emit({ token: 'ABCD', apsEnvironment: 'production' });
    expect(sent).toEqual([]);
  });

  it('removes the listener and the state subscription on dispose', async () => {
    const { plugin, remove } = fakePlugin();
    const { directory, unsubscribe } = fakeDirectory();
    const controller = createLiveActivityController({ plugin, directory, platform: 'ios', enabled: () => true });
    await settle();
    controller.dispose();
    expect(remove).toHaveBeenCalledTimes(1);
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it('logs a failing plugin call and keeps going', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { plugin } = fakePlugin();
    plugin.start.mockRejectedValueOnce(new Error('ActivityKit unavailable'));
    const controller = createLiveActivityController({ plugin, directory: fakeDirectory().directory, platform: 'ios', enabled: () => true });
    await expect(controller.refresh()).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalledWith('[live-activity] start failed', expect.any(Error));
    warn.mockRestore();
  });

  it('stores the switch: absent is on, off is off', () => {
    expect(liveActivityEnabled()).toBe(true);
    setLiveActivityEnabled(false);
    expect(localStorage.getItem(LIVE_ACTIVITY_SETTING_KEY)).toBe('off');
    expect(liveActivityEnabled()).toBe(false);
    setLiveActivityEnabled(true);
    expect(liveActivityEnabled()).toBe(true);
  });
});
