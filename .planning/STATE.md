# PAN-830: Unified Command Deck — issue + agent + workflow as one surface

## Status: In Progress

## Current Phase
Bootstrapping planning artifacts. Implementing Phase 1 (server-side reviewer canonical naming + JSONL resolution fix) before moving to frontend zones and liveness components.

## Completed Work
- pan-4r2w: Phase 1 — Added `getReviewerSessionName(role, projectKey, issueId)`, `parseReviewerSessionName`, `ReviewerRole` type, and `REVIEWER_ROLES` constant to `src/lib/cloister/specialists.ts`. Unit test added at `src/lib/cloister/__tests__/specialists-reviewer-name.test.ts` (9 tests, all passing).
- pan-fard: Phase 1 — Replaced timestamp-based reviewer fan-out in `runParallelReview` (review-agent.ts) with canonical resume-or-spawn: tmux sessions are now `specialist-<projectKey>-<issueId>-review-<role>` and persist across rounds via `sendKeysAsync` follow-up + `remain-on-exit on`. Synthesis follows the same pattern. Renamed `cleanupReviewerStateDirs` → `archiveReviewerRound`, which writes `~/.panopticon/agents/<reviewer-id>/round-N.json` artifacts instead of deleting state dirs. 5 unit tests added at `src/lib/cloister/__tests__/archive-reviewer-round.test.ts` covering first-write, increment, no-deletion-of-state, missing-dir, and synthesis status mapping.

## Remaining Work
- [ ] pan-nk6b: Phase 1 — Rewrite `resolveJsonlPath` to use `claudeSessionId` from `state.json`
- [ ] pan-lhh8: Phase 1 — Update `extractReviewerRole` + command-deck route to surface one canonical reviewer node per role
- [ ] pan-d53s: Phase 3 — Liveness building blocks (StatusDot, LiveCounter, RoleBadge, RoundCard, ToolFlash, ActivitySparkline) + 5 keyframes
- [ ] pan-11sr: Phase 2 — Three-zone shell (IssueWorkbench, ZoneA, ZoneB, ZoneCConversation, ZoneCOverview)
- [ ] pan-ofa3: Phase 4 — Issue-selected mode tab strip + Overview tab
- [ ] pan-y6ge: Phase 6 — MessagesTimeline round dividers via `roundMarkers` prop

## Key Decisions
- D1: Implementing Phase 1 first (server-side fan-out fix + JSONL fix) — these are root causes; without them the tree shows ghost reviewers and conversations never load. Frontend liveness is layered on top.
- D2: Existing CommandDeck dir at `src/dashboard/frontend/src/components/CommandDeck/` already has IssueHeader/SessionPanel/ConversationList — Phase 2 is therefore a refactor, not a greenfield build. Keeping existing components when they map cleanly to Zone A/B/C; introducing new ZoneA/ZoneB/ZoneCConversation/ZoneCOverview components for the additive surfaces (sparkline, ToolFlash, tabbed overview).
- D3: Round metadata is read from `~/.panopticon/agents/<reviewer-id>/round-N.json` artifacts written by `archiveReviewerRound`. The aggregated state is exposed via the existing command-deck snapshot endpoint.

## Specialist Feedback
- (none yet)
