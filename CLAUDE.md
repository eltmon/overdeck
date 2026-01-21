# Workspace: feature-pan-27

**Issue:** PAN-27
**Branch:** feature/pan-27
**Path:** /home/eltmon/projects/panopticon/workspaces/feature-pan-27

## URLs (if workspace has Docker)

| Service | URL |
|---------|-----|
| Frontend | https://feature-pan-27.localhost:3000 |
| API | https://api-feature-pan-27.localhost:8080 |


---

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
bd update <id> --blocked-by <blocker-id>
bd ready  # Will exclude blocked issues
```


---

## Available Commands

| Command | Description |
|---------|-------------|
| `/work-status` | Show all running agents |
| `/work-tell <id> <msg>` | Message an agent |
| `/work-approve <id>` | Approve and merge work |
| `pan workspace list` | List all workspaces |
| `pan skills` | List available skills |

## Skills

Skills are in `~/.panopticon/skills/`. They provide reusable workflows and best practices.

To use a skill, invoke it with `/skill-name` or reference it in your prompt.


---

## Warnings

- **DO NOT** modify files outside this workspace without explicit permission
- **DO NOT** push to main/master branch directly
- **ALWAYS** check for existing patterns before introducing new ones

## Completion Requirements (CRITICAL)

**You are NOT done until ALL of these are true:**

1. **Tests pass** - Run the full test suite (`npm test` or equivalent)
2. **All changes committed** - `git status` shows "nothing to commit, working tree clean"
3. **Pushed to remote** - `git push -u origin $(git branch --show-current)`
4. **Beads updated** - Add completion notes with `bd comments add`

**Completion checklist:**
```bash
# 1. Run tests
npm test  # or: mvn test, cargo test, etc.

# 2. Stage and commit ALL changes
git add -A
git commit -m "feat: description (ISSUE-XXX)"

# 3. Push to remote
git push -u origin $(git branch --show-current)

# 4. Verify clean state
git status  # Must show "nothing to commit"

# 5. Update beads
bd comments add <task-id> "Implementation complete: <summary>"
```

**If ANY step fails, fix it before declaring work complete.**
