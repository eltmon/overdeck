# PAN-4435 settings-uat evidence

Isolated verification: `npm run build`, then `node dist/dashboard/server.js`
under Node 22 on `127.0.0.1:18432` with `OVERDECK_HOME` set to a fresh temp
directory (minimal `config.yaml` enabling `anthropic`) and its own
`OVERDECK_INTERNAL_TOKEN`. Playwright launched a fresh, isolated browser
context (no shared profile/cookies) against
`http://127.0.0.1:18432/settings#access-tokens`.

1. **Create token.** Created `uat-sidecar` with scope `read:events`; the
   plaintext (`odk_…`) rendered once in the dialog. After Close and a page
   reload, the row was listed and no element on the page contained the
   plaintext.
2. **Revoke.** Revoked `uat-sidecar` through the confirm dialog; the Revoked
   column showed a timestamp (`9/30/2026, 4:56:17 PM` in this run).
3. **Toggle on, no restart.** Turned "Require a token to sign in" on from the
   same page. `curl -X POST http://127.0.0.1:18432/api/dashboard/session`
   (with `Origin: http://127.0.0.1:18432`, required for the request to clear
   origin validation before reaching the require_token_mint check — a bare
   curl with no Origin/Referer/bearer 403s with "Missing origin" regardless of
   this flag, which is pre-existing CSRF behavior unrelated to PAN-4435)
   returned **401**. A second, fresh isolated browser context (no cookies)
   opened against `/` while the toggle was on showed the "Dashboard session
   could not be established (HTTP 401)" banner, as designed.
4. **Toggle off, same page.** Turned the toggle back off from the same
   (still-cookied) page. The same curl call returned **200**.

All four steps passed on the first run after fixing the curl invocation to
include the `Origin` header.
