# PAN-30: Cloister Phase 3 - Active Heartbeats & Hooks

## Issue Summary

Enable rich heartbeat data from agents via Claude Code hooks, providing detailed activity information beyond passive file monitoring. This allows the dashboard to show what tool an agent is using and what action it's taking in real-time.

## Key Decisions

### 1. Heartbeat Scope
**Decision:** Rich Context

Include comprehensive data in each heartbeat:
- Tool name
- Current beads task (via cache)
- Git branch
- Workspace path
- Timestamp
- Agent ID

This provides maximum value for the dashboard at minimal overhead cost.

### 2. Existing Hooks Handling
**Decision:** Merge (append to array)

When running `pan setup hooks`:
- Read existing `~/.claude/settings.json`
- Preserve any existing PostToolUse hooks
- Append Panopticon heartbeat hook to the array
- Never clobber user's custom hooks

### 3. Heartbeat Mode
**Decision:** Required for new agents

When spawning agents via `pan work issue`:
- Automatically run hook setup if not already configured
- Set `PANOPTICON_AGENT_ID` environment variable
- Silent auto-setup (one-line confirmation message)

### 4. Task Lookup Method
**Decision:** Cache-based

Performance optimization for beads task lookup:
- When agent starts or switches tasks, write current task to a state file
- Heartbeat hook reads from cache file (0ms overhead)
- Avoids 50-200ms penalty of running `bd show` per tool call

Task cache location: `~/.panopticon/agents/{agentId}/current-task.json`

### 5. Heartbeat Path
**Decision:** Shared directory

Heartbeats written to: `~/.panopticon/heartbeats/{agentId}.json`

Benefits:
- Easier for dashboard to watch all heartbeats in one directory
- Can use `inotify` or `fs.watch` efficiently
- Clear separation from agent state files

**Note:** Need to update `claude-code.ts` to read from new location.

### 6. Idempotent Setup
**Decision:** Yes

`pan setup hooks` will:
- Check if Panopticon heartbeat hook already exists in settings.json
- Skip if already present (print "Already configured")
- Update if version/path has changed

### 7. Auto Setup Mode
**Decision:** Silent auto-setup

On first `pan work issue`:
- Detect hooks not configured
- Automatically run setup
- Print single line: "Configured Panopticon heartbeat hooks"
- Continue with agent spawn

### 8. Dependency Handling
**Decision:** Install if missing

The heartbeat hook script will:
- Check for `jq` dependency at install time
- Attempt to install via package manager if missing (apt, brew, etc.)
- Fail with clear instructions if auto-install fails

## Current Status

**✅ COMPLETE - All Changes Committed and Pushed**

All core features have been implemented and tested:
- ✅ Layer 1: Hook Infrastructure (heartbeat-hook script, pan setup hooks command, jq dependency installation)
- ✅ Layer 2: Integration (spawnAgent PANOPTICON_AGENT_ID, auto-setup hooks, task cache writing, claude-code.ts updates)
- ✅ All tests passing (208/208)
- ✅ Changes committed to feature/pan-30 branch
- ✅ Changes pushed to remote repository

**Commit:** 2f9c4a2
**Branch:** feature/pan-30
**Remote:** https://github.com/eltmon/panopticon-cli/pull/new/feature/pan-30

**Ready for:**
- Manual testing with live agent spawn
- Code review
- Pull request creation

## Scope

### In Scope (PAN-30)

**Heartbeat Hook Infrastructure:**
- Create `~/.panopticon/bin/heartbeat-hook` bash script
- Parse Claude Code's PostToolUse JSON input
- Write rich heartbeat to `~/.panopticon/heartbeats/{agentId}.json`
- Include tool name, timestamp, beads task (from cache), git branch, workspace

**Setup Command:**
- Implement `pan setup hooks` CLI command
- Read/modify `~/.claude/settings.json`
- Merge Panopticon hook with existing hooks
- Idempotent (safe to run multiple times)
- Install `jq` dependency if missing

**Agent Spawning Integration:**
- Modify `spawnAgent()` to set `PANOPTICON_AGENT_ID` env var
- Auto-run hook setup on first spawn if not configured
- Write task cache file when agent starts

**Runtime Updates:**
- Update `claude-code.ts` to read heartbeats from new shared directory
- Ensure hybrid detection (active first, passive fallback) still works

### Out of Scope

- Dashboard UI changes (already supports heartbeat display)
- Webhook notifications (future phase)
- Multi-runtime heartbeat hooks (OpenCode, Codex - future)
- Cost tracking in heartbeats (separate feature)

## Architecture

### Files to Create/Modify

```
~/.panopticon/
├── bin/
│   └── heartbeat-hook         # NEW - bash script called by Claude Code
├── heartbeats/
│   └── {agentId}.json         # NEW - heartbeat files (one per agent)
└── agents/{agentId}/
    └── current-task.json      # NEW - beads task cache

src/cli/commands/
├── setup.ts                   # MODIFY - add 'hooks' subcommand
└── setup/
    └── hooks.ts               # NEW - `pan setup hooks` implementation

src/lib/
├── agents.ts                  # MODIFY - set PANOPTICON_AGENT_ID, auto-setup hooks
└── runtimes/
    └── claude-code.ts         # MODIFY - read from new heartbeat directory
```

### Heartbeat Hook Script

```bash
#!/bin/bash
# ~/.panopticon/bin/heartbeat-hook
# Called by Claude Code after every tool use with JSON on stdin

set -e

# Parse tool info from stdin
TOOL_INFO=$(cat)

# Extract tool name (jq required)
TOOL_NAME=$(echo "$TOOL_INFO" | jq -r '.tool_name // "unknown"')
TOOL_INPUT=$(echo "$TOOL_INFO" | jq -r '.tool_input | tostring | .[0:100] // ""')

# Get agent ID from env (set by pan work issue) or tmux session name
AGENT_ID="${PANOPTICON_AGENT_ID:-$(tmux display-message -p '#S' 2>/dev/null || echo 'unknown')}"

# Get current beads task from cache (if exists)
TASK_CACHE="$HOME/.panopticon/agents/$AGENT_ID/current-task.json"
CURRENT_TASK=""
if [ -f "$TASK_CACHE" ]; then
  CURRENT_TASK=$(jq -r '.title // ""' "$TASK_CACHE" 2>/dev/null || true)
fi

# Get git branch (fast, single command)
GIT_BRANCH=$(git branch --show-current 2>/dev/null || echo "unknown")

# Get workspace from pwd
WORKSPACE=$(pwd)

# Ensure heartbeat directory exists
HEARTBEAT_DIR="$HOME/.panopticon/heartbeats"
mkdir -p "$HEARTBEAT_DIR"

# Write heartbeat
cat > "$HEARTBEAT_DIR/$AGENT_ID.json" << EOF
{
  "timestamp": "$(date -Iseconds)",
  "agent_id": "$AGENT_ID",
  "tool_name": "$TOOL_NAME",
  "last_action": "$TOOL_INPUT",
  "current_task": "$CURRENT_TASK",
  "git_branch": "$GIT_BRANCH",
  "workspace": "$WORKSPACE",
  "pid": $$
}
EOF
```

### Settings.json Modification

Before:
```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": ".*", "command": "my-custom-hook" }
    ]
  }
}
```

After:
```json
{
  "hooks": {
    "PostToolUse": [
      { "matcher": ".*", "command": "my-custom-hook" },
      { "matcher": ".*", "command": "~/.panopticon/bin/heartbeat-hook" }
    ]
  }
}
```

### Heartbeat File Format

```json
{
  "timestamp": "2026-01-21T10:30:45-08:00",
  "agent_id": "agent-pan-30",
  "tool_name": "Edit",
  "last_action": "file_path: src/lib/agents.ts, old_string: ...",
  "current_task": "Implement heartbeat hook script",
  "git_branch": "feature/pan-30",
  "workspace": "/home/user/projects/panopticon/workspaces/feature-pan-30",
  "pid": 12345
}
```

## Implementation Order

### Layer 1: Hook Infrastructure
1. Create heartbeat-hook bash script
2. Make it executable and test manually
3. Create `pan setup hooks` command

### Layer 2: Integration
4. Modify `spawnAgent()` to set env var and auto-setup
5. Add task cache writing when agent starts
6. Update `claude-code.ts` to read from new heartbeat directory

### Layer 3: Polish
7. Add dependency installation (jq)
8. Handle edge cases (permissions, missing directories)
9. Add tests for setup command

## Beads Tasks

| ID | Title | Layer | Blocked By |
|----|-------|-------|------------|
| pan30-01 | Create heartbeat-hook bash script | 1 | - |
| pan30-02 | Implement `pan setup hooks` command | 1 | pan30-01 |
| pan30-03 | Add jq dependency installation | 1 | pan30-02 |
| pan30-04 | Modify spawnAgent to set PANOPTICON_AGENT_ID | 2 | - |
| pan30-05 | Add auto-setup hooks on first spawn | 2 | pan30-02, pan30-04 |
| pan30-06 | Write task cache file on agent start | 2 | pan30-04 |
| pan30-07 | Update claude-code.ts heartbeat reading | 2 | pan30-01 |
| pan30-08 | Handle edge cases and permissions | 3 | pan30-05, pan30-07 |
| pan30-09 | Add tests for pan setup hooks | 3 | pan30-02 |

## Technical Notes

### Claude Code Hook JSON Format

Claude Code sends PostToolUse hooks JSON like:
```json
{
  "tool_name": "Edit",
  "tool_input": { "file_path": "...", "old_string": "...", "new_string": "..." },
  "tool_result": { "success": true, ... }
}
```

### Environment Variable Injection

```typescript
// In spawnAgent()
const claudeCmd = `claude --dangerously-skip-permissions --model ${state.model}`;
createSession(agentId, options.workspace, claudeCmd, {
  env: {
    ...process.env,
    PANOPTICON_AGENT_ID: agentId
  }
});
```

### Idempotent Hook Setup

```typescript
function hookAlreadyConfigured(settings: any): boolean {
  const postToolUse = settings?.hooks?.PostToolUse || [];
  return postToolUse.some((h: any) =>
    h.command?.includes('panopticon') ||
    h.command?.includes('heartbeat-hook')
  );
}
```

### Task Cache Update

Write task cache when:
1. Agent starts (from initial prompt context)
2. Agent updates beads task status (`bd update --status in_progress`)

For MVP: Only write on agent start. Task switching detection is future work.

## Open Questions

None - all decisions captured above.

## References

- PRD: `/home/eltmon/projects/panopticon/docs/PRD-CLOISTER.md` (Phase 3: Active Heartbeats & Hooks)
- Claude Code Runtime: `/home/eltmon/projects/panopticon/src/lib/runtimes/claude-code.ts`
- Agent spawning: `/home/eltmon/projects/panopticon/src/lib/agents.ts`
- GitHub Issue: https://github.com/eltmon/panopticon-cli/issues/30
