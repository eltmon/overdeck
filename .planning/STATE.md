# PAN-830: Unified Command Deck — issue + agent + workflow as one surface

## Status: In Progress

## Current Phase
Phase 1 server-side fixes + Phase 3 liveness building blocks complete. Moving to Phase 2 three-zone shell (pan-11sr).

## Completed Work
- pan-4r2w: Phase 1 — Added `getReviewerSessionName(role, projectKey, issueId)`, `parseReviewerSessionName`, `ReviewerRole` type, and `REVIEWER_ROLES` constant to `src/lib/cloister/specialists.ts`. Unit test added at `src/lib/cloister/__tests__/specialists-reviewer-name.test.ts` (9 tests, all passing).
- pan-fard: Phase 1 — Replaced timestamp-based reviewer fan-out in `runParallelReview` (review-agent.ts) with canonical resume-or-spawn: tmux sessions are now `specialist-<projectKey>-<issueId>-review-<role>` and persist across rounds via `sendKeysAsync` follow-up + `remain-on-exit on`. Synthesis follows the same pattern. Renamed `cleanupReviewerStateDirs` → `archiveReviewerRound`, which writes `~/.panopticon/agents/<reviewer-id>/round-N.json` artifacts instead of deleting state dirs. 5 unit tests added at `src/lib/cloister/__tests__/archive-reviewer-round.test.ts` covering first-write, increment, no-deletion-of-state, missing-dir, and synthesis status mapping.
- pan-nk6b: Phase 1 — Rewrote `resolveJsonlPath` in `src/dashboard/server/routes/command-deck.ts` to look up the agent's `claudeSessionId` (session.id → sessions.json → runtime state) and build the path at `~/.claude/projects/<encoded-workspace>/<claudeSessionId>.jsonl`. Extracted into a standalone module `src/dashboard/server/routes/jsonl-resolver.ts` with `agentsDirOverride`/`claudeProjectsDirOverride`/`getRuntimeStateAsync` test hooks. 15 unit tests added at `src/dashboard/server/routes/__tests__/jsonl-resolver.test.ts` covering all three lookup paths, precedence (session.id > sessions.json > runtime), null/missing/malformed cases, and the regression where the old code looked for `<agentId>.jsonl`.
- pan-lhh8: Phase 1 — Replaced legacy timestamp-based reviewer fan-out in `command-deck.ts` (lines 435-583) with a single `buildReviewerNodes(...)` call. Extracted reviewer-tree logic into `src/dashboard/server/routes/reviewer-tree.ts` exporting `extractReviewerRole` (canonical + legacy), `readReviewerRounds` (reads `round-N.json` artifacts), and `buildReviewerNodes` (always returns exactly 5 canonical reviewer nodes in `REVIEWER_ROLES` order). Removed `scanPersistedReviewerRoles` and the timestamp-filter discovery block. Added `roundMetadata?: ReviewerRoundMetadata` to the section payload so round history flows to the dashboard. 23 unit tests added at `src/dashboard/server/routes/__tests__/reviewer-tree.test.ts` covering both pattern parsers, round artifact reading (sorted, malformed-skipping), and node-count/presence/status invariants.
- pan-d53s: Phase 3 — Added 6 reusable Command Deck building blocks under `src/dashboard/frontend/src/components/CommandDeck/`: `StatusDot.tsx` (6/8px circle, status-driven pulse), `LiveCounter.tsx` (vertical scroll fade + unit pulse + big-jump highlight), `RoleBadge.tsx` (lucide icon + ring color by role/reviewer-role), `RoundCard.tsx` (140px mini-card with `anim-round-active` sweep + verdict pill), `ToolFlash.tsx` (200ms cross-fade tool name with `prev → current`), `ActivitySparkline.tsx` (120×16 SVG histogram, sliding window). Added 5 keyframes to `src/dashboard/frontend/src/index.css`: `alive-dot`, `kf-stuck-shake`, `kf-error-shake`, `kf-row-flash`, `kf-round-active` plus 8 utility classes (`anim-alive-dot-{active,thinking,waiting,idle}`, `anim-stuck-shake`, `anim-error-shake`, `anim-row-flash`, `anim-round-active`). 62 unit tests across 6 test files (`__tests__/{StatusDot,LiveCounter,RoleBadge,RoundCard,ToolFlash,ActivitySparkline}.test.tsx`) — all passing. Frontend typecheck and full 753-test suite clean.

## Remaining Work
- [ ] pan-11sr: Phase 2 — Three-zone shell (IssueWorkbench, ZoneA, ZoneB, ZoneCConversation, ZoneCOverview)
- [ ] pan-ofa3: Phase 4 — Issue-selected mode tab strip + Overview tab
- [ ] pan-y6ge: Phase 6 — MessagesTimeline round dividers via `roundMarkers` prop

## Key Decisions
- D1: Implementing Phase 1 first (server-side fan-out fix + JSONL fix) — these are root causes; without them the tree shows ghost reviewers and conversations never load. Frontend liveness is layered on top.
- D2: Existing CommandDeck dir at `src/dashboard/frontend/src/components/CommandDeck/` already has IssueHeader/SessionPanel/ConversationList — Phase 2 is therefore a refactor, not a greenfield build. Keeping existing components when they map cleanly to Zone A/B/C; introducing new ZoneA/ZoneB/ZoneCConversation/ZoneCOverview components for the additive surfaces (sparkline, ToolFlash, tabbed overview).
- D3: Round metadata is read from `~/.panopticon/agents/<reviewer-id>/round-N.json` artifacts written by `archiveReviewerRound`. The aggregated state is exposed via the existing command-deck snapshot endpoint.
- D4: Liveness components are pure presentational (no data fetching, no event subscriptions) — Phase 2 components will plumb data into them. `ReviewerRole` is defined locally in `RoleBadge.tsx` rather than imported from `@panopticon/contracts` (which doesn't export it) or from `src/lib/cloister/specialists.ts` (server-side, cross-workspace import boundary). Keep the duplicate small and stable; widen the contracts package later if needed.

## Specialist Feedback
- (none yet)

## Pre-existing Test Failures (not caused by this branch)
- `tests/unit/dashboard/server/routes/projects.test.ts` — 2 failures in `fetchProjectSessionTree` ("aggregates sessions for active feature workspaces", "resolves feature title from PLANNING_PROMPT.md"). Verified failing on HEAD without pan-d53s changes (stashed-and-tested 2026-04-25). Likely fallout from PAN-821 workspace-resolution refactor; out of scope for PAN-830.
- `tests/unit/dashboard/server/routes/mission-control.test.ts` — fails as a whole module. Same provenance; pre-existing.
