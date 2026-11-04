# Shared Sessions share service

Source: `services/share/` (licensed under FSL-1.1-MIT, `services/LICENSE.md`) and `packages/contracts/src/sharing.ts` (MIT, like the rest of the repo). Issue: PAN-658 (slice 1 of Shared Sessions v0). Design: `.pan/drafts/pan-658.md` (the PRD).

## What it is

A Cloudflare Worker at `https://share.overdeck.ai` (Worker `overdeck-share`) that lets an Overdeck user give someone a link to a live conversation. It is the **rendezvous and admission service** only: it creates rooms, runs the host-approval lobby, keeps each room's block list and controller, and relays WebRTC signaling (SDP and ICE) between the host's local Overdeck server and each viewer's local Overdeck server. Conversation content never passes through it; content flows peer-to-peer over DTLS DataChannels that open only after the host admits a viewer.

Each room is one `ShareRoom` Durable Object on the SQLite storage backend, addressed by the room's short code. Its WebSockets use the hibernation API. The service also mints short-lived Cloudflare Realtime TURN credentials for peers that cannot connect directly.

Every host and viewer is identified by a PAN-4293 device token (`odd_…`), verified on every request through the `ACCOUNT` service binding to the account Worker's `AccountRpc.verifyDevice`. A server viewer presents it as `Authorization: Bearer odd_…`. A browser viewer on the hosted join page (slice 10) gets its token through a GitHub sign-in that this Worker runs as the OAuth client, and keeps it in a sealed `HttpOnly` cookie; see "Hosted web join" below.

Runtime code uses Web APIs only; `src/index.ts` is the only module that imports `cloudflare:workers`. Every room rule lives in the pure reducer `src/room-state.ts`; `src/room.ts` is the Durable Object glue that persists the record and executes the reducer's effects.

## Slice map

| Slice | Issue | Delivers |
| --- | --- | --- |
| 1 | [PAN-658](https://github.com/eltmon/overdeck/issues/658) | This share service, the signaling types in `@overdeck/contracts`, this doc |
| 2 | [PAN-4473](https://github.com/eltmon/overdeck/issues/4473) | Host share action, share record, `/api/shares/*`, lobby panel with **Admit as contributor** |
| 3 | [PAN-4474](https://github.com/eltmon/overdeck/issues/4474) | Host WebRTC hub, content wire format, conversation bridge |
| 4 | [PAN-4475](https://github.com/eltmon/overdeck/issues/4475) | Viewer surface, join intent, user docs page `configuration/shared-sessions.mdx` |
| 5 | [PAN-4476](https://github.com/eltmon/overdeck/issues/4476) | Drafts, contributor direct-submit, FIFO queue |
| 6 | [PAN-4477](https://github.com/eltmon/overdeck/issues/4477) | Read-only terminal channel |
| 7 | [PAN-4478](https://github.com/eltmon/overdeck/issues/4478) | Controller handoff and reclaim (host enforcement and UI) |
| 8 | [PAN-4479](https://github.com/eltmon/overdeck/issues/4479) | Host reconnect and re-park, viewer auto-restore |
| 9 | [PAN-4480](https://github.com/eltmon/overdeck/issues/4480) | `pan share` / `pan join` CLI |
| 10 | [PAN-4481](https://github.com/eltmon/overdeck/issues/4481) | Hosted web join page (operator decision OD-1) |
| 11 | [PAN-4482](https://github.com/eltmon/overdeck/issues/4482) | Signaling-privacy e2e, forced-TURN verification, full acceptance sweep |

## Rooms and the lobby

A room has a **data owner** (the GitHub identity that created it), a **controller** (initially the data owner), a host connection state, a list of participants (each `lobby` or `admitted`, with a `contributor` flag and a `connected` flag) and a block list. Limits: 50 participants in total, 20 of them in the lobby.

**Invite-only.** A new viewer always lands in the lobby and receives exactly one frame, `status lobby`. Until the host admits that viewer, everything addressed to it is `status lobby`, `error not_admitted` or a close: it never sees a snapshot, another participant's identity, a signal or ICE servers, and nothing it sends reaches the host.

The rules, as the reducer applies them:

- **Host connects.** The room cancels its reconnect alarm and sends the host a `room` snapshot. If the host had been away, every connected admitted viewer gets `status host-reconnected`; lobby viewers get nothing.
- **Host disconnects.** The room arms an alarm for 5 minutes later and tells every connected admitted viewer `status host-disconnected`. If the host is still away when the alarm fires, the room ends. A newly created room arms the same alarm, so a room whose host never connects ends after 5 minutes.
- **Viewer joins.** A blocked identity is closed with **4003** and the host is not told. The data owner joining as a viewer is closed with **4009**. A known participant reconnecting keeps its state: an admitted viewer gets `status admitted` (with `contributor`) and, if the host is away, `status host-disconnected`. This is auto-restore: an admitted viewer is never sent back to the lobby. A new viewer over either cap is closed with **4013**. A second socket for the same identity replaces the first, which is closed with **4008**.
- **Viewer disconnects.** A lobby viewer is removed. An admitted viewer stays admitted, marked offline.
- **Viewer frames.** `leave` removes the viewer and closes with **1000**. An admitted viewer's `signal` goes to the host while it is connected and is dropped while it is away. `ice-servers` mints TURN credentials for an admitted viewer. A lobby viewer's `signal` or `ice-servers` gets `error not_admitted`.
- **Host frames.** `admit` moves a lobby viewer to admitted, with `contributor` when the frame says so, and sends it `status admitted`. `kick` removes a participant and closes it with **4010**; if it rejoins, it is new and lands in the lobby. `revoke` removes it, adds it to the block list and closes it with **4011**; `unrevoke` takes it off the block list. `set-contributor` changes an admitted viewer's flag and resends `status admitted`. `set-controller` hands control to an admitted viewer, or back to the data owner (reclaim, always accepted). `signal` reaches an admitted, connected viewer; a lobby target gets the host `error not_admitted` and nothing reaches the viewer. Naming an identity the room does not hold in the required state gets the host `error unknown_participant`.
- **Controller.** When the controller is kicked, revoked or leaves, control returns to the data owner.
- **End.** The host's `end` frame, `DELETE /v1/rooms/:code` and the reconnect alarm all end the room: every socket closes with **4004**, the alarm is cancelled and the room's storage is deleted. A join to an ended room is refused.

After every state change the host receives a fresh `room` snapshot while it is connected.

## HTTP API

Every response carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, and none carries CORS headers. A request body over 16 KiB is 413 `payload_too_large`. An unknown path is 404 `{"error":"not_found"}`; a wrong method is 405 with an `Allow` header. Without `PUBLIC_BASE_URL` every route except `/healthz` is 503 `{"error":"not_configured","missing":["PUBLIC_BASE_URL"]}`. Without `ACCOUNT_BASE_URL` or a valid `WEB_SESSION_KEY`, the web routes (`/auth/*`, `/v1/web/session`, `/v1/rooms/:code/web-join`) are 503 `{"error":"not_configured","missing":[…]}` and the invite page renders without its browser section.

Short codes are 8 symbols from `BCDFGHJKLMNPQRSTVWXZ23456789` (no vowels, no 0/O/1/I). Codes in paths are uppercased and stripped of spaces and dashes, so `bcdf-ghjk` and `BCDFGHJK` are the same room.

| Method & path | Auth | Responses |
| --- | --- | --- |
| `GET /healthz` | none | 200 `{"ok":true,"configured":<bool>,"turn":<bool>,"web":<bool>}`; `turn` is true when both TURN secrets are set; `web` is true when `ACCOUNT_BASE_URL` is set and `WEB_SESSION_KEY` is 64 hex characters |
| `POST /v1/rooms` | `Bearer odd_…` | Body `{"scope":{"kind":"conversation","conversationId":"…"}}` (id 1–200 characters, no control characters). 201 `{shortCode, hostToken, joinUrl, snapshot}`; 400 `invalid_request`; 401 `invalid_token` / `device_revoked` / `account_deleted`; 403 `grant_expired`; 429 `rate_limited` with `Retry-After: 60` (10 rooms per minute per GitHub id); 503 `account_unavailable`, `account_service_outdated`, `room_unavailable` or `code_space_exhausted` |
| `DELETE /v1/rooms/:code` | `Bearer odh_…` (host token) | 204; 401 `invalid_token` for a missing or malformed host token; 404 `not_found` for an unknown code, an ended room or a wrong token (no oracle) |
| `GET /v1/rooms/:code/host?v=1` | `Bearer odh_…`, `Upgrade: websocket` | 101; 426 `upgrade_required` without the upgrade header; 400 `unsupported_protocol` when `v` is not `1`; 401 `invalid_token`; 404 `not_found` for an unknown code, an ended room or a wrong token |
| `GET /v1/rooms/:code/join?v=1` | `Bearer odd_…`, `Upgrade: websocket` | 101; 426; 400 `unsupported_protocol`; 401/403/503 as for `POST /v1/rooms`; 404 `not_found` for an unknown code or an ended room. Refusals for a blocked identity, the data owner or a full room arrive **after** the upgrade as close codes |
| `GET /s/:code` | none | 200 HTML invite page that finds Overdeck on this computer (PAN-4475): one nonce'd inline script probes `GET /api/share-probe` on `http://localhost:3011` and `http://127.0.0.1:3011` (1.5 s each, `credentials: 'omit'`) and navigates to `<origin>/#/shared/<CODE>` when one answers. The page always shows a manual **Open it in Overdeck on this computer** link, `pan up` instructions, a hint to allow Chrome's local-network prompt, and a link to install docs. Its CSP adds a fresh 16-byte nonce per response: `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-…'; connect-src http://localhost:3011 http://127.0.0.1:3011; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. It also shows `pan join <CODE>` and the no-install `npx @overdeck/core join <CODE>` (slice 9, [PAN-4480](https://github.com/eltmon/overdeck/issues/4480)). 404 HTML "This share link has ended or does not exist.", with no script and CSP `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'`. Neither page shows a host name, scope or participant count. **With web join configured (PAN-4481):** `<body data-short-code="<CODE>">`, the content above inside `<section id="local-join">`, then a hidden `<section id="web-join">` that the viewer bundle fills, the probe script, and `<script src="/viewer/viewer.js" defer>`. The CSP becomes `default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'nonce-…'; connect-src 'self' wss://<share host> http://localhost:3011 http://127.0.0.1:3011; img-src https://avatars.githubusercontent.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, and `Referrer-Policy` is `same-origin` instead of `no-referrer` (under `no-referrer` a same-origin form POST carries `Origin: null`, which would fail the **Sign out** Origin check). In both modes the probe navigates only when `document.documentElement.dataset.hostedJoin` is not `"started"`. |
| `GET /auth/signin?code=<CODE>` | none | 302 to `<ACCOUNT_BASE_URL>/auth/start` with `redirect_uri=<PUBLIC_BASE_URL>/auth/callback`, a fresh `state`, an S256 `code_challenge`, `platform=web` and the browser's `environment_id`; sets `__Host-ods_signin` and `__Host-ods_env`. 400 HTML "This share link is not valid." for a bad code |
| `GET /auth/callback` | `__Host-ods_signin` cookie | 303 to `/s/<CODE>` with `__Host-ods_session` after `AccountRpc.redeemWebCode`. HTML error pages, each with a link back to `/s/<CODE>`: 400 expired (missing, wrong or older-than-10-minutes sign-in cookie, or a redeem `invalid_grant`), 403 invite-only (`invite_only` or a redeem `access_denied`), 400 cancelled on GitHub (`github_denied`), 403 account being deleted (`account_deleting`), 503 account service unavailable. Always clears the sign-in cookie |
| `POST /auth/signout` | `Origin` equal to `PUBLIC_BASE_URL`; form field `code` | 303 to `/s/<CODE>`; revokes the web device through `AccountRpc.signOutDevice` and clears `__Host-ods_session`. 403 `forbidden_origin`; 400 HTML for an invalid code (the cookie is still cleared) |
| `GET /v1/web/session` | `__Host-ods_session` cookie | 200 `{"signedIn":true,"githubId","login","avatarUrl"}`; 200 `{"signedIn":false}` without a valid cookie (a revoked device, an unknown token or a deleted account also clears the cookie); 200 `{"signedIn":false,"reason":"grant_expired"}` (cookie kept); 503 `account_unavailable` or `account_service_outdated` |
| `GET /v1/rooms/:code/web-join?v=1` | `__Host-ods_session` cookie, `Origin` equal to `PUBLIC_BASE_URL`, `Upgrade: websocket` | The browser viewer's signaling socket: the same viewer protocol and the same Durable Object `/join` path as `/join`. 426; 400 `unsupported_protocol`; 403 `forbidden_origin`; 401 `invalid_token` without a valid cookie (an `Authorization` header is never read here); 401/403/503 from `verifyDevice` as for `/join`; 404 `not_found` |
| `GET /viewer/viewer.js` | none | 200 `text/javascript` from the `ASSETS` binding; 404 `not_found` without the binding or the built asset |

`hostToken` (`odh_` + 64 hex) appears only in the `POST /v1/rooms` response. The Worker stores and forwards only its SHA-256 and never logs either.

## WebSocket protocol

Frames are JSON text, at most 64 KiB, typed in `packages/contracts/src/sharing.ts` (protocol version 1). The decoder (`src/protocol.ts`) rejects binary frames and unknown types (`error invalid_frame`) and oversized frames (`error frame_too_large`), requires exact primitive types and a positive integer `githubId`, and rebuilds each frame from its known keys so extra fields are never forwarded. `SignalData` must carry `sdp` (at most 32 KiB) or `candidate` (at most 2 KiB) or both.

| Direction | Frames |
| --- | --- |
| Host → service | `admit {githubId, contributor?}`, `kick`, `revoke`, `unrevoke`, `set-contributor {githubId, contributor}`, `set-controller {githubId}`, `signal {githubId, data}`, `ice-servers`, `end` |
| Service → host | `room {snapshot}`, `signal {githubId, data}`, `ice-servers {iceServers}`, `error {code, githubId?}` |
| Viewer → service | `signal {data}`, `ice-servers`, `leave` |
| Service → viewer | `status {status: lobby \| admitted \| host-disconnected \| host-reconnected, contributor?}`, `signal {data}`, `ice-servers {iceServers}`, `error {code}` |

Error codes: `invalid_frame`, `frame_too_large`, `not_admitted`, `unknown_participant`, `room_full`, `lobby_full`, `turn_unavailable`.

| Close code | Meaning |
| --- | --- |
| 1000 | the viewer sent `leave` |
| 4001 | unauthorized (reserved; auth failures are HTTP errors before the upgrade) |
| 4003 | blocked: the identity is on the room's block list |
| 4004 | the room ended |
| 4008 | replaced: the same identity (or the host) connected again |
| 4009 | the data owner tried to join as a viewer |
| 4010 | kicked |
| 4011 | revoked |
| 4013 | room full (50) or lobby full (20) |

## Identity and the allowlist

The share service trusts only what `env.ACCOUNT.verifyDevice(token)` returns, on every `POST /v1/rooms` and every `/join` upgrade, with no cache. A viewer's identity is its GitHub id, login and `https://avatars.githubusercontent.com/u/<id>` avatar. If the account service does not return `githubLogin`, the share service answers 503 `account_service_outdated` instead of guessing a name.

The account service is invite-only (PAN-4293), so a person can get a device token only after the operator allowlists their GitHub account at `https://account.overdeck.ai/admin`. **Viewers must therefore be allowlisted accounts** (operator decision OD-2 in the PRD). An identity-only participant grant would need a PAN-4293 change and the operator's decision.

GitHub sign-in supplies identity; the lobby and the block list supply authorization. Both are required.

A browser viewer is held to the same rule: its sign-in goes through the account Worker's PKCE flow, which mints a device only for an allowlisted account. A non-allowlisted browser sign-in gets the invite-only page and leaves a pending attempt the operator can allow.

## TURN

`fetchIceServers()` (`src/turn.ts`) posts `{"ttl":3600}` to `https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers` with `Authorization: Bearer $TURN_KEY_API_TOKEN`, times out after 5 seconds, and accepts only `stun:`, `turn:` and `turns:` URLs. Any failure, including missing secrets, gives the requester `error turn_unavailable`; rooms still work over STUN. Credentials go only to the host and admitted viewers.

Facts verified against the Cloudflare docs on 2026-10-02:

- **Pricing:** the first 1,000 GB each month is free, shared between SFU and TURN; after that, $0.05 per GB of egress.
- **Per-allocation limits:** packets drop above roughly 5–10 kpps, 50–100 Mbps, or more than 5 new peer IPs per second. A shared conversation uses a few KB/s.
- **Ports:** STUN 3478/udp; TURN 3478/udp, 443/udp, 3478/tcp, 80/tcp; TURNS 5349/tcp and 443/tcp.
- **TTL:** the docs state no limit; the service uses 3600 seconds.

## What the service can and cannot see

- **Sees:** room membership (GitHub id, login and avatar of the host and participants), the controller's admit, kick, revoke, contributor and handoff decisions, connect and disconnect times, SDP and ICE blobs, and the opaque scope descriptor (a conversation id). For a browser viewer it also sees the sealed session cookie, which holds that browser's device token encrypted with `WEB_SESSION_KEY`.
- **Never sees:** conversation messages, terminal bytes or prompt drafts. Content flows only over DTLS DataChannels opened after admission. Cloudflare TURN may relay those encrypted packets but cannot read them.

`tests/integration/services/share/signaling-privacy.test.ts` checks this on every CI run: it plants a unique string in every kind of content, proves each one arrives over a DataChannel, and fails if any appears in the host or viewer signaling traffic or if any frame carries a type or key outside the protocol table.

## Configuration

| Name | Where | Meaning |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `wrangler.jsonc` `vars` (committed) | `https://share.overdeck.ai`; used for `joinUrl`. Required |
| `TURN_KEY_ID` | secret (`wrangler secret put`) | the Realtime TURN key id. Optional: without it ICE is STUN-only |
| `TURN_KEY_API_TOKEN` | secret | the TURN key's API token. Optional, as above |
| `ROOMS` | Durable Object binding | class `ShareRoom`, migration `v1` (`new_sqlite_classes`) |
| `ACCOUNT` | service binding | `overdeck-account`, entrypoint `AccountRpc` (PAN-4293) |
| `ROOM_CREATE_LIMIT` | rate-limit binding | 10 room creations per 60 s per GitHub id; unbound in tests, which means no limit |
| `ACCOUNT_BASE_URL` | `wrangler.jsonc` `vars` (committed) | `https://account.overdeck.ai`; where browser sign-in sends the visitor (`/auth/start`). Optional: without it web join is off |
| `WEB_SESSION_KEY` | secret | 64 hex characters (32 bytes), the AES-GCM key that seals the web cookies. Optional: without a valid value web join is off |
| `ASSETS` | static assets binding | `./public` with `run_worker_first: true`; serves the built `public/viewer/viewer.js` |
| `anywhere.share_url` | the host's `${OVERDECK_HOME}/config.yaml` (dashboard side, not the Worker) | the share service the dashboard talks to. Default `https://share.overdeck.ai`; `https:`, or `http:` to a loopback host for local development; no query, fragment or credentials |

Local development reads the same names from `services/share/.dev.vars` (gitignored); `.dev.vars.example` holds placeholders. `.dev.vars` overrides the committed `vars`, so for local web join set `PUBLIC_BASE_URL=http://localhost:8787` (the web-join Origin check compares against it), `ACCOUNT_BASE_URL=http://localhost:8788` and a test `WEB_SESSION_KEY`.

## Host side in the dashboard (slice 2, PAN-4473)

The host side lives in the local dashboard server. The browser never talks to the share service and never sees a host token.

**Share record file.** `${OVERDECK_HOME}/shared-sessions.json`, mode 0600, written atomically (temp file, then rename) through `src/lib/sharing/share-record.ts`. It is the host's memory of its rooms:

```json
{
  "version": 1,
  "rooms": {
    "BCDFGHJK": {
      "scopeKind": "conversation",
      "scopeId": "<conversation name>",
      "hostToken": "odh_<64 hex>",
      "joinUrl": "https://share.overdeck.ai/s/BCDFGHJK",
      "createdAt": "2026-11-02T00:00:00.000Z"
    }
  }
}
```

A conversation has at most one share. An entry is removed when the operator ends the share, when the host socket closes with 4004 (room ended), or when the host-socket upgrade answers 404 or 401. A corrupt file is never replaced silently: reads fail with a message naming the file, and deleting it forgets the local shares.

**Share service URL.** `anywhere.share_url` in `${OVERDECK_HOME}/config.yaml` (see the Configuration table), read on every share creation and every end. `src/lib/sharing/share-service.ts` holds the HTTP client: `POST /v1/rooms` with the device token from `account.json`, `DELETE /v1/rooms/:code` with the host token, 10 s timeouts.

**Host socket.** `src/dashboard/server/services/share-host.ts` (`ShareManager`) writes the record, then opens `GET /v1/rooms/:code/host?v=1` with `Authorization: Bearer <hostToken>` and keeps the latest `room` snapshot and the latest `error` frame in memory. It sends a WebSocket protocol ping every 30 s and drops the socket after 75 s without a pong. An unexpected loss reconnects with the record kept (see *Reconnect and restore*); close 4004 removes the record.

**Routes.** All four are behind the dashboard's auth at the default `admin` scope and answer `Cache-Control: no-store`. Short codes are normalized like the Worker (uppercase, spaces and dashes stripped).

| Route | Answers |
| --- | --- |
| `GET /api/shares` | 200 `{ shares: ShareView[] }`, live and stale shares, oldest first; 500 `share_record_unreadable` |
| `POST /api/shares` | body `{ conversationName }`. 201 `ShareView` for a new room; 200 with the existing view when the conversation's share is already live; 400 `invalid_request`; 404 `conversation_not_found` (not a local conversation); 409 for a vault browse copy or a released conversation; 412 `not_signed_in`; 409 `account_rejected` / `account_expired`; 429 `rate_limited`; 500 `account_unreadable` / `share_url_invalid` / `share_record_unreadable`; 502 `share_service_unreachable` / `share_service_error` |
| `POST /api/shares/:code/commands` | body is one share command. 202 `{ ok: true }` once the frame is sent; 400 `invalid_command`; 404 `share_not_found`; 409 `share_not_connected` |
| `DELETE /api/shares/:code` | 204 after `DELETE /v1/rooms/:code` succeeds (404 from the service counts as gone); 404 `share_not_found`; 500 `share_url_invalid`; 502 `share_service_error` with the record kept. A share that is not connected is forgotten locally instead (204) |

A stale record (no host socket, for example on a peer dashboard that does not re-park) is still listed and can still be ended. Creating a share for a conversation whose record is stale ends the old room best-effort and creates a new one.

**Signed out.** Without `${OVERDECK_HOME}/account.json`, `POST /api/shares` answers 412 `{ "error": "not_signed_in", "message": "Sign in with pan account login to share conversations." }`, and the dialog shows a signed-out panel naming `pan account login`.

**Lobby actions.** The conversation's ⋮ menu has **Share this conversation** for conversations that run on this machine. The share dialog shows the join link with **Copy**, the connection state, the lobby panel and **End share**, and polls `GET /api/shares` once a second while open. Each lobby button sends one host frame:

| Button | Who | Host frame |
| --- | --- | --- |
| **Admit** | waiting | `{ "type": "admit", "githubId": N }` |
| **Admit as contributor** | waiting | `{ "type": "admit", "githubId": N, "contributor": true }` (one click, one frame) |
| **Revoke** | waiting or in the room | `{ "type": "revoke", "githubId": N }` |
| **Grant contributor** / **Remove contributor** | in the room | `{ "type": "set-contributor", "githubId": N, "contributor": true / false }` |
| **Kick** | in the room | `{ "type": "kick", "githubId": N }` |
| **Un-revoke** | blocked | `{ "type": "unrevoke", "githubId": N }` |

Reconnect and re-park are described in *Reconnect and restore* below. Content (WebRTC) is described in the next section.

## Host WebRTC hub and content wire format (slice 3, PAN-4474)

Content travels peer-to-peer over WebRTC data channels between the host's dashboard server and each viewer. The share service only relays signaling (SDP and ICE) and never sees content.

**WebRTC stack.** The host uses werift 0.25.1, the pure-TypeScript stack Overdeck Anywhere already ships, so no native addon is added. The slice 3 spike (`src/dashboard/server/sharing/__tests__/werift-spike.slow.test.ts`, opt-in with `VITEST_INCLUDE_SLOW=1`) measured 5.4 to 6.9 MB/s on loopback, delivered 1000 messages in order, and interoperated with headless Chromium on all five channels; the full result is in `.pan/drafts/pan-658.md` under *WebRTC dependency*.

**Peer hub.** `src/dashboard/server/sharing/peer-hub.ts` (`PeerHub`), one per live share, holds one `RTCPeerConnection` per eligible viewer. The host always offers: it creates the five channels below, ordered and reliable, before its offer, and sends the offer and its ICE candidates as `signal` host frames. An inbound offer is ignored. ICE servers come from the share service's `ice-servers` frame; `error turn_unavailable`, or no answer within 5 s, falls back to an empty list (host candidates only). A successful list is cached for 50 minutes and shared by every viewer that starts while the request is in flight.

**Content gate.** The hub keeps its own **host-admitted set**: GitHub ids this host process admitted by sending an `admit` frame. Only the host's own `admit` adds an id; `kick` and `revoke` remove one, and so does a snapshot that no longer lists the id at all. A room snapshot never adds an id. An **eligible viewer** is in the host-admitted set and listed in the latest snapshot as `admitted` and `connected`. Only eligible viewers get a peer connection, a `signal` frame or any content, whatever a snapshot claims. After a dashboard restart, the re-parked host seeds the set once from the first snapshot's admitted participants (slice 8).

**Peer lifetime.** Every snapshot reconciles: an eligible viewer without a peer gets a new offer, and a peer whose viewer is no longer eligible is closed. Kick and revoke close the viewer's peer connection at once. A peer whose connection fails is removed, and the next snapshot that still shows the viewer eligible offers a new one with a fresh history. To ask for a fresh offer (for example after a browser reload), a viewer closes its join socket, waits for that socket's `close` event, and only then opens a new one, so the snapshot flips `connected` false then true. Opening the new socket first does not work: the service replaces the old socket with close 4008 and never marks the viewer disconnected. A dropped host socket keeps established peers; the hub closes only when the share's host entry is dropped (end, close 4004, a 404/401 upgrade, a replaced stale record, or shutdown).

**Channels.** Every peer connection carries the same five labels:

| Channel | Carries |
| --- | --- |
| `control` | The hello exchange and hello errors; slice 5 adds `submit` (viewer → host), `submit-ack` and `draft-sent` (host → viewer), slice 6 the viewer's `terminal-watch`, and slice 7 `identity` and `command-ack` (host → viewer), `command` and `controller-send` (viewer → host). The host reads it with the 64 Ki inbound cap. |
| `conversation` | `history` (the stream's full message list, which replaces what the viewer has), then `append` for a new message, `update` for a changed one, or `unavailable` (`transcript_not_found`, `history_too_large`) |
| `presence` | The roster: the data owner first (`isHost: true`), then every lobby and admitted participant, the host's effective controller (slice 7) and the stream list. Sent when the channel opens and again when a snapshot changes it. The block list and `connected` are never sent. |
| `drafts` | Draft snapshots both ways (slice 5): viewer → host `DraftUpdate { text }`, host → viewer `DraftPayload` |
| `terminal` | A watched viewer's read-only terminal (slice 6), host → viewer only |

**Envelopes.** Every data-channel message is one encoded `SharedEnvelope` `{ v, ch, streamId, seq, t, payload }` or one fragment of one. `v` is 1. `streamId` is the shared conversation's name. `seq` counts per peer connection, per channel and per stream from 1; fragments do not consume one. An encoded envelope longer than `SHARE_MAX_MESSAGE_CHARS` (32,768 characters) is sent as `SharedChunk` fragments `{ v, chunk: { id, index, count }, data }` in order on the same channel. An envelope longer than `SHARE_MAX_ENVELOPE_CHARS` (32 Mi characters) is never sent; a history that large becomes `unavailable history_too_large`. A channel writer waits while the channel's `bufferedAmount` is above 1 MiB, and a peer whose queued content passes 64 Mi characters is closed.

**Hello exchange.** The host sends its hello `{ v: 1, scopeKinds: ['conversation'], scope }` as the first `control` envelope when the channel opens. The viewer answers with its own hello, copying `scope` from the host's. The host sends no conversation or presence content until the viewer's hello negotiates: both sides agree on the lower `v`, each must support the other's scope kind, and the scopes must match. A failed negotiation gets a `control` envelope `{ kind: 'error', code }` (`invalid_hello`, `version_unsupported`, `scope_kind_unsupported`) and nothing else.

**What crosses the wire.** Messages are mapped through `toSharedMessage`, an allow-list of `id`, `role`, `text`, `turnId`, `createdAt`, `completedAt`, `streaming` and `sequence`. The work log, tool calls, thinking, plans, cost and context usage are not shared. `src/dashboard/server/sharing/conversation-bridge.ts` parses the conversation's Claude JSONL once (the full file) and watches it for appends. Only Claude Code conversations stream: a conversation with no Claude session id gets `unavailable transcript_not_found`, and one whose stored session id belongs to another harness gets an empty history that never grows.

**Host socket loss.** A host whose host socket dropped keeps streaming to its established peers, even after the share service ends the room on its 5-minute alarm. A viewer must therefore tear down its peer connection when its own join socket closes with 4004.

**For slice 4.** `@overdeck/contracts` exports the wire format types from `sharing.ts` and the runtime helpers from `sharing-wire.ts` (`toSharedMessage`, `decodeEnvelope`, `encodeSharedMessage`, `SharedChannelReader`, `SeqTracker`, `negotiateHello`). The share Worker imports only `sharing.ts`, which stays type-only. `src/dashboard/server/sharing/__tests__/loopback-viewer.ts` is a werift viewer that tests use as a stand-in for the browser.

## Viewer side in the dashboard (slice 4, PAN-4475)

The viewer is the joiner's own dashboard: its server holds the device token and the join socket, and its browser holds the `RTCPeerConnection`. The browser never sees the device token.

**Join intent is a click.** Opening the join socket shows the joiner's GitHub login and avatar to the host, so it must never happen as a side effect of a navigation. The landing page only navigates to `/#/shared/<code>`; that page shows **Join**, and the click sends a same-origin `POST /api/joins` with the normal CSRF headers. The only cross-origin surface is the read-only probe.

**JoinManager.** `src/dashboard/server/services/share-join.ts` keeps one join per short code in this process. `join(code)` reads `anywhere.share_url` and `account.json` (412 `not_signed_in` without it), then opens `GET /v1/rooms/:code/join?v=1` with `Authorization: Bearer <device token>`. The socket keeps alive like the host socket: a ping every 30 s, terminate after 75 s without a pong. Every status frame, close code and upgrade refusal becomes one `JoinState`:

| Input | State |
| --- | --- |
| `status lobby` / `admitted` (+ `contributor`) / `host-disconnected` / `host-reconnected` | `lobby` / `admitted` / `host-disconnected` / `admitted` |
| close 1000, or any close after **Leave** | `left` |
| close 4003 or 4011 | `revoked` |
| close 4004 / 4008 / 4009 / 4010 / 4013 | `ended` / `replaced` / `is-host` / `kicked` / `full` |
| close after the grace timer | `away` |
| any other close, or 75 s without a pong | `reconnecting` (`connection_lost`) for a seated join, `disconnected` otherwise |
| upgrade 404 / 401 or 403 / other | `ended` / `rejected` / `reconnecting` (`http_<status>`) for a seated join, `disconnected` otherwise |
| socket `error` | `reconnecting` (`unreachable`) for a seated join, `disconnected` otherwise |

`connecting`, `lobby`, `admitted`, `host-disconnected` and `reconnecting` are live. A seated join reconnects on its own; a join that never got a status frame becomes `disconnected` and the page offers **Rejoin**.

**Routes** (`src/dashboard/server/routes/joins.ts`, every answer `Cache-Control: no-store`):

| Method & path | Answers |
| --- | --- |
| `POST /api/joins` `{ code }` (a code or a join URL) | 201 `JoinView`; 200 when that code's join is already live; 400 `invalid_code`; 412 `not_signed_in`; 500 |
| `GET /api/joins/:code` | 200 `JoinView`; 404 `join_not_found` |
| `GET /api/joins/:code/events` | 200 `text/event-stream` with `state`, `signal` and `replaced` events; 404 |
| `POST /api/joins/:code/signal` | 202; 400 `invalid_signal` (an offer, or anything but an answer or candidate); 404; 409 `join_not_admitted` |
| `POST /api/joins/:code/ice-servers` | 200 `{ iceServers }`; 404; 409 `join_not_admitted` |
| `DELETE /api/joins/:code` | 204 after sending `leave`; 404 |
| `GET /api/share-probe` | 200 `{ "overdeck": true, "v": 1 }` |
| `OPTIONS /api/share-probe` | 204 |

Mutations need the dashboard CSRF token; the two `GET /api/joins` routes need a dashboard credential. The signal route rebuilds the body from its known keys, so nothing else reaches the share service.

**Event stream and subscriber.** A join has at most one subscriber: the viewer page's `EventSource`. A new subscriber replaces the old one, which receives `replaced` and is ended, because the host keeps one peer connection per GitHub id and two tabs answering the same offer would break both. A `signal` frame goes to the subscriber, or into a buffer of at most 64 that the next subscriber receives in order; a new socket clears the buffer. A lobby join never emits a `signal` event.

**Restart.** When a subscriber attaches to an `admitted` or `host-disconnected` join that already had a subscriber on the current socket, the manager restarts the socket so the host offers again with a fresh history (a reloaded page needs both). It closes the socket with code 1000 and no `leave` frame (the service would re-lobby a viewer that sends `leave`), and opens the new socket only from the old one's `close` event, or after 5 s with a `terminate()`. This is the order slice 3 requires; the Miniflare test `tests/integration/services/share/join-manager.test.ts` asserts the second offer.

**Grace timer.** A live join with no subscriber for 60 s is closed with a plain close and becomes `away`. An admitted viewer stays admitted on the service; a lobby viewer leaves the lobby. `POST /api/joins` on an `away` join reopens it, and the page does so without asking again.

**ICE servers.** On `status admitted` the manager sends one `ice-servers` frame per socket unless a list younger than 50 minutes is cached. The ice-servers route answers the cached list or waits for the pending request; `error turn_unavailable` or 5 s without an answer gives `[]`.

**Probe.** `GET /api/share-probe` calls no dashboard auth function, because a cross-origin fetch carries no cookie. The remote request gate still admits it only from a loopback peer, and it is deliberately not in `REMOTE_GATE_ALLOWLIST`, so a LAN host cannot learn that Overdeck runs here. `Access-Control-Allow-Origin` is set only when the request's `Origin` equals the origin of `anywhere.share_url`; `OPTIONS` adds `Access-Control-Allow-Methods: GET` and `Access-Control-Allow-Private-Network: true` for that origin only (the older Private Network Access preflight). Chrome's Local Network Access check instead shows the user a permission prompt; the landing page tells them to choose Allow, and its manual link covers a denied prompt or a dashboard on another port.

**Browser peer.** `components/chat/sharing/webrtc-viewer.ts` (`WebRtcViewer`) answers the host's offer: it fetches ICE servers from the viewer server, buffers early remote candidates until the offer is set, sends its own candidates only after the answer, and reads `control`, `conversation` and `presence` with one `SharedChannelReader` each (slice 5 adds `drafts`; slice 6 adds `terminal`). It replies to the host hello after `negotiateHello`, rebuilds every message field by field (never unknown keys; `author` only with a string login and an `https://` avatar since slice 5), and reports notices: a newer host, an unsupported scope kind, a failed hello, an unavailable or too-large transcript, and a `seq` gap (once per peer). A new offer closes the old peer first.

**Route and screens.** `App.tsx` renders `SharedConversationRoute` when the hash matches `#/shared/<code>`, before the deck; a same-tab hash change into it reloads the page. `useSharedJoin` reads the join on mount (minting the dashboard session first), shows **Join** for a new or finished join, resumes an `away` join, and subscribes to a live one. `SharedConversationView` shows one screen per state: the confirmation, the lobby, "Connecting to the host…", the conversation through `MessagesTimeline` with an empty work log, the "Host disconnected — reconnecting…" banner, "Connection to the host was lost." with **Reconnect**, and the terminal screens ("Removed by host", "This share has ended.", and the others). The timeline mounts only when admitted and a history arrived, so a lobby viewer never renders host content.

**Teardown.** Join-socket close 4004 closes the browser peer, because the host may keep streaming after the room ends. `host-disconnected` keeps the peer and shows the banner; `host-reconnected` removes it. Kick, revoke, blocked, replaced, is-host, full, rejected and disconnected close the peer and the event stream. A peer that fails on its own while admitted gets up to three automatic tries (see *Reconnect and restore*), then shows **Reconnect**, which opens a new event stream; the restart rule above makes the host offer again.

## Reconnect and restore (slice 8, PAN-4479)

Inside the share service's 5-minute window, a host network drop, a host dashboard restart or a viewer network drop restores on its own. Admitted viewers get a new offer and a fresh history and never pass through the lobby again.

**Backoff.** Every automatic reconnect waits on `SHARE_RECONNECT_DELAYS_MS` (`share-host.ts`): 1, 2, 4, 8, 15 and 30 s, and 30 s for every attempt after that. There is no attempt limit, because the host cannot tell from its own clock when the service's alarm fires; only the service's answer ends the loop. The host resets the count on a `room` frame, and the viewer server resets it on any `status` frame.

**Host reconnect.** A host-socket close other than 4004 or 4008, a socket `error`, 75 s without a pong, or an upgrade answered with anything but 404 or 401 makes the share `reconnecting`. `ShareManager` keeps the host entry, its peer hub and the record, and opens a new host socket on the backoff. Keeping the hub is safe: nothing can admit a viewer while the host socket is down. The next `room` frame reconciles, so peers that died during the outage get a new offer and live peers are untouched. Every socket listener checks that its socket is still the current one, so late events from an abandoned socket change nothing.

**Terminal answers.** Upgrade 404 or 401 and close 4004 drop the host entry and remove the record. Close 4008 means another host socket holds the room (for example a second dashboard on the same home): the share becomes `disconnected` with `lastError.code` `replaced`, keeps its record, and is not retried.

**End share while offline.** **End share** on a share that is not `connected` forgets it locally when the share service cannot be reached: an invalid `anywhere.share_url` or a failed `DELETE /v1/rooms/:code` drops the host entry, removes the record and answers 204. The room, if it still exists, ends on the service's alarm because no host returns. A `connected` share keeps the 500 and 502 answers and its record.

**Re-park on boot.** `ShareManager.resume()` opens a host socket for every share record this process does not host yet, with that record's host token. `main.ts` calls it once on boot of the primary dashboard (`hostsMachineLinks()`). A peer dashboard on the same `~/.overdeck` never re-parks, because two host sockets for one room replace each other with close 4008. `resume()` reads only the record file and `anywhere.share_url`; it needs no account, never throws, and does not block boot.

**Seeding the content gate.** A new process starts with an empty host-admitted set, and a snapshot never adds an id. So the first `room` frame a re-parked host receives seeds its hub with every participant whose `state` is `admitted`, exactly once, before the hub reconciles. This is safe because the service admits a viewer only on an `admit` frame from the host socket: the snapshot's admitted list is this host's own earlier decisions, kept by the service. A share created or reconnected in the same process is never seeded.

**Viewer server reconnect.** A seated join (one that received at least one `status` frame) whose join socket closes unexpectedly, errors, misses its pong or gets an upgrade answer other than 404, 401 or 403 becomes `reconnecting` with `error` `connection_lost`, `unreachable` or `http_<status>`. `JoinManager` opens a new join socket on the backoff and stays `reconnecting` until the next `status` frame. The service restores an admitted viewer as `admitted` and a lobby viewer to `lobby`. **Leave**, `stop()` and the 60 s grace timer cancel a pending retry; the grace timer turns a join waiting between attempts into `away`. A join that never got a `status` frame becomes `disconnected`, and the page offers **Rejoin**.

**Viewer page.** `reconnecting` is live on the page: **Leave** stays, the browser peer is kept, and the page shows "Reconnecting to the share service…" above the kept timeline, or as a panel when no history arrived yet. The timeline also stays visible while a new host offer negotiates. When the browser peer becomes `lost` while the join is `admitted`, `useSharedJoin` opens a new event stream after 5 s (`PEER_AUTO_RECONNECT_DELAY_MS`) without clearing the messages, at most 3 times in a row (`PEER_AUTO_RECONNECT_MAX`); a `connected` peer resets the count. After the third try the **Reconnect** banner stays. No automatic try runs while the join is `host-disconnected` or `reconnecting`, because the host's own re-offer restores those.

**After the window.** If the host stays away from the share service for more than 5 minutes, the service deletes the room and its short code answers 404. The next reconnect or re-park removes the record, and the share disappears from `GET /api/shares`. Sharing again creates a new link, and everyone joins through the lobby.

The Miniflare tests `tests/integration/services/share/join-manager.test.ts` (a dropped join socket) and `tests/integration/services/share/host-repark.test.ts` (a host restart inside the window, and a room that is gone) cover these paths on real workerd.

## Hosted web join (slice 10, PAN-4481)

A person with only a browser and an allowlisted GitHub account can join from `https://share.overdeck.ai/s/<code>`: sign in with GitHub, come back to the same page, click **Join**, wait in the lobby, and read the live conversation after the host admits them. Content still flows only over the WebRTC data channels between the host's dashboard and the browser; the Worker serves the page, the sign-in and the signaling.

**Sign-in sequence.** The account Worker sends no CORS headers, so the browser cannot redeem a code itself. This Worker is the OAuth client (backend-for-frontend):

1. `GET /auth/signin?code=<CODE>` generates a 32-hex `state` and a 64-hex PKCE verifier, seals them with the code and the issue time into `__Host-ods_signin`, and redirects to the account Worker's `/auth/start` with `redirect_uri=<PUBLIC_BASE_URL>/auth/callback` and `platform=web`.
2. The account Worker accepts that redirect only as an exact match of its `SHARE_BASE_URL` callback, paired with `platform=web` (`docs/ACCOUNT-SERVICE.md`), and runs the usual GitHub leg.
3. `GET /auth/callback?code=odc_…&state=…` checks the state against the sealed cookie (refused after 10 minutes), calls `env.ACCOUNT.redeemWebCode({ code, codeVerifier, redirectUri })` over the service binding, seals the returned `odd_` token into `__Host-ods_session`, and redirects 303 to `/s/<CODE>`.
4. Sign-in never opens the join socket. The page shows **Join**, because opening a join socket reveals the visitor's GitHub identity to the host (join intent is a click, PAN-4475 D-1).

A web sign-in is a device: `platform` `web`, label `Web browser`, one per browser (the `__Host-ods_env` UUID). It appears in the account's device list, and operator revoke and account deletion end it like any other device. **Sign out** (`POST /auth/signout`) revokes it with `revoked_by = 'user'`.

**Cookies.** All three are `__Host-` cookies (`Secure`, `Path=/`, no `Domain`) and `HttpOnly`:

| Cookie | Holds | Attributes |
| --- | --- | --- |
| `__Host-ods_session` | sealed `{v:1, token, iat}`; refused 30 days after `iat` | `SameSite=Strict; Max-Age=2592000` |
| `__Host-ods_signin` | sealed `{v:1, state, verifier, code, iat}` | `SameSite=Lax; Max-Age=600` (it must survive the GitHub → account → share redirect chain) |
| `__Host-ods_env` | the browser's environment id (lowercase UUID v4, not secret) | `SameSite=Lax; Max-Age=34560000` |

**Sealed cookies.** A sealed value is `base64url(iv ‖ AES-GCM ciphertext)` of the JSON payload, with a random 12-byte IV and the 32-byte `WEB_SESSION_KEY` (`src/web-auth.ts`, Web Crypto only). Any decode, decrypt or parse failure reads as no cookie. The device token never reaches page JavaScript or browser storage in usable form, and a stolen cookie is useless outside this Worker.

**The web-join socket.** `GET /v1/rooms/:code/web-join?v=1` needs the session cookie **and** `Origin` equal to `PUBLIC_BASE_URL` (cross-site WebSocket hijacking defence). It never reads `Authorization`, so `/join` stays the only bearer path. After `verifyDevice` it forwards the upgrade to the room's `/join` with the same `X-Share-Identity` header, so every room rule above applies unchanged.

**Keepalive.** A browser cannot send WebSocket protocol pings. The `ShareRoom` object registers a runtime auto-response, so the text frame `ping` gets `pong` without waking the object and never reaches the frame decoder.

**The viewer bundle.** `services/share/web/` holds plain TypeScript and DOM code (no React, no markdown). `scripts/build-web.mjs` bundles `web/main.ts` with esbuild into `public/viewer/viewer.js` (gitignored), aliasing `@overdeck/contracts` to `web/contracts.ts`, which re-exports only `sharing.ts` and `sharing-wire.ts`, so `effect` stays out. The bundle reuses the dashboard's `WebRtcViewer` and must stay at or under 64 KiB. wrangler runs the build as its `build.command`, and the Worker serves the file through the `ASSETS` binding with `run_worker_first`, so it keeps the security headers. `npm run typecheck:share` also checks `web/tsconfig.json`.

**Viewer state rules** (`web/join-socket.ts`, mirroring the viewer server's `share-join.ts`):

- After `status admitted` the viewer requests ICE servers once and caches them for 50 minutes; `error turn_unavailable` or 5 s of silence gives `[]`.
- It sends `ping` every 30 s and treats 75 s without `pong` as a lost connection.
- **Reconnect** runs the restart dance: close the socket with 1000 and no `leave`, and open the new one only from the old one's `close` event (or after 5 s). Opening first gets the old socket replaced with 4008 and the host never re-offers.
- When no offer arrives within 10 s of `status admitted`, the viewer runs that dance once on its own. A second miss shows **Reconnect** instead of looping.
- A socket that fails before `open` hides its HTTP status from the browser, so the viewer re-reads `/v1/web/session`: signed out shows the sign-in screen; signed in shows "Could not reach the share. It may have ended; reload the page to check."
- A **Join** click sets a per-tab `sessionStorage` marker; a reload with that marker and a signed-in session rejoins without a second click. A link cannot set it. Final states remove it.
- **Join** (and a reload rejoin) sets `document.documentElement.dataset.hostedJoin = "started"`, which stops the page's localhost probe from navigating to an installed dashboard.

Message text renders through `textContent` with `white-space: pre-wrap`, never `innerHTML`, and avatars are built from the numeric GitHub id. **The browser viewer is read-only:** it has no composer, no drafts and no terminal. Drafts and contributor submits (slice 5, [PAN-4476](https://github.com/eltmon/overdeck/issues/4476), below) exist only in the dashboard viewer so far.

## Prompt drafts, contributor submits and the queue (slice 5, PAN-4476)

Slice 5 lets viewers take part. Every viewer can type a **draft** that the other participants see live; the host can pick a draft, edit it and send it. A **contributor** (a viewer with `contributor: true` in the room snapshot, set by **Admit as contributor** or `set-contributor`) can also send prompts directly. Every shared prompt, from a contributor or from the host's share dialog, goes through one host-side queue that delivers one prompt per agent turn.

**Drafts.** A viewer sends its whole draft as `DraftUpdate { text }` on `drafts`, at most every 150 ms (`DRAFT_SEND_MS`, trailing). The host's `DraftBoard` (`src/dashboard/server/sharing/draft-board.ts`) keeps one draft per author, last write wins, and an empty text deletes it. The host sets `authorGithubId` and `authorLogin` from its own peer identity and snapshot, never from the payload, and stamps `updatedAt` with its own clock. It relays each change as a `DraftPayload` to every **other** negotiated peer at most once per 200 ms per author (`DRAFT_RELAY_MS`, leading and trailing edge); the author never gets its own draft echoed. A peer whose `drafts` channel and hello are both ready first receives the current drafts minus its own. A viewer who leaves the snapshot's admitted set loses their draft, and the deletion (`text: ''`) is relayed at once. A draft longer than 8,000 characters is ignored. The viewer re-sends its current draft after every new negotiation, so a reconnect restores it.

**Contributor gate.** A `control` `{ kind: 'submit', clientId, text }` counts only from a negotiated peer that is eligible (host-admitted, `admitted` and `connected`) and whose snapshot entry has `contributor: true`; anyone else gets `submit-ack rejected not_contributor`. `clientId` is 1–64 characters of `[A-Za-z0-9_-]`; a repeated id from the same peer while its item is still queued is ignored. When a snapshot shows the grant gone (contributor false or no longer admitted), the host drops that author's queued items and answers each `rejected grant_revoked`; the viewer's composer loses **Send prompt** as soon as its `JoinView.contributor` turns false.

**The queue.** `SubmitQueue` (`src/dashboard/server/sharing/submit-queue.ts`) is one strict-FIFO queue per share. Controller sends from the share dialog use it too, so there is one order and one "N queued" count. It delivers through the conversation message door (`handleConversationMessage`, decoded with `decodeDoorResponse`), the same door scheduled messages use. Turn detection is polled: a timer of `QUEUE_TICK_MS` (1 s), re-armed after each tick, reads the transcript's activity (`summarizeConversationActivity`: `isWorking` and the last message id). The state machine:

1. `idle`: when the agent is not working, deliver the head.
2. `awaiting-start`: wait until a tick reads `working`, or the last message id changed, or `TURN_START_TIMEOUT_MS` (30 s) passed. A fresh prompt is not in the transcript yet, so without this wait the next prompt would land in the same turn.
3. `awaiting-end`: wait until a tick reads `working === false`, then go back to `idle`; the next delivery happens on the following tick.

A conversation with no readable activity (another harness, or no transcript yet) falls back to one delivery per 30 s.

| Door answer | Outcome |
| --- | --- |
| 2xx | `sent`; the queue waits for the turn |
| 409 (`permission-pending`, `input-target-not-main`) | The item stays at the head and is retried every tick, without a cap |
| other 4xx | `rejected delivery_refused` |
| 5xx or a throw | `rejected delivery_unknown`; never re-delivered (at-most-once) |

Limits: 20 items in total (including the one being delivered), 3 queued items per contributor (controller sends count only toward the total), 8,000 characters per prompt (`SHARED_PROMPT_MAX_CHARS`). Inbound `control` and `drafts` messages are reassembled with a 65,536-character cap (`SHARE_MAX_INBOUND_ENVELOPE_CHARS`) instead of the 32 Mi outbound cap, so one viewer cannot make the host buffer megabytes.

**Refused prompts.** `sharedPromptRefusal` (in `sharing-wire.ts`) refuses an empty prompt and a prompt whose first non-whitespace character is `/`, `!` or `#` (`invalid_prompt`), and a prompt over 8,000 characters (`too_long`). The door runs composer commands first (`/compact`, the `/pan` namespace), and Claude Code treats a leading `!` as a shell command and `#` as a memory note; a remote participant must reach none of them. The rule also applies to the host's share-dialog sends. The viewer uses the same helper to disable **Send prompt** early.

**Acks.** A contributor submit is answered on `control` with `submit-ack`: `queued` (with a 1-based `position`), then `sent`, or `rejected` with a reason: `not_contributor`, `invalid_prompt`, `too_long`, `queue_full`, `grant_revoked`, `delivery_refused`, `delivery_unknown`. When the host sends a picked draft, its author gets `control` `{ kind: 'draft-sent' }` and the draft is cleared for everyone.

**Queue status in presence.** Every presence stream carries `agentWorking` and `queued` (the waiting items). Viewers show "Agent is working · N queued", "Agent is working", "N queued" or nothing; the share dialog shows the same line and the queued items. Older viewers ignore the new fields and `control` kinds (`v` stays 1).

**Attribution.** Right before a delivery the hub calls `bridge.expectAuthor(text, author)`. The conversation bridge stamps `SharedMessage.author` (`{ login, avatarUrl }`) on the first appended user message whose trimmed text equals the delivered text, and keeps the stamp in later `history` payloads; viewers show `@login` and the avatar on that message. A rejected delivery cancels the expectation, at most 20 wait at once, and a prompt delivered while no viewer is attached (the bridge is stopped) stays unattributed. If Claude Code stores the prompt with different text, the message has no author; the prompt is never prefixed.

**Host API.** `POST /api/shares/:code/prompts` `{ text, draftGithubId? }` queues a controller send behind the dashboard mutation gate: 202 `{ ok: true, position }`; 400 `invalid_request`, `invalid_prompt` or `too_long`; 404 `share_not_found`; 409 `share_not_live`; 409 `not_controller` while a viewer controls (slice 7); 429 `queue_full`. With `draftGithubId` the draft's author is credited and the draft is taken only after the send is queued; otherwise the data owner is. `GET /api/shares` views carry `drafts` (`ShareDraftView[]`, oldest started first) and `queue` (`ShareQueueView`: `agentWorking`, `delivering`, `items`). The share dialog polls them every second and shows the drafts in a controller-mode `SuggestionList` (**Use**, edit, **Send**).

Drafts and the queue are memory only. A host restart or a share end drops them, and items still queued when the hub closes are dropped.

## Read-only terminal (slice 6, PAN-4477)

Once the peer is connected, the viewer page shows a **Conversation** / **Terminal** toggle (Conversation is the default). **Terminal** shows the host's live terminal for the shared conversation, read-only.

**Watch.** `SharedTerminalView` registers a watch when it mounts and stops it when it unmounts. The viewer sends `{ kind: 'terminal-watch', watch: true }` (or `false`) as a `control` envelope, after its hello reply (that reply is `control` seq 1; the watch takes the next `control` seq, shared with slice 5's `submit`). A new peer, for example after a host re-offer, re-sends `watch: true` after its hello while the view is open. The host acts on a watch only from a peer whose hello negotiated, ignores a non-boolean `watch`, and ignores a repeat of the current value.

**Payloads.** While the watch is on, the host's `terminal` channel carries ordinary envelopes with a `TerminalPayload`: `snapshot { cols, rows, data }` first, then `output { data }` and `size { cols, rows }`. `data` is raw terminal output, escape sequences included, so a large snapshot is fragmented like any envelope. `unavailable { reason }` reports `terminal_not_found` (the conversation has no live terminal, or it ended before a snapshot) or `terminal_ended` (the terminal exited after its snapshot). The viewer rebuilds each payload field by field and drops it unless `cols` and `rows` are integers from 1 to 1000. Turning the watch off and on again starts a fresh stream with a new snapshot.

**Sources.** `src/dashboard/server/sharing/terminal-bridge.ts` (`TerminalBridge`) resolves the conversation's terminal on every watch:

- **Herdr host:** one `herdr terminal session observe` stream per watching viewer, opened without dimensions so frames come at the pane's own size. Each is a Herdr child process, bounded by the room's 50-participant cap. A Herdr viewer does not follow a host resize until it toggles the view off and on.
- **tmux host:** a listener on the session's PTY hub (`pty-hub.ts`, `addHubListener`), through `subscribeToTmuxHub` in `pty-hub-attach.ts`. The listener gets the same coalesced output as the dashboard's `/ws/terminal` tabs, plus every hub resize. When no tab has the session open, the bridge starts a hub at the window's client size (window height plus status lines), so watching never resizes the host window. A hub is torn down only when its last tab and its last listener are both gone. A tab the host opens while a viewer watches joins that hub the way a second tab does, so it gets the viewport snapshot instead of the 500-line history.

**Why it is read-only.** The host subscribes to no inbound message on `terminal`; neither source has a write method (an observe stream cannot write, and a hub listener only receives); the viewer's xterm is created with `disableStdin` and no input handler; and the viewer never sends on `terminal`. The end-to-end spec `src/dashboard/frontend/tests/pan-4477-shared-terminal.spec.ts` types into the viewer's terminal and checks the host pane never receives it.

**Overflow.** The terminal channel uses the same writer rule as the others: a peer whose queued content passes 64 Mi characters is closed, and the viewer sees "Connection to the host was lost." with **Reconnect**.

**Version skew.** The change is additive and the wire version stays 1. An older host ignores `terminal-watch` (it acts only on `hello` and, from slice 5, `submit` on `control`), so its viewer's terminal view stays empty. An older viewer never sends a watch and has no `terminal` listener, so it receives nothing.

## Controller handoff and reclaim (slice 7, PAN-4478)

Slice 7 lets the data owner hand control to an admitted viewer. The **controller** is the one participant whose share commands (admit, kick, revoke, un-revoke, contributor grants, handoff) and prompt sends the host accepts. The data owner starts as controller.

**The appointment.** The host does not take the controller from the share service. The `PeerHub` keeps its own appointment (`ControllerState` in `src/dashboard/server/sharing/controller.ts`): the viewer this host process last made controller with a `set-controller` it sent itself. The **effective controller** is that viewer when the latest room snapshot's `controllerGithubId` names the same viewer, and the data owner otherwise. So a handoff takes effect when the next snapshot confirms it, a reclaim takes effect on the host at once, and a share service that names a controller the host never appointed only produces "the data owner controls". A snapshot that no longer lists the appointed viewer as `admitted` clears the appointment; an admitted controller who goes offline keeps control. The appointment is memory only, so a host restart starts with the data owner in control.

**The gate.** `controlRefusal` decides every share command, from the data owner's browser and from a viewer-controller alike. A command from anyone who is not the effective controller is refused `not_controller`. The one exception is **reclaim**: the data owner's `set-controller` with its own id is always accepted. A `set-controller` target must be the data owner, or a participant listed as `admitted` in the snapshot and admitted by this host. For the data owner, other targets go to the share service unchecked as before; a viewer-controller's targets are checked on the host (`admit` needs a lobby participant, `kick` and `revoke` any listed participant, `set-contributor` an admitted one). **End share** (`DELETE /api/shares/:code`) is never gated. A viewer-controller cannot un-revoke (presence never carries the block list) or end the share; the data owner reclaims first.

**New `control` payloads.**

| Payload | Direction | Fields |
| --- | --- | --- |
| `identity` | host → viewer | `githubId`: the viewer's own id, sent right after its hello negotiates and before any presence |
| `command` | viewer → host | `clientId`, `command`: one of `admit`, `kick`, `revoke`, `set-contributor`, `set-controller` (`SharedControllerCommand`) |
| `controller-send` | viewer → host | `clientId`, `text`, optional `draftGithubId`: a prompt queued as a controller send, credited to the viewer-controller (or to the picked draft's author) |
| `command-ack` | host → viewer | `clientId`, `status` (`accepted` or `rejected`), `position` (with an accepted `controller-send`), `reason` (with `rejected`) |

The host rebuilds each command from its known keys only, relays it through the host socket, and updates its host-admitted set and appointment exactly as for the data owner's own commands. Ack reasons: `not_controller`, `unknown_participant`, `invalid_target` (the viewer named itself), `invalid_command` (malformed, or `unrevoke`), `not_connected` (the host socket cannot send), and the queue's `invalid_prompt`, `too_long` and `queue_full`. The viewer fails a command that gets no ack within 10 s (`COMMAND_ACK_TIMEOUT_MS`) with "The host did not answer.". All four payloads are additive: an older viewer ignores `identity` and `command-ack`, and an older host ignores `command` and `controller-send`, so the viewer's call times out.

**Presence.** Presence `controllerGithubId` is the host's effective controller, never the raw snapshot value. A reclaim, or a viewer handing control back, refreshes presence on every peer at once; a handoff to a viewer shows once the snapshot confirms it.

**Host API.** `POST /api/shares/:code/commands` accepts `{ type: 'set-controller', githubId }`. While a viewer controls, every command except reclaim answers 409 `{ error: 'not_controller', message }`, and a `set-controller` target nobody admitted answers 409 `unknown_participant`. `POST /api/shares/:code/prompts` answers 409 `not_controller` while a viewer controls. `ShareView.controllerGithubId` carries the effective controller.

**UI.** The share dialog's lobby offers **Hand control** on each admitted row while the data owner controls. While a viewer controls it shows "@login has control.", one **Reclaim control** button, no other lobby actions, and read-only suggestions. The viewer-controller's page shows **You have control** with **Hand control back to @owner**, the lobby roster (no Blocked section), a **Send prompt** button and the suggestions in controller mode. Every viewer's header shows "@login has control" while a viewer controls.

## CLI: pan share and pan join (slice 9, PAN-4480)

User docs: [`cli/share.mdx`](../cli/share.mdx). Code: `src/cli/commands/sharing/`, short-code
parsing in the import-free leaf `src/lib/sharing/share-code.ts` (the dashboard routes re-export it).

- **`pan share <conversation>`** resolves a conversation id or name, calls `POST /api/shares` on the
  running dashboard with the internal token (`callDashboard`) and prints the join link, the join
  code (`BCDF-GHJK`) and both join commands. It never starts a dashboard: the host hub needs the
  full `pan up` stack (D-3).
- **`pan join <link-or-code>`** runs in this order: parse the target (`parseJoinTarget`, no network
  or file write on a bad one); sign in with `loginCommand` when `account.json` is missing;
  `ensureLocalDashboard()`; `POST /api/joins { code }`; poll `GET /api/joins/<code>` every 500 ms
  while `connecting`, for at most 15 s; open `<apiUrl>/#/shared/<CODE>` for a live state. A
  terminal state prints a one-line reason and exits 1.
- **Why the CLI may post the join intent (D-5).** The user ran an explicit command, so it keeps
  PAN-4475 D-1. The internal token skips the browser CSRF check. The browser URL carries no token;
  `useSharedJoin` subscribes to the live join without a second click.
- **Auto-start (D-1, D-12, D-14)** is modelled on `pan serve`, not `pan up`: when nothing answers
  `/api/health` (any HTTP answer, even 503, counts as running) on a loopback `http:` API URL with a
  port, it spawns `<packageRoot>/dist/dashboard/server.js` under `process.execPath`, detached, `cwd`
  `OVERDECK_HOME`, logging to `dashboard.log`. Its env drops `DASHBOARD_URL` and
  `OVERDECK_DASHBOARD_URL`, sets `PORT`/`API_PORT`/`OVERDECK_MODE=production`, and goes through
  `applyBootGateEnv(env, { resume: false })`. It waits for health from the spawned PID (120 s) and
  never kills the child. No Herdr, tmux or Traefik is started.
- **npx bin rule (D-2, H-1).** `npx @overdeck/core join <CODE>` works only while every `bin` entry in
  `package.json` points at the same file (`./dist/cli/index.js`). A bin with a different target
  breaks zero-install join with "could not determine executable to run".
- **Cold-start test.** `tests/integration/cli/join-cold-start.slow.test.ts` runs the built CLI's
  `join` in a temp `HOME`/`OVERDECK_HOME` with `tmux`, `herdr` and `pan` shadowed by stubs, a fake
  account service and the share Worker on Miniflare, and asserts a `lobby` join. Run it after
  `npm run build` with `VITEST_INCLUDE_SLOW=1 npx vitest run tests/integration/cli/join-cold-start.slow.test.ts`.

## Local development

```bash
cp services/share/.dev.vars.example services/share/.dev.vars   # optional: TURN key for local ICE
npm --prefix services/share run dev                           # wrangler dev --local
npm run typecheck:share                                       # tsc against @cloudflare/workers-types
npx vitest run tests/unit/services/share/                     # reducer, decoder, codes, TURN, routes (no workerd)
npx vitest run tests/integration/services/share/              # real workerd via Miniflare, account and TURN stubbed
npm --prefix services/share run build:web                     # esbuild → public/viewer/viewer.js (the hosted viewer)
npm --prefix services/share run build:dry                     # wrangler deploy --dry-run --outdir dist (runs build:web first; no credentials)
npx vitest run tests/helpers/share/                           # capture, candidate and harness helpers
npx vitest run tests/integration/services/share/signaling-privacy.test.ts tests/integration/services/share/rate-limit.test.ts
```

A local `ACCOUNT` binding needs PAN-4293's `npm --prefix services/account run dev` running in another terminal; wrangler's local dev registry connects service bindings between local sessions.

Unit tests drive the reducer with an injected clock and `routes.handle()` with injected `Deps`, a fake `ROOMS` namespace and a fake `ACCOUNT`, so the 5-minute window and the 5-second TURN timeout never wait. The integration test bundles the Worker with `wrangler deploy --dry-run`, runs it in Miniflare beside an inline `AccountRpc` stub bound by named entrypoint, stubs `rtc.live.cloudflare.com` through `outboundService`, and drives a room through the lobby, admission, signaling, kick, revoke and deletion over real WebSockets.

Agents may run `wrangler dev --local` and `wrangler deploy --dry-run`; nothing else. Deploying is operator-only.

## Verification

Three tests back the service's security claims (PAN-4482). The first two run in the default vitest run on CI; the third is an operator checkpoint. All three use `startShareWorker` (`tests/helpers/share/share-worker.ts`), which bundles the Worker with `wrangler deploy --dry-run` and runs it in Miniflare beside an account stub.

### Signaling privacy

`tests/integration/services/share/signaling-privacy.test.ts` runs one share end to end on real workerd and real werift: a `ShareManager` with a `PeerHub` on the host side, and two `JoinManager`s with werift `LoopbackViewer`s on the viewer side. A unique canary sits in each kind of content: the conversation history, a live append, the stream label, a viewer draft, a contributor submit, a host controller send, a viewer-controller send, and the terminal snapshot and output. A second viewer stays in the lobby the whole time.

`SignalingCapture` (`tests/helpers/share/signaling-capture.ts`) records every frame and HTTP body both local servers exchange with the service. The test then asserts four things:

1. **Positive control.** Every canary reached its destination over a DataChannel, and the queue delivered the three prompts in order.
2. **No content in signaling.** No canary appears in any captured frame or HTTP body, plain, case-folded or base64-encoded.
3. **Protocol shape.** Every frame's `type` and keys belong to the protocol table above for its socket and direction, `signal.data` holds only `sdp` and `candidate`, the `room` snapshot holds only its seven keys, and no binary frame crossed.
4. **Live path.** The capture saw the SDP offer and answer, ICE candidates in both directions, `room` snapshots, `POST /v1/rooms` and `DELETE /v1/rooms/:code`. The lobby viewer received exactly one frame, `status lobby`, and its socket closed with 4004 when the share ended.

The capture wraps the injected `openSocket`, `createRoom` and `deleteRoom` seams rather than logging TCP bytes. RFC 6455 masks every client-to-server frame with a random key, so a canary sent by a local server never appears in raw bytes, and a byte-level check would pass even if content leaked.

### Room-creation rate limit

`tests/integration/services/share/rate-limit.test.ts` reads the `ROOM_CREATE_LIMIT` entry from the committed `services/share/wrangler.jsonc` and binds it in Miniflare, so a change to the committed limit fails the test. One GitHub id gets `201` ten times, then `429` `rate_limited` with `Retry-After: 60`; another account still gets `201`.

### Forced-relay checkpoint (operator)

`tests/integration/services/share/forced-turn.slow.test.ts` proves the symmetric-NAT case of NFR-7: both peers connect relay-only through Cloudflare Realtime TURN. It forces `iceTransportPolicy: 'relay'` on the host (through `PeerHubDeps.createPeerConnection`) and on the viewer (through `LoopbackViewer`'s configuration, built from `JoinManager.iceServers`). Only the operator runs it:

```bash
TURN_KEY_ID=<key id> TURN_KEY_API_TOKEN=<api token> VITEST_INCLUDE_SLOW=1 \
  npx vitest run tests/integration/services/share/forced-turn.slow.test.ts
```

It needs the same Realtime TURN key as the deployed Worker, and the local Worker makes one real credential request to Cloudflare per run. Without the two env vars it fails with `forced-TURN checkpoint needs TURN_KEY_ID and TURN_KEY_API_TOKEN`; it never skips, and no assertion prints an ICE URL, username or credential. A pass means the conversation history arrived over the DataChannel and every candidate both sides signaled was `typ relay`. Post the result (`PASS`, or the failing assertion) as a comment on PAN-4482.

werift 0.25.1 uses only the first TURN URL in the list, and the test passes the Worker's list unchanged, as production does. If the run fails because the operator's network blocks that first transport, that is a real finding: file an issue to order the hub's TURN URLs (as PAN-4862 did for Anywhere) and re-run the checkpoint after it lands.

## Deploy

Operator-only. **No agent deploys** and no agent runs any of the commands below. The custom-domain route in `wrangler.jsonc` creates the `share.overdeck.ai` DNS record in the Cloudflare zone on first deploy.

0. Confirm the bundle builds with no credentials: `npm --prefix services/share run build:dry` exits 0.
1. Deploy PAN-4293's account Worker first (`docs/ACCOUNT-SERVICE.md`, "Deploy"), with `SHARE_BASE_URL` in its vars. The `ACCOUNT` service binding needs `overdeck-account` with its `AccountRpc` entrypoint, and that entrypoint must return `githubLogin` or room creation answers `account_service_outdated`. It must also have `redeemWebCode` and `signOutDevice` (PAN-4481): a share Worker deployed before them shows browser visitors the "sign-in is unavailable" page.
2. Create a Realtime TURN key in the Cloudflare dashboard (the Realtime section). Note the key id and its API token.
3. `cd services/share && npx wrangler secret put TURN_KEY_ID`, then `npx wrangler secret put TURN_KEY_API_TOKEN`.
   Then generate the web session key with `openssl rand -hex 32` and store it with `npx wrangler secret put WEB_SESSION_KEY`. Rotating it signs every browser out.
4. `npx wrangler deploy` (uploads the Worker, creates the `ShareRoom` Durable Object class from migration `v1`, binds `ACCOUNT` and the rate limiter, and registers `share.overdeck.ai`).
5. Smoke test: `curl -s https://share.overdeck.ai/healthz` shows `"configured":true`, `"turn":true` and `"web":true`.
6. Rollback: `npx wrangler rollback` returns to the previous Worker version.
