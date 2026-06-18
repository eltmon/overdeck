# Agent Directory Structure

Overdeck stores per-agent and per-role-run state under `~/.overdeck/agents/`. Each active run gets its own directory named after the run ID.

## Valid Directory Naming Patterns

Current code creates these patterns:

| Pattern | Created By | Example |
|---------|-----------|---------|
| `agent-<issueId>` | Main work-agent compatibility path (`spawnAgent()`) | `agent-pan-801` |
| `agent-<issueId>-<role>` | Role runner (`spawnRun(issueId, role)`) | `agent-pan-801-review` |
| `planning-<issueId>` | Planning sessions (`startPlanningSession()`) | `planning-pan-801` |

The `<issueId>` is always lowercased before creating the directory. Standard issue IDs follow the `prefix-number` format (e.g., `pan-801`, `min-215`). Rally-format IDs (e.g., `f29698`) are also valid.

## Standard Directory Contents

The following files and directories are written by active code:

| File / Directory | Written By | Purpose |
|------------------|-----------|---------|
| `state.json` | `saveAgentState()` | Core run state (role, model, harness, status, timestamps) |
| `activity.jsonl` | `appendActivity()` | Structured activity log |
| `session.id` | `saveSessionId()` | Active Claude Code session identifier |
| `sessions.json` | `saveSessionId()` | Historical session mapping (used by cost reconciler) |
| `ready.json` / `ready` | `setReadySignal()` / legacy | Agent readiness signal |
| `mail/` | `messageAgent()` | Inbound message queue |
| `initial-prompt.md` | `spawnAgent()` / `spawnRun()` | Prompt sent on startup |
| `launcher.sh` | `spawnAgent()` / `spawnRun()` | Shell script that launches the run |
| `pty-token` | `spawnAgent()` / `spawnConversationSession()` | Per-agent bearer token for PTY supervisor delivery |
| `output.log` | `messageAgent()` / capture | Captured output |
| `completed` | `recoverAgent()` | Completion marker |
| `health.json` | `recoverAgent()` | Last-known health snapshot |
| `current-task.json` | `writeTaskCache()` | Cached task state for resumption |
| `handoffs/` | `handoff.ts` | Handoff prompt debug artifacts |
| `context-pct` / `initial-context-pct` | `scripts/statusline.sh` | Context window usage metrics |

## Delivery artifacts

New Claude Code work agents and Claude Code conversation sessions launch through
the PTY supervisor by default. Their launchers wrap Claude as
`node <projectRoot>/dist/pty-supervisor.js claude ...`; the supervisor runs under
Node 22, owns Claude's PTY master fd, and binds
`${OVERDECK_HOME}/sockets/pty-<id>.sock` at mode `0600`. Because the
supervisor owns the PTY, a supervisor crash also terminates Claude; resume the
session through the normal dashboard/Deacon flow.

`deliverAgentMessage()` uses a three-tier router: PTY supervisor first, legacy
Claude Code Channels MCP second, and tmux paste-buffer last. Docker workspaces
are still excluded from supervisor wiring until host/container socket sharing is
designed, and Pi keeps using its `rpc.in` FIFO.

The legacy Claude Code Channels MCP bridge is opt-in for new work-agent spawns
through `experimental.claudeCodeChannelsMcp: true`; when enabled,
`spawnAgent()` writes `<workspace>/.pan/agent-mcp.json`, a bridge token under
`~/.overdeck/bridge-tokens/`, and `state.channelsEnabled = true`. Existing
agents with `channelsEnabled = true` continue to use Channels as the delivery
fallback even when the MCP override is later disabled.

## Legacy Directories

Older naming conventions that are no longer created include:

- `work-<issueId>` — pre-role work agents
- `review-<issueId>` — pre-role review runs
- `test-<issueId>` — pre-role test runs
- `merge-<issueId>` — pre-role merge runs
- `agent-<number>` — bare numeric IDs (e.g., `agent-108`)
- `agent-agent-<issueId>` — doubled prefix (e.g., `agent-agent-pan-699`)
- `agent-<prefix>-<number>` with uppercase prefix (e.g., `agent-MIN-791`)
- `conv-*` — old conversation directories
- `specialist-*` — old pre-role directories

## Cleanup

Run `pan sync` to clean up orphaned legacy directories. The cleanup step:

1. Scans `~/.overdeck/agents/`
2. Identifies directories that do not match the current naming patterns
3. Skips directories with a running tmux session (never kills active agents)
4. Prompts for confirmation before deletion (use `--force` to skip the prompt)
5. Supports `--dry-run` to preview what would be removed without making changes

```bash
# Preview orphaned directories
pan sync --dry-run

# Clean up with confirmation prompt
pan sync

# Clean up without prompting
pan sync --force
```
