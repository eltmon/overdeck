plan-digest: 920a6ffd3f9e205104165d4e2f98bc958312a94412d88d7637ae93e37d4ab775

## blocks-the-design: Scoped routes fail the telemetry test

The PRD adds three paths to `ROUTE_SCOPES` in WI-3/WI-6 ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5540/.pan/drafts/PAN-5540.md), lines 226 and 370), but its file scopes omit `packages/contracts/src/telemetry.ts`. The existing `route-scopes.test.ts` lines 82-86 asserts that **every** scoped path appears in `TELEMETRY_PROPERTY_DOMAINS.client_route`. That domain comes from the static `TELEMETRY_CLIENT_ROUTES` list in `packages/contracts/src/telemetry.ts` (lines 185-189, 483). I checked that list with `rg -n 'skills/packs|/api/skills' packages/contracts/src/telemetry.ts`: it has no matching path. The three required route-scope rows would therefore make the PRD's named test fail. Add all three paths to `TELEMETRY_CLIENT_ROUTES` and include that file in the route work items.

## blocks-the-design: Search hides available packs

WI-4 says to render `AvailablePacksSection search={search}` after the registered pack rows ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5540/.pan/drafts/PAN-5540.md), lines 247-264). But `SkillPacksSection.tsx` lines 143-146 currently returns `null` whenever a nonempty search has no **registered** pack match. Searching for `remotion` on a fresh machine, or searching for any unregistered known pack while other packs are registered, exits before the new Available section can render. This defeats the proposed search filter and the Add entry point for that query. Change that early return so availability matches can render, and add a test that searches for an unregistered pack and finds its Available row and Add action.

## sharpens-framing: Preview concurrency requirement conflicts with its implementation

NFR-5 ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5540/.pan/drafts/PAN-5540.md), line 56) says a second concurrent request for the same id gets HTTP 409 `busy`. D-11 and the `runExclusive` code prescribed in WI-5 (lines 72 and 297-307) instead share one in-flight promise between two previews, and `known-add-core.ac4` requires both previews to succeed. Change NFR-5 to state the actual rule: two previews share one operation, while any preview/add overlap involving an add returns 409.
