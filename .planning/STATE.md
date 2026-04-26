# PAN-850: Merge flow: stuck on no-op rebase + tight GitHub merge poll timeout

## Status: Implementation Complete

## Current Phase
All beads implemented, tested, and pushed. Ready for merge.

## Completed Work
- [x] pan-47zu: Add no-op rebase detection to triggerMerge in workspaces.ts (commit: c62b8aff)
- [x] pan-uopq: Increase GITHUB_MERGE_TIMEOUT_MS to 15 minutes in forge.ts (commit: 9aad69df)
- [x] pan-mtds: Preserve readyForMerge on transient merge failures in workspaces.ts (commit: 8015f35c)
- [x] pan-fl83: Unit tests for no-op rebase path and timeout value (commit: e2a7fd06)

## Remaining Work
(None — all beads complete)

## Key Decisions
- Using `git merge-base --is-ancestor` pre-check (as specified in issue body) to skip rebase when branch already contains target
- Timeout increase to 15 minutes (issue spec); not making configurable to keep change minimal
- Transient failure detection: checking for "Timed out waiting for GitHub PR" message
- Extracted `isBranchAlreadyRebased` helper from triggerMerge for testability

## Specialist Feedback
(None yet)
- **[2026-04-26T19:01Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
