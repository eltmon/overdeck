## Task Tracking (Beads)

Use beads for persistent task tracking that survives compaction.

```bash
bd list               # See all tasks
bd show <id>          # Get full context
bd update <id> --status in_progress  # Start work
bd update <id> --claim               # Claim work atomically
bd comments add <id> "note"  # Add progress (CRITICAL)
bd close <id> --reason "..."  # Complete
bd sync               # Persist to git (run at session end)
```

**ALWAYS** add comments as you work - they survive context compaction.

**Before closing, check for blockers:**
```bash
bd dep tree <id>        # See what's blocking this issue
# Close blockers first, then close the parent issue
```

**Bulk operations:**
```bash
# Close multiple beads atomically
printf 'close <id-1> done\nclose <id-2> done\n' | bd batch
```

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

**CRITICAL: `bd claim` does NOT exist.** Always use `bd update <id> --claim`.
