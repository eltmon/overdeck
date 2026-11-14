---
type: feedback
description: pan sync-main auto-commits the whole dirty tree as 'pre-sync
  commit' before merging main; commit item work first
updated: 2026-11-14
---

pan sync-main <ID> run with uncommitted work creates one 'chore: pre-sync commit before sync with main' containing every dirty and untracked file, which breaks one-item-per-commit evidence (seen PAN-5283, 2026-11-14, commit 2b5ef294a9a).

**Why:** history rewrites are forbidden, so the bundle cannot be split afterwards; items then need empty evidence commits.

**How to apply:** before pan sync-main, commit each finished item (or leave the tree clean); never run it with several items' files uncommitted.
