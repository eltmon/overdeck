/**
 * The Live Activity controller (PAN-4839 FR-5, FR-6): starts the card when the app comes to the
 * foreground and hands its activity push token to the overdeck.ai directory as `activity-register`.
 * The machines then report their counts to the directory, which pushes them to APNs; nothing on the
 * phone updates the card.
 *
 * The Settings switch is stored in `localStorage` (absent ⇒ on). Turning it off ends the card and
 * sends `activity-unregister`. Android has no Live Activity: every method is a no-op there.
 */
import type { ClientPlatform } from '@overdeck/contracts';
import type { DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import type { PluginListenerHandle } from '@capacitor/core';

import type { LiveActivityToken, OverdeckLiveActivityPlugin } from '../native/liveActivity';

/** `'off'` disables the card; absent or anything else is on. */
export const LIVE_ACTIVITY_SETTING_KEY = 'overdeck.liveActivity';

/** The directory's token rule for an activity token, in the lowercase hex the plugin sends. */
const TOKEN_RE = /^[0-9a-f]{1,4096}$/;

export function liveActivityEnabled(): boolean {
  try {
    return localStorage.getItem(LIVE_ACTIVITY_SETTING_KEY) !== 'off';
  } catch {
    return true;
  }
}

export function setLiveActivityEnabled(on: boolean): void {
  try {
    if (on) localStorage.removeItem(LIVE_ACTIVITY_SETTING_KEY);
    else localStorage.setItem(LIVE_ACTIVITY_SETTING_KEY, 'off');
  } catch {
    // Storage unavailable: the switch falls back to on at the next launch.
  }
}

export interface LiveActivityController {
  /** Starts (or keeps) the card and registers its token again; a no-op when switched off or not allowed. */
  refresh(): Promise<void>;
  /** Ends the card and unregisters its token. */
  disable(): Promise<void>;
  dispose(): void;
}

export interface LiveActivityControllerDeps {
  plugin: OverdeckLiveActivityPlugin;
  directory: Pick<DirectoryWebClient, 'state' | 'send' | 'onStateChange'>;
  platform: ClientPlatform;
  enabled?: () => boolean;
}

const NOOP_CONTROLLER: LiveActivityController = {
  refresh: async () => {},
  disable: async () => {},
  dispose: () => {},
};

function logFailure(step: string, error: unknown): void {
  console.warn(`[live-activity] ${step} failed`, error);
}

export function createLiveActivityController(deps: LiveActivityControllerDeps): LiveActivityController {
  if (deps.platform !== 'ios') return NOOP_CONTROLLER;
  const { plugin, directory } = deps;
  const enabled = deps.enabled ?? liveActivityEnabled;
  let last: LiveActivityToken | null = null;
  let pending: LiveActivityToken | null = null;
  let handle: PluginListenerHandle | null = null;
  let disposed = false;

  /** Sends the pending registration when the directory is online; a refused send keeps it pending. */
  function flush(): void {
    if (pending === null || directory.state !== 'online') return;
    if (directory.send({ type: 'activity-register', token: pending.token, apsEnvironment: pending.apsEnvironment })) pending = null;
  }

  plugin
    .addListener('token', (t) => {
      if (disposed || !enabled() || !TOKEN_RE.test(t.token)) return;
      if (t.apsEnvironment !== 'production' && t.apsEnvironment !== 'sandbox') return;
      last = { token: t.token, apsEnvironment: t.apsEnvironment };
      pending = last;
      flush();
    })
    .then((h) => {
      if (disposed) void h.remove();
      else handle = h;
    })
    .catch((error: unknown) => logFailure('listen', error));

  const unsubscribe = directory.onStateChange((state) => {
    if (state === 'online') flush();
  });

  return {
    async refresh() {
      if (disposed || !enabled()) return;
      try {
        const status = await plugin.status();
        if (!status.supported || !status.enabled) return;
        await plugin.start();
      } catch (error) {
        logFailure('start', error);
        return;
      }
      // FR-6: register the token again on every foreground, in case the directory lost it.
      if (last !== null) {
        pending = last;
        flush();
      }
    },
    async disable() {
      try {
        await plugin.end();
      } catch (error) {
        logFailure('end', error);
      }
      if (directory.state === 'online') directory.send({ type: 'activity-unregister' });
      last = null;
      pending = null;
    },
    dispose() {
      disposed = true;
      void handle?.remove();
      handle = null;
      unsubscribe();
    },
  };
}
