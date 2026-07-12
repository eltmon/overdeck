## Task Tracking (Beads)

Use beads for persistent task tracking that survives compaction.

```bash
bd list               # See all tasks
bd show <id>          # Get full context
pan beads update <id> --status in_progress  # Start work
pan beads claim <id>                 # Claim work atomically
bd comments add <id> "note"  # Add progress (CRITICAL)
pan beads close <id> --reason "..."  # Complete and publish to refs/dolt/data
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
pan beads close <id-1> <id-2> --reason "done"
```

### Creating Sub-Tasks

```bash
pan beads create --title "Implement feature X" --parent <parent-id>
```

### Blocking Issues

```bash
# Make issue-A blocked by issue-B (A cannot start until B is done)
pan beads dep add <blocked-issue> <blocker-issue> --type blocks

# Example: PAN-5 is blocked by PAN-1
bd dep add pan-5 pan-1 --type blocks

bd ready  # Will exclude blocked issues
```

Use `pan beads claim`; the write door maps it to the supported atomic bd update.
