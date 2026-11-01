/*
 * Overdeck service worker (PAN-2354; extended by PAN-2355 — there is exactly
 * one worker, registered as navigator.serviceWorker.register('/sw.js', { scope: '/' })).
 *
 * Push payload contract (encrypted end to end, RFC 8291):
 *   { "title": string, "body": string, "url": string, "tag"?: string }
 * `url` is a same-origin path such as /m?subject=<id> or /m. A click focuses an
 * open dashboard window and navigates it there, else opens a new window. A
 * cross-origin url is replaced with /m. No fetch handler: nothing is cached.
 */

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('push', (event) => {
  let title = 'Overdeck';
  let body = 'Something needs you.';
  let url = '/m';
  let tag = '';
  try {
    const data = event.data ? event.data.json() : null;
    if (data && typeof data.title === 'string') {
      title = data.title;
      body = typeof data.body === 'string' ? data.body : '';
      url = typeof data.url === 'string' ? data.url : '/m';
      tag = typeof data.tag === 'string' ? data.tag : '';
    }
  } catch {
    // Unreadable payload: show the generic notification.
  }
  const options = { body, data: { url }, renotify: Boolean(tag), icon: '/favicon.svg', badge: '/favicon.svg' };
  if (tag) options.tag = tag;
  event.waitUntil(self.registration.showNotification(title, options));
});

function sameOriginUrl(raw) {
  try {
    const url = new URL(raw || '/m', self.location.origin);
    if (url.origin === self.location.origin) return url.href;
  } catch {
    // fall through to /m
  }
  return new URL('/m', self.location.origin).href;
}

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
