---
name: beads-completion-check
description: >
  Verify all beads (tasks) in a workspace are closed before review completion.
  Use as final check in code review workflow. Returns PASS if no open beads,
  BLOCKED if open beads found. Triggers on "check beads", "verify tasks complete",
  "beads status", or as subagent in review workflow.
tools: Bash(bd:*), Read
model: haiku
---

# Beads Completion Check

Verify all beads (tracked tasks) in a workspace are closed before declaring work complete.

## Purpose

Agents often create beads to track sub-tasks during implementation. These must all be closed before the work can be considered complete. This check prevents:
- Incomplete work being merged
- Forgotten sub-tasks
- Lost context about remaining work

## When to Use

- **Review workflow**: Final check before approving PR
- **Work completion**: Before invoking `/work-complete`
- **Handoff**: Before passing to test-agent or merge-agent

## Execution

Run this check in the workspace being reviewed:

```bash
# Check for open beads
bd list --status open --json
```

## Result Interpretation

### PASS - No Open Beads
```
BEADS CHECK: PASS
No open beads found in workspace.
Work tracking is complete.
```

### BLOCKED - Open Beads Found
```
BEADS CHECK: BLOCKED

Found N open bead(s) that must be resolved:

| ID | Title | Priority | Status |
|----|-------|----------|--------|
| pan-123 | Implement feature X | P2 | open |
| pan-124 | Add tests for Y | P3 | in_progress |

ACTION REQUIRED:
1. Close completed beads: bd close <id> --reason "Completed"
2. Or document why they should remain open
3. Re-run review after resolution
```

## Integration with Review Agent

The review-agent should invoke this as a final check:

```
Task(subagent_type='beads-completion-check', prompt='Check if all beads are closed in workspace: /path/to/workspace')
```

If this check fails, the review should be BLOCKED until beads are resolved.

## Output Format

Return a structured result:

```json
{
  "status": "PASS" | "BLOCKED",
  "openBeads": [],
  "message": "Human-readable summary"
}
```

## Error Handling

- If `bd` command not found: WARN but don't fail (beads may not be used)
- If `.beads/` directory doesn't exist: PASS (no beads tracking in this workspace)
- If bd returns error: Report error, don't fail review
