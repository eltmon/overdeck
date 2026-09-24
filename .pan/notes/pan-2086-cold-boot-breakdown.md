# PAN-2086 cold-boot breakdown

Source: `/home/eltmon/.overdeck/logs/dashboard.log`, lines 6915195-6915263.

## Measured boot window

- Process module graph loaded: `2026-07-03T10:20:37.004Z`, `[boot-timing] module graph loaded at +434ms`.
- HTTP server listening: `2026-07-03T10:22:08.349Z`, `[boot-timing] HTTP server listening at +91780ms`.
- Spawn-to-listen: 91,780ms.

## Phase attribution

- WAL replay / `cache.db` open: no `cache.db opened (WAL replay)` line was emitted in this boot. The dashboard reached module-load at +434ms, so WAL replay was not visible as a material contributor in this window.
- Conversation search / memory FTS startup: `conversation-search` completed at `2026-07-03T10:22:06.741Z`, indexing 0 chunks across 8173 files. It completed about 1,608ms before listen. It did not block listen by itself; it ran while other startup work was active.
- ReadModel local database bootstrap: `2026-07-03T10:22:08.330Z`, 416 agents, 22 review statuses, 23 in-flight issues.
- ReadModel issue merge: `2026-07-03T10:22:08.333Z` to `2026-07-03T10:22:08.349Z`, merging 86 issues. Cost: about 16ms.
- Dominant delay before listen: startup side effects before the ReadModel layer resolved. The same window shows a 35,723ms GitHub open-issues fetch, a 40,672ms GitHub closed-issues fetch that failed with a TLS disconnect, deacon startup/auto-resume work, tmux resume retries, and a workspace Docker stack rebuild for PAN-2148.

## Task 4 decision

No-go. Task 4 would move HTTP listen before the full ReadModel issue merge, but the measured ReadModel merge cost in the reproduced 91.780s boot was about 16ms. The delay was dominated by tracker/network/deacon/workspace startup work before listen, so partial ReadModel hydration would not materially improve this cold path.
