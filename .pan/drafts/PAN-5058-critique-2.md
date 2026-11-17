plan-digest: 74fcb59789d999c1dfdedf809a7088cf51c1cb2d00b668319d410b3e176f967d

## blocks-the-design: Muse token header can be rejected

The PRD says to give Muse the issued access token “as the `Authorization` value” ([`.pan/drafts/PAN-5058.md`](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5058/.pan/drafts/PAN-5058.md), line 132; W-4, line 222). The server extracts a token only from `Authorization: Bearer <token>` (`src/dashboard/server/routes/dashboard-auth.ts`, lines 116–120); a bare token produces a 401 at `src/dashboard/server/routes/mcp.ts`, lines 112–117. The checkpoint could therefore classify a usable Muse connection as failed. Specify `Bearer <token>` when Muse asks for a complete Authorization header value, and token-only input only when Muse explicitly adds the Bearer scheme. Confirm the observed scheme from the public MCP audit before interpreting a 401.

## blocks-the-design: Checkpoint teardown races the redirect fix

W-3 requires repeating the Grok Bot live steps after the conditional redirect fix ([`.pan/drafts/PAN-5058.md`](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5058/.pan/drafts/PAN-5058.md), line 216). W-2 step 0 says to stop the peer and remove Funnel mounts when checkpoints finish (line 189), and the xBRIEF's W-2 action says to do so after W-4. The xBRIEF edges allow W-4 to run immediately after W-2, before W-3. W-4 can thus remove the server and mounts needed for W-3's required retest. Add a W-3 → W-4 dependency, or make cleanup a separate item blocked by both the W-3 retest or cancellation and W-4.

## blocks-the-design: Failed Grok Bot route is still recommended

On a failed CP-1, W-5 keeps the connector first and tells users “Use Public MCP” from its connector warning ([`.pan/drafts/PAN-5058.md`](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5058/.pan/drafts/PAN-5058.md), lines 229–230). The same item says the connector is known to fail from Grok Bot's sandbox and Public MCP failed live. The current platform list uses its first reach as the default (`src/dashboard/frontend/src/components/Settings/anywhere/botSnippets.ts`, line 21; `ConnectBotDialog.tsx`, lines 198–209). That branch would present two failed routes, default to one, and recommend the other. For the failure branch, show Grok Bot as unverified or unavailable with the dated cause; do not call either route a working setup until a follow-up live run succeeds.
