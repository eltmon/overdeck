plan-digest: de9f29c62380af240338939ccece62c365d0e29032e6aee3655e31363f083c2c

## blocks-the-design: Shared query key does not mean one poll

WI-2/NFR-2 say `usePendingAgentRequestDecisions()` and `useDecisions()` can each set `refetchInterval: 5000` on `['agent-requests']` and still make one request per poll. The installed React Query implementation creates a timer per `QueryObserver` (`node_modules/.bun/@tanstack+query-core@5.103.2/node_modules/@tanstack/query-core/src/queryObserver.ts`, lines 110–120 and 518–537). `useDecisions` already sets that interval (`src/dashboard/frontend/src/lib/useDecisions.ts`, lines 499–504); the new hook would add an observer in the global host, each pinned card, the conversation list, and the dock. Staggered timers issue separate fetches, so the plan violates its explicit no-new-polling requirement. Make one mounted owner responsible for the interval and let other consumers observe the same key without an interval. Test staggered mounts with fake timers and assert the request count over one interval.

## blocks-the-design: A secret request can leave the Live dock empty

WI-7 only adds request issue ids to `needsYouIds`. `useLiveDockItems` creates panels from explicitly docked issues and conversations with `pendingAskUserQuestion` (`src/dashboard/frontend/src/components/dock/ConversationDock.tsx`, lines 106–164). A conversation with only an agent request creates neither, while `LiveTab` hides when `items.length === 0` (`src/dashboard/frontend/src/components/dock/LiveTab.tsx`, lines 31–42). This contradicts FR-7's promise that an issue whose conversation owns a request shows a Live dock needs-you dot. Add conversation-owned requests to the dock's item construction, with an owner-visible answer path, and test the undocked conversation case; or explicitly narrow FR-7 and the UI wording to already docked issues.

## sharpens-framing: Drawer test path points to a nonexistent file

WI-6b and the xBRIEF name `src/dashboard/frontend/src/components/drawer/__tests__/DrawerAgentSession.test.tsx`, but `rg --files src/dashboard/frontend/src/components/drawer` finds the existing test at `src/dashboard/frontend/src/components/drawer/DrawerAgentSession.test.tsx`. `scripts/frontend-test-subset.txt`, line 312, also lists that adjacent path. Correct the file scope and verify command to the existing test file so the terminal-view assertions run in CI.

## sharpens-framing: List and indicator behavior lack a component check

WI-7 acceptance says the overlaid owner reaches `partitionConversationSections` and the pulsing indicator selects that conversation, but its only named frontend test is `useDecisions.test.ts`, which covers the pure `withPendingAgentRequests` helper. The behavior depends on wiring in `ConversationList.tsx`, lines 545–572, and `ConversationRow.tsx`, lines 563–572; a missing memo dependency or wrong indicator callback would pass the proposed helper tests. Add a focused component test in the existing `ConversationList.test.tsx` or `ConversationRow.test.tsx` for section placement and indicator click, and include that file in WI-7 verification.
