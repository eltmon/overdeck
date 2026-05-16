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

## The Split-Registry Rule (PAN-982)

Hooks are registered in **two places**, not one. This is intentional and prevents double-firing.

### Global `~/.claude/settings.json`

Six hooks live in global settings because Claude Code's per-agent frontmatter cannot reliably host them:

- **Bootstrap-path hooks** (`SessionStart`, `UserPromptSubmit`) fire before `--agent` is fully bound, so frontmatter hooks would be missed.
- **Session-wide signals** (`PreCompact`, `PostCompact`, `Notification`, `PermissionRequest`) need uniform routing across both pipeline-agent and ad-hoc Claude sessions.

### Per-Agent Frontmatter (`agents/pan-*.md`)

Three hooks live in each of the seven agent definition YAML frontmatters:

- `PreToolUse`
- `PostToolUse`
- `Stop`

The pipeline agents are: `pan-work-agent`, `pan-planning-agent`, `pan-review-agent`, `pan-test-agent`, `pan-merge-agent`, `pan-uat-agent`, and `pan-inspect-agent`.

These were migrated out of global settings in PAN-982 because registering them globally **and** in frontmatter causes every event to fire twice (once from each source). The per-agent approach also means ad-hoc Claude sessions (launched without `--agent`) do not trigger Panopticon-specific hooks like heartbeat tracking or cost recording, which is correct — those hooks have no meaning outside a pipeline agent.

### Migration Pruning

`pan install` (via `setupHooksCommand`) automatically strips legacy global registrations of `PreToolUse`, `PostToolUse`, and `Stop` from `~/.claude/settings.json` so upgrades across PAN-982 do not double-fire.

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
