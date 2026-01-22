## Task Tracking (Beads)

Use beads for persistent task tracking that survives compaction.

```bash
bd ready              # Find unblocked work
bd show <id>          # Get full context
bd update <id> --status in_progress  # Start work
bd comments add <id> "note"  # Add progress (CRITICAL)
bd close <id> --reason "..."  # Complete
bd sync               # Persist to git
```

**ALWAYS** add comments as you work - they survive context compaction.

### Creating Sub-Tasks

```bash
bd create --title "Implement feature X" --parent <parent-id>
```

### Blocking Issues

```bash
# Make issue-A blocked by issue-B (A cannot start until B is done)
bd dep add <blocked-issue> <blocker-issue> --type blocks

# Example: PAN-5 is blocked by PAN-1
bd dep add pan-5 pan-1 --type blocks

bd ready  # Will exclude blocked issues
```
