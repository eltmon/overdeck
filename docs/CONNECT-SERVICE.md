# Connect service (`services/connect`, connect.overdeck.ai)

The overdeck.ai directory, the WebRTC introduction, the relay add-on's credentials and metering, and the webhook inbox for Overdeck Anywhere (PAN-2356; issue PRD `.pan/drafts/pan-2356.md`, epic PRD `.pan/drafts/pan-2350.md` D-3, D-15, D-18, D-20). A Cloudflare Worker with one Durable Object per account. Machine side: `docs/ANYWHERE-ARCHITECTURE.md`; user pages: `configuration/remote-access.mdx` ("Find your machines through overdeck.ai") and `configuration/triggers.mdx` ("Hold events with the directory inbox").

## What it is

- **One Durable Object per account** (`AccountDirectory`, SQLite storage), named by the account's `userId` (`DIRECTORY.idFromName(userId)`). It owns every directory socket of that account's machines.
- **The Worker** checks each device token through the account service's `AccountRpc.verifyDevice` (service binding `ACCOUNT`), then hands the socket to the account's Durable Object with the verified identity in `X-Connect-Identity`. The token comes from `Authorization` (machines) or, when that header is absent, from the `overdeck.bearer.<token>` WebSocket subprotocol (phones, whose WebView cannot set headers); the Worker echoes that exact subprotocol on the 101 so the browser keeps the socket. The token never reaches the Durable Object, which never reads `Authorization`.
- **It carries transport only** (D-15). Conversation bytes never cross it; it introduces two machines and steps aside. It never vouches for a key (D-18): linking needs the two-screen approval or a pairing code.
- Layout copies `services/share`: own Bun workspace (`@overdeck/connect-service`, FSL-1.1-MIT), Web APIs only, only `src/index.ts` imports `cloudflare:workers`, typechecked by `npm run typecheck:connect`, tests under `tests/unit/services/connect/` and `tests/integration/services/connect/`.

| File | Role |
| --- | --- |
| `src/index.ts` | Worker entry and the `AccountDirectory` class (delegates to `DirectoryHost`) |
| `src/routes.ts`, `src/http.ts` | `GET /healthz`, `GET /v1/directory` (upgrade), `POST /h/:id` |
| `src/account.ts` | Device token check through `AccountRpc` (401 / 403 `grant_expired` / 503) |
| `src/protocol.ts` | Decoder for machine and client frames by socket role: known keys only, 64 KiB frames, 64-char labels, 16 endpoints |
| `src/directory-state.ts` | Pure reducer: presence, the machine limit, signalling, approvals, relay metering, inbox frames |
| `src/client-state.ts` | Pure reducer for phone clients: registration, the 5-client cap, phone signalling, forget |
| `src/ice-relay.ts` | The `ice-servers` and `relay-usage` answers shared by both reducers |
| `src/push-state.ts` | Pure push decisions: registration, the `push` checks and rate limit, the `push-result` for a delivery outcome |
| `src/push/` | Push I/O: `config.ts` (secrets, shared types), `jwt.ts` (base64url, PEM, JWS input), `http.ts` (2 s fetch timeout), `apns.ts`, `fcm.ts`, `deliver.ts` (provider choice, one retry) |
| `src/directory.ts` | Durable Object glue: sockets, alarm, effects in order persist → register → send → close |
| `src/directory-store.ts` | SQLite schema, the `clients` upserts and the load that rebuilds the reducer state at wake-up |
| `src/relay-meter.ts`, `src/turn.ts` | Monthly relay usage; Cloudflare Realtime TURN credentials (600 s TTL) |
| `src/inbox.ts`, `src/inbox-intake.ts`, `src/seal.ts` | Inbox store, the public `POST /h/:id` route, `crypto_box_seal` in pure JS |
| `src/log.ts` | The only logger: frame type, environment id or client id, outcome; never a label, key or payload |

The wire protocol is `packages/contracts/src/connect.ts` (runtime-import-free so the Worker imports it by relative path); the dashboard's `GET /api/directory` view is `packages/contracts/src/connect-view.ts`.

`connect.ts` also carries the phone app's frames (PAN-4823): `ClientToDirectoryFrame`, `DirectoryToClientFrame`, the machine's `push` and the directory's `push-result`, with `CLIENT_LIMIT`, `PUSH_RATE_PER_MINUTE` and `PUSH_SEALED_MAX_CHARS`. The directory serves the client role (PAN-4829, "Phone clients" below). The directory forwards sealed push to APNs and FCM (PAN-4830, "Phone push" below).

## Phone clients (PAN-4829)

- **Role.** A socket's first valid hello fixes its role: `hello` makes it a machine, `hello-client` a phone. The decoder then accepts only that role's frames; a cross-role frame is `bad_frame`.
- **Welcome.** `welcome-client` carries the protocol, the plan, `relayAllowed` and the account's machines with their online state.
- **Broadcasts.** Phones receive every `directory` frame machines receive and every `relay-status`, but never approvals or inbox frames. No machine frame ever lists a phone.
- **Signals.** A phone signals an online machine with `purpose: 'link'` only, and the machine sees `from` = the phone's `clientId`. A machine's `link` signal to an online phone arrives with `from` = its environment id. Phone to phone is `bad_frame`; an offline target is `peer_offline`.
- **ICE and relay.** `ice-servers` and `relay-usage` from a phone follow the machine rules and meter the account's relay allowance.
- **Storage.** Phones live in the `clients` table. Its nullable `push_platform`, `push_token` and `aps_environment` columns hold the phone's push registration. Only `push-register` and `push-unregister` (and a dead-token answer) write them; `hello-client` never does, so a reconnect keeps the registration. They were created with the table by PAN-4829 because `CREATE TABLE IF NOT EXISTS` cannot add columns later.
- **Tags.** Every socket keeps the `machine` tag and the role lives in the socket attachment: tags are fixed at accept time, before the role is known, and renaming the tag would orphan sockets that hibernated before this shipped.

## Phone push (PAN-4830)

- **Register.** A phone sends `push-register { platform, token, apsEnvironment? }`: the token is 1-4096 chars of `[0-9A-Za-z:_.-]`, and `apsEnvironment` (`production` or `sandbox`) is iOS-only. iOS without it stores `production`. A `platform` that differs from the phone's `hello-client` platform answers `error bad_frame`. `push-unregister` clears the registration.
- **Push checks, in order.** A machine's `push { requestId, to, sealed, urgency, collapseId }` answers `push-result` `unknown_client` when `to` is not a phone of this account, `no_registration` when the phone has none, and `rate_limited` after 30 accepted pushes per account in one UTC minute. The count lives in the `meta` row `push_window`, so hibernation does not reset it. Whether the phone is online never matters: a closed app is why push exists.
- **APNs.** `POST https://api.push.apple.com/3/device/<token>` (`api.sandbox.push.apple.com` for `sandbox`), `apns-push-type: alert`, `apns-topic: ai.overdeck.app`, `apns-priority` 10 (high) or 5, `apns-collapse-id`. The body is exactly `{"aps":{"alert":{"title":"Overdeck","body":"Something needs you"},"mutable-content":1,"sound":"default","thread-id":"<collapseId>"},"s":"<sealed>"}`; the phone's notification extension opens `s`.
- **APNs provider token.** ES256 with `iat` rounded down to a 45-minute window and deterministic (RFC 6979) signatures, so every Durable Object in every isolate derives the same token per window. Apple answers `429 TooManyProviderTokenUpdates` when the token changes more often than about every 20 minutes, and rejects a token older than 60 minutes.
- **FCM.** `POST https://fcm.googleapis.com/v1/projects/<FCM_PROJECT_ID>/messages:send`, body exactly `{"message":{"token":"<token>","data":{"s":"<sealed>"},"android":{"priority":"HIGH","ttl":"3600s","collapse_key":"<collapseId>"}}}` (`NORMAL` for normal urgency). It has no `notification` key, so Android wakes the app's messaging service even when the app is closed. The OAuth access token comes from an RS256 service-account assertion and is cached until 5 minutes before it expires; a 401 drops it.
- **Dead tokens.** APNs 410, or 400 `BadDeviceToken` / `DeviceTokenNotForTopic` / `Unregistered`; FCM 404 or `UNREGISTERED`. The directory clears the registration only if the phone still holds the token that failed (it may have re-registered during the request) and answers `no_registration`.
- **Retry and time.** Each request has a 2 s timeout. A 5xx, network error or timeout of the send is retried once after 2 s; the OAuth exchange, 4xx and 429 are not. Worst case 8 s (OAuth 2 + send 2 + wait 2 + send 2), inside the machine's 10 s wait.
- **Answer.** Delivered ⇒ `push-result { ok: true }`; a dead token ⇒ `no_registration`; any other failure, including an unconfigured provider ⇒ `delivery_failed`.
- **Logs** carry only the frame type, ids and a short outcome (`delivered`, `gone`, `not_configured`, `failed_apns_503`, …), never a token, the sealed payload, a JWT, an access token or a key.

## Endpoints

| Method | Path | Auth | Answer |
| --- | --- | --- | --- |
| GET | `/healthz` | none | `{ ok, configured, turn, apns, fcm }` (reveals no value) |
| GET | `/v1/directory` | `Bearer odd_…` device token, or the subprotocol `overdeck.bearer.odd_…` (echoed on the 101); WebSocket upgrade | 101 to the account's Durable Object; 401 / 403 / 426 / 429 / 503 otherwise |
| POST | `/h/<doId>.<secret>` | the secret in the URL | `202 { queued: true }`; `404 { error: "not found" }`, `413`, `403` (free plan), `429` (full or rate-limited) |

## Limits

- **Machines:** a `free` account holds at most 3 (`hello` for a fourth environment id → `error machine_limit` "The free account includes 3 machines", close 4009). `tester` (every allowlisted account until billing) has no limit.
- **Phones (clients):** at most 5 per account on every plan (`hello-client` for a sixth `clientId` → `error client_limit` "This account already has 5 phones. Remove one in the app or on a machine.", close 4013). Phones never count against the machine limit. One socket per phone (a newer one closes the older with 4011); `forget-client` deletes the phone and closes with 4012.
- **Sockets:** one per machine; a newer socket for the same machine closes the older with 4011. `forget` closes with 4012. `ping`/`pong` is a runtime auto-response, so an idle socket never wakes the object.
- **Approvals:** 1 pending request per requesting machine, 5 per account, 10-minute expiry.
- **Relay:** 50 GB (`RELAY_MONTHLY_CAP_BYTES`) per account per UTC calendar month; each `relay-usage` report (from a machine or a phone) broadcasts the month's `relay-status` to every machine and phone, the report that reaches the cap broadcasts `relay-status { stopped: true }`, and later credential requests answer `relay_cap_reached`.
- **Inbox:** bodies up to 256 KiB, 200 pending events per inbox, 64 MiB of sealed bytes per account, 120 events per minute per inbox (`INBOX_LIMIT`), 24-hour hold.
- **Connects:** 30 directory upgrades per minute per device (`CONNECT_LIMIT`).
- **Push:** 30 pushes per account per UTC minute (`rate_limited` after that).

## Configuration

| Name | Kind | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | var | `https://connect.overdeck.ai`; the base of inbox URLs. Without it every route but `/healthz` answers 503. |
| `STUN_URLS` | var | Comma-separated STUN URLs for `direct` routes (`stun:stun.cloudflare.com:3478`). |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | secrets | Cloudflare Realtime TURN key. Unset: no relay (`turn_unavailable`), `/healthz` reports `turn: false`. |
| `RELAY_CAP_BYTES` | optional var | Positive integer overriding the 50 GB cap, for staging tests only. |
| `APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID` | secrets | APNs auth key (`.p8` PEM; literal `\n` sequences become newlines), its key id and the Apple team id. Unset: iOS pushes answer `delivery_failed`, `/healthz` reports `apns: false`. |
| `FCM_SERVICE_ACCOUNT_JSON`, `FCM_PROJECT_ID` | secrets | Firebase service-account JSON (needs `client_email` and `private_key`) and project id. Unset: Android pushes answer `delivery_failed`, `/healthz` reports `fcm: false`. |
| `DIRECTORY` | Durable Object binding | `AccountDirectory`, migration `v1` (`new_sqlite_classes`). |
| `ACCOUNT` | service binding | `overdeck-account`, entrypoint `AccountRpc`. |
| `INBOX_LIMIT`, `CONNECT_LIMIT` | rate limits | namespaces `1101` (120 / 60 s) and `1102` (30 / 60 s). |

A machine points at a self-hosted copy with `anywhere.directory_url` in its `config.yaml` (`https:`, or `http:` to a loopback host).

## Local development

```bash
cd services/connect
cp .dev.vars.example .dev.vars        # leave the TURN or push values empty to run without the relay or push
npx wrangler dev --local              # binds 127.0.0.1:8787
npm run build:dry                     # bundle with no credentials and no upload
```

`wrangler dev` needs the account Worker running too for the `ACCOUNT` binding; the tests stub it instead: `npx vitest run tests/unit/services/connect/ tests/integration/services/connect/`. The end-to-end check is `node scripts/anywhere/directory-smoke.mjs` after `npm run build` (see `docs/ANYWHERE-ARCHITECTURE.md`, "Running the directory smoke").

## Deploy

Operator-only. **No agent deploys** and no agent runs any of the commands below. The custom-domain route in `wrangler.jsonc` creates the `connect.overdeck.ai` DNS record on first deploy.

1. `npm run build:dry` in `services/connect` exits 0.
2. Deploy `services/account` first (`docs/ACCOUNT-SERVICE.md`, "Deploy"); the `ACCOUNT` binding needs `overdeck-account` with its `AccountRpc` entrypoint returning `entitlement`, or every directory socket answers `account_service_outdated`.
3. Reuse the share service's Realtime TURN key, or create one in the Cloudflare dashboard (Realtime → TURN Server). An account without Realtime must first add the Realtime subscription, which needs a payment method (1,000 GB a month free, then billed per GB).
4. `cd services/connect && npx wrangler secret put TURN_KEY_ID`, then `npx wrangler secret put TURN_KEY_API_TOKEN`.
5. `npx wrangler secret put` for each of the five push secrets (`APNS_KEY_P8`, `APNS_KEY_ID`, `APNS_TEAM_ID`, `FCM_SERVICE_ACCOUNT_JSON`, `FCM_PROJECT_ID`; values from W-REL1, PAN-4841). `/healthz` then reports `apns: true, fcm: true`.
6. `npx wrangler deploy` (uploads the Worker, creates the `AccountDirectory` Durable Object from migration `v1`, binds `ACCOUNT` and both rate limiters, and registers `connect.overdeck.ai`).
7. Smoke test: `node scripts/anywhere/smoke-hosted.mjs` exits 0 (both Workers' `/healthz`, plus one account device-code start), and on a signed-in machine `pan machines directory` lists it `online` within a minute.
8. Run the two live checks of D-2356-21 on real machines: two machines on different networks without Tailscale link by approval and reach each other over `rtc://`; with UDP blocked on both, a relay-plan account links over `rtc+turn://` and the card shows **Using relay**. To block UDP, run these rules with both `iptables` and `ip6tables`; they drop all UDP except DNS on port 53: `-A OUTPUT -p udp --dport 53 -j ACCEPT`, `-A INPUT -p udp --sport 53 -j ACCEPT`, `-A OUTPUT -p udp -j DROP`, `-A INPUT -p udp -j DROP`. Start the server with `DEBUG=werift*`. When the relay picks the right TURN URL, its `iceOptions` log line shows `turnTransport: 'tls'` and port 443.
9. Rollback: `npx wrangler rollback` returns to the previous Worker version.
