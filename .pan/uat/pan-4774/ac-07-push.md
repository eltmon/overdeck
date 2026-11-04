# PAN-4774 — AC-7: push to a subscribed browser, unreadable at the push service

- **Commit tested:** `feature/pan-4774` (built tree; no `src/` change since the build except the remote-worker follower fix, which push does not use).
- **Date:** 2026-11-02, about 23:00 UTC, host `eltmon-z790`.
- **Approximation:** desktop Chrome on this host, not an installed phone PWA. AC-7 names a phone; that half is not covered.

## Delivery latency (D-10)

- **Peer test dashboard:** `dist/dashboard/server.js` started through the symlink `.tmp/pan-4774/peer7/serve.js` (so the host orphan reaper leaves it alone), with its own `OVERDECK_HOME` and fake `HOME` under `.tmp/pan-4774/peer7`, port 3942, `OVERDECK_DISABLE_DEACON=1`, tmux socket `pan4774-peer7`. The home dashboard was never subscribed.
- **Browser:** Google Chrome (`/usr/bin/google-chrome`) through Playwright 1.63 `channel: 'chrome'`, headed on `DISPLAY=:1`, its own `userDataDir` at `.tmp/pan-4774/chrome`, notification permission granted for `http://127.0.0.1:3942`.
- **Subscribe:** Settings → Anywhere → Phone notifications → **Turn on notifications** → `GET /api/push/vapid-public-key 200`, `POST /api/push/subscriptions 201 {"id":"dc3a2e155f9beae7"}` (host `fcm.googleapis.com`).
- **Measure:** click **Send test**, then poll `registration.getNotifications()` every 25 ms for the title `Overdeck test notification` (the service worker's `push` handler calls `showNotification`, `public/sw.js` line 85). Each `POST /api/push/test` answered `{"outcomes":[{"target":"webpush:dc3a2e155f9beae7","ok":true}]}`.

| Run | Send test → notification shown |
| --- | --- |
| 1 | 615 ms |
| 2 | 1,093 ms |
| 3 | 1,806 ms |

Every run showed `{"title":"Overdeck test notification","body":"Push works on this device.","tag":"test"}`, through the real Google push service. Screenshot: [ac-07-push.png](ac-07-push.png) (the peer dashboard's Settings after **Send test**, toast "Test sent to 1 target(s)"; the OS notification itself is outside the page).

## Unreadable at the push service — deviation from D-10

D-10 planned a second subscription whose endpoint is a local capture server. The subscription store refuses that: `validatePushEndpoint` (`src/lib/push/subscription-store.ts`) accepts only `https:` endpoints on port 443 at a known push service. Instead, the real provider (`createWebPushProvider`, `src/lib/push/webpush-provider.ts`) was run in a throwaway `OVERDECK_HOME` with a subscription to `https://fcm.googleapis.com/fcm/send/pan4774-capture` whose P-256 key pair and auth secret were generated for the check, and with a stubbed `fetchImpl` that records the request instead of sending it. That is exactly the request the push service would receive.

```
outcomes: [{"target":"webpush:b7deccfa43d3d48c","ok":true}]
POST https://fcm.googleapis.com/fcm/send/pan4774-capture
headers: { "TTL": "3600", "Content-Type": "application/octet-stream", "Content-Encoding": "aes128gcm",
           "Authorization": "vapid t=eyJ0<redacted>", "Urgency": "normal", "Topic": "n4bQgYhMfWWaL-qgxVrQFaO_TxsrC4Is" }
body bytes: 201
first 64 bytes (hex): 48d8a6c0c158e767d8444b8747dd74b40000100041041e5576d92c30f7691fc2b5ec646e6f47598ad398e28f5912af9b06890305228243ebdc9c4edd9797be31
body contains the title (utf8): false | contains "Push works": false
decrypted with the subscription private key: {"title":"Overdeck test notification","body":"Push works on this device.","url":"/m","tag":"test"}
```

The body starts with the RFC 8188 header (16-byte salt, record size `00001000`, key-id length `41`, then the 65-byte sender public key `04…`). Neither the title nor the body text appears in it, and it decrypts (`http_ece`, `aes128gcm`) to the payload only with the subscriber's private key. The `Topic` header is a hash of the tag, not the tag.

## Cleanup

- The capture subscription lived in a temporary `OVERDECK_HOME`, removed by the script.
- The browser subscription: `DELETE /api/push/subscriptions/dc3a2e155f9beae7` was refused ("Content-Type must be application/json") before the peer was stopped; the record went away with the peer's `OVERDECK_HOME` (`.tmp/pan-4774/peer7`, deleted), and the Chrome profile holding the browser side was deleted too, so no server holds that push target.
- Peer server stopped (pid file), tmux server `pan4774-peer7` killed, port 3942 free.

Status: approximated: desktop Chrome, no phone
