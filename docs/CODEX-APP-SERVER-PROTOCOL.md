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
integer counter because the t3code reference reads `context.nextRequestId`,
increments it, and writes that value as `id`
(`/home/eltmon/Projects/t3code/apps/server/src/codexAppServerManager.ts:1215`).

The generated schema describes one JSON-RPC message object at a time; it does
not encode stream framing. The newline-delimited stdio framing is verified from
the t3code reference, whose `writeMessage` serializes one message and writes
`${encoded}\n` to the Codex child stdin
(`/home/eltmon/Projects/t3code/apps/server/src/codexAppServerManager.ts:1246`).

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
using an isolated `CODEX_HOME` at `/tmp/pan-2597-codex-live-yIYlP5`.
`thread/start` returned a planned rollout path immediately, but Codex did not
create the JSONL until the first `turn/start` completed.

After a minimal prompt (`Reply with exactly OK.`), Codex wrote:

```text
/tmp/pan-2597-codex-live-yIYlP5/sessions/2026/07/12/rollout-2026-07-12T14-28-38-019f5796-a6eb-7ec0-91e6-ac452b37e193.jsonl
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

Checkpoint C3 was verified with `codex-cli 0.144.1` using isolated
`CODEX_HOME=/tmp/pan-2597-c3-4M1kZ8`. A thread was started with model
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
