<<<<<<< HEAD
# Agent State: PAN-540
=======
# PAN-704: FeatureCard action buttons (Plan / See Plan / vBRIEF / Tasks)

## Status: In Progress

## Current Phase
Preparing the extraction bead commit for reusable planning chips in `src/dashboard/frontend/src/components/PlanningChips.tsx` and the `KanbanBoard.tsx` refactor, then closing the final implementation bead before full-suite verification.

## Completed Work
- [x] Workspace context loaded, restart check completed, and branch rebased onto `origin/main` with no new changes required.
- [x] ba4f48a7 / panopticon-cli-1ln9 implementation: added FeatureCard action bar buttons, planning-active watch state, and IssueColumn prop wiring.
- [x] ce0e4cb1 / panopticon-cli-sofu: added RTL coverage for FeatureCard chips, handler routing, planning watch state, and stopPropagation.
- [x] Verified targeted frontend checks after extraction changes: `npm test -- KanbanBoard.test.tsx`, `npm run typecheck`, and `npm run lint` all pass.

## Remaining Work
- [ ] panopticon-cli-l9hu: commit and close reusable `PlanChip`, `VBriefChip`, and `TasksChip` extraction, with `IssueCard` and `FeatureCard` consuming them.
- [ ] Run full quality gates (`npm test`) across the repo, push the branch, and call `pan done PAN-704` after all beads pass inspection.

## Key Decisions
- Keep `FeatureCard` exported from `KanbanBoard.tsx` so RTL can import it directly without introducing another wrapper file.
- Land the FeatureCard action bar first and keep RTL as its own bead because the beads graph blocked closing the action-bar bead until the test bead was complete.
- Centralize plan / vBRIEF / tasks behavior in `PlanningChips.tsx` while keeping `IssueCard`’s own planning-state query for Start Agent gating; React Query dedupes the chip subscriptions.
- Follow the workspace rule to install dependencies locally with `bun install`; this workspace initially had no `node_modules`, which blocked Vitest until installed.
>>>>>>> 00693a15 (refactor(dashboard): extract planning action chips)

## Specialist Feedback

- **[2026-04-20T13:24Z] test-agent → FAILED** — `.planning/feedback/080-test-agent-failed.md`
- **[2026-04-20T13:45Z] verification-gate → FAILED** — `.planning/feedback/081-verification-gate-failed.md`
- **[2026-04-20T14:36Z] review-agent → COMMENTED** — `.planning/feedback/082-review-agent-commented.md`
- **[2026-04-20T15:02Z] review-agent → COMMENTED** — `.planning/feedback/083-review-agent-commented.md`
- **[2026-04-20T15:13Z] review-agent → COMMENTED** — `.planning/feedback/084-review-agent-commented.md`
- **[2026-04-20T15:15Z] review-agent → COMMENTED** — `.planning/feedback/085-review-agent-commented.md`
- **[2026-04-20T15:18Z] review-agent → COMMENTED** — `.planning/feedback/086-review-agent-commented.md`
- **[2026-04-20T15:23Z] review-agent → COMMENTED** — `.planning/feedback/087-review-agent-commented.md`
- **[2026-04-20T15:25Z] review-agent → COMMENTED** — `.planning/feedback/088-review-agent-commented.md`
- **[2026-04-20T15:33Z] review-agent → COMMENTED** — `.planning/feedback/089-review-agent-commented.md`
- **[2026-04-20T15:44Z] review-agent → COMMENTED** — `.planning/feedback/090-review-agent-commented.md`
- **[2026-04-20T15:49Z] review-agent → COMMENTED** — `.planning/feedback/091-review-agent-commented.md`
- **[2026-04-20T16:35Z] verification-gate → FAILED** — `.planning/feedback/092-verification-gate-failed.md`
- **[2026-04-20T16:54Z] verification-gate → FAILED** — `.planning/feedback/093-verification-gate-failed.md`
- **[2026-04-20T16:57Z] verification-gate → FAILED** — `.planning/feedback/094-verification-gate-failed.md`
- **[2026-04-20T17:12Z] verification-gate → FAILED** — `.planning/feedback/095-verification-gate-failed.md`
- **[2026-04-20T17:21Z] verification-gate → FAILED** — `.planning/feedback/096-verification-gate-failed.md`
- **[2026-04-20T18:11Z] review-agent → COMMENTED** — `.planning/feedback/097-review-agent-commented.md`
- **[2026-04-20T18:12Z] review-agent → COMMENTED** — `.planning/feedback/098-review-agent-commented.md`
- **[2026-04-20T19:47Z] review-agent → COMMENTED** — `.planning/feedback/099-review-agent-commented.md`
- **[2026-04-20T19:48Z] review-agent → COMMENTED** — `.planning/feedback/100-review-agent-commented.md`
- **[2026-04-20T19:49Z] review-agent → COMMENTED** — `.planning/feedback/101-review-agent-commented.md`
