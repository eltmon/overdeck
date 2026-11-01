/*
 * Overdeck service worker (PAN-2354; extended by PAN-2355 — there is exactly
 * one worker, registered as navigator.serviceWorker.register('/sw.js', { scope: '/' })).
 *
 * Ownership: PAN-2354 sends the pushes (VAPID keys, subscriptions,
 * Turn on notifications); PAN-2355 owns the phone shell at /m. Both register
 * this same script at the same scope. Extend this file; never add a second
 * worker script or register another one.
 *
 * Push payload contract (encrypted end to end, RFC 8291):
 *   { "title": string, "body": string, "url": string, "tag"?: string }
 * `url` is a same-origin path such as /m?subject=<id> or /m. A cross-origin url
 * is replaced with /m, both when the notification is shown and when it is
 * clicked. A click focuses an open dashboard window and navigates it there,
 * else opens a new window. An unreadable payload shows a generic notification
 * that opens /m.
 *
 * No fetch handler: nothing is cached and no request is answered by the worker.
 * index.html is served no-store and its boot watchdog polls the network; a
 * caching worker would break both.
 */

function isSameOrigin(raw) {
  try {
    return new URL(raw, self.location.origin).origin === self.location.origin;
  } catch {
    return false;
  }
}

function sameOriginUrl(raw) {
  try {
    const url = new URL(raw || '/m', self.location.origin);
    if (url.origin === self.location.origin) return url.href;
  } catch {
    // fall through to /m
  }
  return new URL('/m', self.location.origin).href;
}

/**
 * Push payload (parsed object, or JSON text) → the notification to show.
 * Exposed on `self` for the PAN-2355 Playwright spec.
 */
self.overdeckNotificationFromPush = function overdeckNotificationFromPush(payload) {
  let data = payload;
  if (typeof data === 'string') {
    try {
      data = JSON.parse(data);
    } catch {
      data = null;
    }
  }
  let title = 'Overdeck';
  let body = 'Something needs you.';
  let url = '/m';
  let tag = '';
  if (data && typeof data === 'object' && typeof data.title === 'string') {
    title = data.title;
    body = typeof data.body === 'string' ? data.body : '';
    url = typeof data.url === 'string' && isSameOrigin(data.url) ? data.url : '/m';
    tag = typeof data.tag === 'string' ? data.tag : '';
  }
  const options = { body, data: { url }, renotify: Boolean(tag), icon: '/favicon.svg', badge: '/favicon.svg' };
  if (tag) options.tag = tag;
  return { title, options };
};

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let payload = null;
  try {
    payload = event.data ? event.data.json() : null;
  } catch {
    // Unreadable payload: show the generic notification.
  }
  const { title, options } = self.overdeckNotificationFromPush(payload);
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = sameOriginUrl(event.notification.data && event.notification.data.url);
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const client = windows.find((candidate) => {
      try {
        return new URL(candidate.url).origin === self.location.origin;
      } catch {
        return false;
      }
    });
    if (client) {
      await client.focus();
      await client.navigate(target);
      return;
    }
    await self.clients.openWindow(target);
  })());
});
