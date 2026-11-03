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
| 8 | [PAN-4479](https://github.com/eltmon/overdeck/issues/4479) | Host reconnect and viewer auto-restore on the host side |
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
| `GET /s/:code` | none | 200 HTML invite page that finds Overdeck on this computer (PAN-4475): one nonce'd inline script probes `GET /api/share-probe` on `http://localhost:3011` and `http://127.0.0.1:3011` (1.5 s each, `credentials: 'omit'`) and navigates to `<origin>/#/shared/<CODE>` when one answers. The page always shows a manual **Open it in Overdeck on this computer** link, `pan up` instructions, a hint to allow Chrome's local-network prompt, and a link to install docs. Its CSP adds a fresh 16-byte nonce per response: `default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-…'; connect-src http://localhost:3011 http://127.0.0.1:3011; frame-ancestors 'none'; base-uri 'none'; form-action 'none'`. Slice 9 ([PAN-4480](https://github.com/eltmon/overdeck/issues/4480)) adds `pan join` back. 404 HTML "This share link has ended or does not exist.", with no script and CSP `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'`. Neither page shows a host name, scope or participant count. **With web join configured (PAN-4481):** `<body data-short-code="<CODE>">`, the content above inside `<section id="local-join">`, then a hidden `<section id="web-join">` that the viewer bundle fills, the probe script, and `<script src="/viewer/viewer.js" defer>`. The CSP becomes `default-src 'none'; style-src 'unsafe-inline'; script-src 'self' 'nonce-…'; connect-src 'self' wss://<share host> http://localhost:3011 http://127.0.0.1:3011; img-src https://avatars.githubusercontent.com; frame-ancestors 'none'; base-uri 'none'; form-action 'self'`, and `Referrer-Policy` is `same-origin` instead of `no-referrer` (under `no-referrer` a same-origin form POST carries `Origin: null`, which would fail the **Sign out** Origin check). In both modes the probe navigates only when `document.documentElement.dataset.hostedJoin` is not `"started"`. |
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

**Host socket.** `src/dashboard/server/services/share-host.ts` (`ShareManager`) writes the record, then opens `GET /v1/rooms/:code/host?v=1` with `Authorization: Bearer <hostToken>` and keeps the latest `room` snapshot and the latest `error` frame in memory. It sends a WebSocket protocol ping every 30 s and drops the socket after 75 s without a pong. Any close other than 4004 leaves the share `disconnected` with its record kept.

**Routes.** All four are behind the dashboard's auth at the default `admin` scope and answer `Cache-Control: no-store`. Short codes are normalized like the Worker (uppercase, spaces and dashes stripped).

| Route | Answers |
| --- | --- |
| `GET /api/shares` | 200 `{ shares: ShareView[] }`, live and stale shares, oldest first; 500 `share_record_unreadable` |
| `POST /api/shares` | body `{ conversationName }`. 201 `ShareView` for a new room; 200 with the existing view when the conversation's share is already live; 400 `invalid_request`; 404 `conversation_not_found` (not a local conversation); 409 for a vault browse copy or a released conversation; 412 `not_signed_in`; 409 `account_rejected` / `account_expired`; 429 `rate_limited`; 500 `account_unreadable` / `share_url_invalid` / `share_record_unreadable`; 502 `share_service_unreachable` / `share_service_error` |
| `POST /api/shares/:code/commands` | body is one share command. 202 `{ ok: true }` once the frame is sent; 400 `invalid_command`; 404 `share_not_found`; 409 `share_not_connected` |
| `DELETE /api/shares/:code` | 204 after `DELETE /v1/rooms/:code` succeeds (404 from the service counts as gone); 404 `share_not_found`; 500 `share_url_invalid`; 502 `share_service_error` with the record kept |

A stale record (no host socket, for example after a dashboard restart) is still listed and can still be ended. Creating a share for a conversation whose record is stale ends the old room best-effort and creates a new one.

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

**Not done yet.** The host socket is not reconnected after a network drop and not re-parked after a dashboard restart: that is slice 8 ([PAN-4479](https://github.com/eltmon/overdeck/issues/4479)), which reads the same record file. Content (WebRTC) is described in the next section.

## Host WebRTC hub and content wire format (slice 3, PAN-4474)

Content travels peer-to-peer over WebRTC data channels between the host's dashboard server and each viewer. The share service only relays signaling (SDP and ICE) and never sees content.

**WebRTC stack.** The host uses werift 0.25.1, the pure-TypeScript stack Overdeck Anywhere already ships, so no native addon is added. The slice 3 spike (`src/dashboard/server/sharing/__tests__/werift-spike.slow.test.ts`, opt-in with `VITEST_INCLUDE_SLOW=1`) measured 5.4 to 6.9 MB/s on loopback, delivered 1000 messages in order, and interoperated with headless Chromium on all five channels; the full result is in `.pan/drafts/pan-658.md` under *WebRTC dependency*.

**Peer hub.** `src/dashboard/server/sharing/peer-hub.ts` (`PeerHub`), one per live share, holds one `RTCPeerConnection` per eligible viewer. The host always offers: it creates the five channels below, ordered and reliable, before its offer, and sends the offer and its ICE candidates as `signal` host frames. An inbound offer is ignored. ICE servers come from the share service's `ice-servers` frame; `error turn_unavailable`, or no answer within 5 s, falls back to an empty list (host candidates only). A successful list is cached for 50 minutes and shared by every viewer that starts while the request is in flight.

**Content gate.** The hub keeps its own **host-admitted set**: GitHub ids this host process admitted by sending an `admit` frame. Only the host's own `admit` adds an id; `kick` and `revoke` remove one, and so does a snapshot that no longer lists the id at all. A room snapshot never adds an id. An **eligible viewer** is in the host-admitted set and listed in the latest snapshot as `admitted` and `connected`. Only eligible viewers get a peer connection, a `signal` frame or any content, whatever a snapshot claims.

**Peer lifetime.** Every snapshot reconciles: an eligible viewer without a peer gets a new offer, and a peer whose viewer is no longer eligible is closed. Kick and revoke close the viewer's peer connection at once. A peer whose connection fails is removed, and the next snapshot that still shows the viewer eligible offers a new one with a fresh history. To ask for a fresh offer (for example after a browser reload), a viewer closes its join socket, waits for that socket's `close` event, and only then opens a new one, so the snapshot flips `connected` false then true. Opening the new socket first does not work: the service replaces the old socket with close 4008 and never marks the viewer disconnected. A dropped host socket keeps established peers; the hub closes only when the share's host entry is dropped (end, close 4004, a 404/401 upgrade, a replaced stale record, or shutdown).

**Channels.** Every peer connection carries the same five labels:

| Channel | Carries in slice 3 |
| --- | --- |
| `control` | The hello exchange and hello errors. The only channel the host reads. |
| `conversation` | `history` (the stream's full message list, which replaces what the viewer has), then `append` for a new message, `update` for a changed one, or `unavailable` (`transcript_not_found`, `history_too_large`) |
| `presence` | The roster: the data owner first (`isHost: true`), then every lobby and admitted participant, the controller and the stream list. Sent when the channel opens and again when a snapshot changes it. The block list and `connected` are never sent. |
| `drafts` | Nothing yet (slice 5) |
| `terminal` | Nothing yet (slice 6) |

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
| any other close, or 75 s without a pong | `disconnected` (`connection_lost`) |
| upgrade 404 / 401 or 403 / other | `ended` / `rejected` / `disconnected` (`http_<status>`) |
| socket `error` | `disconnected` (`unreachable`) |

`connecting`, `lobby`, `admitted` and `host-disconnected` are live. An unexpected close is never reconnected here: the page offers **Rejoin**, and the service restores an admitted viewer without the lobby. Automatic restore is slice 8 ([PAN-4479](https://github.com/eltmon/overdeck/issues/4479)).

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

**Browser peer.** `components/chat/sharing/webrtc-viewer.ts` (`WebRtcViewer`) answers the host's offer: it fetches ICE servers from the viewer server, buffers early remote candidates until the offer is set, sends its own candidates only after the answer, and reads `control`, `conversation` and `presence` with one `SharedChannelReader` each (`drafts` and `terminal` get no listener yet). It replies to the host hello after `negotiateHello`, rebuilds every message field by field (never `author` or unknown keys), and reports notices: a newer host, an unsupported scope kind, a failed hello, an unavailable or too-large transcript, and a `seq` gap (once per peer). A new offer closes the old peer first.

**Route and screens.** `App.tsx` renders `SharedConversationRoute` when the hash matches `#/shared/<code>`, before the deck; a same-tab hash change into it reloads the page. `useSharedJoin` reads the join on mount (minting the dashboard session first), shows **Join** for a new or finished join, resumes an `away` join, and subscribes to a live one. `SharedConversationView` shows one screen per state: the confirmation, the lobby, "Connecting to the host…", the conversation through `MessagesTimeline` with an empty work log, the "Host disconnected — reconnecting…" banner, "Connection to the host was lost." with **Reconnect**, and the terminal screens ("Removed by host", "This share has ended.", and the others). The timeline mounts only when admitted and a history arrived, so a lobby viewer never renders host content.

**Teardown.** Join-socket close 4004 closes the browser peer, because the host may keep streaming after the room ends. `host-disconnected` keeps the peer and shows the banner; `host-reconnected` removes it. Kick, revoke, blocked, replaced, is-host, full, rejected and disconnected close the peer and the event stream. A peer that fails on its own shows **Reconnect**, which opens a new event stream; the restart rule above makes the host offer again.

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

Message text renders through `textContent` with `white-space: pre-wrap`, never `innerHTML`, and avatars are built from the numeric GitHub id. **The browser viewer is read-only in this slice:** there is no composer, no drafts and no terminal; slice 5 ([PAN-4476](https://github.com/eltmon/overdeck/issues/4476)) adds the composer to both viewers.

## Local development

```bash
cp services/share/.dev.vars.example services/share/.dev.vars   # optional: TURN key for local ICE
npm --prefix services/share run dev                           # wrangler dev --local
npm run typecheck:share                                       # tsc against @cloudflare/workers-types
npx vitest run tests/unit/services/share/                     # reducer, decoder, codes, TURN, routes (no workerd)
npx vitest run tests/integration/services/share/              # real workerd via Miniflare, account and TURN stubbed
npm --prefix services/share run build:web                     # esbuild → public/viewer/viewer.js (the hosted viewer)
npm --prefix services/share run build:dry                     # wrangler deploy --dry-run --outdir dist (runs build:web first; no credentials)
```

A local `ACCOUNT` binding needs PAN-4293's `npm --prefix services/account run dev` running in another terminal; wrangler's local dev registry connects service bindings between local sessions.

Unit tests drive the reducer with an injected clock and `routes.handle()` with injected `Deps`, a fake `ROOMS` namespace and a fake `ACCOUNT`, so the 5-minute window and the 5-second TURN timeout never wait. The integration test bundles the Worker with `wrangler deploy --dry-run`, runs it in Miniflare beside an inline `AccountRpc` stub bound by named entrypoint, stubs `rtc.live.cloudflare.com` through `outboundService`, and drives a room through the lobby, admission, signaling, kick, revoke and deletion over real WebSockets.

Agents may run `wrangler dev --local` and `wrangler deploy --dry-run`; nothing else. Deploying is operator-only.

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
