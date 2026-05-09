# PAN-412: Beads Lifecycle Gaps

## Summary
Fixed three beads lifecycle issues:
1. `createBeadsFromVBrief` now idempotent — clears existing beads before creating new ones
2. `wipe.ts` CLI now clears beads before workspace deletion
3. Root cause found and fixed: `clearProjectBeads` was running on every teardown (including normal approve), not just wipe

## Current Status
Implementation complete. All tests pass (1781/1781).

## Remaining Work
None.
