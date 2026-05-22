---
name: pan-approve
description: "pan approve has been removed — use the dashboard MERGE button instead"
triggers:
  - pan approve
  - approve agent work
  - merge agent mr
  - accept work
allowed-tools:
---

# pan approve — REMOVED

`pan approve` has been removed. Use the **dashboard MERGE button** instead.

## Why

`pan approve` was a legacy CLI command that bypassed critical infrastructure:
- **Merge queue** — no serialization, could collide with concurrent merges
- **Post-merge lifecycle** — no Docker cleanup, label cleanup, stash cleanup, beads compaction
- **Idempotency guards** — no protection against the infinite loop (PAN-328)
- **Verification gate** — no post-rebase quality checks

## What to do instead

1. Agent completes work → `pan done`
2. Review pipeline runs automatically
3. When review passes → `readyForMerge` becomes true
4. **Click MERGE in the dashboard**
5. Server orchestrates: rebase → verify → squash merge → full post-merge lifecycle
