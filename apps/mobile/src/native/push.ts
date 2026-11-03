/**
 * Push registration (PAN-4838 FR-1, FR-2, FR-4, D-8 to D-11): asks iOS for notification permission,
 * keeps the latest APNs token, and tells the directory with `push-register` whenever it has a new
 * token or its socket comes online. The Notifications switch turns the directory registration off
 * with `push-unregister`; the APNs registration itself is never undone (D-11).
 *
 * The token is not secret (D-10) but is never logged (NFR-2).
 */
import { Capacitor, type PermissionState, type PluginListenerHandle } from '@capacitor/core';
import { PushNotifications, type PushNotificationsPlugin } from '@capacitor/push-notifications';
import type { DirectoryWebState } from '@overdeck/anywhere-channel/web';
import type { ApsEnvironment, ClientPlatform, ClientToDirectoryFrame } from '@overdeck/contracts';
import { useCallback, useSyncExternalStore } from 'react';

import { OverdeckKeys, type OverdeckKeysPlugin } from './keys';

export const PUSH_TOKEN_KEY = 'overdeck.pushToken';
export const NOTIFICATIONS_PREF_KEY = 'overdeck.notifications';
export type PushPermission = 'granted' | 'denied' | 'prompt' | 'unknown';

/** The directory's `push-register` token rule (services/connect/src/protocol.ts `PUSH_TOKEN_RE`, ≤ 4,096). */
const TOKEN_RE = /^[0-9A-Za-z:_.-]{1,4096}$/;

/** iOS only in PAN-4838; PAN-4840 adds Android once Firebase is configured (D-9). */
export function pushSupported(platform: string = Capacitor.getPlatform()): boolean {
  return platform === 'ios';
}

function readStorage(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // Storage unavailable: the in-memory state still applies for this launch.
  }
}

/** The Notifications switch: on unless set to `'off'`; storage errors read as on. */
export function notificationsEnabled(): boolean {
  return readStorage(NOTIFICATIONS_PREF_KEY) !== 'off';
}

export interface PushDirectory {
  readonly state: DirectoryWebState;
  send(frame: ClientToDirectoryFrame): boolean;
  onStateChange(listener: (state: DirectoryWebState) => void): () => void;
}

export interface PushController {
  readonly permission: PushPermission;
  readonly enabled: boolean;
  onChange(listener: () => void): () => void;
  enable(): Promise<void>;
  disable(): void;
  stop(): void;
}

export interface PushDeps {
  directory: PushDirectory;
  /** `shellPlatform()`. */
  platform: ClientPlatform;
  plugin?: Pick<PushNotificationsPlugin, 'checkPermissions' | 'requestPermissions' | 'register' | 'addListener'>;
  keys?: Pick<OverdeckKeysPlugin, 'pushEnvironment'>;
  log?: (message: string, error?: unknown) => void;
}

function toPermission(state: PermissionState): PushPermission {
  if (state === 'granted' || state === 'denied') return state;
  return 'prompt';
}

export function startPush({
  directory,
  platform,
  plugin = PushNotifications,
  keys = OverdeckKeys,
  log = (message, error) => console.warn(`[push] ${message}`, error ?? ''),
}: PushDeps): PushController {
  let permission: PushPermission = 'unknown';
  let enabled = notificationsEnabled();
  let stopped = false;
  const changeListeners = new Set<() => void>();
  const handles: PluginListenerHandle[] = [];
  const notify = () => {
    for (const listener of changeListeners) listener();
  };

  // One call per start; only iOS tokens carry an APNs host (D-7).
  const apsEnvironment: Promise<ApsEnvironment | undefined> =
    platform === 'ios'
      ? keys.pushEnvironment().then(
          (result) => result.apsEnvironment,
          (error: unknown) => {
            log('push environment unavailable', error);
            return undefined;
          },
        )
      : Promise.resolve(undefined);

  /** R5: a register with the stored token, only when enabled and online. */
  const sendRegister = async () => {
    const environment = await apsEnvironment;
    const token = readStorage(PUSH_TOKEN_KEY);
    if (stopped || !enabled || token === null || directory.state !== 'online') return;
    directory.send({
      type: 'push-register',
      platform,
      token,
      ...(platform === 'ios' && environment ? { apsEnvironment: environment } : {}),
    });
  };

  /** R2: check, ask once while iOS says `prompt`, and register when granted. */
  const refreshPermission = async () => {
    let status = await plugin.checkPermissions();
    if (status.receive === 'prompt' || status.receive === 'prompt-with-rationale') status = await plugin.requestPermissions();
    if (stopped) return;
    permission = toPermission(status.receive);
    notify();
    if (permission === 'granted') await plugin.register();
  };

  // R4: act only on a change into `online`; a machine-list update keeps the state and does nothing.
  let previous: DirectoryWebState = directory.state;
  const onOnline = () => {
    if (enabled) void sendRegister();
    else directory.send({ type: 'push-unregister' });
  };
  const unsubscribe = directory.onStateChange((state) => {
    const cameOnline = state === 'online' && previous !== 'online';
    previous = state;
    if (cameOnline && !stopped) onOnline();
  });
  if (previous === 'online') onOnline();

  void (async () => {
    try {
      // R1: both listeners exist before `register()` can report a token.
      const added = await Promise.all([
        plugin.addListener('registration', ({ value }) => {
          if (!TOKEN_RE.test(value)) {
            log('push token rejected');
            return;
          }
          writeStorage(PUSH_TOKEN_KEY, value);
          void sendRegister();
        }),
        plugin.addListener('registrationError', (error) => log('push registration failed', error.error)),
      ]);
      if (stopped) {
        for (const handle of added) void handle.remove();
        return;
      }
      handles.push(...added);
      if (enabled) await refreshPermission();
    } catch (error) {
      log('push setup failed', error);
    }
  })();

  return {
    get permission() {
      return permission;
    },
    get enabled() {
      return enabled;
    },
    onChange(listener) {
      changeListeners.add(listener);
      return () => {
        changeListeners.delete(listener);
      };
    },
    // R7
    async enable() {
      enabled = true;
      writeStorage(NOTIFICATIONS_PREF_KEY, null);
      try {
        await refreshPermission();
      } catch (error) {
        log('push permission failed', error);
      }
      await sendRegister();
      notify();
    },
    // R6
    disable() {
      enabled = false;
      writeStorage(NOTIFICATIONS_PREF_KEY, 'off');
      if (directory.state === 'online') directory.send({ type: 'push-unregister' });
      notify();
    },
    // R8
    stop() {
      stopped = true;
      unsubscribe();
      for (const handle of handles.splice(0)) void handle.remove();
      changeListeners.clear();
    },
  };
}

const noSubscription = () => () => {};

/** The controller's switch and permission, re-rendering on every change, or null without a controller (PAN-4838 WI-9). */
export function usePushState(controller: PushController | null): { enabled: boolean; permission: PushPermission } | null {
  const subscribe = useCallback((onChange: () => void) => (controller ? controller.onChange(onChange) : noSubscription()), [controller]);
  const enabled = useSyncExternalStore(subscribe, () => controller?.enabled ?? false);
  const permission = useSyncExternalStore(subscribe, () => controller?.permission ?? 'unknown');
  return controller ? { enabled, permission } : null;
}
