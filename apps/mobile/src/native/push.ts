/**
 * Push registration (PAN-4840 FR-7, FR-8): the notification permission, the FCM token and
 * `push-register`. Android only for now; iOS is PAN-4838 (D-10). The push secret key never
 * enters JavaScript; only the token does.
 *
 * `register()` is called only when the `OverdeckPush` plugin reports a Firebase config, because
 * the push plugin's `register()` crashes a build without `google-services.json` (D-5). The
 * token is sent on every transition to `online` (D-6): the frame is idempotent and resending
 * heals a registration the directory dropped.
 */
import { registerPlugin } from '@capacitor/core';
import type { DirectoryWebClient } from '@overdeck/anywhere-channel/web';
import { PushNotifications } from '@capacitor/push-notifications';

import { shellPlatform } from '../shell/platform';

export interface OverdeckPushPlugin {
  status(): Promise<{ configured: boolean }>;
}

export const OverdeckPush = registerPlugin<OverdeckPushPlugin>('OverdeckPush', {
  web: () => Promise.resolve({ status: async () => ({ configured: false }) }),
});

/** `on`: granted; `off`: denied; `prompt`: never asked; `unavailable`: this build or platform has no push. */
export type PushState = 'on' | 'off' | 'prompt' | 'unavailable';

export type PushDirectory = Pick<DirectoryWebClient, 'state' | 'send' | 'onStateChange'>;

export async function pushState(): Promise<PushState> {
  // iOS: PAN-4838
  if (shellPlatform() !== 'android') return 'unavailable';
  try {
    if (!(await OverdeckPush.status()).configured) return 'unavailable';
    const { receive } = await PushNotifications.checkPermissions();
    if (receive === 'granted') return 'on';
    if (receive === 'denied') return 'off';
    return 'prompt';
  } catch {
    return 'unavailable';
  }
}

export async function requestPush(): Promise<PushState> {
  try {
    await PushNotifications.requestPermissions();
  } catch {
    return 'unavailable';
  }
  return pushState();
}

/** Asks for the permission when never asked, then keeps the directory's push registration current. Returns the stop function. */
export async function startPushRegistration(client: PushDirectory): Promise<() => void> {
  let state = await pushState();
  if (state === 'prompt') state = await requestPush();
  if (state !== 'on') return () => {};

  let token: string | null = null;
  let sentThisOnline = false;
  let stopped = false;
  const sendIfOnline = () => {
    if (!stopped && token !== null && client.state === 'online' && !sentThisOnline) {
      sentThisOnline = client.send({ type: 'push-register', platform: 'android', token });
    }
  };

  const registration = await PushNotifications.addListener('registration', ({ value }) => {
    token = value;
    sentThisOnline = false;
    sendIfOnline();
  });
  const registrationError = await PushNotifications.addListener('registrationError', () => {
    console.warn('[push] registration failed');
  });
  const unsubscribe = client.onStateChange((s) => {
    if (s !== 'online') sentThisOnline = false;
    else sendIfOnline();
  });
  try {
    await PushNotifications.register();
  } catch {
    console.warn('[push] registration failed');
  }

  return () => {
    stopped = true;
    unsubscribe();
    void registration.remove();
    void registrationError.remove();
  };
}

/** Deletes the FCM token (sign-out, FR-10). Errors are swallowed. */
export async function unregisterPush(): Promise<void> {
  try {
    if ((await pushState()) !== 'unavailable') await PushNotifications.unregister();
  } catch {
    // Best effort: sign-out continues and the key pair it deletes makes a late push drop (FR-5).
  }
}
