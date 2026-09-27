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

`SubagentSummary` is the shared server/frontend shape. It contains the metadata fields, derived `agentId`, and a status of `running` or `done`. Two more fields, both optional:

- `background: boolean` — true for a subagent launched with `requestShape: "background"` (the same flag `## Status derivation` below uses to pick a status rule).
- `humanInputs: SubagentHumanInput[]` — recent human-origin sidechain records this subagent's own transcript received, each `{id, text, createdAt}`. `createSubagentHumanInputScanner()` (`src/dashboard/server/services/conversation/subagents.ts`) reads them incrementally: a module-level cache keyed by transcript file path holds the byte offset already scanned, so a repeat call reads only newly appended bytes, mirroring `createTaskNotificationScanner`. Text is truncated to 2000 characters and only the most recent 20 inputs per subagent are kept; a transcript rewritten shorter than the cached offset resets that entry to scratch. One `sharedHumanInputScanner` instance serves every `listSubagentSummaries` call in the process, so repeat calls for the same conversation reuse cached offsets instead of rescanning each subagent transcript from the start. The one-shot `GET /api/conversations/:name/messages` snapshot builds its `subagents` list via `listSubagentMetas` instead, which does not carry `background` or `humanInputs` — both fields arrive with the first two-second `{ kind: "subagents" }` event, not in the initial payload.

The existing conversation transport carries subagent data:

- A parent `pan.subscribeConversationMessages` stream emits `{ kind: "subagents", subagents }` after its initial message snapshot. A two-second poll emits a replacement list only when the list or a status changes.
- The subscription payload accepts an optional `agentId`. When present, the same RPC streams the matching subagent JSONL through the existing snapshot and tail pipeline. Subagent transcript streams do not emit nested subagent-list events.
- `GET /api/conversations/:name/messages` includes `subagents` for the parent response. `?agentId=<id>` returns one subagent transcript for ended conversations and other one-shot reads. `GET /api/conversations/:name/message-locator?byteOffset=N` accepts the same `?agentId=<id>` and resolves the offset against that subagent's transcript.

The frontend keeps parent and subagent transcripts in separate React Query cache keys, so opening a subagent cannot replace the parent timeline.

## Input routed into a subagent — the agent selector check

Claude Code can deliver typed input — the dashboard composer or `pan tell` — into a subagent's sidechain instead of the main conversation. The main transcript never shows it. Overdeck checks and fixes the routing before every send (PAN-4268), and detects and surfaces a misrouting that still happens (PAN-4247):

- **Selector check (PAN-4268).** Claude Code's agent selector (`● main` / `◯ <type>  <description>`, drawn below the prompt box) decides where typed input goes: the row with the filled dot receives it, whether or not that subagent is still running. `parseAgentSelector` and `ensureMainInputTarget` (`src/lib/agents/input-target.ts`) read the pane before every composer send and every `messageAgent` delivery to a `claude-code` target. They press only `Down`/`Up`/`Enter`/`Escape` to put `●` back on `main`, re-read the pane after each key, and refuse when the switch cannot be confirmed: the composer route answers HTTP 409 `input-target-not-main` (the draft stays in the editor), and `pan tell` exits 1 with the message saved to mail. Parser fixtures live in `src/lib/agents/__fixtures__/claude-code-2.1.280/`, so a Claude Code UI change breaks a test instead of misrouting silently.
- **Detection.** A subagent records a human-origin message as a `user` record with `isSidechain: true` and `origin.kind: "human"`, its content wrapped in Claude Code's own preamble (`The user sent a new message while you were working:\n<text>\n\nThis is how Claude Code surfaces…`). `extractSidechainHumanText` (`src/lib/transcript-landing.ts`) strips that wrapper down to the operator's own text. `probeSidechainsSince` scans every subagent transcript for a matching human input newer than the delivery attempt; `deliverMessageWithTranscriptConfirmation` checks it on every poll, ahead of a bare assistant-turn fallback, so a same-window subagent record always wins over a false "confirmed" reading of an unrelated assistant reaction.
- **Composer label.** Once a message lands in a subagent, `reconcileComposerEchoes` (`src/dashboard/frontend/src/lib/composerEchoes.ts`) relabels the pending bubble in place — `acknowledged: true`, `deliveryState: 'subagent'`, `deliveredToSubagent: {agentId, description}` — and the timeline renders it "Delivered to subagent · `<description>`" at full opacity with no spinner. The bubble is never removed from the pending list, so a later real main-transcript echo can still reclaim it.
- **Composer notice.** Conversation rows carry `inputTarget` (`'main' | { subagent } | 'unknown'`, read from the selector by `readConversationInputTarget` only for live `claude-code` sessions with a `subagents/` directory). When it is `{ subagent }`, `inputTargetNotice` (`src/dashboard/frontend/src/lib/subagentRouting.ts`) shows "Typed messages are going to subagent "<description>", not the main agent." with a **Send to main** button that sends the draft through the normal send path, which switches first. PAN-4247's hedged "running" notice, its "routed" notice, and the confirm-before-send gate that came with it were removed.
- **`pan tell`.** When `deliverMessageWithTranscriptConfirmation` reports a subagent landing, `messageAgent` queues the message for manual delivery instead of retrying (a retry would route into the same subagent again) and returns `landedInSubagent: {agentId, description}`. `tellCommand` prints the subagent's name and reason in red and exits **1** — it never prints "turn confirmed" for a message that never reached the main conversation. On success it prints "Message delivered to `<id>`'s main agent" and, after a switch, names the subagent it switched away from.

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

## Agents rail collapse (PAN-4222)

`SubagentRail`'s collapsed state persists to `localStorage['overdeck.ui.agentsRailCollapsed']`,
read on mount and written on every toggle — except when the rail is given
`defaultCollapsed`: it then starts at that state instead of reading localStorage, and toggling it
never writes back. The Agents page preview (Live's preview pane, and History's detail pane)
passes `defaultCollapsed`, so it always starts with the rail collapsed at its default 1280px
width without disturbing whatever collapsed/expanded state the user left on the conversation's
own full page.

