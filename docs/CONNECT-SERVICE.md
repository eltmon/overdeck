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
| `src/directory.ts` | Durable Object glue: sockets, SQLite tables, alarm, effects in order persist → register → send → close |
| `src/relay-meter.ts`, `src/turn.ts` | Monthly relay usage; Cloudflare Realtime TURN credentials (600 s TTL) |
| `src/inbox.ts`, `src/inbox-intake.ts`, `src/seal.ts` | Inbox store, the public `POST /h/:id` route, `crypto_box_seal` in pure JS |
| `src/log.ts` | The only logger: frame type, environment id or client id, outcome; never a label, key or payload |

The wire protocol is `packages/contracts/src/connect.ts` (runtime-import-free so the Worker imports it by relative path); the dashboard's `GET /api/directory` view is `packages/contracts/src/connect-view.ts`.

`connect.ts` also carries the phone app's frames (PAN-4823): `ClientToDirectoryFrame`, `DirectoryToClientFrame`, the machine's `push` and the directory's `push-result`, with `CLIENT_LIMIT`, `PUSH_RATE_PER_MINUTE` and `PUSH_SEALED_MAX_CHARS`. The directory serves the client role (PAN-4829, "Phone clients" below). `push`, `push-register` and `push-unregister` stay `bad_frame` until push delivery (PAN-4830).

## Phone clients (PAN-4829)

- **Role.** A socket's first valid hello fixes its role: `hello` makes it a machine, `hello-client` a phone. The decoder then accepts only that role's frames; a cross-role frame is `bad_frame`.
- **Welcome.** `welcome-client` carries the protocol, the plan, `relayAllowed` and the account's machines with their online state.
- **Broadcasts.** Phones receive every `directory` frame machines receive and every `relay-status`, but never approvals or inbox frames. No machine frame ever lists a phone.
- **Signals.** A phone signals an online machine with `purpose: 'link'` only, and the machine sees `from` = the phone's `clientId`. A machine's `link` signal to an online phone arrives with `from` = its environment id. Phone to phone is `bad_frame`; an offline target is `peer_offline`.
- **ICE and relay.** `ice-servers` and `relay-usage` from a phone follow the machine rules and meter the account's relay allowance.
- **Storage.** Phones live in the `clients` table. It also has the nullable `push_platform`, `push_token` and `aps_environment` columns, reserved for PAN-4830 and never written by registration, because `CREATE TABLE IF NOT EXISTS` cannot add columns later.
- **Tags.** Every socket keeps the `machine` tag and the role lives in the socket attachment: tags are fixed at accept time, before the role is known, and renaming the tag would orphan sockets that hibernated before this shipped.

## Endpoints

| Method | Path | Auth | Answer |
| --- | --- | --- | --- |
| GET | `/healthz` | none | `{ ok, configured, turn }` (reveals no value) |
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

## Configuration

| Name | Kind | Purpose |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | var | `https://connect.overdeck.ai`; the base of inbox URLs. Without it every route but `/healthz` answers 503. |
| `STUN_URLS` | var | Comma-separated STUN URLs for `direct` routes (`stun:stun.cloudflare.com:3478`). |
| `TURN_KEY_ID`, `TURN_KEY_API_TOKEN` | secrets | Cloudflare Realtime TURN key. Unset: no relay (`turn_unavailable`), `/healthz` reports `turn: false`. |
| `RELAY_CAP_BYTES` | optional var | Positive integer overriding the 50 GB cap, for staging tests only. |
| `DIRECTORY` | Durable Object binding | `AccountDirectory`, migration `v1` (`new_sqlite_classes`). |
| `ACCOUNT` | service binding | `overdeck-account`, entrypoint `AccountRpc`. |
| `INBOX_LIMIT`, `CONNECT_LIMIT` | rate limits | namespaces `1101` (120 / 60 s) and `1102` (30 / 60 s). |

A machine points at a self-hosted copy with `anywhere.directory_url` in its `config.yaml` (`https:`, or `http:` to a loopback host).

## Local development

```bash
cd services/connect
cp .dev.vars.example .dev.vars        # leave the TURN values empty to run without the relay
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
5. `npx wrangler deploy` (uploads the Worker, creates the `AccountDirectory` Durable Object from migration `v1`, binds `ACCOUNT` and both rate limiters, and registers `connect.overdeck.ai`).
6. Smoke test: `node scripts/anywhere/smoke-hosted.mjs` exits 0 (both Workers' `/healthz`, plus one account device-code start), and on a signed-in machine `pan machines directory` lists it `online` within a minute.
7. Run the two live checks of D-2356-21 on real machines: two machines on different networks without Tailscale link by approval and reach each other over `rtc://`; with UDP blocked on both, a relay-plan account links over `rtc+turn://` and the card shows **Using relay**. To block UDP, run these rules with both `iptables` and `ip6tables`; they drop all UDP except DNS on port 53: `-A OUTPUT -p udp --dport 53 -j ACCEPT`, `-A INPUT -p udp --sport 53 -j ACCEPT`, `-A OUTPUT -p udp -j DROP`, `-A INPUT -p udp -j DROP`. Start the server with `DEBUG=werift*`. When the relay picks the right TURN URL, its `iceOptions` log line shows `turnTransport: 'tls'` and port 443.
8. Rollback: `npx wrangler rollback` returns to the previous Worker version.
