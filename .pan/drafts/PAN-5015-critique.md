plan-digest: e4be8da8d3b32912a7508d222bd00400a36823854e18d39fca97aabe076a251a

## sharpens-framing: qualify the 500 boundary

The proposed regex in PRD WI-1 matches `something went wrong while executing your query` without inspecting a status code; `isTransientForgeError` tests the full message or stderr (`src/lib/forge-transient.ts`, lines 18–24). PRD D3 says a **raw** 500 is excluded, but WI-3 instructs the docs to say “A 500 does not.” That sentence is false for a 500 response carrying the GraphQL phrase, and it may mislead a later implementer about the classifier's boundary. Change the WI-3 text and its acceptance criterion to say “A status-only HTTP 500, without that GraphQL phrase, does not count.” Keep D3's raw-500 decision.
