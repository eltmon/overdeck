/**
 * Tapping a decrypted notification opens its machine at its `/m` screen (PAN-4838 FR-8, NFR-3).
 * The NotificationService extension puts `machine` and `url` in the notification's userInfo; a
 * notification it could not decrypt carries neither and opens the app where it was.
 */
import { PushNotifications, type PushNotificationsPlugin } from '@capacitor/push-notifications';

import type { PairedMachine } from './types';

export type TapTarget = { kind: 'machine'; environmentId: string; path: string } | { kind: 'machines' };

/** The tapped notification id already handled in this app process; the reload after `navigate` must not replay it. */
const HANDLED_KEY = 'overdeck.notificationHandled';
const BASE = 'https://phone.invalid';

/** The same-origin `/m` path in `url`, else `/m` (NFR-3). */
export function safeMobilePath(url: unknown): string {
  if (typeof url !== 'string' || url === '') return '/m';
  let parsed: URL;
  try {
    parsed = new URL(url, BASE);
  } catch {
    return '/m';
  }
  if (parsed.origin !== BASE) return '/m';
  if (parsed.pathname !== '/m' && !parsed.pathname.startsWith('/m/')) return '/m';
  return parsed.pathname + parsed.search;
}

/** Where a tapped notification goes, or null when it carries no machine (not decrypted). */
export function tapTarget(data: unknown, paired: readonly PairedMachine[]): TapTarget | null {
  if (typeof data !== 'object' || data === null) return null;
  const { machine, url } = data as { machine?: unknown; url?: unknown };
  if (typeof machine !== 'string' || machine === '') return null;
  if (!paired.some((m) => m.environmentId === machine)) return { kind: 'machines' };
  return { kind: 'machine', environmentId: machine, path: safeMobilePath(url) };
}

export interface TapDeps {
  plugin?: Pick<PushNotificationsPlugin, 'addListener'>;
  paired(): readonly PairedMachine[];
  signedIn(): boolean;
  open(target: TapTarget): void;
}

/** Returns true the first time `id` is seen in this app process. */
function firstDelivery(id: string): boolean {
  try {
    if (sessionStorage.getItem(HANDLED_KEY) === id) return false;
    sessionStorage.setItem(HANDLED_KEY, id);
  } catch {
    // Storage unavailable: handle the tap.
  }
  return true;
}

/** Listens for `pushNotificationActionPerformed`; returns the uninstaller. */
export function installNotificationTap({ plugin = PushNotifications, paired, signedIn, open }: TapDeps): () => void {
  let removed = false;
  const handle = plugin.addListener('pushNotificationActionPerformed', ({ notification }) => {
    if (removed || !signedIn() || !firstDelivery(notification.id)) return;
    const target = tapTarget(notification.data, paired());
    if (target) open(target);
  });
  return () => {
    removed = true;
    void handle.then((h) => h.remove());
  };
}
