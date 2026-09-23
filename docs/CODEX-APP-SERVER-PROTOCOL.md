# Codex App Server Protocol

Verified on this workspace with `codex-cli 0.144.1`.

The fixture at `src/lib/codex/__fixtures__/app-server-schema.json` was produced by:

```bash
codex app-server generate-json-schema --out /tmp/pan-2597-codex-schema
cp /tmp/pan-2597-codex-schema/codex_app_server_protocol.schemas.json \
  src/lib/codex/__fixtures__/app-server-schema.json
```

The generated bundle includes the methods below. The v2-specific generated bundle
(`codex_app_server_protocol.v2.schemas.json`) uses the same active method names and
contains the resolved v2 parameter schemas.

## Wire Envelope

`JSONRPCRequest` is an object with required `id` and `method`, optional `params`,
and optional `trace`. `JSONRPCNotification` is an object with required `method`
and optional `params`; it has no `id`. `JSONRPCResponse` has required `id` and
`result`; `JSONRPCError` has required `id` and `error`.

The generated schemas do not define a `jsonrpc` property on requests,
notifications, responses, or errors. Do not send `jsonrpc: "2.0"`.

`RequestId` accepts either a string or an integer. The schema verifies that
integer IDs are valid, not that they are mandatory. Overdeck uses a monotonic
integer counter because the t3code reference manager reads `context.nextRequestId`,
increments it, and writes that value as `id`.

The generated schema describes one JSON-RPC message object at a time; it does
not encode stream framing. The newline-delimited stdio framing is verified from
the t3code reference manager, whose `writeMessage` serializes one message and
writes `${encoded}\n` to the Codex child stdin.

## Client Requests

| Purpose | Generated method | t3code reference | Status |
| --- | --- | --- | --- |
| Handshake request | `initialize` | `initialize` | Match |
| Start a thread | `thread/start` | `thread/start` | Match |
| Resume a thread | `thread/resume` | `thread/resume` | Match |
| Start a turn | `turn/start` | `turn/start` | Match |
| Interrupt a turn | `turn/interrupt` | `turn/interrupt` | Match |
| Read a thread | `thread/read` | `thread/read` | Match |
| Read account state | `account/read` | `account/read` | Match |
| Roll back a thread | `thread/rollback` | `thread/rollback` | Match; present for completeness although not in the first manager slice |

## Client Notifications

| Purpose | Generated method | t3code reference | Status |
| --- | --- | --- | --- |
| Complete handshake | `initialized` | `initialized` | Match |

## Server Notifications

| Purpose | Generated method | t3code reference | Status |
| --- | --- | --- | --- |
| Thread opened | `thread/started` | `thread/started` | Match |
| Turn began | `turn/started` | `turn/started` | Match |
| Turn finished | `turn/completed` | `turn/completed` | Match |
| Structured error | `error` | `error` | Match |

Relevant generated payload shapes:

- `ThreadStartedNotification` requires `thread`.
- `TurnStartedNotification` requires `threadId` and `turn`.
- `TurnCompletedNotification` requires `threadId` and `turn`.
- `ErrorNotification` requires `error`, `threadId`, `turnId`, and `willRetry`.

## Server Requests

| Purpose | Generated method | t3code reference | Status |
| --- | --- | --- | --- |
| Command approval | `item/commandExecution/requestApproval` | `item/commandExecution/requestApproval` | Match |
| File-change approval | `item/fileChange/requestApproval` | `item/fileChange/requestApproval` | Match |
| User input for a tool | `item/tool/requestUserInput` | `item/tool/requestUserInput` | Match |
| File-read approval | Not present in generated schema | `item/fileRead/requestApproval` | Divergence: codex-cli 0.144.1 does not expose this server request in the generated schema |

The generated schema also includes server requests outside the current Overdeck
plan: `item/permissions/requestApproval`, `item/tool/call`,
`mcpServer/elicitation/request`, `account/chatgptAuthTokens/refresh`,
`attestation/generate`, plus deprecated `applyPatchApproval` and
`execCommandApproval`.

## Response Payloads

Approval replies are JSON-RPC responses to the server request `id`:

- `CommandExecutionRequestApprovalResponse` requires `decision`.
- `FileChangeRequestApprovalResponse` requires `decision`.
- `ToolRequestUserInputResponse` requires `answers`, an object whose values are
  `ToolRequestUserInputAnswer` objects.
- `ToolRequestUserInputAnswer` requires `answers`, an array of strings.

t3code matches this shape by converting provider answers into
`Record<string, { answers: string[] }>` before writing `{ id, result: { answers } }`.

## Transcript And Cost Continuity

Checkpoint C1 was verified with a live `codex-cli 0.144.1 app-server` session
using an isolated temporary `CODEX_HOME`.
`thread/start` returned a planned rollout path immediately, but Codex did not
create the JSONL until the first `turn/start` completed.

After a minimal prompt (`Reply with exactly OK.`), Codex wrote:

```text
<isolated-CODEX_HOME>/sessions/2026/07/12/rollout-2026-07-12T14-28-38-019f5796-a6eb-7ec0-91e6-ac452b37e193.jsonl
```

The existing rollout path helpers worked unchanged:

- `findLatestRollout(codexHome)` returned the live JSONL.
- `findRolloutPath(codexHome, "019f5796-a6eb-7ec0-91e6-ac452b37e193")`
  returned the same JSONL.

The existing cost parser also worked unchanged. `parseCodexSessionSync` returned
one assistant message, model `gpt-5.6-sol`, 26,389 input tokens, 9,984 cached
input tokens, 5 output tokens, and total cost `0.087167`.
`parseCodexSessionCostEventsSync` emitted one cost event with the same usage.

The existing conversation reader path worked unchanged. `getCachedMessages`
already treats `rollout-*.jsonl` as Codex and dispatches to
`parseCodexConversationMessages`; that parser returned two chat messages
(`user`, `assistant`), total tokens `26394`, total cost `0.087167`, and the
assistant text `OK`.

No fallback transcript adapter is required for app-server. The durable transcript
and cost source remains the Codex rollout JSONL under the per-agent
`CODEX_HOME/sessions/YYYY/MM/DD/` tree.

## Per-Turn Model Checkpoint

Checkpoint C3 was verified with `codex-cli 0.144.1` using an isolated
temporary `CODEX_HOME`. A thread was started with model
`gpt-5.6-sol`, then a later `turn/start` in the same thread included an explicit
`model: "gpt-5.6-sol"` field. The app-server accepted the request without a
protocol error, so Overdeck uses the native per-turn `model` field for
app-server model overrides on this version. No restart-and-resume fallback is
needed for Codex CLI 0.144.x.

## Divergences

1. `item/fileRead/requestApproval` appears in t3code's pending approval union and
   routing logic, but it is absent from codex-cli 0.144.1's generated
   `ServerRequest` schema. Overdeck implementation beads must not assume a
   file-read approval request exists unless a later schema version verifies it.
2. The plan shorthand "integer id counter" is an Overdeck/t3code implementation
   choice, not a schema restriction. The generated `RequestId` allows string or
   integer IDs; Overdeck uses integers.

## Native Terminal Attachment (PAN-3835)

A Codex conversation's app-server can take a second client: the native Codex
TUI, attached with `codex resume --remote`. The dashboard keeps its structured
connection; the TUI is an optional extra client of the same app-server and the
same thread.

### Protocol experiment, 2026-09-23, codex-cli 0.153.4

Run in isolation: a throwaway `codex app-server --listen unix://<path>` under a
temporary `CODEX_HOME` (auth symlinked the way `initCodexHome` does it), an
Overdeck-style JSON-RPC client written against `ws`, and the native TUI in a
private `tmux -L pan3835-test` server. Model `gpt-5.6-luna`, effort `low`.

| Check | Result |
| --- | --- |
| Transport | `--listen unix://<path>` serves WebSocket over the Unix socket (HTTP `101 Switching Protocols`, one JSON-RPC message per text frame). The socket is created `0600`. The handshake is hung up when the client offers `permessage-deflate`; a client must disable it. |
| Attach before any turn | Fails: `thread/resume failed: no rollout found for thread id …`. `thread/start` reports the rollout path but Codex writes the file with the first turn, so the TUI can only attach after one turn. |
| Idle attach | Pass. The TUI shows the full history of the thread. The other client sees only `thread/goal/cleared`. |
| Active-turn attach | Pass. Attaching while a turn ran a 25 s shell command showed `Working (… esc to interrupt)` and the streamed result. The turn was not interrupted and completed for both clients. |
| Shared events | Turn, item, token-usage and status events for the thread reach every subscribed client, whichever client started the turn. A turn typed in the TUI appears in the other client's stream and in the same rollout. |
| Foreign threads | `thread/started` is broadcast to every client: a TUI turn also starts an ephemeral system title thread (`ephemeral: true`), and `/new` starts a separate, non-ephemeral thread with its own rollout in the same `CODEX_HOME`. `thread/status/changed` is broadcast for every thread; turn and item events arrive only for subscribed threads. A client that adopts the thread id from any `thread/started` is rebound to the wrong thread. |
| Approval ownership | A server request (`item/commandExecution/requestApproval`) goes to every subscribed client, including a TUI that attaches while the request is pending. The first answer wins; the server then sends `serverRequest/resolved { threadId, requestId }` to every client and the other client's prompt disappears. Request ids are per connection. A second answer to a resolved id is ignored silently. Verified in both directions. |
| User-input requests | Not exercised: `request_user_input` is not offered in the Default collaboration mode. Resolution uses the same method-agnostic `serverRequest/resolved`. |
| Settings | A `/model` change in the TUI emits `thread/settings/updated` (model, effort, approval policy, sandbox) to every client. A `turn/start` with `effort` from the other client becomes the thread's setting, and the TUI status line follows it. The TUI also writes `model` and `model_reasoning_effort` into `CODEX_HOME/config.toml`. |
| Permissions and instructions | Every turn in the rollout kept `approval_policy` and `sandbox_policy` from the thread; the thread's developer instructions stayed in place after TUI turns. |
| Disconnect and reconnect | Killing the TUI or `/quit` ("Disconnected from this task. Any running work continues.") leaves the thread loaded and the other client working. A new client can `thread/resume` a thread another client holds loaded; there is no active-writer refusal. |
| Unload or stop | Neither client unloads the thread by leaving. Esc in a TUI approval prompt cancels that request and interrupts the turn, like the dashboard's interrupt. |
| Owner death | When the app-server exits it removes its socket, and the TUI does not exit: it loops on `Reconnecting to app-server…`. The owner's teardown must close it. |
| Malformed client | Raw bytes on the socket close that connection; the server keeps running. |
| Update prompt | A TUI started without `check_for_update_on_startup = false` blocks on an update modal before attaching. |

Decision: simultaneous attachment is safe, including during an active turn and
with a pending approval, provided the dashboard client pins its own thread and
ignores foreign-thread traffic. No handover or second runtime is needed.

### Sub-agents and process lifetime (review follow-up, same version)

| Check | Result |
| --- | --- |
| Sub-agent threads | `multi_agent` spawns a sub-agent on its own thread. The client gets **no `thread/started`** for it. The only announcement is an `item/started` / `item/completed` of type `collabAgentToolCall` (`tool: "spawnAgent"`) on the spawning thread, whose `receiverThreadIds` names the new thread. The sub-agent's first `thread/status/changed` can arrive before that item. |
| Sub-agent approvals | The sub-agent's `item/commandExecution/requestApproval` carries the sub-agent's `threadId` and goes to the parent's client. The parent turn waits on it (`collabAgentToolCall` `wait`). A client that drops requests for threads other than its own hangs the turn. Answering it from the dashboard let the parent turn complete. |
| `--listen unix://` and stdin | The app-server does not exit when its stdin closes (stdio mode does). A host killed with SIGKILL outside tmux leaves the app-server serving the socket. Inside a tmux pane the pane's process group gets SIGHUP, which stops it. |
| Wrapper signals | `codex` is a Node wrapper around the native binary; it forwards SIGINT, SIGTERM and SIGHUP to it, so signalling the wrapper pid stops the server. |

### How Overdeck uses it

- Conversation launches pass `--native-endpoint` to `codex-app-server-host.js`;
  work and review agents never do and keep stdio. The manager spawns
  `codex app-server --listen unix://~/.overdeck/agents/<id>/codex-native/app.sock`
  (directory `0700`, socket `0600`) and connects with `ws` and
  `perMessageDeflate: false`. It falls back to stdio, and records why, when the
  CLI is older than 0.153.4, the socket path is longer than 100 bytes, or the
  socket never accepts. The native child is stopped before the stdio child starts.
- The host records `unix://…` in `~/.overdeck/agents/<id>/codex-native-endpoint`
  and removes it on stop. Its `status` op reports `generation` (random per host
  process), `nativeEndpoint` and `navigationEpoch`.
- The manager pins the owner thread from its own `thread/start` or
  `thread/resume` response and keeps a thread tree: the owner, plus every
  thread named in a `collabAgentToolCall` `receiverThreadIds` from inside the
  tree, plus any `thread/started` whose `parentThreadId` is in the tree. A
  `thread/started` outside the tree (a title thread, a native `/new` or
  `/fork`) marks that thread **foreign**; its events go out as `foreign-thread`
  and never touch state, pending requests, activity, cost, or
  `codex-thread-id`. Only the owner thread moves the owner's turn state. A
  `collabAgentToolCall` from inside the tree that names a foreign thread as a
  receiver moves it into the tree (PAN-4031), so a sub-agent announced before
  its parent joined does not stay foreign with its approvals unanswered.
- Server requests fail open: a request from the owner, a sub-agent, or a thread
  the manager cannot classify is pending in the host and shown in the pane. Only
  a request for a thread positively known to be foreign is left to the client
  that opened it, with one pane line. Activity and live cost include sub-agent
  threads (cost is the sum of each thread's running total). The host writes
  `codex-thread-id` from its own start only.
- Live cost prices each sub-agent at its own model (PAN-4031): the model the
  `spawnAgent` item requested (`item.model`), replaced by a later
  `thread/settings/updated` for that thread. A spawn with `model: null` takes
  its spawner's recorded model, and a sub-agent with no recorded model, or a
  model with no pricing entry, is priced at the owner's model. `model/rerouted`
  is not tracked. This is the live figure only; the final ledger
  (`codex-collector.ts`) reads each rollout and is exact.
- Runtime-log lines from a sub-agent carry a thread label, for example
  `[turn sub:0000beef] started` and `[assistant sub:0000beef] …` (the last
  8 characters of the thread id). Owner lines are unlabeled.
- The host kills its app-server on every exit path (SIGTERM, SIGINT, SIGHUP,
  `process.on('exit')`). The manager records the app-server pid in
  `codex-native/app.pid`; on the next start, if that pid is still alive and its
  `/proc/<pid>/cmdline` is a codex app-server on the same socket, it is sent
  SIGTERM (SIGKILL after 5 s) before the socket is reused.
- When the app-server exits while the host's pane stays alive, the host removes
  `codex-native-endpoint`, marks the endpoint unavailable (`exited`), closes the
  conversation's companion through the companion-terminal lifecycle, and
  prints a line in Runtime log.
- The host drops a pending request on `serverRequest/resolved`, refuses a
  second answer to user-input requests (approvals already refused one), and adopts
  `thread/settings/updated` model and effort so the next dashboard turn keeps
  a TUI choice. The dashboard effort picker still applies when used afterwards.
- `navigationEpoch` counts native navigation: foreign threads from a
  `thread/started` that are neither ephemeral (title threads) nor have a
  `parentThreadId` (sub-agents): a TUI `/new` or `/fork`. It only ever goes
  up, so the companion fingerprint never changes back and forth (PAN-4031).
  Unclassified threads are not counted: a sub-agent's status can arrive before
  its spawn item, and counting it made the epoch drop once the item adopted
  it, which replaced an attached CLI. The cost: a TUI `/resume` of another
  thread announces no `thread/started`, so it does not count as navigation.
- A new `prepare-terminal` op is the companion adapter's health check. It
  strictly resumes a saved thread the host has not loaded yet (never a fresh
  thread), never starts a turn, and answers only when the pinned thread's rollout
  exists.
- The companion adapter runs
  `codex resume -c check_for_update_on_startup=false --remote <endpoint> <threadId>`
  with the conversation's `CODEX_HOME`. It passes no model, sandbox or approval
  flags, so attaching never changes the thread's settings.

Minimum CLI for the native terminal: **0.153.4** (the version verified here).
Ordinary app-server use keeps its 0.144.0 floor.
