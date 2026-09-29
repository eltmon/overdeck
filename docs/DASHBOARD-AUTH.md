# Dashboard Authentication (PAN-1166, PAN-3762)

How the Overdeck dashboard authenticates browsers, paired devices and
non-browser clients, what the `/ws/*` upgrade gate and the remote request gate
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
- **CSRF token** — an HMAC token returned by the session mint and sent back on
  mutating requests as `x-overdeck-csrf-token`. Only checked for mutations
  (`rejectUnsafeDashboardMutationRequest`); WebSocket upgrades never carry it.
  It is one global value; a revoked device's cookie no longer authenticates, so
  the shared CSRF token alone grants nothing.

`resolveDashboardCredential(headers)` (`dashboard-auth.ts`) is THE credential
check. It returns `{ kind: 'internal-token' }`, `{ kind: 'root-session' }`,
`{ kind: 'device', deviceId }`, or `null`, in that precedence.
`hasDashboardAuthHeaders(headers)` is `resolveDashboardCredential(headers) !==
null`. Every gate in this document reuses it — there is no second credential
check anywhere in the server.

## Session mint

`POST /api/dashboard/session` (`routes/dashboard-session.ts`,
`dashboardSessionRouteLayer`) is the only way a browser acquires the session
cookie. It requires a trusted (or absent) `Origin`.

A request that authenticates as a **device** gets the CSRF token and a
refreshed `overdeck_device` cookie, and never `overdeck_session` (FR-16): a
device must never be upgraded to the unrevocable root session. Otherwise the
mint passes when any of these is true:

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

`authorizeDashboardUpgrade(headers, method)` (`src/dashboard/server/ws-auth.ts`)
is the single chokepoint all four raw upgrades route through — `/ws/terminal`,
`/ws/rpc`, `/ws/voice`, `/ws/autopreso`. It runs three checks in order:

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
   **401**. On success `authorizeDashboardUpgrade` returns the credential, so
   the handler can close a device's socket when it is revoked.

**Peer trust is deliberately NOT consulted here.** A loopback client with no
cookie and no internal token gets 401 on upgrade, even though the same client
could mint a session at `/api/dashboard/session` first. This keeps peer-based
trust confined to one chokepoint — the mint — so the `require_token_mint`
switch (PAN-3762, read from raw `config.yaml`) closes it everywhere at once by
changing the mint alone, without touching four separate upgrade handlers.

`// PAN-2351 adds scoped access tokens (?token=) here.` marks where a future
`?token=` scoped-access check slots into `authorizeDashboardUpgrade` — no
scoped tokens exist yet (PAN-2351 is open). `GET /api/environment` reports this
gate as `capabilities.terminalAuth: true` (`WS_UPGRADE_REQUIRES_CREDENTIAL`).

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
kind? }`; `kind: 'device'` marks a paired device. Only the SHA-256 hash of the
`odk_` token is stored, and comparison is constant-time. PAN-2351 builds scoped
API tokens (`kind: 'token'`) on the same registry.

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
while the internal token and root session may revoke any.

**Revocation closes live connections** (`src/dashboard/server/device-connections.ts`).
Each device-authenticated connection registers a close callback under its
device id, and `DELETE /api/devices/:id` calls `closeDeviceConnections(id)`
right after revoking:

- `/ws/terminal`, `/ws/voice`, `/ws/autopreso` close with code `4401`, reason
  `device revoked` (`trackDeviceSocket`, `ws-auth.ts`).
- `/ws/rpc` runs inside Effect's RPC server, which owns the socket: revocation
  interrupts the handler, and Effect's release closes the socket without a
  close code. The client's reconnect then gets 401.
- `/events/stream` ends through `Stream.interruptWhen`
  (`endStreamOnDeviceRevocation`).

## Pairing

`pan pair` (`src/cli/commands/pair.ts`) calls `POST /api/pairing/credentials`
with the internal token. That route accepts the internal token or the root
session (plus CSRF for the cookie); a device gets **403**, so a paired device
cannot mint more devices. It returns an `odp_<64 hex>` credential
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
3. `resolveDashboardCredential` returns a credential: pass. `GET
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
`~/.overdeck/config.yaml` by `src/lib/remote-access/config.ts` and cached for
the process lifetime, so changing it needs a dashboard restart. PAN-2351 adds
the schema entry and the Settings toggle.

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
  correct the trusted-origin env for this launch path.
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
