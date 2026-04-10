# Planning State: PAN-594

## Issue
**bug: stale session_file paths with incorrect CWD encoding break conversation messages**

## Problem Summary

Old Panopticon versions stored `session_file` paths in SQLite with dots preserved in usernames (e.g., `edward.becker`), but Claude Code encodes dots as hyphens (e.g., `edward-becker`). The `encodeClaudeProjectDir()` function was fixed to use `/[^a-zA-Z0-9-]/g → -`, so **new** conversations get correct paths. But existing DB records are never migrated.

Impact: `GET /api/conversations/:name/messages` returns empty `messages: []` for affected conversations, even though the JSONL files exist at the correctly-encoded paths.

## Root Cause
- `sessionFilePath()` in `conversations.ts` computes the correct path at conversation creation time
- `encodeClaudeProjectDir()` correctly encodes dots as hyphens since the fix
- Existing conversations created before the fix have stale `session_file` values in the DB
- The messages endpoint uses the stale DB path → `readFile` fails → empty messages

## Files Involved
- `src/lib/paths.ts` — `encodeClaudeProjectDir()` (already correct, no changes needed)
- `src/lib/database/conversations-db.ts` — `Conversation` type, `listConversations()`, `updateSessionFile()`
- `src/dashboard/server/routes/conversations.ts` — `backfillConversationModels()` pattern to follow, `sessionFilePath()` helper

## Decision: One-Time Migration via Schema Version Bump
- **Run exactly once** — inside `runMigrations()` in `schema.ts`, triggered when `currentVersion < 14` (i.e., on first startup after this fix is deployed)
- **Not per-startup** — no fire-and-forget on module load; handled by the schema migration system
- **Verify file exists** before updating — skip update if the correctly-encoded path doesn't exist
- **Summary logging only** — "Fixed session_file paths for N conversation(s) via PAN-594 migration"

## Proposed Approach

Add a schema migration (`v13 → v14`) in `schema.ts`:

1. In `runMigrations()`: add `if (currentVersion < 14)` block
2. Import `encodeClaudeProjectDir` from `paths.ts` into `schema.ts` (safe — no circular deps)
3. SQL: `SELECT id, name, cwd, session_file FROM conversations WHERE session_file IS NOT NULL`
4. For each row:
   a. Extract the encoded-CWD segment from `session_file` (path between `~/.claude/projects/` and the `session-id.jsonl`)
   b. Compute `expectedEncodedCwd = encodeClaudeProjectDir(cwd)`
   c. If they differ: build `correctPath` by replacing the stale segment in `session_file`
   d. `existsSync(correctPath)` — verify the correctly-encoded file actually exists
   e. If exists: `UPDATE conversations SET session_file = ? WHERE id = ?`
5. Log: `"Fixed session_file paths for N conversation(s) via PAN-594 migration"`
6. Bump `SCHEMA_VERSION` from 13 to 14

## Implementation Tasks

### Task 1: Add schema migration (v13 → v14) in `schema.ts`
- Bump `SCHEMA_VERSION` from 13 to 14
- Add `import { encodeClaudeProjectDir } from '../paths.js'` (top of file)
- Add `if (currentVersion < 14)` block inside `runMigrations()`:
  - SQL query to get all conversations with non-null `session_file`
  - For each: extract CWD segment, re-encode, verify file exists, update
  - Summary log on completion

### Task 2: Typecheck and lint
- Run `npm run typecheck && npm run lint`

## Edge Cases
- **File doesn't exist at correctly-encoded path**: skip (can't fix — data is truly missing; messages stay empty, consistent with pre-fix behavior)
- **Already correct path**: no-op (no DB write; correct paths pass through unchanged)
- **Conversation has no `sessionFile`**: skip
- **Archived conversations**: migration SQL does not filter by `archived_at` — archived conversations with stale paths are also fixed (correct behavior)
- **Multiple dot-encoded segments in path**: only the first segment between `~/.claude/projects/` and `session-id.jsonl` is treated as the CWD segment; rest of path is preserved

## Difficulty: `trivial`
- Single ~30-line migration block in existing `runMigrations()` function
- No new files, no new dependencies
- Follows existing migration pattern in `schema.ts`
