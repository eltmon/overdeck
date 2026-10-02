# Dashboard Authentication (PAN-1166, PAN-3762, PAN-2351)

How the Overdeck dashboard authenticates browsers, paired devices, scoped API
tokens and non-browser clients, what the `/ws/*` upgrade gate and the remote request gate
defend, and what they do not. User-facing guide:
[configuration/remote-access.mdx](../configuration/remote-access.mdx).

## Credentials

- **Internal token** — the root secret at `~/.overdeck/internal-token` (mode
  `0600`), read by `getInternalToken()` (`src/lib/internal-token.ts`). Sent as
  the header `x-overdeck-internal-token` or `Authorization: Bearer <token>`.
  Generated once, on first server start, and never rotated automatically.
- **Session cookie** — `overdeck_session`
  (`DASHBOARD_SESSION_COOKIE`, `src/dashboard/server/routes/dashboard-auth.ts`).
  Its value is an HMAC of the internal token (context
  `overdeck-dashboard-session-v1`), so it is *derived*, not random: a dashboard
  restart does not invalidate cookies minted before it. Attributes: `Path=/;
  HttpOnly; SameSite=Strict; Max-Age=2592000` (30 days, rolling), host-only.
- **Device session** (PAN-3762) — a paired device's own `odk_<64 hex>` token,
  sent as the cookie `overdeck_device` (`DASHBOARD_DEVICE_COOKIE`, same
  attributes as `overdeck_session`) or as `Authorization: Bearer odk_…`
  (desktop clients). Revocable one device at a time; see "Device sessions".
- **Access token** (PAN-2351) — a scoped `odk_<64 hex>` token for a sidecar,
  Hermes or a script: a `kind: 'token'` record in the same registry, created
  with `pan token create` or `POST /api/access-tokens`. It authenticates only
  from `Authorization: Bearer odk_…`, carries named scopes (see "Scopes"), and
  is revocable one token at a time.
- **CSRF token** — an HMAC token returned by the session mint and sent back on
  mutating requests as `x-overdeck-csrf-token`. Only checked for mutations
  (`rejectUnsafeDashboardMutationRequest`); WebSocket upgrades never carry it.
  It is one global value; a revoked device's cookie no longer authenticates, so
  the shared CSRF token alone grants nothing.

`resolveDashboardCredential(headers)` (`dashboard-auth.ts`) is THE credential
check. It returns `{ kind: 'internal-token' }`, `{ kind: 'root-session' }`,
`{ kind: 'device', deviceId, scopes }`, `{ kind: 'token', tokenId, scopes }`,
or `null`, in that precedence. The `odk_` value is read from the
`overdeck_device` cookie first, else the Bearer header. A `kind: 'token'`
record authenticates only from the Bearer header: the same plaintext in the
`overdeck_device` cookie resolves to `null` (D-9). A record with no `kind` is
a device. `credentialScopes(credential)` is `['admin']` for the two root
credentials and the record's scopes otherwise.
`hasDashboardAuthHeaders(headers)` is `resolveDashboardCredential(headers) !==
null`. Every gate in this document reuses it — there is no second credential
check anywhere in the server.

## Scopes

Every registry credential (device or token) carries scopes from
`ACCESS_TOKEN_SCOPES` (`src/lib/access-tokens.ts`):

- `admin` satisfies every scope. Root credentials are `admin`.
- `operate` satisfies `tell`.
- `read:events`, `read:state`, `read:conversations` and `tell` are independent
  grants; only `admin` implies them.
- An unknown scope string in the registry file parses but satisfies nothing
  (`scopeSatisfies`), so a hand-edited record fails closed.

Pairing always grants a device `['admin']`; a hand-edited device record with
narrower scopes is honored as narrower. The one table of which scope each route
needs is `ROUTE_SCOPES` in `src/dashboard/server/route-scopes.ts`. Anything it
does not list needs `admin` (D-6):

| Scope | `METHOD path` |
| --- | --- |
| `read:events` | `GET /events/stream`, `GET /events/version` |
| `read:state` | `GET /api/issues`, `GET /api/agents`, `GET /api/agent-directory`, `GET /api/flywheel/status`, `GET /api/pipeline/membership` |
| `read:conversations` | `GET /api/conversations`, `GET /api/conversations/:id`, `GET /api/conversations/:name/messages`, `GET /api/conversations/:name/about` |
| `tell` | `POST /api/agents/:id/message`, `POST /api/agents/:id/tell`, `POST /api/conversations/:name/message` |
| `operate` | WebSocket `/ws/terminal` (`WS_TERMINAL_SCOPE`) |
| `admin` | everything else, including `/ws/rpc`, `/ws/voice`, `/ws/autopreso` |

A `:param` segment matches exactly one non-empty segment; matching is exact and
case-sensitive on the normalized path, so any mismatch needs `admin`. Three
places read the table: the remote request gate, `authorizeDashboardUpgrade`,
and the per-route helper `rejectUnauthorizedDashboardRequest` (and so
`rejectUnsafeDashboardMutationRequest`). The helper covers routes outside the
gate's prefixes, such as `GET /knowledge-viewer/*`.

A registry credential is judged by its scopes, never by its peer (D-7): a
narrow token from `127.0.0.1` still gets 403 on an `admin` route. A credential
without the required scope gets **403**
`{ "error": "insufficient_scope", "missingScope": "<scope>" }` (HTTP) or a 403
upgrade rejection. A missing or invalid credential stays **401**.

Only root credentials may create or revoke access tokens, issue pairing
credentials, or revoke a device other than the caller's own (D-11). A device or
token credential gets 403 on those operations, even with `admin`.

A Bearer-borne access token skips the CSRF check in
`rejectUnsafeDashboardMutationRequest`, and a non-GET request carrying
`Authorization: Bearer odk_…` with no `Origin` and no `Referer` passes origin
validation (FR-9). A browser cannot attach an `Authorization` header to a
cross-site request without a CORS preflight the server does not grant. Device
and root-session requests keep both checks.

## Session mint

`POST /api/dashboard/session` (`routes/dashboard-session.ts`,
`dashboardSessionRouteLayer`) is the only way a browser acquires the session
cookie. It requires a trusted (or absent) `Origin`.

A request that authenticates as an **access token** gets **403** and no
`Set-Cookie` (D-12): token clients send the Bearer header on every request.
This check runs before the loopback check, so peer trust cannot turn a token
into a root session. A request that authenticates as a **device** gets the CSRF
token and a refreshed `overdeck_device` cookie, and never `overdeck_session`
(FR-16): a device must never be upgraded to the unrevocable root session.
Otherwise the mint passes when any of these is true:

- the internal token is present (header, Bearer, or the one-time
  `#overdeck_token` URL-hash bootstrap `pan up`/`pan dev` inject), or
- the request's real TCP peer is a **loopback peer** — `127.0.0.1`/`::1`, an
  IP inside a host-local Docker bridge subnet (`peerIsHostLocalDockerBridge`,
  the case host-local Traefik fronting `overdeck.localhost` hits from), or, in
  a container, inside one of the container's own attached-network subnets
  (`peerIsLocalContainerNetwork`) — or
- the request already carries a valid session cookie or internal token
  (`rejectUnauthorizedDashboardRequest`), so a mint from an already-trusted
  caller just refreshes the cookie's rolling `Max-Age`.

Peer trust reads only the real TCP peer (`request.remoteAddress`), never
`X-Forwarded-For`, which a caller could spoof. With
`dashboard.require_token_mint: true` (see "Remote request gate"), the loopback
bullet no longer applies: only the internal token or an existing credential
mints.

**Two-host mint** — when `VITE_API_URL` puts the API on a different host than
the page (a workspace dev stack, PAN-3711), `ensureDashboardSession()`
(`wsTransport.ts`) mints on both hosts in parallel; the cookie is host-only, so
each host needs its own mint.

## WebSocket gate

`authorizeDashboardUpgrade(headers, method, requiredScope = 'admin')`
(`src/dashboard/server/ws-auth.ts`) is the single chokepoint all four raw
upgrades route through — `/ws/terminal`, `/ws/rpc`, `/ws/voice`,
`/ws/autopreso`. It runs four checks in order:

1. **Origin** (`validateOriginHeaders`) — a *present* `Origin` (or `Referer`)
   must be in `getTrustedOrigins()`, or the upgrade is rejected with **403**.
   An *absent* `Origin` on a GET is allowed through to the next check —
   WebSocket upgrades are GETs, and non-browser clients (a script minting the
   internal token) never send one. Browsers always send `Origin` on upgrades,
   so cross-site WebSocket hijacking is still blocked.
2. **Internal token configured** — if `getInternalToken()` returns nothing,
   the upgrade is rejected with **503** (`dashboard session token not
   configured`) rather than silently trusting an unauthenticated caller.
3. **Credential** (`resolveDashboardCredential`) — the session cookie
   (browsers, attached automatically on same-site upgrades), a device cookie or
   bearer, or the internal token header (non-browser clients). None is a
   **401**.
4. **Scope** — the credential's scopes must satisfy `requiredScope`, or the
   upgrade is rejected with **403** (`Forbidden: missing scope <scope>`).
   `/ws/terminal` passes `operate`; `/ws/rpc` (it carries `terminalWrite` and
   `writeFileAtPath`), `/ws/voice` and `/ws/autopreso` keep `admin`.

On success `authorizeDashboardUpgrade` returns the credential, so the handler
can close a device's or token's socket when it is revoked.

**Peer trust is deliberately NOT consulted here.** A loopback client with no
cookie and no internal token gets 401 on upgrade, even though the same client
could mint a session at `/api/dashboard/session` first. This keeps peer-based
trust confined to one chokepoint — the mint — so the `require_token_mint`
switch (PAN-3762, read from raw `config.yaml`) closes it everywhere at once by
changing the mint alone, without touching four separate upgrade handlers.

Tokens never travel in a URL query parameter (D-10): URLs land in proxy and
access logs. Programmatic WebSocket clients (Node `ws`, Python `websockets`) set
`Authorization: Bearer odk_…`; browsers use the session or device cookie.
`GET /api/environment` reports this gate as `capabilities.terminalAuth: true`
(`WS_UPGRADE_REQUIRES_CREDENTIAL`).

**Heartbeats.** `/ws/rpc` emits a `system.heartbeat` every 15 s and
`/events/stream` sends a `: keepalive` comment every 15 s, so both stay under a
proxy's idle timeout. `/ws/terminal` sends a `\u0000{"type":"ping"}` control frame
every 20 s to clients that connect with `?heartbeat=1`; programmatic Bearer clients
must add that query parameter themselves and answer `{"type":"pong"}`. See the
terminal heartbeat section in [DASHBOARD-ARCHITECTURE.md](DASHBOARD-ARCHITECTURE.md).

Rejected raw upgrades (`/ws/terminal`, `/ws/voice`, `/ws/autopreso`) write a
plain `HTTP/1.1 <status> <message>` response and destroy the socket
(`rejectUpgrade`, `ws-auth.ts`). `/ws/rpc` is Effect-routed and returns a JSON
error response with the same status instead.

The `reauth-*` terminal one-time token (`consumeReauthTerminalToken`,
`ws-terminal.ts`) is an additional check for those sessions only, and runs
*after* `authorizeDashboardUpgrade` — it is unrelated to this gate.

## Device sessions

Registry: `src/lib/access-tokens.ts`, the single door for
`~/.overdeck/access-tokens.json` (mode `0600`, atomic temp-file rename). Each
record is `{ id, name, scopes, tokenHash, createdAt, lastUsedAt, revokedAt?,
kind? }`; `kind: 'device'` marks a paired device and `kind: 'token'` a scoped
access token (PAN-2351). Only the SHA-256 hash of the `odk_` token is stored,
and comparison is constant-time.

- **Verification is synchronous** against an in-memory snapshot, because
  `resolveDashboardCredential` is synchronous. `main.ts` loads the snapshot at
  boot (`refreshAccessTokens()`) and refreshes it every 5 s
  (`startAccessTokenRefresh()`). In-process create and revoke update it at once,
  so a revocation written by another process (the CLI) is honored within 5 s.
- **Fails closed**: a corrupt or unreadable file means zero valid tokens, plus
  an error naming the file. It is never parsed permissively.
- `lastUsedAt` writes are throttled to one per record per minute.

Routes (`routes/pairing.ts`): `GET /api/devices` lists devices (never the
hash). `DELETE /api/devices/:id` revokes one; a device may revoke only itself,
an access token may revoke none (403), and the internal token and root session
may revoke any.

Access-token routes (`routes/access-tokens.ts`): `GET /api/access-tokens`
lists `kind: 'token'` records (never the hash). `POST /api/access-tokens`
takes `{ name, scopes }` and returns `{ token, record }`, the only time the
plaintext is shown. `DELETE /api/access-tokens/:id` revokes one and closes its
live connections; a device id there is 404. Create and revoke accept root
credentials only. `pan token create|list|revoke` (`src/cli/commands/token.ts`)
wraps them: create and list use the registry directly, and revoke calls the
DELETE route, writing the registry only when the dashboard is unreachable
(D-14).

**Revocation closes live connections** (`src/dashboard/server/device-connections.ts`).
Each connection opened by a device or token registers a close callback under
its record id (`revocableCredentialId`), and `DELETE /api/devices/:id` and
`DELETE /api/access-tokens/:id` call `closeDeviceConnections(id)` right after
revoking:

- `/ws/terminal`, `/ws/voice`, `/ws/autopreso` close with code `4401`, reason
  `device revoked` (`trackDeviceSocket`, `ws-auth.ts`).
- `/ws/rpc` runs inside Effect's RPC server, which owns the socket: revocation
  interrupts the handler, and Effect's release closes the socket without a
  close code. The client's reconnect then gets 401.
- `/events/stream` ends through `Stream.interruptWhen`
  (`endStreamOnDeviceRevocation`).

## Pairing

`pan pair` (`src/cli/commands/pair.ts`) calls `POST /api/pairing/credentials`
with the internal token. That route accepts only the internal token or the root
session (plus CSRF for the cookie); a device or an access token gets **403**,
so neither can mint more devices (D-11). It returns an `odp_<64 hex>` credential
(`src/dashboard/server/pairing-credentials.ts`) that:

- is held only in the dashboard's memory, as a SHA-256 hash;
- is single use and expires 10 minutes after issue;
- is lost on a dashboard restart;
- travels only in the URL fragment: `<base>/#pair=<credential>`.

`POST /api/pairing/exchange` is unauthenticated. It checks `Origin` (a present,
untrusted one is **403**), then trades the credential for
`createAccessToken({ kind: 'device' })`. With `delivery: 'cookie'` it sets
`overdeck_device`; with `'bearer'` it returns the token in the body. Expired is
**410**, unknown or reused is **401**, and after 10 failures within 60 s every
exchange is **429** for 60 s (process-wide). Both pairing responses are
`Cache-Control: no-store` and never contain the internal token. In the browser,
`ensureDashboardSession()` (`wsTransport.ts`) strips `#pair=` from the address
bar before any request, runs the exchange, then the normal session mint. A
refused exchange throws `DashboardPairingError`; it never falls back to the
root bootstrap.

## Anywhere routes (PAN-4445)

`routes/anywhere.ts` serves the dashboard's Settings → Anywhere screens. The
pair dialog and Devices panel call the same pairing and device routes as
`pan pair` and `pan devices`.

**`POST /api/anywhere/trusted-origins`** takes `{ origin }` and saves it to
`~/.overdeck/trusted-origins.json` (`{ version: 1, origins }`, written through
a temp file and rename by `addSavedTrustedOrigin()` in
`src/lib/remote-access/trusted-origins.ts`). It answers `200 { origin, added }`,
where `origin` is normalized to `scheme://host[:port]` and `added` is false when
the origin was already trusted.

- Only the **root session** may call it. The internal token (the CLI and every
  pipeline agent), a paired device and a scoped token get **403** (D-5):
  widening origin trust widens the dashboard's attack surface, so it stays
  with the operator's browser on this machine.
- A missing, invalid, non-http(s) or loopback origin is **400**. Loopback
  origins are already trusted for this port and never help another device.
- A saved file that is unreadable or invalid is **500** naming the file; it is
  never overwritten.
- Nothing is written in any refused case.

Saved origins merge into `getTrustedOrigins()` (`routes/origin-validation.ts`)
in **every** launch mode, outside the bare-launch `config.yaml` fallback, so a
Traefik or `OVERDECK_TRUSTED_ORIGINS` launch trusts them too. The route calls
`invalidateTrustedOriginsCache()` after an add, so the next request and the
next WebSocket upgrade from that origin pass with no restart. The file is read
only when the cache fills (`readSavedTrustedOriginsSync()`), never per request.

**`GET /api/anywhere/status`** needs any dashboard credential and returns
`{ machine, addresses, devices, vault, problems, viewer }` with
`Cache-Control: no-store` (`src/lib/remote-access/anywhere-status.ts`).
`addresses` are the trusted origins, each flagged `loopback` by
`isLoopbackOrigin()` (`src/lib/remote-access/loopback.ts`, the one loopback
check, which `pan pair` re-exports as `isLoopbackBase`). `devices.active`
counts unrevoked device records. `problems` are computed on the server, each
with an `action` (`pair-dialog`, `settings-section`, or `none` with an optional
`docsUrl`) that the UI maps to a button. `viewer.kind` is the caller's
credential kind from `resolveDashboardCredential()` (`root-session`, `device`,
`token`, `internal-token`, or `null`); the Continue on another device dialog
offers **Also pair the device** only to the `root-session` (PAN-4455 D-3).

**`POST /api/vault/sessions/by-conversation/:name/settle`** (PAN-4455, Hand off
now, in `routes/vault.ts`) follows the setup, join and sync rule: only the
**root session** or a **paired device** may call it, the internal token and
scoped tokens get **403** without the service running, and every response is
`Cache-Control: no-store`. A device also needs the `admin` scope, which
`route-scopes.ts` already requires for routes it does not list. A conversation
name longer than 100 characters never matches the route.

## Remote request gate

The server binds `0.0.0.0`, and many routes check only `Origin`.
`src/dashboard/server/remote-request-gate.ts` is one global `HttpRouter`
middleware, merged into `makeRoutesLayer`, that decides whether a request may
reach any route at all:

1. The path is not under `/api/` or `/events/` (the static SPA): pass.
2. `METHOD path` is on `REMOTE_GATE_ALLOWLIST`: pass. The list is
   `GET /api/health`, `GET /api/environment`, `OPTIONS` and
   `POST /api/dashboard/session`, `POST /api/pairing/exchange`, and
   `POST /api/webhooks/github` (HMAC-verified by its route).
3. `resolveDashboardCredential` returns a credential: pass when its scopes
   satisfy the route-scope table (see "Scopes"), else **403**
   `insufficient_scope`. This rule never falls back to peer trust. `GET
   /events/stream` also accepts its own `OVERDECK_EVENTS_TOKEN` bearer when that
   variable is set, so remote SSE consumers keep working.
4. The request is a trusted local caller (`isLoopbackPeer`, the same peer check
   as the mint): pass. With `require_token_mint`, a loopback peer that carries
   `X-Forwarded-For`, `X-Forwarded-Host` or `Forwarded` counts as remote.
5. Otherwise: **401** `{ "error": "unauthorized" }`.

The gate normalizes the path before deciding (query, absolute-form target,
percent escapes, repeated slashes, dot segments, case), because the router
matches `//api/x` to `/api/x`. Routes keep their own checks (Origin, CSRF,
internal-token-only routes); the gate adds a floor, it does not replace them.

`dashboard.require_token_mint` (boolean, default `false`) is read from raw
`~/.overdeck/config.yaml` by `src/lib/remote-access/config.ts` and cached until
a Settings save calls `invalidateRemoteAccessConfig()`, so the Settings toggle
(Access Tokens section) applies at once; a hand edit needs a restart.
`GET /api/settings` reports the enforced value.

## Threat model

**Defends:**
- LAN clients that can reach the dashboard's `0.0.0.0` API port. Before this
  gate, a GET upgrade with no `Origin` header passed origin validation
  outright, so any machine on the LAN got a live PTY on `/ws/terminal` by
  omitting the header — no browser, no credential.
- Non-browser clients that forge an `Origin` header the server would
  otherwise trust; the credential check still runs after origin validation.
- LAN clients calling `/api/*` or `/events/*` routes that check only
  `Origin`: the remote request gate answers them **401** unless they carry a
  credential (PAN-3762).
- A lost or stolen paired device: revoking it ends its HTTP access and its
  open connections at once, and the root internal token was never on it.
- A leaked access token: it reaches only the routes its scopes name, can never
  mint a session, a pairing credential or another token, and revoking it ends
  its access and open connections at once.

**Does NOT defend:**
- Any process running on this machine. It can mint a session as a loopback
  peer with zero credentials, then use that cookie on every upgrade — this
  gate closes the LAN hole, not the local-machine trust boundary.
- LAN clients reaching the dashboard through Traefik with a forged `Host`
  header, because the shipped Traefik template publishes ports 80/443/8080 on
  all interfaces (`sync-sources/templates/traefik/docker-compose.yml`), not
  `127.0.0.1` — tracked as [PAN-4299](https://github.com/eltmon/overdeck/issues/4299).
- Exposure through a local reverse proxy or tunnel while
  `dashboard.require_token_mint` is `false` (the default): the proxy connects
  from loopback, so every visitor is a trusted local caller. Turn the switch on
  whenever a proxy forwards outside traffic.

## Troubleshooting

The dashboard shows a destructive **"Dashboard session could not be
established (HTTP 401)"** banner (`data-phase="unauthorized"`) when
`ensureDashboardSession()` gets a 401 from any mint host — with the two-host
mint (PAN-3711), a 401 from either host is a failure (D-4), since a socket on
that host would otherwise fail regardless of the other host's mint. Two
distinct causes produce different symptoms:

- **Missing trusted-origin configuration** (`OVERDECK_TRAEFIK_*` /
  `OVERDECK_TRUSTED_ORIGINS` not set for this launch) — the *mint itself*
  403s on origin, which the frontend does not distinguish from an unreachable
  server, so it surfaces as `unreachable`/`delayed`, not `unauthorized`. Fix:
  correct the trusted-origin env for this launch path, or add the address
  from Settings → Anywhere (`~/.overdeck/trusted-origins.json`).
- **Non-loopback peer with no credential** — the mint's origin check passes
  but neither the internal token nor an existing session is present and the
  peer is not loopback/Docker-bridge/in-container, so the mint itself 401s →
  `unauthorized`. Fix: open the dashboard through `pan up` (its `#overdeck_token`
  hash bootstrap mints once with the internal token) or from a browser
  actually running on this machine.

## 2026-05 post-mortem

The PAN-457 cookie/session gate was removed from `/ws/terminal` and `/ws/rpc`
in 2026-05 (the `// Hotfix for #1166` comments this issue's work items
delete) because it broke every Traefik (`overdeck.localhost`) terminal. Three
root causes, two already fixed on `main` before this issue started:

1. The mint required the one-time `#overdeck_token` URL-hash token that only
   `pan up` injects, so any tab that was not freshly bootstrapped by `pan up`
   could never mint. **Fixed**: loopback and Docker-bridge peers now
   auto-mint with zero steps (`isLoopbackPeer`).
2. The session token was random per boot, so a dashboard restart invalidated
   every open tab's cookie. **Fixed**: the token is HMAC-derived from the
   persisted internal token, so it survives restarts
   (`dashboard-auth.test.ts`, "keeps a previously-minted session cookie valid
   across a restart").
3. The frontend silently swallowed a mint 401 (`if (response.status === 401)
   return null`), so a failed mint looked like an ordinary connection issue
   and nobody diagnosed it as an auth failure. **Fixed by this issue**:
   `ensureDashboardSession()` now throws `DashboardSessionUnauthorizedError`
   on a 401, and the dashboard shows the `unauthorized` phase loudly instead
   of failing silently.
