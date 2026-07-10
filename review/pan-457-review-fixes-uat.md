# PAN-457 Review Fixes UAT

Date: 2026-05-17
Server: `API_PORT=4311 PORT=4311 HOST=127.0.0.1 PANOPTICON_DISABLE_DEACON=1 node dist/dashboard/server.js`
URL: `http://127.0.0.1:4311/sessions`

## Automated gates

- `npm run typecheck` passed.
- `npm test -- src/dashboard/server/routes/__tests__/discovered-sessions.test.ts src/lib/database/__tests__/discovered-sessions-db.test.ts src/lib/conversations/__tests__/enrichment.test.ts src/lib/conversations/__tests__/scanner.test.ts src/cli/commands/conversations/__tests__/enrich.test.ts` passed: 5 files, 100 tests.
- `npm run lint && npm test && npm run build` passed.
  - Lint: permission-flag lint passed; skill CLI lint passed.
  - Full tests: 340 files passed, 4 skipped; 3849 tests passed, 49 skipped.
  - Build completed.

## Browser UAT

Using Playwright against the built Node 22 dashboard:

- Sessions page loaded at `/sessions` with header `Session History`.
- Stats rendered: `14988 indexed`, `0 enriched`, `374 managed`, `$17869.7574 est. cost`.
- Scan control rendered in the header.
- Keyword search input accepted `PAN-457`; search request completed and empty-state rendered without a crash.
- Filters panel opened and showed time facets, workspace/model facets, cost ranges, enrichment levels, `Panopticon-managed`, and `Enriched only` controls.
- Clearing search repopulated the session table and facet counts.
- Detail flow: clicking a session row opened `Session #9041` detail panel.
- Enrichment flow UI: detail panel rendered `Enrich this session` with provider disclosure text: `Sends redacted conversation excerpts to the configured enrichment provider.` I did not click the enrichment action because it would intentionally call the configured provider and spend credentials.

## Browser UAT — safe enrichment and embedding dispatch

Using a temporary isolated `PANOPTICON_HOME=/tmp/pan-457-uat-1778983666-1052` and built Node 22 dashboard on `http://127.0.0.1:4312/sessions`:

- Seeded one discovered session whose JSONL path intentionally did not exist, so enrichment request dispatch would exercise the backend path and progress events without sending any prompt to a paid provider.
- Sessions page loaded with `1 indexed`, `0 enriched`, `0 managed`, and the seeded row for `/tmp/pan-457-uat-workspace`.
- Clicking the row opened `Session #1` detail drawer.
- Detail drawer rendered `Quick (L1)`, `Detailed (L2)`, new `Deep (L3)`, and new `Embed` controls.
- Clicking `Deep (L3)` dispatched the enrichment flow through the dashboard RPC/backend path and rendered live progress failure text: `L3 failed: No readable messages in JSONL · claude-sonnet-4-6`.
- Clicking `Embed` dispatched embedding generation through the dashboard RPC/backend path and rendered `Embedding complete`.
- Network panel showed follow-up session/list/stats refreshes after both actions, confirming store/query invalidation and UI refresh behavior.

## Browser UAT — scan click-through

Using a temporary isolated `HOME=/tmp/pan-457-scan-uat-Hok5Ip/home` and `PANOPTICON_HOME=/tmp/pan-457-scan-uat-Hok5Ip/panhome` with a single fixture JSONL, built Node 22 dashboard on `http://127.0.0.1:4316/sessions`:

- Sessions page initially rendered `0 indexed`, `0 enriched`, `0 managed`, and the empty state `Run a scan to discover Claude Code sessions`.
- Clicked the actual `Scan` button in the Sessions header.
- Scan domain events recorded progress and completion for the browser-triggered run:
  - `scan.progress`: `dirsProcessed=1`, `dirsTotal=1`, `sessionsFound=1`, `elapsedMs=22`.
  - `scan.complete`: `inserted=1`, `updated=0`, `skipped=0`, `errors=0`, `durationMs=22`.
- The ScanButton rendered the final result `+1 ↑0 ·0.0s` after completion.
- The refreshed table rendered the discovered fixture row `-tmp-pan-457-uat-workspace/scan-uat-session.jsonl` with `2` messages and `today` last active.
- Clicking the refreshed row opened `Session #1`; the detail drawer showed the new `Ad-hoc` badge and the fixture JSONL path.

## Security UAT note

Semantic search origin hardening is covered by `src/dashboard/server/routes/__tests__/discovered-sessions.test.ts`:

- rejects semantic GET requests without origin evidence,
- allows semantic GET requests from trusted origins,
- rejects semantic GET requests from untrusted origins.

Dashboard session minting is now guarded by proof of possession of the internal token:

- `rejectUnauthorizedDashboardSessionMintRequest()` returns `401` for a browser session cookie without the internal token header.
- `rejectUnauthorizedDashboardSessionMintRequest()` returns `null` for `x-panopticon-internal-token: test-dashboard-token`.
- `dashboardSessionCookieHeader()` still mints a browser-only cookie whose value is not the internal token.
- `dashboardSessionCookieHeader({ secure: true })` adds `Secure` for HTTPS-terminated requests.

## Browser UAT — dashboard session auth

Using an isolated rebuilt Node 22 dashboard with `PANOPTICON_HOME=/tmp/pan-457-uat-auth2`, `PANOPTICON_INTERNAL_TOKEN=uat-dashboard-token`, and `PANOPTICON_DISABLE_DEACON=1` on `http://127.0.0.1:4315/sessions`:

- CORS preflight for `POST /api/dashboard/session` returned `200` with `Access-Control-Allow-Methods: POST, OPTIONS`, `Access-Control-Allow-Credentials: true`, and `Access-Control-Allow-Headers: x-panopticon-internal-token, authorization, content-type`.
- `POST /api/dashboard/session` with trusted origin but no internal token returned `401`.
- `POST /api/dashboard/session` with trusted origin and `x-panopticon-internal-token: uat-dashboard-token` returned `200` and `Set-Cookie: panopticon_session=uat-browser-session-token; Path=/; HttpOnly; SameSite=Strict`.
- The same request with `x-forwarded-proto: https` returned a cookie with `; Secure`.
- Loading `/sessions#panopticon_token=uat-dashboard-token` consumed and removed the fragment token, then rendered `Session History` at `/sessions`.
- Same-page `fetch('/api/discovered-sessions/stats', { credentials: 'include' })` returned `200` and the validated stats shape.
- Same-page `fetch('/api/discovered-sessions?limit=1', { credentials: 'omit' })` returned `401 {"error":"unauthorized"}`, confirming transcript-derived metadata is not exposed without the dashboard session/shared-secret credential.

## Requirements evidence — L1/L2 sampling semantics

`src/lib/conversations/__tests__/enrichment.test.ts` now proves the requirement executablely:

- L1 sends exactly 3 sampled transcript messages into the single provider prompt: first, one deterministic middle sample, and last.
- L2 sends exactly 11 sampled transcript messages into the single provider prompt: first 3, five deterministic middle samples, and last 3.
- Tool-use blocks are represented as summaries such as `[tool_use:Read]`; raw tool inputs are not sent.

## Requirements evidence — HTTP response validation

`src/dashboard/server/routes/discovered-sessions.ts` validates every successful discovered-session HTTP response before serialization with Effect `Schema.decodeUnknownSync()`:

- stats, list, search, semantic-error search fallback, cost, get-by-id,
- scan, enrich-by-id, bulk enrich, embed,
- config GET, config PUT, and test-connection.

## Requirements evidence — cost estimate accuracy

Cost-estimate behavior is covered by sample-run tests:

- `src/lib/conversations/__tests__/scanner.test.ts` validates the 20% scan-cost tolerance boundary and warns when matched `cost_events` differ by more than 20%.
- `src/lib/conversations/__tests__/enrichment.test.ts` now runs a mocked enrichment sample where actual cost is 110% of estimate and asserts the estimate-vs-actual delta is within the 20% tolerance.
