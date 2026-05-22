---
name: workspace-status
description: Auto-applied when reporting on agent/workspace status. Displays robust workspace information with URLs and commands.
---

# Workspace Status Display Format

When discussing agent status, workspace setup, or providing updates about spawned agents, ALWAYS include this comprehensive table format.

## Required Information Table

Display workspace details in this exact format:

```markdown
## Agent: {ISSUE_ID} - {ISSUE_TITLE}

| Field | Value |
|-------|-------|
| Issue | {TRACKER_URL} |
| PR/MR | {PR_OR_MR_URL} (if available) |
| Workspace | {WORKSPACE_PATH} |
| **Frontend** | https://feature-{issue-id-lowercase}.{PROJECT_DOMAIN} |
| **API** | https://api-feature-{issue-id-lowercase}.{PROJECT_DOMAIN} |
| tmux Session | agent-{issue-id-lowercase} |

## Commands

| Action | Command |
|--------|---------|
| **Watch agent** | `tmux attach -t agent-{issue-id-lowercase}` |
| **Send feedback** | `pan tell {ISSUE_ID} "your message"` |
| **Merge** | Dashboard MERGE button |
| Detach | `Ctrl+b` then `d` |
| Kill | `tmux kill-session -t agent-{issue-id-lowercase}` |
| Resources | `htop` or `watch -n 5 'free -h'` |
```

## When to Apply This Format

Use this format when:
- Spawning a new agent
- Reporting agent completion
- Providing agent status updates
- Resuming or restarting an agent
- User asks about an agent's status
- Providing investigation/spike results

## Additional Context (Optional)

After the tables, you may add additional context like:
- Investigation plan or next steps
- Important notes about the workspace
- Special setup or requirements
- Resource availability status

The tables should ALWAYS come first, followed by any additional narrative.
