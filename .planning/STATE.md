# PAN-847: Command Deck polish, enrichment, motion catalog, and perf hardening

## Status: In Progress

## Current Phase
Implementing backend perf beads (cache keying + async fan-out) before moving to frontend enrichment.

## Completed Work
- [x] Planning: Created 12 beads for PAN-847 follow-up work
- [x] pan-atj7: Keyed costCache by issueId and closedIssuesCache by repo; added invariant tests (commit: ffffe192)
- [x] pan-3h57: Parallelized fetchIssueDiscussions steps 1-3 and archiveReviewerRound writes (commit: 013bcf0e)
- [x] pan-l4jb: Liveness: centralized event-to-motion catalog wiring (commit: 2dc204c1)

## Remaining Work
- [ ] pan-6zyx: Zone A enrichment: activity sparkline, quality-gates, stash warning, acceptance progress
- [ ] pan-6zyx: Zone A enrichment: activity sparkline, quality-gates, stash warning, acceptance progress
- [ ] pan-mc22: Zone B enrichment: output buffer, idle/thinking/waiting states, cost rate, summary line
- [ ] pan-sjj5: Overview tab: real test summary and PR summary cards
- [ ] pan-35kn: Density rule: suppress default-value badges in Zone A
- [ ] pan-0h5k: Round marker derivation from roundMetadata
- [ ] pan-rtf5: Session-tab strip: Conversation/Terminal/Findings tabs
- [ ] pan-m1iu: Tree right-click menu: Pause, Resume, Stop, Restart, Deep Wipe, Open State Dir, View JSONL
- [ ] pan-0bms: Missing Zone B overflow actions
- [ ] pan-xvyz: PrDiffTab virtualization for large diffs

## Key Decisions
- Backend beads (cache keying, async fan-out) go first since they're self-contained and testable
- Frontend beads will follow in dependency order: motion catalog first (other components depend on it), then Zone A/B enrichment, then structural features (tabs, menus)

## Specialist Feedback
- None yet
