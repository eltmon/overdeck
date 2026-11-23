plan-digest: 0707de61efcb0804c803592b91c3f8f910acc6bd69e533b9a83ab96434947d77

## blocks-the-design: Relay requests can impersonate Funnel

The PRD defines `publicIngressOf` as “Funnel header, or a tagged relay socket” and gives the Funnel branch priority in the gate (`.pan/drafts/PAN-5058.md`, lines 117 and 246). The existing Funnel predicate checks only header presence (`src/dashboard/server/routes/dashboard-auth.ts`, lines 500-503), while the Funnel gate admits `POST /hooks/*` (`src/dashboard/server/remote-request-gate.ts`, lines 130-133). A relay visitor controls HTTP headers inside its TLS connection and can send `Tailscale-Funnel-Request`, making a relay request take the Funnel branch and reach hooks despite NFR-3. Resolve the socket tag before any header check; a tagged relay socket must always be classified as relay and ignore the Funnel header. Add a test for a relay-tagged `POST /hooks/x` carrying that header, plus a spoofed `x-forwarded-for`, and require 404 with the tagged IP used for rate limiting.

## blocks-the-design: Early registration refusals are unaudited

W-1 inserts the audit only after `registerClient` returns `!result.ok` (`.pan/drafts/PAN-5058.md`, lines 141 and 152-162). The route already returns 400 before that call for a wrong media type, a body over 16 KiB, or invalid JSON (`src/dashboard/server/routes/mcp-oauth.ts`, lines 92-103); the existing acceptance test exercises all three (`src/dashboard/server/__tests__/mcp-oauth.test.ts`, lines 121-129). Those refused registrations would violate FR-2 and AC-W1. Route every non-201 registration response through one refusal-audit helper, with an empty origins list when there is no parseable body, and test each early return produces exactly one entry.

## blocks-the-design: CP-1 cannot identify a bare token from a 401

W-2 says a `Public MCP POST /mcp 401` activity entry means Grok Bot sent a bare token (`.pan/drafts/PAN-5058.md`, line 175). The public audit records only the surface, status and client ID (`src/dashboard/server/public-mcp-funnel.ts`, lines 64-74), and `/mcp` returns 401 whenever credential resolution fails (`src/dashboard/server/routes/mcp.ts`, lines 112-117). That includes a missing, malformed, expired or revoked Bearer token; the Bearer parser itself accepts only a `Bearer` scheme (`src/dashboard/server/routes/dashboard-auth.ts`, lines 116-120). CP-1 could record a false cause and trigger the wrong fix. Add a sanitized observation of the authorization scheme without its value, or record token form as unknown unless direct evidence establishes it. Do not infer “bare” from status alone.

## blocks-the-design: The Grok Bot dialog text is outside W-5

W-5 requires the Connect a bot dialog to state the CP-1 result and date, and to show a failure note if CP-1 fails (`.pan/drafts/PAN-5058.md`, lines 209-211; AC-W5 at line 281). Its only UI file is `botSnippets.ts`, where the Grok Bot entry holds a label and route order (`src/dashboard/frontend/src/components/Settings/anywhere/botSnippets.ts`, lines 17-23). The actual dialog note lives in `ConnectBotDialog.tsx`, lines 215-220, and the setup copy in `ConnectBotOutput.tsx`, lines 107-119. Include those components and their behavioral tests in W-5, and specify the dated copy for both the success and failure branches.

## blocks-the-design: Muse failure still ships a Muse route

W-4 says that if CP-2 finds Muse cannot use a custom URL, Muse becomes out of scope and `configuration/bots.mdx` gets no Muse section (`.pan/drafts/PAN-5058.md`, line 203). S-E nevertheless requires a Muse URL choice in the Connect a bot dialog and Muse route-table documentation (`.pan/drafts/PAN-5058.md`, lines 263-265). The current platform list has no Muse entry (`src/dashboard/frontend/src/components/Settings/anywhere/botSnippets.ts`, lines 13-23). Make every S-E Muse UI and documentation change conditional on a passed CP-2, and name the platform-list and output changes when it passes.

## sharpens-framing: Run the audited build before CP-1

W-1 changes the source route and verifies tests/typecheck (`.pan/drafts/PAN-5058.md`, lines 139-164), while W-2 expects its new activity entry from a live Grok Bot registration (`.pan/drafts/PAN-5058.md`, lines 169-175). A running dashboard retains its previously loaded route code; the plan never says to build, restart, and verify the live endpoint has W-1 before CP-1. Add that explicit checkpoint before collecting the registration result, or CP-1 may lack the observation that decides W-3.
