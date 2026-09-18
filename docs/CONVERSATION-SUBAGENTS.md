# Conversation subagents

Claude Code and Codex expose subagents through the same conversation rail. Claude Code writes each subagent beside its parent conversation transcript. Overdeck reads these files to list subagents and show their full transcripts in the conversation panel. The dashboard never modifies the files.

## On-disk layout

For a parent transcript at:

```text
~/.claude/projects/<encoded-project>/<session-id>.jsonl
```

Claude Code writes subagent data under the parent session directory:

```text
~/.claude/projects/<encoded-project>/<session-id>/subagents/
├── agent-<agent-id>.jsonl
└── agent-<agent-id>.meta.json
```

The JSONL file uses the same message format as the parent transcript, so Overdeck reuses the existing parser and watcher. The metadata file has this verified shape:

```json
{
  "agentType": "Explore",
  "description": "Trace conversation message handling",
  "toolUseId": "toolu_01ABC...",
  "spawnDepth": 1
}
```

Overdeck derives `agentId` from the metadata filename. `spawnDepth` is display metadata; the dashboard shows nested subagents in one flat rail with a depth marker.

## Parent-row join

The metadata field `toolUseId` equals the `id` of the parent transcript's `tool_use` block. The conversation parser stores that block id as the work-log entry id. This gives the frontend a direct join:

```text
subagent.meta.toolUseId == workLogEntry.id == tool_use.id
```

An expanded `Agent` or legacy `Task` row uses this join to show **Open subagent transcript**.

## Transport

`SubagentSummary` is the shared server/frontend shape. It contains the metadata fields, derived `agentId`, and a status of `running` or `done`.

The existing conversation transport carries subagent data:

- A parent `pan.subscribeConversationMessages` stream emits `{ kind: "subagents", subagents }` after its initial message snapshot. A two-second poll emits a replacement list only when the list or a status changes.
- The subscription payload accepts an optional `agentId`. When present, the same RPC streams the matching subagent JSONL through the existing snapshot and tail pipeline. Subagent transcript streams do not emit nested subagent-list events.
- `GET /api/conversations/:name/messages` includes `subagents` for the parent response. `?agentId=<id>` returns one subagent transcript for ended conversations and other one-shot reads.

The frontend keeps parent and subagent transcripts in separate React Query cache keys, so opening a subagent cannot replace the parent timeline.

## Status derivation

Metadata files do not contain runtime status. While the parent stream is live, Overdeck marks a subagent `running` when its `toolUseId` remains in the parser's `pendingToolUse` map. It marks all other entries `done`.

A watcher delta triggers an immediate status refresh. The two-second metadata poll catches new subagent files. REST responses for ended conversations mark every discovered subagent `done`.

## Path safety

Subagent transcript lookup accepts only ids that match:

```text
^[A-Za-z0-9_-]+$
```

The resolver then builds the candidate with `path.resolve` and verifies that its parent directory is the resolved `subagents` directory. Invalid ids return `null`, and the REST route returns HTTP 400 before any transcript read. Discovery and transcript access use asynchronous filesystem APIs and remain read-only.

## Codex child threads

Codex stores children as separate `rollout-*.jsonl` files in the parent's
`codex-home/sessions/YYYY/MM/DD/` tree. The first `session_meta` record supplies
`payload.id` and `payload.source.subagent.thread_spawn.parent_thread_id`.
`agent_path`, `agent_nickname`, and `agent_role` supply display labels when present.
The resolver follows these parent IDs to discover descendants across date directories.
It computes depth relative to the selected parent and excludes ordinary conversation forks.

Codex uses the same list event, `agentId` subscription field, REST query, URL
selection, and isolated transcript cache as Claude Code. The selected child passes
through the Codex parser and existing full-snapshot file watcher. A two-second
poll discovers new children and changes to their status even when the parent
transcript does not change. Child streams do not emit their own subagent lists.

The resolver reads and caches metadata separately from transcript content. It reads
a bounded 128 KiB tail for status: the most recent `task_started` means running;
`task_complete` or `turn_aborted` means done. A later task starts the running status
again. Without a terminal event in that tail, it reports running.

A parent `spawn_agent` work-log row joins to a child through its result's
`agent_id` or `thread_id`, or through the collaboration tool's `task_name`, which
matches the child's `agent_path`. That row offers **Open subagent transcript**.
Children without a matching spawn row remain accessible through the rail.

Selection accepts only safe IDs and requires membership in the parent's verified
descendant tree. It never interprets an ID as a path, follows directory/file
symlinks during discovery, or searches another Codex home. Missing or unrelated
IDs cannot fall back to the parent transcript. All discovery and reads are asynchronous.
