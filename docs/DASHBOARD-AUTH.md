# Dashboard Authentication (PAN-1166)

How the Overdeck dashboard authenticates browsers and non-browser clients,
what the `/ws/*` upgrade gate defends, and what it does not.

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
- **CSRF token** — an HMAC token returned by the session mint and sent back on
  mutating requests as `x-overdeck-csrf-token`. Only checked for mutations
  (`rejectUnsafeDashboardMutationRequest`); WebSocket upgrades never carry it.

`hasDashboardAuthHeaders(headers)` (`dashboard-auth.ts`) is THE credential
check: true when the request carries the internal token (header or Bearer) OR
a valid session cookie. Every gate in this document reuses it — there is no
second credential check anywhere in the server.

## Session mint

`POST /api/dashboard/session` (`server.ts`, `dashboardSessionRouteLayer`) is
the only way a browser acquires the session cookie. It requires a trusted (or
absent) `Origin`, and then passes when any of these is true:

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
`X-Forwarded-For`, which a caller could spoof.

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
3. **Credential** (`hasDashboardAuthHeaders`) — the session cookie (browsers,
   attached automatically on same-site upgrades) or the internal token header
   (non-browser clients). Missing both is a **401**.

**Peer trust is deliberately NOT consulted here.** A loopback client with no
cookie and no internal token gets 401 on upgrade, even though the same client
could mint a session at `/api/dashboard/session` first. This keeps peer-based
trust confined to one chokepoint — the mint — so PAN-2351's future
`require_token_mint` switch can close it everywhere at once by changing the
mint alone, without touching four separate upgrade handlers.

`// PAN-2351 adds scoped access tokens (?token=) here.` marks where a future
`?token=` scoped-access check slots into `authorizeDashboardUpgrade` — no
scoped tokens exist yet (PAN-2351 is open, unimplemented).

Rejected raw upgrades (`/ws/terminal`, `/ws/voice`, `/ws/autopreso`) write a
plain `HTTP/1.1 <status> <message>` response and destroy the socket
(`rejectUpgrade`, `ws-auth.ts`). `/ws/rpc` is Effect-routed and returns a JSON
error response with the same status instead.

The `reauth-*` terminal one-time token (`consumeReauthTerminalToken`,
`ws-terminal.ts`) is an additional check for those sessions only, and runs
*after* `authorizeDashboardUpgrade` — it is unrelated to this gate.

## Threat model

**Defends:**
- LAN clients that can reach the dashboard's `0.0.0.0` API port. Before this
  gate, a GET upgrade with no `Origin` header passed origin validation
  outright, so any machine on the LAN got a live PTY on `/ws/terminal` by
  omitting the header — no browser, no credential.
- Non-browser clients that forge an `Origin` header the server would
  otherwise trust; the credential check still runs after origin validation.

**Does NOT defend:**
- Any process running on this machine. It can mint a session as a loopback
  peer with zero credentials, then use that cookie on every upgrade — this
  gate closes the LAN hole, not the local-machine trust boundary.
- LAN clients reaching the dashboard through Traefik with a forged `Host`
  header, because the shipped Traefik template publishes ports 80/443/8080 on
  all interfaces (`sync-sources/templates/traefik/docker-compose.yml`), not
  `127.0.0.1` — tracked as [PAN-4299](https://github.com/eltmon/overdeck/issues/4299).
- Exposure through a remote tunnel. That requires PAN-2351's scoped tokens and
  a `require_token_mint` switch to disable peer-based minting entirely, which
  do not exist yet.

## Troubleshooting

The dashboard shows a destructive **"Dashboard session could not be
established (HTTP 401)"** banner (`data-phase="unauthorized"`) when
`ensureDashboardSession()` gets a 401 from every mint host. Two distinct
causes produce different symptoms:

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
