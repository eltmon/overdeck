/*
 * Overdeck service worker (PAN-2355).
 *
 * D-1 Ownership: PAN-2355 owns this file, including its push and
 *     notificationclick handlers. PAN-2354 (Web Push) owns VAPID keys,
 *     subscriptions and sending. Whichever issue lands second extends this
 *     file; never add a second worker script and never register another one.
 *     The phone shell (/m) and PAN-2354's notifications control both register
 *     this same script with scope '/'.
 *
 * D-2 Push payload: JSON { title, body, url, tag? }. `url` is a same-origin
 *     path: /m?subject=<id> opens that question, /m opens the Needs-you list.
 *     A missing or cross-origin url opens /m. A payload that is not valid
 *     JSON shows "Overdeck" / "Something needs you" and opens /m.
 *
 * D-5 No offline support: this worker has no fetch listener, keeps no cache
 *     and never answers a request itself. index.html is served no-store and
 *     its boot watchdog polls the network; a caching worker would break both.
 *
 * Plain ES2020, no imports: Vite copies public/ to the build unchanged.
 */

const FALLBACK_PATH = '/m';

function resolveNotificationUrl(raw) {
  try {
    const url = new URL(typeof raw === 'string' && raw ? raw : FALLBACK_PATH, self.location.origin);
    if (url.origin === self.location.origin) return url.href;
  } catch {
    // Unparsable url: fall through to the Needs-you list.
  }
  return new URL(FALLBACK_PATH, self.location.origin).href;
}

/** Push message text → the notification to show. Exposed for the Playwright spec. */
self.overdeckNotificationFromPush = function overdeckNotificationFromPush(text) {
  let payload = null;
  try {
    payload = JSON.parse(text);
  } catch {
    payload = null;
  }
  if (!payload || typeof payload !== 'object') {
    return {
      title: 'Overdeck',
      options: { body: 'Something needs you', data: { url: resolveNotificationUrl(null) } },
    };
  }
  const options = {
    body: typeof payload.body === 'string' ? payload.body : '',
    data: { url: resolveNotificationUrl(payload.url) },
  };
  if (typeof payload.tag === 'string' && payload.tag) options.tag = payload.tag;
  return {
    title: typeof payload.title === 'string' && payload.title ? payload.title : 'Overdeck',
    options,
  };
};

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  const text = event.data ? event.data.text() : '';
  const { title, options } = self.overdeckNotificationFromPush(text);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  const url = resolveNotificationUrl(data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((c) => new URL(c.url).origin === self.location.origin);
    if (client) {
      const focused = await client.focus();
      await (focused || client).navigate(url);
      return;
    }
    await self.clients.openWindow(url);
  })());
});
