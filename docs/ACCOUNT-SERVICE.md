# overdeck.ai account service

Source: `services/account/`. Issue: PAN-4293. Design: `.pan/drafts/PAN-4293.md` (the PRD) and `.pan/drafts/anywhere-accounts.md` §6.9.

## What it is

A Cloudflare Worker at `https://account.overdeck.ai` that is the identity service for every hosted Overdeck feature: the hosted Session Vault (PAN-4297), the relay (PAN-2356) and shared sessions (PAN-658). It signs people in with GitHub (OAuth scope `read:user`, nothing else), mints revocable device tokens, and keeps the invite-only allowlist the operator manages from an admin screen.

It is **invite-only** until billing (PAN-4294) exists: a GitHub account can sign in only if it is the owner or holds an unexpired grant in the `grants` table. Everyone else sees the invite-only page and leaves one bounded "pending attempt" row that the operator can allow with one click.

What it stores (D1 database `overdeck-account`): users (GitHub numeric id, login, timestamps), grants, pending attempts, device records (SHA-256 hashes of tokens, never the tokens), short-lived sign-in continuations and codes (hashed), admin sessions (hashed), deletion jobs and rate-limit counters (hashed client IPs).

What it never stores: the GitHub access token (used once per sign-in and discarded), any plaintext token or code, raw client IPs, the vault key, a vault passphrase or any user content. It has no CORS headers: `/v1/*` is called by the local Overdeck server or CLI, never from a browser.

Runtime code uses Web APIs only; `src/index.ts` is the only module that imports `cloudflare:workers`.

## Sign-in flows

Both flows share the **GitHub leg**: `startGitHubLeg()` writes an `auth_requests` row keyed by `sha256(state)` (10-minute expiry) and sets `__Host-od_state=<state>`; `GET /auth/github/callback` requires cookie = `state`, consumes the row (single use), exchanges the code, reads `GET /user`, and dispatches to the flow. Then `resolveSignIn()` is the allowlist gate: not allowed → pending attempt and no `users` row; allowed → the user row is created or its login refreshed.

**PKCE loopback flow** (local dashboard; client in PAN-4330). `GET /auth/start?redirect_uri&state&code_challenge&code_challenge_method=S256&platform&environment_id`. `redirect_uri` must be `http:` with host exactly `127.0.0.1`, `localhost` or `[::1]`, any port, no userinfo, no fragment; anything else is a 400 page with no redirect. After the GitHub leg the browser is sent back to `redirect_uri` with `code=odc_…&state=…`, or with `error=access_denied&error_description=invite_only|account_deleting|github_denied&state=…`. The client posts `grant_type=authorization_code&code&code_verifier&redirect_uri` to `/oauth/token`. Codes are single use (consumed before any check), expire after 5 minutes, and require the identical `redirect_uri` and a matching S256 verifier; the allowlist is re-checked before minting.

**Device flow** (CLI, SSH, headless; RFC 8628). `POST /oauth/device/code` with `platform` and `environment_id` returns `device_code` (`oddc_…`), `user_code` (`BCDF-GHJK`, 8 letters from `BCDFGHJKLMNPQRSTVWXZ`), `verification_uri` (`<base>/activate`), `verification_uri_complete`, `expires_in` 900 and `interval` 5. The person opens `/activate`, types the code (case, dashes and spaces are ignored), confirms the device type, and completes the GitHub leg. Both `POST /activate` and `POST /activate/confirm` require an `Origin` header equal to `PUBLIC_BASE_URL`, so a cross-site form post cannot walk a signed-in browser through the confirm step and approve someone else's device code. The CLI polls `/oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code`:

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

Each row carries a server-minted `device_id` (UUID v4), `platform` (`^(linux|darwin|win32)-(x64|arm64)$`), a label (default "Linux device" / "macOS device" / "Windows device", never the hostname; renamable, 1–64 characters, no control characters) and the client's opaque `environment_id` (lowercase UUID v4 from `${OVERDECK_HOME}/environment-id.json`). Signing in again from the same `(user, environment_id)` rotates that row's token in place: same `device_id`, same label, old token dead. `last_used_at` is written at most once per device per 5 minutes.

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

Bearer failures: `invalid_token`, `device_revoked` and `account_deleted` → 401 `{"error":<code>}` with `WWW-Authenticate: Bearer error="invalid_token"`; an expired grant → 403 `{"error":"grant_expired"}` except where noted.

## RPC contract

`src/index.ts` exports `class AccountRpc extends WorkerEntrypoint<Env>` with `verifyDevice(token: string): Promise<VerifyResult>`. Other Workers reach it through a service binding (`"services": [{ "binding": "ACCOUNT", "service": "overdeck-account", "entrypoint": "AccountRpc" }]`), never over the public internet. Types live in `src/contract.ts`:

```ts
type VerifyResult =
  | { ok: true; userId: string; githubId: number; deviceId: string; entitlement: Entitlement }
  | { ok: false; error: 'invalid_token' | 'device_revoked' | 'grant_expired' | 'account_deleted' };
interface AccountDataHolder { deleteAccountData(userId: string): Promise<{ deleted: true }> }
```

`verifyDevice` is one D1 lookup per call (no cache), so revocation is immediate. `entitlement` is `{ plan: 'tester', storageBytesCap, maxDevices: null }` from `entitlementFor(grant)`; the owner gets the default cap.

## Hosted vault contract

Fixed here for PAN-4297, which implements it:

1. **Auth.** Every vault request carries `Authorization: Bearer odd_…`. The vault calls `env.ACCOUNT.verifyDevice(token)` and refuses anything but `ok: true`.
2. **Storage cap.** One Durable Object per vault holds `usedBytes`. Before accepting an object `PUT`, the vault calls `quotaDecision(entitlement, usedBytes, body.length)` from `services/account/src/contract.ts`; `{ allowed: false, reason: 'quota_exceeded', capBytes, usedBytes }` → 507 `{"error":"quota_exceeded","capBytes":…,"usedBytes":…}` and nothing is written. The rule is exactly `usedBytes + incomingBytes > storageBytesCap`. Re-putting an existing id is free (content-addressed). The default cap is 5 GB (5,368,709,120 bytes); the operator may set a different cap per grant on the admin screen.
3. **CAS.** Refs live in the per-vault Durable Object's storage. Create-if-absent (`If-None-Match: *`) and swap (`If-Match: <version>`) run inside the object's single-threaded `fetch`; a mismatch → 412.
4. **Chunks** live in R2 under content-derived keys; immutable.
5. **Deletion.** The vault's RPC entrypoint implements `AccountDataHolder.deleteAccountData(userId)` idempotently, deleting every R2 object and the Durable Object's storage for that user's vault within 24 hours. The account service's optional `VAULT` service binding points at it (`"services": [{ "binding": "VAULT", "service": "overdeck-vault", "entrypoint": "VaultRpc" }]`).

## Account deletion

`DELETE /v1/account` runs one batch: `users.deleted_at` set, every device revoked (`revoked_by = 'account-deletion'`), the grant and pending row deleted, and a `deletion_jobs` row opened listing the bound data holders (`["vault"]` when `VAULT` is bound, else `[]`). The job runs immediately via `ctx.waitUntil` and again every hour (see `src/maintenance.ts`): each pending holder is asked to `deleteAccountData(userId)`; a failure increments `attempts` and stores a 200-character `last_error`; a holder that is no longer bound stays pending with `last_error = 'holder <name> not bound'`. When no holder remains, the user's device and user rows are deleted and `completed_at` is set. With no holders bound the job completes in the same request. Every device token of a deleting account is refused as `account_deleted` until the rows are gone, then as `invalid_token`. The admin screen flags jobs older than 24 hours as overdue.

Grant expiry, operator revoke and deletion are distinct: an **expired grant** keeps the devices and makes `verifyDevice` answer `grant_expired` (re-allowing restores access without a new sign-in); an **operator revoke** deletes the grant and revokes every device of that account (`revoked_by = 'operator'`), keeping the user row; **deletion** is the above.

The hourly cron (`0 * * * *`) also purges expired `auth_requests`, `auth_codes` and `admin_sessions`; `device_grants` one hour past expiry; `pending_attempts` 30 days after their last attempt; devices revoked 90 days ago; rate-limit windows older than an hour; and deletion jobs completed 30 days ago.

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
| `GITHUB_CLIENT_ID` | secret (`wrangler secret put`) | the GitHub OAuth App's client id |
| `GITHUB_CLIENT_SECRET` | secret | the OAuth App's client secret |
| `OWNER_GITHUB_ID` | secret | the operator's numeric GitHub id; unset or non-numeric disables the admin screen (503) and the owner bypass |
| `DB` | D1 binding | database `overdeck-account`, migrations in `services/account/migrations/` |
| `VAULT` | optional service binding | the hosted vault's RPC entrypoint; added by PAN-4297 |

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

1. Create a GitHub OAuth App (GitHub → Settings → Developer settings → OAuth Apps): homepage `https://account.overdeck.ai`, authorization callback URL `https://account.overdeck.ai/auth/github/callback`. Note the client id and generate a client secret.
2. `cd services/account && npx wrangler login` (opens the browser for the Cloudflare account that owns the `overdeck.ai` zone).
3. `npx wrangler d1 create overdeck-account`, paste the printed `database_id` into `wrangler.jsonc` (replacing the all-zero placeholder), and commit that change.
4. `npx wrangler d1 migrations apply overdeck-account --remote` (applies `migrations/0001_init.sql` to the production database).
5. `npx wrangler secret put GITHUB_CLIENT_ID`, then `npx wrangler secret put GITHUB_CLIENT_SECRET`, then `npx wrangler secret put OWNER_GITHUB_ID` (your numeric GitHub id, from `https://api.github.com/users/<login>` → `id`).
6. `npx wrangler deploy` (uploads the Worker, binds D1, registers the hourly cron and the `account.overdeck.ai` custom domain).
7. Smoke test: `curl -s https://account.overdeck.ai/healthz` shows `"configured":true`; open `https://account.overdeck.ai/admin`, sign in with GitHub as the owner, add one tester by username, and have them sign in.
8. Rollback: `npx wrangler rollback` returns to the previous Worker version (the D1 schema is additive and stays).

After deploying, the local client (PAN-4330) needs the base URL `https://account.overdeck.ai`; it reads `verification_uri` from the device-code response and never hardcodes the host.
