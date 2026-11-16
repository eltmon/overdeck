# overdeck.ai account service

Source: `services/account/`, licensed under FSL-1.1-MIT (`services/LICENSE.md`), not the repo's MIT license. Issue: PAN-4293. Design: `.pan/drafts/PAN-4293.md` (the PRD) and `.pan/drafts/anywhere-accounts.md` §6.9. Billing: PAN-4294, `.pan/drafts/PAN-4294.md`.

## What it is

A Cloudflare Worker at `https://account.overdeck.ai` that is the identity service for every hosted Overdeck feature: the hosted Session Vault (PAN-4297), the relay (PAN-2356) and shared sessions (PAN-658). It signs people in with GitHub (OAuth scope `read:user`, nothing else), mints revocable device tokens, and keeps the invite-only allowlist the operator manages from an admin screen.

It is **invite-only**; billing (PAN-4294) sells Anywhere to allowlisted accounts, and PAN-5455 opens sign-up later. A GitHub account can sign in only if it is the owner, holds an unexpired grant in the `grants` table, or has a subscription row that is not revoked (a subscriber whose grant lapsed can still read and export). Everyone else sees the invite-only page and leaves one bounded "pending attempt" row that the operator can allow with one click.

What it stores (D1 database `overdeck-account`): users (GitHub numeric id, login, timestamps), grants, pending attempts, device records (SHA-256 hashes of tokens, never the tokens), short-lived sign-in continuations and codes (hashed), admin sessions and account-page web sessions (hashed), deletion jobs and rate-limit counters (hashed client IPs). For billing it stores only Creem ids (customer, subscription, checkout), product keys, subscription statuses, paid-through times and processed webhook event ids: never card data, email, name or address.

What it never stores: the GitHub access token (used once per sign-in and discarded), any plaintext token or code, raw client IPs, the vault key, a vault passphrase or any user content. It has no CORS headers: `/v1/*` is called by the local Overdeck server or CLI, never from a browser.

Runtime code uses Web APIs only; `src/index.ts` is the only module that imports `cloudflare:workers`.

## Sign-in flows

Both flows share the **GitHub leg**: `startGitHubLeg()` writes an `auth_requests` row keyed by `sha256(state)` (10-minute expiry) and sets `__Host-od_state=<state>`; `GET /auth/github/callback` requires cookie = `state`, consumes the row (single use), exchanges the code, reads `GET /user`, and dispatches to the flow. Then `resolveSignIn()` is the allowlist gate: not allowed → pending attempt and no `users` row; allowed → the user row is created or its login refreshed.

**PKCE flow** (local dashboard: loopback redirect, the dashboard's Account card, PAN-4960: `POST /api/account/sign-in` + `GET /oauth/account/callback`, verifier held server-side, redirect `http://127.0.0.1:<port>/oauth/account/callback`; phone app: native redirect, PAN-4823; hosted share page: share redirect, PAN-4481). `GET /auth/start?redirect_uri&state&code_challenge&code_challenge_method=S256&platform&environment_id`. `redirect_uri` must be `http:` with host exactly `127.0.0.1`, `localhost` or `[::1]`, any port, no userinfo, no fragment; anything else is a 400 page with no redirect. The one other accepted `redirect_uri` is the phone app's private-use scheme redirect `ai.overdeck.app:/oauth/callback` (RFC 8252 §7.1), matched as the exact string: `ai.overdeck.app://oauth/callback`, another path, a query string or a different case is a 400. The third accepted `redirect_uri` is the hosted share page's callback `<SHARE_BASE_URL>/auth/callback` (for example `https://share.overdeck.ai/auth/callback`), also matched as the exact string, so another path, a query string or `http:` is a 400; with `SHARE_BASE_URL` unset it is refused. Each rule is its own function in `src/pkce.ts` (`validateLoopbackRedirect`, `NATIVE_APP_REDIRECT`, `validateShareRedirect`). The share redirect and `platform=web` come only as a pair: the share redirect with any other platform, or `platform=web` with any other redirect, is a 400 naming `platform`. The share Worker redeems the code over the service binding with `AccountRpc.redeemWebCode` instead of `/oauth/token`, because this service sends no CORS headers. After the GitHub leg the browser is sent back to `redirect_uri` with `code=odc_…&state=…`, or with `error=access_denied&error_description=invite_only|account_deleting|github_denied&state=…`. The client posts `grant_type=authorization_code&code&code_verifier&redirect_uri` to `/oauth/token`. Codes are single use (consumed before any check), expire after 5 minutes, and require the identical `redirect_uri` and a matching S256 verifier; the allowlist is re-checked before minting.

The service sends no `Access-Control-*` headers, so the phone app calls `/oauth/token` and `/v1/*` with native HTTP, not WebView `fetch`.

**Device flow** (CLI, SSH, headless; RFC 8628). `POST /oauth/device/code` with `platform` and `environment_id` (any valid platform except `web`, which is 400 `invalid_request`), plus optional `client_name` and `target_name` (the bot and the machine; cleaned by `deviceName()` and cut to 64 characters, stored as display-only claims on the `device_grants` row), returns `device_code` (`oddc_…`), `user_code` (`BCDF-GHJK`, 8 letters from `BCDFGHJKLMNPQRSTVWXZ`), `verification_uri` (`<base>/activate`), `verification_uri_complete`, `expires_in` 900 and `interval` 5. The person opens `verification_uri_complete`, which shows the confirm step at once (the names marked as claims from the device that asked, the device type and the code) with one **Authorize** button that starts the GitHub leg; a person who opens bare `/activate` types the code first and reaches the same confirm step. A `GET /activate` never changes a grant, so a link preview approves nothing. Both `POST /activate` and `POST /activate/confirm` require an `Origin` header equal to `PUBLIC_BASE_URL`, so a cross-site form post cannot walk a signed-in browser through the confirm step and approve someone else's device code. The names live only on the `device_grants` row, which is deleted at token exchange or denial and purged by the hourly cron one hour past expiry. The CLI polls `/oauth/token` with `grant_type=urn:ietf:params:oauth:grant-type:device_code&device_code`:

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
| `activate-fail` | wrong user codes on `POST /activate` and on `GET /activate?user_code=` | 10 per 15 min |
| `admin-login` | `POST /admin/login` | 10 per 10 min |
| `account-login` | `POST /account/login` | 10 per 10 min |
| `account-action` | `POST /account/logout`, `POST /account/machines/:environmentId/remove`, `POST /account/delete`, `POST /account/delete/confirm` | 30 per 15 min |
| `billing-action` | `POST /account/billing/checkout`, `POST /account/billing/relay`, `POST /account/billing/portal` | 20 per 15 min |

`/v1/*` and `GET /admin` are not rate limited (they need a valid token or session). `POST /webhooks/creem` is not rate limited either: Creem retries on its own schedule and the signature check is the gate.

## API

Every response carries `Cache-Control: no-store` and `X-Content-Type-Options: nosniff`; HTML responses also carry `Content-Security-Policy: default-src 'none'; style-src 'unsafe-inline'; form-action 'self' https://github.com; frame-ancestors 'none'; base-uri 'none'` and `Referrer-Policy: same-origin` (not `no-referrer`: that would make browsers send `Origin: null` on the service's own form posts, which the `/activate` and `/admin` Origin checks must refuse). Request bodies over 16 KiB → 413 (64 KiB on `POST /webhooks/creem`). Unknown path → 404 `{"error":"not_found"}`; wrong method → 405 with `Allow`; `OPTIONS` → 405. When `PUBLIC_BASE_URL`, `GITHUB_CLIENT_ID` or `GITHUB_CLIENT_SECRET` is missing, every route except `/healthz` returns 503 `{"error":"not_configured","missing":[…]}`; `/admin*` also returns 503 listing `OWNER_GITHUB_ID` when that is unset or non-numeric.

| Method | Path | Auth | Request → response |
| --- | --- | --- | --- |
| GET | `/healthz` | — | → 200 `{"ok":true,"configured":<bool>}` |
| GET | `/auth/start` | — | PKCE start (see above) → 302 to GitHub, or 400 page |
| GET | `/auth/github/callback` | state cookie | → the flow's redirect or page |
| POST | `/oauth/token` | — | form `grant_type=…` → token response or 400 `{"error":…}` (`invalid_request`, `invalid_grant`, `access_denied`, `unsupported_grant_type`, RFC 8628 codes) |
| POST | `/oauth/device/code` | — | form `platform`, `environment_id`, optional `client_name`, `target_name` → device code response |
| GET | `/activate` | — | `?user_code=` of a pending grant → the confirm step; a wrong or expired code → the form with an error (400, counts against `activate-fail`); no code → the form |
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
| POST | `/account/billing/checkout` | web session + csrf | form `plan` (`monthly` \| `annual` \| `founding`), `relay` (`0` \| `1`) → 200 interstitial with one link to Creem's checkout; the page with 400 "Choose a plan.", 409 (already paid, or founding sold out), 502 (Creem failed) or 503 (billing off) |
| POST | `/account/billing/relay` | web session + csrf | form `action` (`add` \| `remove`) → 303 `/account`; the page with 404 (no paid subscription), 409 (subscription cancelled), 502 or 503 |
| POST | `/account/billing/portal` | web session + csrf | → 200 interstitial with one link to the Creem customer portal; the page with 404 (no subscription), 502 or 503 |
| POST | `/webhooks/creem` | `creem-signature` HMAC | raw Creem event → 200 `{"ok":true}` (also for events ignored as not ours), 200 `{"ok":true,"duplicate":true}`, 400 `invalid_event`, 401 `invalid_signature`, 503 `unknown_subscription` (Creem retries) or 503 `billing_not_configured` |

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

`verifyDevice` is one D1 statement per call (no cache; the subscription rows join in as a JSON subquery), so revocation is immediate. `entitlement` comes from `entitlementFor(grant, billing, owner)` and has the shape below; `GET /v1/me` returns the same object. The values follow the precedence table in "Billing" below: a paying account is `anywhere`; otherwise a grant whose `entitlement` column is `free` is `free`, any other grant and the owner are `tester`.

```ts
interface Lapse { lapsedAt: number; graceEndsAt: number; deletesAt: number } // ms since epoch
interface Entitlement {
  plan: 'free' | 'tester' | 'anywhere';
  storageBytesCap: number;
  maxDevices: number | null;        // directory machines; null = unlimited
  relay: boolean;                   // relay fallback allowed
  inbox: boolean;                   // webhook inbox allowed
  vaultMaxMachines: number | null;  // machines syncing the hosted vault; null = unlimited
  lapse: Lapse | null;              // only when plan is 'free' and a lapsed subscription exists
}
```

### The free entitlement (PAN-2356)

An allowlisted account is `tester` unless its grant says `free`; `tester` carries the paid Anywhere tiers (unlimited directory machines, the relay add-on and the webhook inbox) at no charge. A **free** account is an allowlisted GitHub id whose grant row has `entitlement = 'free'`; the connect service (`docs/CONNECT-SERVICE.md`) then limits it to 3 directory machines and refuses the relay and the inbox. Sign-up stays invite-only. Set or clear it with Wrangler (operator only):

```bash
cd services/account
npx wrangler d1 execute overdeck-account --remote --command "UPDATE grants SET entitlement = 'free' WHERE github_id = 12345"
npx wrangler d1 execute overdeck-account --remote --command "UPDATE grants SET entitlement = 'tester' WHERE github_id = 12345"
```

The change applies on the account's next `verifyDevice`, so a connected machine sees it when its directory socket next reconnects.

## Billing

PAN-4294. Creem (`https://api.creem.io`, test mode `https://test-api.creem.io`) is the payment provider and merchant of record. Code: `services/account/src/billing/`. Billing is on only when `CREEM_API_KEY`, `CREEM_WEBHOOK_SECRET`, `CREEM_API_BASE` and `CREEM_PRODUCTS` are all set and valid (`parseBillingConfig`); otherwise every billing route answers 503 and the account page keeps "Billing is not available yet.".

**Products.** Creem's upgrade call works on single-item subscriptions only, so each combination is its own Creem product. `CREEM_PRODUCTS` maps these six keys to Creem product ids:

| Key | Price |
| --- | --- |
| `anywhere_monthly` | &#36;10 a month |
| `anywhere_monthly_relay` | &#36;13 a month with the relay |
| `anywhere_annual` | &#36;96 a year |
| `anywhere_annual_relay` | &#36;126 a year with the relay |
| `founding_annual` | &#36;60 a year (founding price) |
| `founding_annual_relay` | &#36;90 a year with the relay (founding price) |

Adding or removing the relay moves the subscription to the paired key with `proration-charge-immediately`. Switching between monthly and annual is not offered in-app: the user cancels in the Creem portal and subscribes again. The display prices live in `billing/catalog.ts` and must match the Creem products; Creem's checkout shows the binding price.

**Founding price.** Annual only, locked while subscribed. A founding checkout is refused when founding subscription rows plus open founding reservations younger than 60 minutes reach 500, or when `FOUNDING_ENDS_AT` is set and has passed. The count and the reservation insert are one SQL statement, so two checkouts cannot both take the 500th place. A reservation that is replaced or fails is expired, never deleted, so a late payment on its Creem link still maps to the user.

**Entitlement.** First match wins (GiB = 1024³ bytes):

| Case | plan | storageBytesCap | maxDevices | relay | inbox | vaultMaxMachines | lapse |
| --- | --- | --- | --- | --- | --- | --- | --- |
| paid access, any account including the owner | `anywhere` | max(100 GiB, grant cap) | null | the product's relay | true | null | null |
| owner | `tester` | 5 GiB | null | true | true | null | null |
| active grant `free` | `free` | grant cap or 1 GiB | 3 | false | false | 2 | from billing |
| any other active grant | `tester` | grant cap or 5 GiB | null | true | true | null | null |
| no active grant, a subscription row not revoked | `free` | 1 GiB | 3 | false | false | 2 | from billing |

**Paid access.** A subscription row gives paid access while it is not revoked, has a `paid_through`, and either its status is `active`, `trialing`, `scheduled_cancel` or `canceled` and now is before `paid_through`, or its status is `past_due` and now is before `paid_through` + 7 days (Creem is retrying the card). `paused`, `unpaid`, `expired` and unknown statuses give none. `canceled` keeps access to the end of the paid period because the portal cancels immediately. `paid_through` moves only forward, and only from `subscription.paid` and `checkout.completed` events, whatever order they arrive in.

**Lapse.** When no row gives paid access and a non-revoked row was paid at some point, `lapsedAt` is when the last access ended, `graceEndsAt` = `lapsedAt` + 30 days and `deletesAt` = `lapsedAt` + 60 days. At `lapsedAt` the plan becomes `free` at once: the relay and the inbox stop, and registered directory machines keep their rows (the directory refuses only new machines past 3). Subscribing again before `deletesAt` restores everything. The hosted vault enforces the rest (contract item 6 below).

**Webhook.** `POST /webhooks/creem` checks `creem-signature` (lowercase hex HMAC-SHA256 of the raw body, compared in constant time), skips an event id it has already applied, and writes the change and the `billing_events` row in one batch, so a failed apply is retried by Creem. `checkout.completed` completes our `checkouts` row, found by `request_id` (we send our checkout id) or by `metadata.overdeck_checkout_id`. `subscription.*` events find the user by `metadata.overdeck_user_id`, then the existing subscription row, then the checkout that created it; never by email. An unresolved subscription answers 503 (Creem retries for 24 hours) and is listed on the admin screen from `billing_unresolved`. Product, status and customer follow only the newest event (`created_at` ≥ the row's `last_event_at`). An unknown product and event types this service does not use (`refund.created`, `dispute.created` and others) are recorded and ignored. A subscription that resolves to a deleted or missing user, or to a revoked one (not the owner, no grant row and no subscription row that is not revoked), is stored revoked with a cancel requested and answered `{"ok":true,"cancelled":"gone"|"revoked"}`: its payment may land after the deletion's billing holder or the revoke already ran. The cancel is sent at once and retried by the hourly cron, so the account is not charged again and is not re-admitted.

**Account-page actions.** Checkout, relay and portal are the `/account/billing/*` routes above. Checkout and portal answer an interstitial page with one link to Creem instead of a redirect, because the page's CSP allows form posts only to the service itself and GitHub.

**Refunds.** A refund or dispute does not end paid access by itself. An operator who refunds a subscription in the Creem dashboard also revokes the account on the admin screen or cancels the subscription in Creem.

## Hosted vault contract

Fixed here for PAN-4297, which implements it:

1. **Auth.** Every vault request carries `Authorization: Bearer odd_…`. The vault calls `env.ACCOUNT.verifyDevice(token)` and refuses anything but `ok: true`.
2. **Storage cap.** One Durable Object per vault holds `usedBytes`. Before accepting an object `PUT`, the vault calls `quotaDecision(entitlement, usedBytes, body.length)` from `services/account/src/contract.ts`; `{ allowed: false, reason: 'quota_exceeded', capBytes, usedBytes }` → 507 `{"error":"quota_exceeded","capBytes":…,"usedBytes":…}` and nothing is written. The rule is exactly `usedBytes + incomingBytes > storageBytesCap`. Re-putting an existing id is free (content-addressed). The cap comes from the entitlement: 1 GiB for `free`, 5 GiB (5,368,709,120 bytes) for `tester` and the owner, at least 100 GiB for `anywhere`; the operator may set a different cap per grant on the admin screen.
3. **CAS.** Refs live in the per-vault Durable Object's storage. Create-if-absent (`If-None-Match: *`) and swap (`If-Match: <version>`) run inside the object's single-threaded `fetch`; a mismatch → 412.
4. **Chunks** live in R2 under content-derived keys; immutable.
5. **Deletion.** The vault's RPC entrypoint implements `AccountDataHolder.deleteAccountData(userId)` idempotently, deleting every R2 object and the Durable Object's storage for that user's vault within 24 hours. The account service's optional `VAULT` service binding points at it (`"services": [{ "binding": "VAULT", "service": "overdeck-vault", "entrypoint": "VaultRpc" }]`).
6. **Lapse** (PAN-4294). When `entitlement.lapse` is set the account was a subscriber. During the grace period (`lapsedAt` to `graceEndsAt`) all vault data stays readable and `pan vault migrate` works; writes follow the free cap, so a vault over 1 GiB is read-only. During the export window (`graceEndsAt` to `deletesAt`) the same holds and the account page warns of deletion. At `deletesAt` a vault holding more than the free cap is deleted entirely and the account continues as Free; a vault within the cap is kept. `vaultMaxMachines` limits how many machines sync the vault (2 on `free`, unlimited otherwise). This deletion is the vault's job; `pan vault migrate` is never gated.

## Account deletion

`DELETE /v1/account` runs one batch: `users.deleted_at` set, every device revoked (`revoked_by = 'account-deletion'`), the grant and pending row deleted, every web session deleted, and a `deletion_jobs` row opened listing the bound data holders (`billing` when billing is configured, then `vault` when `VAULT` is bound, then `directory` when `DIRECTORY` is bound; `[]` when none is). The job runs immediately via `ctx.waitUntil` and again every hour (see `src/maintenance.ts`): each pending holder is asked to `deleteAccountData(userId)`; a failure increments `attempts` and stores a 200-character `last_error`; a holder that is no longer bound stays pending with `last_error = 'holder <name> not bound'`. The `directory` holder calls `POST /delete-account` on the account's Directory Durable Object in the connect Worker, which closes every machine and phone socket and empties its tables (machine labels, public keys, phone push tokens, approvals, relay use, sealed inbox events); a non-200 is recorded as `directory delete failed: HTTP <status>`. The `billing` holder asks Creem to cancel, mode `immediate`, each of the user's subscriptions Creem has not ended (a 404 counts as cancelled), then deletes the user's `subscriptions` and `checkouts` rows; while any cancel fails, the job keeps `billing` pending with `last_error = 'billing cancel pending'` and the failing row shows on the admin screen. No refund is issued by code. When no holder remains, the user's device and user rows are deleted and `completed_at` is set. With no holders bound the job completes in the same request. Every device token of a deleting account is refused as `account_deleted` until the rows are gone, then as `invalid_token`. The admin screen flags jobs older than 24 hours as overdue.

Grant expiry, operator revoke and deletion are distinct: an **expired grant** keeps the devices and makes `verifyDevice` answer `grant_expired` (re-allowing restores access without a new sign-in); an **operator revoke** deletes the grant and revokes every device of that account (`revoked_by = 'operator'`), keeping the user row, and marks its subscriptions revoked and cancels them in Creem (failed cancels retry hourly); **deletion** is the above.

The hourly cron (`0 * * * *`) also purges expired `auth_requests`, `auth_codes`, `admin_sessions` and `user_sessions`; `device_grants` one hour past expiry; `pending_attempts` 30 days after their last attempt; devices revoked 90 days ago; rate-limit windows older than an hour; and deletion jobs completed 30 days ago; `billing_events` and `billing_unresolved` rows 30 days old; unpaid `checkouts` 7 days after they expired; and subscription rows of a user that no longer exists once their cancel succeeded. When billing is configured it also retries pending Creem cancels.

## Account page

`https://account.overdeck.ai/account` (PAN-4959), server-rendered HTML with no JavaScript, for any allowlisted user or subscriber. Every value is escaped; prices appear only in the Billing section, and only when billing is configured.

**Sign-in.** Without a valid web session the page shows "Sign in with GitHub", which posts to `/account/login` and runs the GitHub leg with purpose `account`. Then, in order: an account being deleted gets 403 "This account is being deleted."; the owner, an active grant or a subscriber with a row that is not revoked gets a session; an existing user whose grant expired also gets a session (as `GET /v1/me` allows), so they can still see the page and delete the account; anyone else gets the invite-only page and **no** pending-attempt row (invitations keep coming from device and PKCE sign-ins). A session lives in `user_sessions` (SHA-256 of the cookie value, a random csrf token, 12 hours), cookie `__Host-od_account` (`HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=43200`). A session of a user who has neither a grant row nor a non-revoked subscription (for example after an operator revoke) renders "Access to this account was removed." and is deleted. Every POST except `/account/login` must carry the session's `csrf` field and an `Origin` equal to `PUBLIC_BASE_URL`, else 403 "Request rejected."; `/account/login` checks the `Origin` only.

Sections, top to bottom:

1. "Your Overdeck account", "Signed in as <login> (GitHub id <id>)" and **Sign out**.
2. **Plan:** "Anywhere with the relay", "Anywhere", "Free account" or "Tester", from `entitlementFor` of the grant row (whether or not it expired) and the subscription rows; for a paid plan "Paid through <date>" and, on a founding price, "Founding price, locked while you stay subscribed."; access "No expiry", "Expires on <date>" or "Expired on <date>"; "Paid plans are invite-only for now." only when billing is not configured.
3. **Relay:** for Tester, "<used> of <cap> GB relay traffic this month" (decimal GB) and "Resets on <first of next month> (UTC).", plus "Relay allowance used; it resets on <date>." when the relay is stopped; for Free, "The relay is not included in the free account."; for Anywhere without the add-on, "The relay is not included in your plan."
4. **Machines:** "<n> of 3 machines" (Free) or "<n> machines" (Tester and Anywhere), and a table of the account's directory machines oldest first (label, Online/Offline, last seen, Overdeck version, **Remove**). Remove revokes that machine's device token, then forgets it in the Directory DO: its open socket closes with 4012, the other machines and phones get the updated directory, and on a free account the slot is free again. "Sign in on it again to add it back."
5. **Billing:** with billing not configured, "Billing is not available yet. Paid plans are invite-only for now." Otherwise:
   - **No paid access:** a form posting to `/account/billing/checkout` with the plans "&#36;10 a month", "&#36;96 a year (&#36;8 a month)" and, while founding places remain, "&#36;60 a year, founding price" followed by "<n> founding places left"; a checkbox "Add the relay: +&#36;3 a month or +&#36;30 a year, 50 GB of relay traffic a month"; and **Subscribe**. After Creem sends the user back (`?checkout=done`) and before the webhook arrives: "Payment received. Your plan changes as soon as Creem confirms it, usually within a minute." A former subscriber also gets **Manage billing**.
   - **Paid:** "<product>, <price>", **Add the relay** or **Remove the relay** (for a subscription cancelled in the portal, "Cancelled. Ends on <date>." instead), and **Manage billing (card, invoices, cancel)**; when the last payment failed, "Your last payment failed. Creem is retrying it; update your card in Manage billing."
   - **Lapsed** (above the subscribe form): during the grace period "Your Anywhere plan ended on <date>. Until <date> your hosted data stays readable and subscribing again restores everything."; during the export window "Hosted vault data above the free 1 GB will be deleted on <date>. Export it now with pan vault migrate, or subscribe again."; after it "Hosted vault data above the free 1 GB was deleted on <date>."
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

When billing is configured, the screen also shows "Founding places sold: <n> of 500" under the owner line, a **Billing** column in Allowlisted accounts ("Anywhere annual with the relay, paid through <date>", "Past due", "Lapsed on <date>" or "—"), and, when they have rows: **Subscribers without an invite** (login, GitHub id, billing), **Subscription cancels failing** (login, subscription id, attempts, error; "Cancel these by hand in the Creem dashboard.") and **Webhook events not matched to an account** (event id, type, subscription id, first seen, attempts; "Creem retries these for 24 hours. Match them by hand if they stay.").

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
| `CREEM_API_KEY` | secret | Creem API key (test-mode key against the test API). Billing is off until all four Creem values are valid |
| `CREEM_WEBHOOK_SECRET` | secret | the signing secret of the Creem webhook pointing at `/webhooks/creem` |
| `CREEM_API_BASE` | `wrangler.jsonc` `vars` (committed) | `https://api.creem.io`; `https://test-api.creem.io` for a test deployment |
| `CREEM_PRODUCTS` | var (set by the operator once the products exist) | JSON object mapping each of the six product keys to its Creem product id |
| `FOUNDING_ENDS_AT` | optional var | ISO 8601 date-time when the founding price ends; unset means no date limit yet. An unparseable value turns billing off |
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
4. `npx wrangler d1 migrations apply overdeck-account --remote` (applies every pending file in `migrations/`: `0001_init.sql`, then `0002_account_page.sql`, which adds `user_sessions` and rebuilds `auth_requests` for the `account` purpose, then `0003_device_grant_names.sql`, which adds the nullable `client_name`/`target_name` columns to `device_grants`). An existing deployment runs the same command to apply whichever migrations are new. Apply `0003_device_grant_names.sql` before deploying the Worker that writes the new columns; a Worker deployed first answers 500 to every device-code request. The previous Worker runs fine on the migrated schema (the columns are nullable).
5. `npx wrangler secret put GITHUB_CLIENT_ID` (it reads the value from stdin, so `printf %s <value> | npx wrangler secret put …` works too), then `npx wrangler secret put GITHUB_CLIENT_SECRET`, then `npx wrangler secret put OWNER_GITHUB_ID` (your numeric GitHub id, from `https://api.github.com/users/<login>` → `id`).
6. Deploy `overdeck-connect` first (`docs/CONNECT-SERVICE.md` "Deploy"): this Worker's `DIRECTORY` binding names its `AccountDirectory` class and the internal paths the account page calls. Then `npx wrangler deploy` (uploads the Worker, binds D1 and `DIRECTORY`, registers the hourly cron and the `account.overdeck.ai` custom domain).
7. Smoke test: `curl -s https://account.overdeck.ai/healthz` shows `"configured":true` (after the connect Worker is deployed too, `node scripts/anywhere/smoke-hosted.mjs` checks both services and starts one device sign-in); `pan account login` then `pan account status` shows your GitHub login; open `https://account.overdeck.ai/admin`, sign in with GitHub as the owner, add one tester by username, and have them sign in.
8. Rollback: `npx wrangler rollback` returns to the previous Worker version (the D1 schema is additive and stays).

**Billing (PAN-4294).** Deploy `overdeck-connect` with the paid-plan support first: until the Creem values below are set nobody can buy, so an older connect Worker never sees the `anywhere` plan. Then:

1. Apply `0004_billing.sql` (`npx wrangler d1 migrations apply overdeck-account --remote`) and deploy this Worker.
2. In Creem **test mode**, create the six subscription products of "Billing" (prices as in its table) and one webhook with URL `https://account.overdeck.ai/webhooks/creem` for all checkout and subscription events. Note the product ids and the webhook signing secret.
3. Point a test deployment at `https://test-api.creem.io` (`CREEM_API_BASE`), set `CREEM_API_KEY` and `CREEM_WEBHOOK_SECRET` with `npx wrangler secret put`, and set `CREEM_PRODUCTS` (and optionally `FOUNDING_ENDS_AT`) as vars.
4. Buy each product with a Creem test card. Confirm the account page and `pan account status` show the plan, add and remove the relay, and open **Manage billing**: the portal link must open (if Creem answers 404, change `CREEM_PORTAL_PATH` in `src/billing/creem.ts` to `/v1/customer-portal` and redeploy).
5. Repeat steps 2–4 in live mode with `CREEM_API_BASE=https://api.creem.io` and the live key, products and webhook secret.

A refund issued in the Creem dashboard does not end access by itself: also revoke the account on the admin screen or cancel the subscription in Creem.

## Client

`pan account login | status | logout` (PAN-4330) is the machine-side client, in `src/lib/account/` (`client.ts` for the HTTP calls, `store.ts` for the token file) plus `src/cli/commands/account/`. Sign-in is optional: nothing else in the CLI reads the token file.

- `login` runs the device flow, prints `verification_uri` from the device-code response (never a hardcoded host) and the user code, polls for the token, calls `GET /v1/me`, and writes `${OVERDECK_HOME}/account.json` (mode `0600`). The device-code request is retried after a network error (3 attempts, waiting 1 s then 2 s; an HTTP error response is not retried), and every network-error message from `client.ts` appends fetch's cause code and message, for example `fetch failed (ECONNRESET: socket hang up)`.
- `status` reports the signed-in GitHub login, this device, and access status from a fresh `GET /v1/me`; `--json` omits the token.
- `logout` calls `DELETE /v1/devices/<deviceId>` and deletes the token file whether or not the revoke succeeded.

The base URL resolves in order: `--base-url`, then `OVERDECK_ACCOUNT_URL`, then `https://account.overdeck.ai`; it is stored in the token file so `status` and `logout` always target the machine's own signed-in service. See [`/cli/account`](/cli/account) for the full command reference.
