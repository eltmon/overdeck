# Panopticon Hook System

Panopticon uses Claude Code's lifecycle hooks to emit domain events that drive the dashboard, deacon, and activity tracking. This document explains how the system works, what events exist, and the known gaps for the Pi harness.

## What Hooks Are

Claude Code exposes nine lifecycle hook events. Panopticon registers shell scripts against these events. When an event fires, the script POSTs a JSON body to the dashboard's `/api/agents/:id/heartbeat` endpoint, which translates it into a typed `DomainEvent` and appends it to the event store. The `AgentStateService` folds these events into an in-memory `AgentRuntimeSnapshot` that the dashboard UI and deacon consume.

## The Nine Hook Events

| Event | When It Fires | Panopticon Script | Domain Event(s) Emitted |
|---|---|---|---|
| `PreToolUse` | Before Claude executes a tool | `pre-tool-hook` | `agent.activity_changed` (working) |
| `PostToolUse` | After Claude executes a tool | `heartbeat-hook` | `agent.activity_changed` (working) |
| `Stop` | When Claude finishes a turn and returns to the prompt | `stop-hook` | `agent.activity_changed` (idle) |
| `SessionStart` | When a Claude session begins | `session-start-hook` | `agent.model_set`, `agent.activity_changed` (idle) |
| `Notification` | When Claude shows a notification | `notification-hook` | `agent.waiting_started` (pattern-matched permission/question/disambiguation prompts only) |
| `PreCompact` | Before context compaction begins | `pre-compact-hook` | `agent.activity_changed` (`activity: working`, `tool: compact`) |
| `PostCompact` | After context compaction ends | `post-compact-hook` | `agent.activity_changed` (idle) |
| `UserPromptSubmit` | When the user submits a prompt | `user-prompt-submit-hook` | `agent.message_received`, `agent.waiting_cleared` |
| `PermissionRequest` | When Claude requests tool permission | `permission-event-hook` | `conversation.permission_changed` |

## Hook Registration

All nine Claude Code hook events live in global `~/.claude/settings.json`. `pan install` and `pan admin hooks install` install the hook scripts into `~/.panopticon/bin/` and idempotently add any missing registrations to settings.json.

The global registry is the single source of truth for `PreToolUse`, `PostToolUse`, `Stop`, `SessionStart`, `Notification`, `PreCompact`, `PostCompact`, `UserPromptSubmit`, and `PermissionRequest`. Role files under `roles/` and synced agent definitions under `sync-sources/agents/` do not declare `hooks:` frontmatter.

Users upgrading across PAN-1402 should re-run `pan install` (or `pan admin hooks install`) after pulling the fixed version. Any work agent that was already running before the reinstall must be stopped and restarted before it can pick up the restored hook registration.

### History

PAN-982 attempted to move `PreToolUse`, `PostToolUse`, and `Stop` into per-agent frontmatter to avoid double-firing. PAN-1402 reverted that migration because Claude Code did not honor those frontmatter hooks when Panopticon launched agents with path-form `--agent roles/<role>.md`; the observable result was missing heartbeats, missing `sessions.json`, and `claudeSessionId: null`.

### Migration Pruning

No PAN-1402 pruning is needed. The old PAN-982 `removeIfPresent(...)` block was removed, so setup now only adds missing Panopticon hook registrations and leaves existing matching entries intact.

## Hook Execution Flow

```
Claude Code fires hook
        |
        v
Hook script in ~/.panopticon/bin/
        |
        v
pan_emit_event() (from pan-hook-lib.sh)
        |
        v
POST /api/agents/:id/heartbeat
        |
        v
bodyToEvent() → DomainEvent shape
        |
        v
EventStore.appendAsync() → SQLite + PubSub
        |
        v
AgentStateService SubscriptionRef fold
        |
        v
Dashboard UI + Deacon read snapshot
```

## Hook Scripts Inventory

| Script | Hook(s) | Purpose |
|---|---|---|
| `pre-tool-hook` | PreToolUse | Emits `activity: working` before tool execution |
| `heartbeat-hook` | PostToolUse | Emits `activity: working`, records cost event, updates activity.jsonl |
| `stop-hook` | Stop | Emits `activity: idle`, detects API errors, chains to specialist/work-agent hooks |
| `session-start-hook` | SessionStart | Emits `model_set` + `activity: idle` on session boot |
| `notification-hook` | Notification | Emits `waiting_started` for dashboard notification display |
| `user-prompt-submit-hook` | UserPromptSubmit | Emits `message_received` + `waiting_cleared` |
| `pre-compact-hook` | PreCompact | Emits `activity: working` with `tool=compact` |
| `post-compact-hook` | PostCompact | Emits `activity: idle` (clear compact indicator) |
| `permission-event-hook` | PermissionRequest | Emits permission state changes |
| `specialist-stop-hook` | Stop (chained) | Detects specialist auto-completion |
| `work-agent-stop-hook` | Stop (chained) | Detects work agents that forgot `pan done` |
| `tldr-read-enforcer` | PreToolUse (Read only) | Enforces TLDR MCP for Read tool calls |
| `tldr-post-edit` | PostToolUse (Edit/Write) | TLDR post-edit bookkeeping |

## Pi Parity Matrix

Pi's extension API (`pi --extension`) exposes three lifecycle events: `session_start`, `tool_execution_end`, and `turn_end`. Panopticon maps everything Pi can provide onto the same dashboard ingestion path used by Claude Code hooks.

| Claude Code Hook | Pi Surface | Pi Coverage |
|---|---|---|
| `PreToolUse` | none | Not available; Pi does not expose a pre-tool event. |
| `PostToolUse` | `tool_execution_end` | Emits `agent.activity_changed`, writes the heartbeat file, records per-tool cost events, and resets Pi progress-stall tracking. |
| `Stop` | `turn_end` | Emits idle activity, records turn cost, runs work-agent completion detection, and runs specialist auto-completion detection. |
| `SessionStart` | `session_start` | Writes `ready.json`/`session.id`, emits `agent.model_set`, emits idle activity, and appends workspace/session briefing context when Pi provides a prompt context API. |
| `Notification` | none | Not available; Pi does not expose notification events. |
| `UserPromptSubmit` | none | Not available; Pi does not expose user-prompt submission events. |
| `PreCompact` | none | Not available; Pi does not expose compaction lifecycle events. |
| `PostCompact` | none | Not available; Pi does not expose compaction lifecycle events. |
| `PermissionRequest` | not applicable | Pi has no Claude Code-style permission prompt system. |

The unavailable rows are API gaps rather than missing Panopticon code. Pi agents cannot participate in hook-driven workflows that depend on those missing lifecycle events until Pi exposes equivalent extension events.

## Pi Event Channel (PAN-1134)

The Pi extension POSTs directly to `/api/agents/:id/heartbeat`, using the same validation path as Claude Code hooks. Network and 5xx failures buffer to `pending-events.jsonl` in the agent state directory and flush on the next successful POST; 4xx responses are treated as invalid payloads and are not replayed. Heartbeat bodies flow through `bodyToEvent → decodeDomainEvent → AgentStateService.emit`, so Pi and Claude Code update the same runtime snapshot and event store.

Pi also writes local compatibility files under `~/.panopticon/agents/<agent-id>/` and `~/.panopticon/heartbeats/`:

| File | Writer | Purpose |
|---|---|---|
| `ready.json` | `session_start` | Spawn readiness, Pi session id, reason, pid, timestamp. |
| `session.id` | `session_start` when Pi supplies a session id | Resume target for Pi sessions. |
| `pending-events.jsonl` | failed POST replay buffer | FIFO retry queue for heartbeat and completion endpoint POSTs. |
| `cost-events.jsonl` | `tool_execution_end`, `turn_end` | Local audit trail for Pi usage/cost payloads. |
| `pi-progress.json` | tool/turn events | Progressless-turn counter used for stuck escalation. |
| `../heartbeats/<agent-id>.json` | tool/turn events | Legacy liveness heartbeat for compatibility. |

## Pi Completion Detection

Pi work agents use `turn_end` to approximate Claude Code's `Stop` hook completion flow:

1. Check evidence first: issue beads must all be closed and the workspace vBRIEF/continue state must be satisfied when present.
2. Scan the turn output/transcript for explicit completion markers such as `PANOPTICON_WORK_COMPLETE`, `Implementation complete`, `all beads closed`, or `ready for review`.
3. Ask the dashboard classifier endpoint for a final verdict when the transcript is ambiguous.
4. Emit `agent.resolution_changed` with `done`, `needs_input`, or `stuck` as appropriate.

Specialist Pi agents use the same `turn_end` surface to detect review, test, merge/ship, inspect, and UAT completion markers, then call `/api/specialists/:name/auto-complete` with `passed` or `failed`.

## Harness-Aware Installation

`pan admin hooks install --harness <claude-code|pi|both>` targets Claude Code, Pi, or both harnesses. With no explicit `--harness`, the installer detects available `claude` and `pi` binaries and chooses the installed harnesses. Claude Code installation copies shell hooks into `~/.panopticon/bin/` and mutates `~/.claude/settings.json`; Pi installation verifies that `packages/pi-extension/dist/index.js` exists so launcher-generated Pi commands can load it with `pi --extension`.

`pan admin hooks status` reports the detected harness binaries and Pi extension build status.
