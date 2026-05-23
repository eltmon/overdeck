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

## The Six Pi Gaps

Pi's extension API (`pi --extension`) exposes only three lifecycle events: `session_start`, `tool_execution_end`, and `turn_end`. There is **no equivalent** for six of Claude Code's nine hooks:

1. **PreToolUse** — Pi has no pre-tool event
2. **Notification** — Pi has no notification system
3. **PreCompact** — Pi has no compaction lifecycle hook
4. **PostCompact** — Pi has no compaction lifecycle hook
5. **UserPromptSubmit** — Pi has no user-prompt event
6. **PermissionRequest** — Pi has no permission system (intentionally absent by design)

These gaps are inherent to Pi's API surface. Pi agents cannot participate in hook-driven workflows that depend on these events.

## Pi Partial Equivalents

While the six gaps above have no workaround, three hooks have partial Pi equivalents:

| Claude Hook | Pi Equivalent | Coverage |
|---|---|---|
| `SessionStart` | `session_start` event | Writes `ready.json` with sessionId. Dashboard uses this for spawn readiness. |
| `PostToolUse` | `tool_execution_end` event | Writes `heartbeat.json` with tool name. Used for liveness detection only — does not emit domain events. |
| `Stop` | `turn_end` event | Approximates the Stop hook: fires when Pi finishes a turn and returns to the prompt. |

### Pi Event Channel (PAN-1134)

The Pi extension POSTs directly to `/api/agents/:id/heartbeat`, using the same validation path as Claude Code hooks. Network failures buffer to `pending-events.jsonl` in the agent state directory and flush on the next successful POST — the same FIFO model that `scripts/pan-hook-lib.sh` uses for Claude Code hooks. This gives Pi agents real-time activity tracking (`activity_changed`, `model_set`) through the same `bodyToEvent → decodeDomainEvent → appendAsync` pipeline that Claude Code hooks use, even though the six gaps remain.
