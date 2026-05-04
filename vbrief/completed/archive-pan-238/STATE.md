# PAN-238: Cost recording generates ~50% duplicate events despite flock serialization

## Status: Implementation Complete

## Root Cause

The flock serialization (PAN-220) is working correctly — it prevents concurrent invocations from reading the same byte range. However, **Claude Code's transcript file itself contains multiple entries per API request** (same `requestId`).

Evidence from a live transcript:
- 26 assistant entries with usage data → only 9 unique `requestId`s (65.4% duplicates)
- Each `requestId` appears 2-5 times in the transcript JSONL

The cost recorder (`record-cost-event.ts`) processes all new transcript lines and emits a cost event for every `assistant` entry with usage data. Since the transcript contains multiple entries per request, we get multiple cost events per request — within a **single invocation**.

The flock doesn't help because the duplicates exist within a single processing batch, not across concurrent invocations.

## Decisions

1. **Fix at the source**: Deduplicate by `requestId` in `record-cost-event.ts` during transcript processing
2. **Persistent requestId tracking**: Persist seen requestIds to a per-session state file (alongside `.offset`) to guard against crash-before-write scenarios
3. **Upgrade deduplicateEvents()**: Replace the heuristic 60-second window dedup with `requestId`-based dedup for precision
4. **One-time data cleanup**: Run dedup after deploy to clean historical duplicates
5. **Add requestId to CostEvent**: Include `requestId` in the event type for traceability

## PAN-236 Dependency

PAN-236 (TLDR session metrics) is merging concurrently and modifies two of our target files:

- **`src/lib/costs/events.ts`** — PAN-236 adds optional TLDR fields to `CostEvent`. We add `requestId?` alongside them. No conflict.
- **`scripts/record-cost-event.ts`** — PAN-236 adds TLDR metrics capture and attaches `...tldrFields` to the first event in each batch using a `tldrAttachedToFirstEvent` flag. Our requestId dedup goes *before* the TLDR attachment in the loop. After dedup, TLDR metrics attach to the first *surviving* (non-duplicate) event, which is correct behavior.

**Implementation note**: Rebase on main after PAN-236 merges before starting work. The `record-cost-event.ts` loop now has a TLDR block that must be preserved.

## Architecture

### Current Flow (broken)
```
PostToolUse → heartbeat-hook → flock → record-cost-event.ts
  → reads transcript from byte offset
  → processes ALL assistant messages with usage (including dupes)
  → appends cost events (duplicates included)
  → saves byte offset
```

### Fixed Flow
```
PostToolUse → heartbeat-hook → flock → record-cost-event.ts
  → reads transcript from byte offset
  → loads persisted requestId set from state/{sessionId}.seen
  → processes assistant messages, SKIPPING already-seen requestIds
  → appends cost events (no duplicates, TLDR metrics on first surviving event)
  → saves byte offset AND updated requestId set
```

## Files to Modify

| File | Change | Difficulty |
|------|--------|-----------|
| `scripts/record-cost-event.ts` | Add requestId dedup + persist seen set (work with PAN-236's TLDR block) | medium |
| `src/lib/costs/events.ts` | Add `requestId?` to CostEvent (after PAN-236's TLDR fields), upgrade deduplicateEvents() | medium |
| `src/lib/costs/__tests__/events.test.ts` | Update dedup tests for requestId-based logic | simple |
| `src/lib/costs/index.ts` | Re-export updated types (if needed) | trivial |

## Risks

- **requestId availability**: Verified — all assistant entries in the transcript have `requestId`. The field has been present in Claude Code transcripts since at least the current format.
- **Persisted seen-set growth**: Bounded per session. Sessions have finite lifetimes and the set only tracks requestIds, not full events. Can prune on session end.
- **Backward compatibility**: `requestId` is optional on `CostEvent` — older events without it are unaffected. The upgraded `deduplicateEvents()` falls back to timestamp heuristic for events missing `requestId`.
- **PAN-236 interaction**: TLDR metrics attachment uses a `tldrAttachedToFirstEvent` flag. With dedup, fewer events survive per batch, but the flag still attaches to the first survivor. No behavioral change needed.

## Current Status

Implementation complete. All 3 beads closed.

## Remaining Work

None.

## Implementation Summary

- `scripts/record-cost-event.ts` + `.js`: requestId dedup with persistent seen-set (`state/{sessionId}.seen`). Each requestId emits exactly one cost event per session.
- `src/lib/costs/events.ts`: `requestId?` added to `CostEvent`. `deduplicateEvents()` upgraded with two strategies: primary requestId-based exact dedup; fallback 60-second window heuristic for legacy events.
- `src/lib/costs/__tests__/events.test.ts`: 4 new tests for requestId dedup (10 total, all pass).
- `src/dashboard/server/index.ts`: Startup call to `deduplicateEvents()` for one-time historical cleanup.

Build passes, all tests pass (XTerminal timeout failure is pre-existing on main).
