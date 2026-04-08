# PAN-542: Session Rotation on Compaction — Planning Decisions

## Issue
Rotate specialist JSONL when Claude compacts (compact_boundary detected), keeping session files bounded in size.

## Context Summary

- **Specialists** use `--resume "${deterministicUUID}"` to accumulate context across spawns.
- Claude Code internally compacts sessions, writing a `{ "type": "system", "subtype": "compact_boundary" }` entry followed by a `{ "type": "user", "isCompactSummary": true }` entry with a narrative summary.
- The `isCompactSummary` content is a **plain text narrative** — not structured conversation history.
- `parseFromLastCompactBoundary()` (conversation-service.ts) already handles display-only: it parses only messages after the last boundary.
- PAN-541 (SQLite `session_compact_offsets`) **does not exist in code** — it must be implemented as part of this issue or as a prerequisite.

## Key Research Finding: Rotation Approach Doesn't Work As Proposed

The original proposal suggested:
1. Generate a new random UUID
2. Write a seed JSONL at `~/.claude/projects/{encoded-cwd}/{newUUID}.jsonl`
3. Use `--resume "${newUUID}"` (or fallback to `--session-id`)

**This doesn't work.** Investigation revealed:

| Flag | Behavior |
|------|----------|
| `--resume UUID` | Looks up `UUID` in Claude's internal `sessions-index.json` → uses that JSONL. If UUID not registered, fails (exit 127). |
| `--session-id UUID` | **Always creates a blank fresh session.** Does NOT load from any existing JSONL file. |

Since `--session-id` ignores seed files entirely, and `--resume` requires pre-registration in Claude's storage, **there is no way to create a session seeded with existing context via CLI**.

## Viable Approach: Truncate-to-Boundary

The only workable approach given CLI constraints:

1. **Detect** the last un-rotated `compact_boundary` (using `findLastCompactBoundary` + SQLite tracking).
2. **Truncate** the JSONL file to just after the `compact_boundary` + `isCompactSummary` entries (i.e., keep only the last 2 lines of the file).
3. **Keep the same UUID** — no rotation, no new session. The existing `--resume` flow continues unchanged.
4. **Record** the rotated boundary offset in SQLite (`session_compact_offsets`).
5. On next `--resume`, Claude re-reads the (now-small) JSONL + whatever is still in its in-memory context.

**Tradeoff**: If a session is revived after truncation (rare — normally sessions are continuously active), only the `isCompactSummary` narrative survives. All intermediate conversation history between the previous boundary and truncation is lost. This is **acceptable** because:
- The dashboard already uses `parseFromLastCompactBoundary` to show only the current window.
- Compaction already implies context is summarized — the full history is intentionally being discarded.
- Continuous specialist sessions rarely get revived from a truncated state.

## Files Affected

| File | Changes |
|------|---------|
| `src/lib/cloister/database.ts` | Add `session_compact_offsets` table + helper functions |
| `src/lib/cloister/specialists.ts` | Before writing launcher script: detect un-rotated boundary, truncate JSONL, record offset |
| `src/dashboard/server/services/conversation-service.ts` | Export `findLastCompactBoundary` and JSONL-writing helpers; refactor to support truncation |

## Acceptance Criteria

- [ ] `spawnEphemeralSpecialist` detects `compact_boundary` in the existing JSONL before spawning
- [ ] On detection of un-rotated boundary: truncate JSONL to just boundary + isCompactSummary entries
- [ ] Record the rotated boundary offset in `session_compact_offsets` table (new SQLite table)
- [ ] Subsequent spawns do NOT re-truncate for the same boundary (idempotent)
- [ ] If no compaction exists, behavior is unchanged (normal `--resume`)
- [ ] `test-agent` is excluded (stateless, no resume)
- [ ] PAN-541 SQLite migration is implemented (new `session_compact_offsets` table)

## Difficulty: Medium-Complex
- New SQLite table + query helpers
- JSONL truncation (write at byte offset, preserve encoding)
- Integration into `spawnEphemeralSpecialist` pre-launch flow
- ~4-5 files, moderate risk (modifies session lifecycle)
