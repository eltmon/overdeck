import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';

import {
  loadPushStatus,
  loadVapidPublicKey,
  PUSH_STATUS_QUERY_KEY,
  savePushSubscription,
  urlBase64ToUint8Array,
} from './pushApi';

/**
 * Why this browser cannot turn on push, or ok. Web Push needs a service worker,
 * the Push API, a secure context (HTTPS or localhost) and notification
 * permission that is not blocked. On iPhone, Safari exposes push only to a
 * Home Screen web app (PAN-2354).
 */
export function pushSupport(): { ok: true } | { ok: false; message: string } {
  const missingApi = !('serviceWorker' in navigator) || !('PushManager' in window);
  if (missingApi && /iPhone|iPad/.test(navigator.userAgent)) {
    return { ok: false, message: 'On iPhone, add Overdeck to your Home Screen, then turn on notifications from the installed app.' };
  }
  if (missingApi) return { ok: false, message: 'This browser cannot receive push notifications.' };
  if (!window.isSecureContext) {
    return { ok: false, message: 'Open this dashboard over HTTPS (for example through Tailscale Serve) to turn on notifications.' };
  }
  if (typeof Notification !== 'undefined' && Notification.permission === 'denied') {
    return { ok: false, message: 'Notifications are blocked for this site in the browser settings.' };
  }
  return { ok: true };
}

function deviceLabel(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPad/.test(ua)) return 'iPhone';
  if (/Android/.test(ua)) return 'Android';
  return 'This browser';
}

/**
 * Subscribe this device to needs-you push. Registers the one service worker at
 * `/sw.js` with scope `/` — the same call PAN-2355 makes, so the browser
 * returns the existing registration instead of creating a second worker.
 */
export function TurnOnNotificationsButton({ compact = false }: { compact?: boolean }) {
  const queryClient = useQueryClient();
  const [busy, setBusy] = useState(false);
  const support = pushSupport();
  const { data: status } = useQuery({ queryKey: PUSH_STATUS_QUERY_KEY, queryFn: loadPushStatus, enabled: support.ok });

  if (!support.ok) {
    return compact ? (
      <span className="text-xs text-muted-foreground" title={support.message}>Notifications unavailable</span>
    ) : (
      <p className="text-xs text-muted-foreground">{support.message}</p>
    );
  }

  if (status?.webpush.subscriptions.some((subscription) => subscription.thisDevice)) {
    return <span className="text-xs text-muted-foreground">Notifications on</span>;
  }

  const handleClick = async () => {
    setBusy(true);
    try {
      // Must run inside the click: iOS only prompts from a user gesture.
      const permission = await Notification.requestPermission();
      if (permission !== 'granted') return;
      const registration = await navigator.serviceWorker.register('/sw.js', { scope: '/' });
      await navigator.serviceWorker.ready;
      const publicKey = await loadVapidPublicKey();
      const subscription = (await registration.pushManager.getSubscription())
        ?? await registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) });
      await savePushSubscription(subscription.toJSON(), deviceLabel());
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(false);
      await queryClient.invalidateQueries({ queryKey: PUSH_STATUS_QUERY_KEY });
    }
  };

  return (
    <button
      type="button"
      disabled={busy}
      onClick={() => void handleClick()}
      className="rounded-md bg-primary px-3 py-1.5 text-xs text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50"
    >
      Turn on notifications
    </button>
  );
}
