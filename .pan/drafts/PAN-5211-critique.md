plan-digest: 13f002dfa0ed484ed8e0822acdf15ac928de8bece2aedd490d6cd6b36ef31ff1

## blocks-the-design: Paged tool rows cannot expand

WI-14 returns older work-log rows from a fresh disk parse, but WI-13 records result locations only in the current in-memory parse and wires both tool-body routes to search that parse. The registered route searches `parsed.workLog` or `parsed.pendingToolUse` at `src/lib/overdeck/conversation-reads.ts:695-704`; the agent route searches `result.body.workLog` at `src/dashboard/server/routes/agents/conversation.ts:284-292`. Once a tool row has fallen out of the in-memory window, expanding that row returns 404 even though the disk page rendered it. The plan's expand test covers only a current row. Add a way for a paged row to carry or resolve its verified output record location at expand time, and test expansion after the row has been evicted from memory.

## blocks-the-design: Window slides invalidate existing bookmarks

D7/WI-8 assign counter IDs when parsing starts at byte 0, while WI-14's disk page accumulator starts at a nonzero `rangeStart` and assigns `@<offset>` IDs. WI-9 can slide a byte-zero accumulator's window before the file reaches 64 MiB, so a previously visible `codex-user-<n>` row reappears on a disk page as `codex-user-@<offset>`. Bookmarks persist and look up the exact `message_id` (`src/lib/overdeck/conversation-bookmarks.ts:113-131`); `useOlderHistory` searches exact IDs (`src/dashboard/frontend/src/components/chat/useOlderHistory.ts:78-88`). That bookmark can never resolve, beyond D7's stated cold-tail limitation. Use a stable ID for the same record in both parsers and provide a lookup or migration for existing counter-form bookmarks; test a bookmark made before a window slide and loaded from a disk page afterward.

## sharpens-framing: The 32 Mi cache limit is not a dashboard limit

D15 excludes `messagesCache`, which stores parsed Codex results and has a 100-entry count limit (`src/lib/overdeck/conversation-reads.ts:241-251,339-360`). At the planned 16 Mi-character entry ceiling, this separate main-thread cache can retain about 1.56 Gi characters, while the reader and snapshot cache each enforce their own 32 Mi-character totals. The PRD's summary and documentation work item call this a “32 Mi total” budget without naming its scope. State the per-cache scope and aggregate exposure explicitly, or add a retained-size budget to `messagesCache` if the intended claim is a dashboard-wide bound.
