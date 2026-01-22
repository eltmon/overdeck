# Planning Session: PAN-30

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files (except STATE.md)
- Run implementation commands (npm install, docker compose, make, etc.)
- Create actual features or functionality
- Start implementing the solution

**YOU SHOULD ONLY:**
- Ask clarifying questions (use AskUserQuestion tool)
- Explore the codebase to understand context (read files, grep)
- Generate planning artifacts:
  - STATE.md (decisions, approach, architecture)
  - Beads tasks (via `bd create`)
  - PRD file at `docs/prds/active/{issue-id}-plan.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-30
- **Title:** Cloister Phase 3: Active Heartbeats & Hooks
- **URL:** https://github.com/eltmon/panopticon-cli/issues/30

## Description
## Overview

Enable rich heartbeat data from agents via Claude Code hooks, providing detailed activity information beyond passive file monitoring.

## Goals

1. Agents report what tool they are using and what action they are taking
2. Enable agent ID injection for proper session tracking
3. Provide hybrid detection (active heartbeats with passive fallback)

## Tasks

From PRD-CLOISTER.md Phase 3:

- [ ] Heartbeat hook script (`~/.panopticon/bin/heartbeat-hook`)
- [ ] `pan setup hooks` command to configure Claude Code
- [ ] Agent ID environment variable injection (`PANOPTICON_AGENT_ID`)
- [ ] Rich heartbeat data (tool name, last action)
- [ ] Hybrid detection (active + passive fallback)

## Heartbeat Hook Script

```bash
#!/bin/bash
# ~/.panopticon/bin/heartbeat-hook
# Called after every tool use with JSON on stdin

TOOL_INFO=$(cat)
TOOL_NAME=$(echo "$TOOL_INFO" | jq -r ".tool_name // \"unknown\"")
AGENT_ID="${PANOPTICON_AGENT_ID:-$(tmux display-message -p "#S" 2>/dev/null || echo "unknown")}"

HEARTBEAT_DIR="$HOME/.panopticon/agents/$AGENT_ID"
mkdir -p "$HEARTBEAT_DIR"

cat > "$HEARTBEAT_DIR/heartbeat.json" << HEARTBEAT
{
  "timestamp": "$(date -Iseconds)",
  "agent_id": "$AGENT_ID",
  "tool_name": "$TOOL_NAME",
  "pid": $$
}
HEARTBEAT
```

## Claude Code Hook Configuration

Add to `~/.claude/settings.json`:
```json
{
  "hooks": {
    "PostToolUse": [
      {
        "matcher": ".*",
        "command": "~/.panopticon/bin/heartbeat-hook"
      }
    ]
  }
}
```

## Dependencies

- Phase 1 (Watchdog Framework) ✅
- Phase 2 (Agent Management UI) ✅

## References

- PRD-CLOISTER.md lines 916-1070

---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. Read the codebase to understand relevant files and patterns
2. Identify what subsystems/files this issue affects
3. Note any existing patterns we should follow

### Phase 2: Discovery Conversation
Use AskUserQuestion tool to ask contextual questions:
- What's the scope? What's explicitly OUT of scope?
- Any technical constraints or preferences?
- What does "done" look like?
- Are there edge cases we need to handle?

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Create beads tasks with dependencies using `bd create`
3. Summarize the plan and STOP

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.
