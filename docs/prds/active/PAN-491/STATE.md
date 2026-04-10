# PAN-491: bun:sqlite named param binding broken in event-store.ts

## Status: Implementation Complete

## Problem

`bun:sqlite` requires the sigil prefix in binding keys for named parameters (e.g., `{ ':name': value }` or `{ '$name': value }`), while `better-sqlite3` accepts bare keys (`{ name: value }`). Code using `:name` SQL params with `{ name: value }` bindings works under Node/better-sqlite3 but silently nulls all params under Bun, causing NOT NULL constraint failures.

## What Was Already Done

The primary fix for `event-store.ts` was applied in commit `b2ade102` on `feature/pan-488` and **already merged to main**. That commit converted all SQL in `event-store.ts` from named parameters (`:name`/`$name`) to positional parameters (`?`) with array bindings, which work identically across both runtimes.

## Remaining Work
None — all work complete.

## Approach

Convert `projection-cache.ts` from `:name` named params to positional `?` params with array bindings, matching the pattern already established in `event-store.ts`. This is a mechanical change — same fix, different file.

## Scope

- **In scope:** Fix `projection-cache.ts` named params, verify no other dashboard server SQLite files are affected
- **Out of scope:** `src/lib/` database files (already use positional params, run under Node CLI only)

## Audit Results

Files checked for named-param binding issues:
- `src/dashboard/server/event-store.ts` — ✅ Already fixed (positional params)
- `src/dashboard/server/services/projection-cache.ts` — ❌ Still uses `:name` params
- `src/dashboard/server/services/cache-service.ts` — ✅ Uses positional params
- `src/lib/database/conversations-db.ts` — ✅ Positional params
- `src/lib/database/cost-events-db.ts` — ✅ Positional params
- `src/lib/database/health-events-db.ts` — ✅ Positional params
- `src/lib/database/review-status-db.ts` — ✅ Positional params

## Difficulty

**Simple** — single file, mechanical change following an established pattern.

## Current Phase
All work complete. Ready for review.

## Completed Work
- [x] feature-pan-489-7nk: Convert projection-cache.ts to positional SQL params (commit: 89e7cd8c)

## Key Decisions
- D1: Pre-existing typecheck errors in sync.ts and build errors in frontend are unrelated to this fix and existed before this branch.

## Specialist Feedback
(none yet)
