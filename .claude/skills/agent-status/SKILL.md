---
name: agent-status
description: >
  Show the live status of all Panopticon agents and review sessions.
  Lists every tmux session, captures recent output, identifies models,
  and reports status (running, stuck, idle, done) in a summary table.
triggers:
  - /agent-status
  - show agent status
  - show all agents
  - check on agents
  - agent status
  - what are agents doing
---

# agent-status — Live Agent Status Report

## What this skill does

Captures a real-time snapshot of every active Panopticon agent and specialist
session, shows what each is doing, and presents it as a concise summary table.

## Steps

### 1. List all agent tmux sessions

```bash
tmux list-sessions 2>/dev/null | grep -E "agent-|specialist-|review-|planning-" | sort
```

This gives you every active session. Note which are `(attached)`.

### 2. Capture recent output from each session

For each session found in step 1, capture the last 15 lines of terminal output:

```bash
tmux capture-pane -t "<session-name>" -p | tail -15
```

From the captured output, extract:
- **Model**: Look for model identifiers in the status line (e.g., `K2.6-code-preview`, `claude-sonnet-4-6`, `minimax-m2.7`, `glm-5.1`, `gpt-5.4`)
- **Status**: Determine from the output:
  - "Idle" — at a prompt (`>`) with no active work
  - "Running" — actively generating or executing tools (look for spinners like "Churning", "Slithering", "Thinking")
  - "Stuck" — waiting on user input, interrupted, or hit a resume prompt
  - "Done" — completed work, review triggered or submitted
  - "Error" — crashed or showing error output
- **What it's doing**: The last meaningful action or output summary (1 sentence)
- **Session age / cost**: If visible in the status line (e.g., `5h 58%`, `cost $0.5436`)

### 3. Check for review pipeline sessions

Review sessions follow the naming pattern:
- `review-coordinator-<ISSUE>-<timestamp>` — the coordinator that spawns reviewers
- `review-<ISSUE>-<timestamp>-<role>` — individual reviewers (correctness, security, performance, requirements)

For review coordinators, check the log output to see:
- Which reviewers have completed (look for "completed in Xms")
- Which are still running
- What models the reviewers were launched with (look for `--model <id>` in the exec line)

### 4. Present the summary

Present two tables:

**Active agents:**

| Session | Model | Status | Details |
|---|---|---|---|
| `agent-pan-XXX` | model-name | Running/Idle/Stuck/Done | Last action or current state |

**Review pipeline** (if any review sessions exist):

| Session | Model | Status | Duration |
|---|---|---|---|
| `review-coordinator-...` | model | Running/Done | - |
| `correctness` | model | Done | 138s |
| `security` | model | Running | 4m 23s |

### 5. Flag problems

After the tables, call out anything that needs attention:
- Agents stuck at interactive prompts (resume dialogs, permission prompts, interrupted commands)
- Review sessions using wrong models (compare against `~/.panopticon/config.yaml` overrides)
- Sessions that have been running unusually long (>30min for reviewers, >2h for work agents without activity)
- Dead sessions (tmux session exists but process has exited)

## Output format

Keep it concise. Tables first, problems second. No preamble. The user wants a dashboard-style glance, not a narrative.
