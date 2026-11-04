# overdeck.ai account service

Source: `services/account/`, licensed under FSL-1.1-MIT (`services/LICENSE.md`), not the repo's MIT license. Issue: PAN-4293. Design: `.pan/drafts/PAN-4293.md` (the PRD) and `.pan/drafts/anywhere-accounts.md` §6.9.

## What it is

A Cloudflare Worker at `https://account.overdeck.ai` that is the identity service for every hosted Overdeck feature: the hosted Session Vault (PAN-4297), the relay (PAN-2356) and shared sessions (PAN-658). It signs people in with GitHub (OAuth scope `read:user`, nothing else), mints revocable device tokens, and keeps the invite-only allowlist the operator manages from an admin screen.

It is **invite-only** until billing (PAN-4294) exists: a GitHub account can sign in only if it is the owner or holds an unexpired grant in the `grants` table. Everyone else sees the invite-only page and leaves one bounded "pending attempt" row that the operator can allow with one click.

What it stores (D1 database `overdeck-account`): users (GitHub numeric id, login, timestamps), grants, pending attempts, device records (SHA-256 hashes of tokens, never the tokens), short-lived sign-in continuations and codes (hashed), admin sessions and account-page web sessions (hashed), deletion jobs and rate-limit counters (hashed client IPs).

What it never stores: the GitHub access token (used once per sign-in and discarded), any plaintext token or code, raw client IPs, the vault key, a vault passphrase or any user content. It has no CORS headers: `/v1/*` is called by the local Overdeck server or CLI, never from a browser.

Runtime code uses Web APIs only; `src/index.ts` is the only module that imports `cloudflare:workers`.

## Sign-in flows

Both flows share the **GitHub leg**: `startGitHubLeg()` writes an `auth_requests` row keyed by `sha256(state)` (10-minute expiry) and sets `__Host-od_state=<state>`; `GET /auth/github/callback` requires cookie = `state`, consumes the row (single use), exchanges the code, reads `GET /user`, and dispatches to the flow. Then `resolveSignIn()` is the allowlist gate: not allowed → pending attempt and no `users` row; allowed → the user row is created or its login refreshed.

**PKCE flow** (local dashboard: loopback redirect, client in PAN-4330; phone app: native redirect, PAN-4823; hosted share page: share redirect, PAN-4481). `GET /auth/start?redirect_uri&state&code_challenge&code_challenge_method=S256&platform&environment_id`. `redirect_uri` must be `http:` with host exactly `127.0.0.1`, `localhost` or `[::1]`, any port, no userinfo, no fragment; anything else is a 400 page with no redirect. The one other accepted `redirect_uri` is the phone app's private-use scheme redirect `ai.overdeck.app:/oauth/callback` (RFC 8252 §7.1), matched as the exact string: `ai.overdeck.app://oauth/callback`, another path, a query string or a different case is a 400. The third accepted `redirect_uri` is the hosted share page's callback `<SHARE_BASE_URL>/auth/callback` (for example `https://share.overdeck.ai/auth/callback`), also matched as the exact string, so another path, a query string or `http:` is a 400; with `SHARE_BASE_URL` unset it is refused. Each rule is its own function in `src/pkce.ts` (`validateLoopbackRedirect`, `NATIVE_APP_REDIRECT`, `validateShareRedirect`). The share redirect and `platform=web` come only as a pair: the share redirect with any other platform, or `platform=web` with any other redirect, is a 400 naming `platform`. The share Worker redeems the code over the service binding with `AccountRpc.redeemWebCode` instead of `/oauth/token`, because this service sends no CORS headers. After the GitHub leg the browser is sent back to `redirect_uri` with `code=odc_…&state=…`, or with `error=access_denied&error_description=invite_only|account_deleting|github_denied&state=…`. The client posts `grant_type=authorization_code&code&code_verifier&redirect_uri` to `/oauth/token`. Codes are single use (consumed before any check), expire after 5 minutes, and require the identical `redirect_uri` and a matching S256 verifier; the allowlist is re-checked before minting.

The service sends no `Access-Control-*` headers, so the phone app calls `/oauth/token` and `/v1/*` with native HTTP, not WebView `fetch`.

**Device flow** (CLI, SSH, headless; RFC 8628). `POST /oauth/device/code` with `platform` and `environment_id` (any valid platform except `web`, which is 400 `invalid_request`) returns `device_code` (`oddc_…`), `user_code` (`BCDF-GHJK`, 8 letters from `BCDFGHJKLMNPQRSTVWXZ`), `verification_uri` (`<base>/activate`), `verification_uri_complete`, `expires_in` 900 and `interval` 5. The person opens `/activate`, types the code (case, dashes and spaces are ignored), confirms the device type, and completes the GitHub leg. Both `POST /activate` and `POST /activate/confirm` require an `Origin` header equal to `PUBLIC_BASE_URL`, so a cross-site form post cannot walk a signed-in browser through the confirm step and approve someone else's device code. The CLI polls `/oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code`:

| Poll result | Meaning |
| --- | --- |
| `authorization_pending` | not approved yet |
| `slow_down` with `interval` | polled faster than the interval; the interval grew by 5 s |
| `access_denied` | not allowlisted, cancelled on GitHub, or the grant was removed before the poll |
| `expired_token` | the 15-minute code expired |
| 200 token response | approved; the row is deleted |

Clients read `verification_uri` from the response; the host is never hardcoded.

## Device tokens

A device token is `odd_` + 64 lowercase hex characters (256 random bits). Only its SHA-256 hex hash is stored, in `devices.token_hash`; the plaintext exists only in the token response. The token response is `{"access_token","token_type":"Bearer","device_id","label"}`.

Each row carries a server-minted `device_id` (UUID v4), `platform` (`^((linux|darwin|win32)-(x64|arm64)|(ios|android)-arm64|web)$`; `web` is a browser signed in on the hosted share page, PAN-4481), a label (default "Linux device" / "macOS device" / "Windows device" / "iPhone" / "Android phone" / "Web browser", never the hostname; renamable, 1–64 characters, no control characters) and the client's opaque `environment_id` (lowercase UUID v4 from `${OVERDECK_HOME}/environment-id.json`). Signing in again from the same `(user, environment_id)` rotates that row's token in place: same `device_id`, same label, old token dead. `last_used_at` is written at most once per device per 5 minutes.

Revocation is a column write (`revoked_at`, `revoked_by` ∈ `user | operator | account-deletion`); verification is one D1 lookup with no cache in front of it, so a revoked token is refused on the next request.

## Rate limits

Fixed windows per (bucket, `sha256(CF-Connecting-IP)`) in the `rate_limits` table. Exceeding a limit returns 429 with `Retry-After` (seconds to window end): JSON `{"error":"rate_limited"}` on `/oauth/*`, an HTML page elsewhere.

| Bucket | Applies to | Limit |
| --- | --- | --- |
| `auth-start` | `GET /auth/start` | 20 per 10 min |
| `github-callback` | `GET /auth/github/callback` | 30 per 10 min |
| `device-code` | `POST /oauth/device/code` | 10 per 10 min |
| `token` | `POST /oauth/token` | 120 per 10 min |
| `activate` | `POST /activate`, `POST /activate/confirm` | 30 per 15 min |
| `activate-fail` | wrong user codes on `POST /activate` | 10 per 15 min |
| `admin-login` | `POST /admin/login` | 10 per 10 min |
| `account-login` | `POST /account/login` | 10 per 10 min |
| `account-action` | `POST /account/logout`, `POST /account/machines/:environmentId/remove`, `POST /account/delete`, `POST /account/delete/confirm` | 30 per 15 min |

`/v1/*` and `GET /admin` are not rate limited (they need a valid token or session).

## API

Every response carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; HTML responses also carry `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'; base-uri 'none'` and `Referrer-Policy: same-origin` (not `no-referrer`: that would make browsers send `Origin: null` on the service's own form posts, which the `/activate` and `/admin` Origin checks must refuse). Request bodies over 16 KiB → 413. Unknown path → 404 `{"error":"not_found"}`; wrong method → 405 with `Allow`; `OPTIONS` → 405. When `PUBLIC_BASE_URL`, `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET` is missing, every route except `/healthz` returns 503 `{"error":"not_configured","missing":[…]}`; `/admin*` also returns 503 listing `OWNER_GITHUB_ID` when that is unset or non-numeric.

| Method | Path | Auth | Request → response |
| --- | --- | --- | --- |
| GET | `/healthz` | — | → 200 `{"ok":true,"configured":<bool>}` |
| GET | `/auth/start` | — | PKCE start (see above) → 302 to GitHub, or 400 page |
| GET | `/auth/github/callback` | state cookie | → the flow's redirect or page |
| POST | `/oauth/token` | — | form `grant_type=…` → token response or 400 `{"error":…}` (`invalid_request`, `invalid_grant`, `access_denied`, `unsupported_grant_type`, RFC 8628 codes) |
| POST | `/oauth/device/code` | — | form `platform`, `environment_id` → device code response |
| GET | `/activate` | — | HTML form; `?user_code=` prefills |
| POST | `/activate` | same-origin `Origin` | form `user_code` → confirm page, or the form with an error; 403 page cross-site |
| POST | `/activate/confirm` | same-origin `Origin` | form `user_code` → 302 to GitHub; 403 page cross-site |
| GET | `/v1/me` | Bearer (expired grant allowed) | → `{ userId, githubId, githubLogin, deviceId, entitlement, access: { status: "active" \| "grant_expired", expiresAt } }` |
| GET | `/v1/devices` | Bearer | → `{ devices: [{ deviceId, label, platform, environmentId, createdAt, lastUsedAt, current }] }` (the caller's active devices, oldest first) |
| PATCH | `/v1/devices/:id` | Bearer | JSON `{"label"}` → the device, 400 `invalid_label`, or 404 `not_found` |
| DELETE | `/v1/devices/:id` | Bearer (expired grant allowed) | → 204; 404 when not the caller's or already revoked. Revoking the calling device is sign-out |
| DELETE | `/v1/account` | Bearer (expired grant allowed) | → 202 `{"deletionRequestedAt"}` |
| GET | `/admin` | owner session | the admin screen, or the sign-in page |
| POST | `/admin/login` | — | → 302 to GitHub (purpose `admin`) |
| POST | `/admin/logout` | owner session + csrf | → 302 `/admin` |
| POST | `/admin/grants` | owner session + csrf | form `username`, `note`, `expires`, `cap_gb` → 303 `/admin`, or the page with an error |
| POST | `/admin/grants/:githubId/revoke` | owner session + csrf | → 303 `/admin` |
| POST | `/admin/pending/:githubId/allow` | owner session + csrf | → 303 `/admin`, or 404 page |
| GET | `/account` | web session | the account page, or the sign-in page |
| POST | `/account/login` | same-origin `Origin` | → 302 to GitHub (purpose `account`); 403 page cross-site |
| POST | `/account/logout` | web session + csrf | → 302 `/account`, cookie cleared |
| POST | `/account/machines/:environmentId/remove` | web session + csrf | → 303 `/account`; the page with 404 when the machine is not listed, 503 when the directory is unavailable |
| POST | `/account/delete` | web session + csrf | → the confirm page |
| POST | `/account/delete/confirm` | web session + csrf | form `confirm` (the GitHub login, any case) → "Your account is being deleted." with the cookie cleared, or the confirm page with 400 |

Bearer failures: `invalid_token`, `device_revoked` and `account_deleted` → 401 `{"error":<code>}` with `WWW-Authenticate: Bearer error="invalid_token"`; an expired grant → 403 `{"error":"grant_expired"}` except where noted.

## RPC contract

`src/index.ts` exports `class AccountRpc extends WorkerEntrypoint<Env>` with `verifyDevice(token: string): Promise<VerifyResult>`, and, for the share Worker's browser sign-in (PAN-4481), `redeemWebCode(input: RedeemWebCodeInput): Promise<RedeemResult>` and `signOutDevice(token: string): Promise<SignOutResult>`. Other Workers reach it through a service binding (`"services": [{ "binding": "ACCOUNT", "service": "overdeck-account", "entrypoint": "AccountRpc" }]`), never over the public internet. Types live in `src/contract.ts`:

```ts
type VerifyResult =
  | { ok: true; userId: string; githubId: number; githubLogin: string; deviceId: string; entitlement: Entitlement }
  | { ok: false; error: 'invalid_token' | 'device_revoked' | 'grant_expired' | 'account_deleted' };
interface AccountDataHolder { deleteAccountData(userId: string): Promise<{ deleted: true }> }
interface RedeemWebCodeInput { code: string; codeVerifier: string; redirectUri: string }
type RedeemResult =
  | { ok: true; accessToken: string; deviceId: string; label: string }
  | { ok: false; error: 'invalid_request' | 'invalid_grant' | 'access_denied' };
type SignOutResult = { ok: true } | { ok: false; error: VerifyError };
```

`redeemWebCode` applies exactly the rules of `POST /oauth/token` (single use, 5-minute expiry, identical redirect, S256 verifier, allowlist re-check) and refuses with `invalid_request` any `redirectUri` that is not the share redirect. `signOutDevice` revokes the token's own device with `revoked_by = 'user'`; a device whose grant lapsed still signs out.

`verifyDevice` is one D1 lookup per call (no cache), so revocation is immediate. `entitlement` comes from `entitlementFor(grant)`: a grant whose `entitlement` column is `free` gives `{ plan: 'free', storageBytesCap, maxDevices: 3 }`; any other grant, and the owner, gives `{ plan: 'tester', storageBytesCap, maxDevices: null }`. The owner gets the default cap.

### The free entitlement (PAN-2356)

Until billing (PAN-4294) ships, every allowlisted account is `tester`, which carries the paid Anywhere tiers (unlimited directory machines, the relay add-on and the webhook inbox). A **free** account is an allowlisted GitHub id whose grant row has `entitlement = 'free'`; the connect service (`docs/CONNECT-SERVICE.md`) then limits it to 3 directory machines and refuses the relay and the inbox. Sign-up stays invite-only. Set or clear it with Wrangler (operator only):

```bash
cd services/account
npx wrangler d1 execute overdeck-account --remote --command "UPDATE grants SET entitlement = 'free' WHERE github_id = 12345"
npx wrangler d1 execute overdeck-account --remote --command "UPDATE grants SET entitlement = 'tester' WHERE github_id = 12345"
```

The change applies on the account's next `verifyDevice`, so a connected machine sees it when its directory socket next reconnects.

## Hosted vault contract

Fixed here for PAN-4297, which implements it:

1. **Auth.** Every vault request carries `Authorization: Bearer odd_…`. The vault calls `env.ACCOUNT.verifyDevice(token)` and refuses anything but `ok: true`.
2. **Storage cap.** One Durable Object per vault holds `usedBytes`. Before accepting an object `PUT`, the vault calls `quotaDecision(entitlement, usedBytes, body.length)` from `services/account/src/contract.ts`; `{ allowed: false, reason: 'quota_exceeded', capBytes, usedBytes }` → 507 `{"error":"quota_exceeded","capBytes":…,"usedBytes":…}` and nothing is written. The rule is exactly `usedBytes + incomingBytes > storageBytesCap`. Re-putting an existing id is free (content-addressed). The default cap is 5 GB (5,368,709,120 bytes); the operator may set a different cap per grant on the admin screen.
3. **CAS.** Refs live in the per-vault Durable Object's storage. Create-if-absent (`If-None-Match: *`) and swap (`If-Match: <version>`) run inside the object's single-threaded `fetch`; a mismatch → 412.
4. **Chunks** live in R2 under content-derived keys; immutable.
5. **Deletion.** The vault's RPC entrypoint implements `AccountDataHolder.deleteAccountData(userId)` idempotently, deleting every R2 object and the Durable Object's storage for that user's vault within 24 hours. The account service's optional `VAULT` service binding points at it (`"services": [{ "binding": "VAULT", "service": "overdeck-vault", "entrypoint": "VaultRpc" }]`).

## Account deletion

`DELETE /v1/account` runs one batch: `users.deleted_at` set, every device revoked (`revoked_by = 'account-deletion'`), the grant and pending row deleted, every web session deleted, and a `deletion_jobs` row opened listing the bound data holders (`vault` when `VAULT` is bound, then `directory` when `DIRECTORY` is bound; `[]` when neither is). The job runs immediately via `ctx.waitUntil` and again every hour (see `src/maintenance.ts`): each pending holder is asked to `deleteAccountData(userId)`; a failure increments `attempts` and stores a 200-character `last_error`; a holder that is no longer bound stays pending with `last_error = 'holder <name> not bound'`. The `directory` holder calls `POST /delete-account` on the account's Directory Durable Object in the connect Worker, which closes every machine and phone socket and empties its tables (machine labels, public keys, phone push tokens, approvals, relay use, sealed inbox events); a non-200 is recorded as `directory delete failed: HTTP <status>`. When no holder remains, the user's device and user rows are deleted and `completed_at` is set. With no holders bound the job completes in the same request. Every device token of a deleting account is refused as `account_deleted` until the rows are gone, then as `invalid_token`. The admin screen flags jobs older than 24 hours as overdue.

Grant expiry, operator revoke and deletion are distinct: an **expired grant** keeps the devices and makes `verifyDevice` answer `grant_expired` (re-allowing restores access without a new sign-in); an **operator revoke** deletes the grant and revokes every device of that account (`revoked_by = 'operator'`), keeping the user row; **deletion** is the above.

The hourly cron (`0 * * * *`) also purges expired `auth_requests`, `auth_codes`, `admin_sessions` and `user_sessions`; `device_grants` one hour past expiry; `pending_attempts` 30 days after their last attempt; devices revoked 90 days ago; rate-limit windows older than an hour; and deletion jobs completed 30 days ago.

## Account page

`https://account.overdeck.ai/account` (PAN-4959), server-rendered HTML with no JavaScript, for any allowlisted user. Every value is escaped and no price appears anywhere.

**Sign-in.** Without a valid web session the page shows "Sign in with GitHub", which posts to `/account/login` and runs the GitHub leg with purpose `account`. Then, in order: an account being deleted gets 403 "This account is being deleted."; the owner or an active grant gets a session; an existing user whose grant expired also gets a session (as `GET /v1/me` allows), so they can still see the page and delete the account; anyone else gets the invite-only page and **no** pending-attempt row (invitations keep coming from device and PKCE sign-ins). A session lives in `user_sessions` (SHA-256 of the cookie value, a random csrf token, 12 hours), cookie `__Host-od_account` (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`). A session of a user whose grant the operator revoked renders "Access to this account was removed." and is deleted. Every POST except `/account/login` must carry the session's `csrf` field and an `Origin` equal to `PUBLIC_BASE_URL`, else 403 "Request rejected."; `/account/login` checks the `Origin` only.

Sections, top to bottom:

1. "Your Overdeck account", "Signed in as <login> (GitHub id <id>)" and **Sign out**.
2. **Plan:** "Free account" or "Tester", from `entitlementFor` of the grant row whether or not it expired (the owner, with no row, is Tester); access "No expiry", "Expires on <date>" or "Expired on <date>"; "Paid plans are invite-only for now."
3. **Relay:** for Tester, "<used> of <cap> GB relay traffic this month" (decimal GB) and "Resets on <first of next month> (UTC).", plus "Relay allowance used; it resets on <date>." when the relay is stopped; for Free, "The relay is not included in the free account."
4. **Machines:** "<n> of 3 machines" (Free) or "<n> machines" (Tester), and a table of the account's directory machines oldest first (label, Online/Offline, last seen, Overdeck version, **Remove**). Remove revokes that machine's device token, then forgets it in the Directory DO: its open socket closes with 4012, the other machines and phones get the updated directory, and on a free account the slot is free again. "Sign in on it again to add it back."
5. **Billing:** "Billing is not available yet. Paid plans are invite-only for now."
6. **Delete account:** a two-step delete. The confirm page asks for the GitHub login (any letter case); a match runs the same deletion as `DELETE /v1/account`, ends every web session and clears the cookie; a mismatch answers 400 "Type your GitHub login to confirm."

Machines and relay use come from the account's Directory Durable Object in the connect Worker, through the `DIRECTORY` binding (`src/directory-view.ts`); the plan comes from D1, never from the directory. When `DIRECTORY` is unbound, or the call throws or answers non-200, the page still renders, Relay and Machines say "Machines and relay use are unavailable right now." and no Remove button is shown; a Remove in that state answers 503.

## Admin screen

`https://account.overdeck.ai/admin`, server-rendered HTML with no JavaScript. **Sign-in:** a "Sign in with GitHub" button runs the GitHub leg with purpose `admin`; a session is created only when the GitHub id equals `OWNER_GITHUB_ID` (cookie `__Host-od_admin`, `HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`); anyone else gets "This page is for the Overdeck operator." and no row. Every admin POST must carry the session's `csrf` form field and an `Origin` equal to `PUBLIC_BASE_URL`, else 403.

Sections, top to bottom:

1. Header "Overdeck accounts (invite-only)" with sign-out.
2. "Owner (always allowed): GitHub id …" — the owner has no grant row.
3. **Allowlisted accounts:** login (GitHub link), GitHub id, granted date, entitlement, storage cap ("5 GB" or the set value), note, expires (date, "never", or "expired" in the warning color), active devices, last seen, **Revoke**. Newest first.
4. **Add an account:** GitHub username (resolved to its numeric id with an unauthenticated `GET https://api.github.com/users/<username>`; 404 → "GitHub user not found.", 403/429 → "GitHub rate limit reached; try again in a few minutes."), optional note (≤ 200 characters), optional expiry date (end of that UTC day), optional storage cap in whole GB (1–1000; empty = default 5). Re-adding an account updates its note, expiry and cap.
5. **Pending sign-in attempts:** login, GitHub id, first seen, last seen, attempts, flow, **Allow** — "Allowing an account lets it sign in. Ask the person to sign in again." Allow creates a `tester` grant with the default cap; it does not mint a token.
6. **Account deletions in progress:** user id, requested at, age in hours, holders pending, attempts, last error; rows older than 24 hours show "overdue".

**Revoke** deletes the grant and revokes every device token of that account at once. The storage cap shown per grant is what the hosted vault enforces on every write.

## Configuration

| Name | Where | Meaning |
| --- | --- | --- |
| `PUBLIC_BASE_URL` | `wrangler.jsonc` `vars` (committed) | `https://account.overdeck.ai`; used for redirect URIs, `verification_uri` and the admin `Origin` check |
| `SHARE_BASE_URL` | `wrangler.jsonc` `vars` (committed) | `https://share.overdeck.ai`; its `/auth/callback` is the third accepted PKCE `redirect_uri` (PAN-4481). Optional: unset refuses the share redirect |
| `GITHUB_CLIENT_ID` | secret (`wrangler secret put`) | the GitHub OAuth App's client id |
| `GITHUB_CLIENT_SECRET` | secret | the OAuth App's client secret |
| `OWNER_GITHUB_ID` | secret | the operator's numeric GitHub id; unset or non-numeric disables the admin screen (503) and the owner bypass |
| `DB` | D1 binding | database `overdeck-account`, migrations in `services/account/migrations/` |
| `VAULT` | optional service binding | the hosted vault's RPC entrypoint; added by PAN-4297 |
| `DIRECTORY` | optional cross-script Durable Object binding (`wrangler.jsonc` `durable_objects`) | class `AccountDirectory` with `script_name` `overdeck-connect`: the account page reads machines and relay use from it, Remove forgets a machine in it, and deletion empties it (PAN-4959). Absent in unit tests and local dev, where the page says machines are unavailable |

No value has a hardcoded default. Local development reads the same names from `services/account/.dev.vars` (gitignored); `.dev.vars.example` holds placeholders.

## Local development

```bash
cp services/account/.dev.vars.example services/account/.dev.vars   # fill in a GitHub OAuth App for local use
npm --prefix services/account run migrate:local                   # wrangler d1 migrations apply overdeck-account --local
npm --prefix services/account run dev                             # wrangler dev --local
npm run typecheck:account                                         # tsc against @cloudflare/workers-types
npx vitest run tests/unit/services/account/                       # unit tests on a node:sqlite D1 shim (no workerd)
npx vitest run tests/integration/services/account/                # real workerd via Miniflare, GitHub stubbed
npm --prefix services/account run build:dry                       # wrangler deploy --dry-run --outdir dist (no credentials)
```

Unit tests (`tests/unit/services/account/`) drive `handle()` directly with an injected clock and fetch (`Deps`), so expiry, throttles and rate-limit windows never wait. The D1 shim (`helpers/d1.ts`) implements only `prepare/bind/first/all/run/batch`; runtime code must not use other D1 methods. The integration test bundles the Worker with `wrangler deploy --dry-run`, loads it into Miniflare with a local D1, stubs GitHub through `outboundService`, and runs the PKCE and device flows end to end.

Agents may run `wrangler dev --local`, `wrangler d1 migrations apply overdeck-account --local` and `wrangler deploy --dry-run`; nothing else. Deploying is operator-only.

## Deploy

Operator-only. No agent runs any of the commands below; the custom-domain route in `wrangler.jsonc` creates the `account.overdeck.ai` DNS record in the Cloudflare zone on first deploy (the apex stays on Vercel). Before starting, confirm the bundle builds with no credentials: `npm --prefix services/account run build:dry` exits 0.

1. Create a GitHub OAuth App (GitHub → Settings → Developer settings → OAuth Apps): homepage `https://account.overdeck.ai`, authorization callback URL `https://account.overdeck.ai/auth/github/callback`. Leave **Enable Device Flow** off: `pan account login` runs this service's own device flow, which uses GitHub's ordinary web callback. Note the client id and generate a client secret.
2. `cd services/account && npx wrangler login` (opens the browser for the Cloudflare account that owns the `overdeck.ai` zone). On an account that has never had a Worker, open **Workers & Pages** in the Cloudflare dashboard once first: that creates the account's `workers.dev` subdomain, without which `wrangler deploy` fails with code 10063.
3. `npx wrangler d1 create overdeck-account`, paste the printed `database_id` into `wrangler.jsonc` (replacing the all-zero placeholder), and commit that change.
4. `npx wrangler d1 migrations apply overdeck-account --remote` (applies every pending file in `migrations/`: `0001_init.sql`, then `0002_account_page.sql`, which adds `user_sessions` and rebuilds `auth_requests` for the `account` purpose). An existing deployment runs the same command to apply `0002_account_page.sql`.
5. `npx wrangler secret put GITHUB_CLIENT_ID` (it reads the value from stdin, so `printf %s <value> | npx wrangler secret put …` works too), then `npx wrangler secret put GITHUB_CLIENT_SECRET`, then `npx wrangler secret put OWNER_GITHUB_ID` (your numeric GitHub id, from `https://api.github.com/users/<login>` → `id`).
6. Deploy `overdeck-connect` first (`docs/CONNECT-SERVICE.md` "Deploy"): this Worker's `DIRECTORY` binding names its `AccountDirectory` class and the internal paths the account page calls. Then `npx wrangler deploy` (uploads the Worker, binds D1 and `DIRECTORY`, registers the hourly cron and the `account.overdeck.ai` custom domain).
7. Smoke test: `curl -s https://account.overdeck.ai/healthz` shows `"configured":true` (after the connect Worker is deployed too, `node scripts/anywhere/smoke-hosted.mjs` checks both services and starts one device sign-in); `pan account login` then `pan account status` shows your GitHub login; open `https://account.overdeck.ai/admin`, sign in with GitHub as the owner, add one tester by username, and have them sign in.
8. Rollback: `npx wrangler rollback` returns to the previous Worker version (the D1 schema is additive and stays).

## Client

`pan account login | status | logout` (PAN-4330) is the machine-side client, in `src/lib/account/` (`client.ts` for the HTTP calls, `store.ts` for the token file) plus `src/cli/commands/account/`. Sign-in is optional: nothing else in the CLI reads the token file.

- `login` runs the device flow, prints `verification_uri` from the device-code response (never a hardcoded host) and the user code, polls for the token, calls `GET /v1/me`, and writes `${OVERDECK_HOME}/account.json` (mode `0600`).
- `status` reports the signed-in GitHub login, this device, and access status from a fresh `GET /v1/me`; `--json` omits the token.
- `logout` calls `DELETE /v1/devices/<deviceId>` and deletes the token file whether or not the revoke succeeded.

The base URL resolves in order: `--base-url`, then `OVERDECK_ACCOUNT_URL`, then `https://account.overdeck.ai`; it is stored in the token file so `status` and `logout` always target the machine's own signed-in service. See [`/cli/account`](/cli/account) for the full command reference.
