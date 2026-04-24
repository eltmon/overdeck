# Async Gates for Workflow Coordination

`bd gate` provides async coordination primitives for cross-session and external-condition workflows.

**IMPORTANT**: Gates are created as issues with `--type gate`, NOT via a `bd gate create` subcommand.

---

## Creating Gates

### Step 1: Register the gate type (one-time per project)

```bash
bd config set types.custom '["gate"]'
```

### Step 2: Create a gate issue

```bash
# Human approval gate
bd create "Approve production deploy" --type gate

# Timer gate (deployment propagation)
bd create "Wait for deployment propagation" --type gate --due "+15m"

# CI gate (GitHub Actions)
bd create "Wait for CI" --type gate
# Then set the gate condition via labels or external tracking

# PR merge gate
bd create "Wait for PR approval" --type gate
```

**Required**: `--type gate` (after registering custom type)
**Recommended**: `--due` or `--timeout` to prevent forever-open gates

### Step 3: Block work on the gate

```bash
# Make issue-A blocked by the gate (A cannot start until gate closes)
bd dep add <blocked-issue> <gate-id> --type blocks
```

---

## Gate Types

| Type | Resolve Method | Use Case |
|------|----------------|----------|
| `human` | `bd gate resolve <id>` | Cross-session human approval |
| `timer` | Auto-resolves when due date reached | Deployment propagation delay |
| `gh:run` | `bd gate check` evaluates GitHub API | Wait for GitHub Actions completion |
| `gh:pr` | `bd gate check` evaluates GitHub API | Wait for PR merge/close |

---

## Monitoring Gates

```bash
bd gate list              # All open gates
bd gate list --all        # Include closed
bd gate show <gate-id>    # Details for specific gate
bd gate check             # Auto-evaluate and close resolved gates
bd gate check --dry-run   # Preview what would close
```

**Auto-close behavior** (`bd gate check`):
- `timer` — Closes when due date elapsed
- `gh:run` — Checks GitHub API, closes on success/failure
- `gh:pr` — Checks GitHub API, closes on merge/close
- `human` — Requires explicit `bd gate resolve`

---

## Resolving Gates

```bash
# Human gates require explicit approval
bd gate resolve <gate-id>
bd gate resolve <gate-id> --reason "Reviewed and approved by Steve"

# Manual close (any gate)
bd gate resolve <gate-id> --reason "No longer needed"
```

---

## Best Practices

1. **Always set due dates**: Prevents forever-open gates
   ```bash
   bd create "Approve deploy" --type gate --due "+24h"
   ```

2. **Clear titles**: Title should indicate what's being gated
   ```bash
   bd create "Approve Phase 2: Core Implementation" --type gate
   ```

3. **Check periodically**: Run at session start to close elapsed gates
   ```bash
   bd gate check
   ```

4. **Clean up obsolete gates**: Resolve gates that are no longer needed
   ```bash
   bd gate resolve <id> --reason "superseded by new approach"
   ```

5. **Check before creating**: Avoid duplicate gates
   ```bash
   bd gate list | grep "spec-myfeature"
   ```

---

## Gates vs Issues

| Aspect | Gates (type=gate) | Issues |
|--------|-------------------|--------|
| Persistence | Permanent (synced to git) | Permanent (synced to git) |
| Purpose | Block on external condition | Track work items |
| Lifecycle | Auto-close when condition met | Manual close |
| Visibility | `bd gate list` | `bd list` |
| Use case | CI, approval, timers | Tasks, bugs, features |

Gates are standard issues with a special type — they exist until their condition is satisfied.

---

## Troubleshooting

### Gate won't close

```bash
# Check gate details
bd gate show <gate-id>

# For gh:run gates, verify the run exists
gh run view <run-id>

# Force close if stuck
bd gate resolve <gate-id> --reason "manual override"
```

### Can't find gate ID

```bash
# List all gates (including closed)
bd gate list --all

# Search by title pattern
bd gate list | grep "Phase 2"
```

### CI run ID detection fails

```bash
# Check GitHub CLI auth
gh auth status

# List runs manually
gh run list --branch <branch>

# Use specific workflow
gh run list --workflow ci.yml --branch <branch>
```
