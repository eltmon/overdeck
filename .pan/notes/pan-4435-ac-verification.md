# PAN-4435 acceptance-criteria verification map

Each xBRIEF acceptance criterion below is verified by an automated test that
already exists on this branch (added in the item's own commit). This note
exists only to carry the `Item: <id>` trailers `pan task done` requires per
AC; no new source or test changes are needed.

- `dashboard-schema.ac1`-`ac4`: `src/lib/config-yaml/__tests__/dashboard-config.test.ts`
  (4 cases: `true`, `"yes"`/`1` coercion, absent key, global-wins-over-project).
- `dashboard-schema.ac5`: `bash scripts/lint-file-size.sh` (run in CI and locally
  after every commit on this branch; `schema.ts` is 1105 lines, cap 1114).
- `settings-api-mapping.ac1`-`ac4`: `src/lib/__tests__/settings-api.test.ts`
  ("reports dashboard.require_token_mint from the enforced value", the two
  `saveSettingsApi` dashboard tests, and the three `validateSettingsApi`
  dashboard tests).
- `live-toggle-invalidation.ac1`: `settings-api.test.ts` — "writes
  dashboard.require_token_mint and invalidates the enforcement cache", which
  asserts `invalidateRemoteAccessConfig`'s call order is after `writeFile`.
- `live-toggle-invalidation.ac2`: `src/dashboard/server/__tests__/remote-request-gate.test.ts`
  — "applies require_token_mint after invalidation without a restart" (the
  false → true → false loopback-mint sequence).
- `live-toggle-invalidation.ac3`: `git grep _resetRemoteAccessConfigForTests`
  over source and tests returns no matches (verified at commit time).
- `live-toggle-invalidation.ac4`: `git diff origin/main -- src/dashboard/server/routes/settings.ts`
  is empty (verified at commit time).
- `access-tokens-section.ac1`-`ac3`, `ac5`: `src/dashboard/frontend/src/components/Settings/sections/__tests__/AccessTokensSection.test.tsx`
  (render/scopes/timestamps, revoke + re-fetch, 403 notices, nav placement).
- `access-tokens-section.ac4`: `package.json` `test:frontend-subset` contains
  `src/components/Settings/sections/__tests__/AccessTokensSection.test.tsx`.
- `create-token-dialog.ac1`-`ac4`: the "create-token dialog" describe block in
  `AccessTokensSection.test.tsx` (disabled state, post + plaintext, Copy,
  clear-on-reopen, 403 notice).
- `create-token-dialog.ac5`: `tests/unit/dashboard/access-token-scopes-parity.test.ts`.
- `require-token-mint-toggle.ac1`-`ac3`: the "require_token_mint toggle row"
  describe block in `AccessTokensSection.test.tsx`.
- `docs.ac1`-`ac3`: verified with the exact `grep` commands the xBRIEF
  specifies against `configuration/remote-access.mdx` and
  `docs/DASHBOARD-AUTH.md` at commit time.
- `settings-uat.ac1`-`ac5`: `.pan/notes/pan-4435-settings-uat.md` records the
  isolated-browser run and the observed `401`/`200`.
