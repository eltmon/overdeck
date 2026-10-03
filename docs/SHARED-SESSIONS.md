# Shared Sessions share service

Source: `services/share/` (licensed under FSL-1.1-MIT, `services/LICENSE.md`) and `packages/contracts/src/sharing.ts` (MIT, like the rest of the repo). Issue: PAN-658 (slice 1 of Shared Sessions v0). Design: `.pan/drafts/pan-658.md` (the PRD).

## What it is

A Cloudflare Worker at `https://share.overdeck.ai` (Worker `overdeck-share`) that lets an Overdeck user give someone a link to a live conversation. It is the **rendezvous and admission service** only: it creates rooms, runs the host-approval lobby, keeps each room's block list and controller, and relays WebRTC signaling (SDP and ICE) between the host's local Overdeck server and each viewer's local Overdeck server. Conversation content never passes through it; content flows peer-to-peer over DTLS DataChannels that open only after the host admits a viewer.

Each room is one `ShareRoom` Durable Object on the SQLite storage backend, addressed by the room's short code. Its WebSockets use the hibernation API. The service also mints short-lived Cloudflare Realtime TURN credentials for peers that cannot connect directly.

It performs no OAuth. Every host and viewer is identified by a PAN-4293 device token (`odd_…`), verified on every request through the `ACCOUNT` service binding to the account Worker's `AccountRpc.verifyDevice`.

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

Every response carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`, and none carries CORS headers. A request body over 16 KiB is 413 `payload_too_large`. An unknown path is 404 `{"error":"not_found"}`; a wrong method is 405 with an `Allow` header. Without `PUBLIC_BASE_URL` every route except `/healthz` is 503 `{"error":"not_configured","missing":["PUBLIC_BASE_URL"]}`.

Short codes are 8 symbols from `BCDFGHJKLMNPQRSTVWXZ23456789` (no vowels, no 0/O/1/I). Codes in paths are uppercased and stripped of spaces and dashes, so `bcdf-ghjk` and `BCDFGHJK` are the same room.

| Method & path | Auth | Responses |
| --- | --- | --- |
| `GET /healthz` | none | 200 `{"ok":true,"configured":<bool>,"turn":<bool>}`; `turn` is true when both TURN secrets are set |
| `POST /v1/rooms` | `Bearer odd_…` | Body `{"scope":{"kind":"conversation","conversationId":"…"}}` (id 1–200 characters, no control characters). 201 `{shortCode, hostToken, joinUrl, snapshot}`; 400 `invalid_request`; 401 `invalid_token` / `device_revoked` / `account_deleted`; 403 `grant_expired`; 429 `rate_limited` with `Retry-After: 60` (10 rooms per minute per GitHub id); 503 `account_unavailable`, `account_service_outdated`, `room_unavailable` or `code_space_exhausted` |
| `DELETE /v1/rooms/:code` | `Bearer odh_…` (host token) | 204; 401 `invalid_token` for a missing or malformed host token; 404 `not_found` for an unknown code, an ended room or a wrong token (no oracle) |
| `GET /v1/rooms/:code/host?v=1` | `Bearer odh_…`, `Upgrade: websocket` | 101; 426 `upgrade_required` without the upgrade header; 400 `unsupported_protocol` when `v` is not `1`; 401 `invalid_token`; 404 `not_found` for an unknown code, an ended room or a wrong token |
| `GET /v1/rooms/:code/join?v=1` | `Bearer odd_…`, `Upgrade: websocket` | 101; 426; 400 `unsupported_protocol`; 401/403/503 as for `POST /v1/rooms`; 404 `not_found` for an unknown code or an ended room. Refusals for a blocked identity, the data owner or a full room arrive **after** the upgrade as close codes |
| `GET /s/:code` | none | 200 HTML invite page with `pan join <CODE>` and a link to install docs; 404 HTML "This share link has ended or does not exist." The page shows no host name, scope or participant count. CSP: `default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'none'; base-uri 'none'` |

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

## TURN

`fetchIceServers()` (`src/turn.ts`) posts `{"ttl":3600}` to `https://rtc.live.cloudflare.com/v1/turn/keys/$TURN_KEY_ID/credentials/generate-ice-servers` with `Authorization: Bearer $TURN_KEY_API_TOKEN`, times out after 5 seconds, and accepts only `stun:`, `turn:` and `turns:` URLs. Any failure, including missing secrets, gives the requester `error turn_unavailable`; rooms still work over STUN. Credentials go only to the host and admitted viewers.

Facts verified against the Cloudflare docs on 2026-10-02:

- **Pricing:** the first 1,000 GB each month is free, shared between SFU and TURN; after that, $0.05 per GB of egress.
- **Per-allocation limits:** packets drop above roughly 5–10 kpps, 50–100 Mbps, or more than 5 new peer IPs per second. A shared conversation uses a few KB/s.
- **Ports:** STUN 3478/udp; TURN 3478/udp, 443/udp, 3478/tcp, 80/tcp; TURNS 5349/tcp and 443/tcp.
- **TTL:** the docs state no limit; the service uses 3600 seconds.

## What the service can and cannot see

- **Sees:** room membership (GitHub id, login and avatar of the host and participants), the controller's admit, kick, revoke, contributor and handoff decisions, connect and disconnect times, SDP and ICE blobs, and the opaque scope descriptor (a conversation id).
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

Local development reads the same names from `services/share/.dev.vars` (gitignored); `.dev.vars.example` holds placeholders.

## Local development

```bash
cp services/share/.dev.vars.example services/share/.dev.vars   # optional: TURN key for local ICE
npm --prefix services/share run dev                           # wrangler dev --local
npm run typecheck:share                                       # tsc against @cloudflare/workers-types
npx vitest run tests/unit/services/share/                     # reducer, decoder, codes, TURN, routes (no workerd)
npx vitest run tests/integration/services/share/              # real workerd via Miniflare, account and TURN stubbed
npm --prefix services/share run build:dry                     # wrangler deploy --dry-run --outdir dist (no credentials)
```

A local `ACCOUNT` binding needs PAN-4293's `npm --prefix services/account run dev` running in another terminal; wrangler's local dev registry connects service bindings between local sessions.

Unit tests drive the reducer with an injected clock and `routes.handle()` with injected `Deps`, a fake `ROOMS` namespace and a fake `ACCOUNT`, so the 5-minute window and the 5-second TURN timeout never wait. The integration test bundles the Worker with `wrangler deploy --dry-run`, runs it in Miniflare beside an inline `AccountRpc` stub bound by named entrypoint, stubs `rtc.live.cloudflare.com` through `outboundService`, and drives a room through the lobby, admission, signaling, kick, revoke and deletion over real WebSockets.

Agents may run `wrangler dev --local` and `wrangler deploy --dry-run`; nothing else. Deploying is operator-only.

## Deploy

Operator-only. **No agent deploys** and no agent runs any of the commands below. The custom-domain route in `wrangler.jsonc` creates the `share.overdeck.ai` DNS record in the Cloudflare zone on first deploy.

0. Confirm the bundle builds with no credentials: `npm --prefix services/share run build:dry` exits 0.
1. Deploy PAN-4293's account Worker first (`docs/ACCOUNT-SERVICE.md`, "Deploy"). The `ACCOUNT` service binding needs `overdeck-account` with its `AccountRpc` entrypoint, and that entrypoint must return `githubLogin` or room creation answers `account_service_outdated`.
2. Create a Realtime TURN key in the Cloudflare dashboard (the Realtime section). Note the key id and its API token.
3. `cd services/share && npx wrangler secret put TURN_KEY_ID`, then `npx wrangler secret put TURN_KEY_API_TOKEN`.
4. `npx wrangler deploy` (uploads the Worker, creates the `ShareRoom` Durable Object class from migration `v1`, binds `ACCOUNT` and the rate limiter, and registers `share.overdeck.ai`).
5. Smoke test: `curl -s https://share.overdeck.ai/healthz` shows `"configured":true` and `"turn":true`.
6. Rollback: `npx wrangler rollback` returns to the previous Worker version.
