## Update — two more engine increments landed (2026-06-09)

On top of the foundation:
- **Conflict-aware merge order** (`fa43d7a11`) — `computeMergeQueue` now orders by the conflict graph it already builds (disjoint-safe first, then conflicting clusters broadest-footprint-first) instead of issue number. Extracted to a pure `orderMergeCandidates()` + unit-tested. *Advisory only* — the queue is display/planning; this does not yet change what the executor merges.
- **Hold-for-UAT actually blocks auto-merge** (`32c1dcf92`) — `isAutoMergeEligible` returns ineligible when `autoMerge === false`. `undefined`/`true` are unaffected, so this can only make auto-merge *more* conservative. The 🔒 Hold toggle is now functional end-to-end. Tested.

**Still remaining (the merge-critical core):** make the executor *drive* merges from the conflict-aware order, the rolling auto-rebase-onto-updated-main + re-verify loop, and on-demand UAT-candidate assembly. That's the part that fixes PAN-1240 / PAN-1215 / PAN-1213 / PAN-1658 — still open, best built as its own reviewed change (ideally behind a default-off flag).
