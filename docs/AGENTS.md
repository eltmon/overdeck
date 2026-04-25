# Agent Directory Structure

Panopticon stores per-agent state under `~/.panopticon/agents/`. Each agent gets its own directory named after the agent ID.

## Valid Directory Naming Patterns

Only two patterns are created by the codebase today:

| Pattern | Created By | Example |
|---------|-----------|---------|
| `agent-<issueId>` | Work agents (`spawnAgent()`) | `agent-pan-801` |
| `planning-<issueId>` | Planning agents (`startPlanningSession()`) | `planning-pan-801` |

The `<issueId>` is always lowercased before creating the directory. Standard issue IDs follow the `prefix-number` format (e.g., `pan-801`, `min-215`). Rally-format IDs (e.g., `f29698`) are also valid.

## Standard Directory Contents

The following files and directories are written by active code:

| File / Directory | Written By | Purpose |
|------------------|-----------|---------|
| `state.json` | `saveAgentState()` | Core agent state (model, status, timestamps) |
| `activity.jsonl` | `appendActivity()` | Structured activity log |
| `session.id` | `saveSessionId()` | Active Claude Code session identifier |
| `sessions.json` | `saveSessionId()` | Historical session mapping (used by cost reconciler) |
| `ready.json` / `ready` | `setReadySignal()` / legacy | Agent readiness signal |
| `mail/` | `messageAgent()` | Inbound message queue |
| `initial-prompt.md` | `spawnAgent()` | Prompt sent on agent startup |
| `launcher.sh` | `spawnAgent()` | Shell script that launches the agent |
| `output.log` | `messageAgent()` / capture | Captured agent output |
| `completed` | `recoverAgent()` | Completion marker |
| `health.json` | `recoverAgent()` | Last-known health snapshot |
| `current-task.json` | `writeTaskCache()` | Cached task state for resumption |
| `handoffs/` | `handoff.ts` | Handoff prompt debug artifacts |
| `context-pct` / `initial-context-pct` | `scripts/statusline.sh` | Context window usage metrics |

## Legacy Directories

Older naming conventions that are no longer created include:

- `work-<issueId>` — pre-specialist work agents
- `review-<issueId>` — review agents (now ephemeral tmux sessions)
- `test-<issueId>` — test agents (now ephemeral tmux sessions)
- `merge-<issueId>` — merge agents (now ephemeral tmux sessions)
- `agent-<number>` — bare numeric IDs (e.g., `agent-108`)
- `agent-agent-<issueId>` — doubled prefix (e.g., `agent-agent-pan-699`)
- `agent-<prefix>-<number>` with uppercase prefix (e.g., `agent-MIN-791`)
- `conv-*` — old conversation directories
- `specialist-*` — old specialist directories

## Cleanup

Run `pan sync` to clean up orphaned legacy directories. The cleanup step:

1. Scans `~/.panopticon/agents/`
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

## Specialists Do Not Use Agent Directories

Review, test, and merge specialists run as ephemeral tmux sessions and do not create persistent agent directories. Their state is transient and lives only in tmux.
