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
- `GET /api/conversations/:name/messages` includes `subagents` for the parent response. `?agentId=<id>` returns one subagent transcript for ended conversations and other one-shot reads. `GET /api/conversations/:name/message-locator?byteOffset=N` accepts the same `?agentId=<id>` and resolves the offset against that subagent's transcript.

The frontend keeps parent and subagent transcripts in separate React Query cache keys, so opening a subagent cannot replace the parent timeline.

## Opening a subagent from search

Conversation search indexes subagent transcripts too. Their chunks keep `session_id = agent-<id>` (the file basename) and also store `chunks.parent_session_id`, the parent session UUID taken from the `<parent-uuid>/subagents/` path. Schema v2 of the embeddings DB added the column and backfilled it once at open from `file_cursors`, with no re-embedding.

A palette hit on a subagent chunk reports `conversationId` as the parent conversation's name (or the parent UUID when the parent has no conversation row), plus `parentSessionId` and the bare `subagentId`. The palette labels it `Subagent of …` and shows a distinct icon. Opening it:

1. fetches `GET /api/conversations/:name/message-locator?byteOffset=N&agentId=<bare id>`, which resolves the offset inside the subagent transcript;
2. opens the parent conversation pane with `targetSubagentId` beside the usual message target;
3. `ConversationPanel` selects the rail row via `?subagent=<id>` once the subagent list contains it, and only `SubagentTranscript` receives the message target, so the main timeline never consumes it.

Codex child threads are not indexed, so they never appear as search hits (PAN-3982).

## Status derivation

Metadata files do not contain runtime status. While the parent stream is live, Overdeck derives it from the launch shape in the metadata (`requestShape`):

- A foreground subagent is `running` while its `toolUseId` remains in the parser's `pendingToolUse` map, and `done` otherwise.
- A background subagent (`requestShape: "background"`) gets its `Agent` tool result as soon as it launches, so that map cannot track it. It is `running` until the parent transcript has a `<task-notification>` naming it. The first notification carries `<tool-use-id>` equal to its `toolUseId`. Notifications after a `SendMessage` resume carry only `<task-id>`, which equals its `agentId`. Both ids are matched exactly. Claude Code writes each notification as a `queue-operation` `enqueue` record when the subagent stops, and again as a `user` record with `origin.kind: "task-notification"` when the parent takes it. Text that only quotes a notification, such as assistant text, a tool result or a pasted message, does not count.
- A notified background subagent is `running` again when its transcript or metadata changed more than 5 seconds after its latest notification. That means it was resumed. Its last write normally lands within 0.1 s of the notification.
- A background subagent with no notification after its last write, for example because the parent crashed, becomes `done` once its transcript and metadata files have not changed for `BACKGROUND_SUBAGENT_IDLE_MS` (30 minutes).

The notification scan reads only the parent transcript bytes appended since the previous poll. It rescans from the start when the transcript gets shorter.

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

Jobs launched through the Codex plugin for Claude Code (`codex:codex-rescue` and friends) are
not subagents: they are separate `codex` processes with their own rollouts, outside the
conversation's transcript. Overdeck records them as **external agents** (`~/.overdeck/agents/ext-*`)
and lists them in the Agents Directory under the conversation that launched them. See
`reference/workers.mdx` "Externally spawned agents" and DASHBOARD-ARCHITECTURE.md "Agents page: Live and History".

### Child activity

Selected subagent transcripts show the same animated “Working for …” row as
main conversations, including the tool activity icon. Codex child activity comes
from its own task lifecycle in the subagent list: Codex transcript snapshots have
`streaming: false`, so that field cannot override a running child. Claude Code
also uses the child stream's activity. Ended or disconnected parent sessions do
not display stale child activity. The main agent's busy state does not determine
whether a selected child is working.

### Direct child composer

The bottom composer appears only when the live Codex app-server host has
classified the selected child as a descendant of its owner thread (announced by
a `thread/started` naming an in-tree parent, or adopted from an in-tree
`spawnAgent` item) and Codex reports it loaded with an idle or active turn.
Owner, foreign (a native `/new` or `/fork` from an attached Codex CLI), and
unannounced threads never accept input. Active turns receive `turn/steer` with
the exact expected turn ID; idle children receive `turn/start` with the child's
thread ID. Child notifications do not replace the host's owner thread or active
turn. Input inherits the child's existing model and permissions. An attached
native Codex CLI is a second client of the same app-server; child input from the
dashboard does not change which thread that CLI shows.

`GET /api/conversations/:name/subagents/:agentId/input` checks capability.
`POST` to the same route accepts `{ "message": "..." }` and revalidates membership
and availability. Input is literal text, including slash-prefixed text; parent
composer commands are not intercepted. Drafts use a separate per-child key.
The UI clears a draft only after the host acknowledges the selected recipient.
An uncertain send is never automatically retried.

Claude Code PTY sessions, Codex TUI sessions, old hosts, and unloaded children
remain read-only. There is no relay through the parent, automatic replacement
thread, or second process resuming a live transcript. A host upgrade requires
restarting that conversation before its new operations are available; reloading
the dashboard alone does not update an already-running host.

## Agent subagents (PAN-3920)

Overdeck agents (work, review, plan, …) spawn subagents too — the foreman's same-family workers
among them. Two routes read them, beside the agent's own transcript as the session index
resolves it (`resolveAgentTranscriptCandidate`):

- `GET /api/agents/:id/subagents` lists `{ subagents: [...] }` with each subagent's summary and
  transcript `mtimeMs`. Transcript paths stay on the server.
- `GET /api/agents/:id/conversation?subagentId=<id>` returns one subagent transcript in the
  agent conversation response shape. An id that fails `^[A-Za-z0-9_-]+$` answers 400; an id that
  is not that agent's subagent answers 404.

A Claude subagent is `running` while its transcript changed in the last 120 s and `done`
otherwise; a Codex child keeps the rollout's own task status. Only `claude` and `codex`
transcripts have subagents; other harnesses answer an empty list. The Agents Directory lists
these as `subagent` entries under their parent (`src/dashboard/server/services/agent-subagents.ts`).

