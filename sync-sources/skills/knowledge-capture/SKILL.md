---
name: knowledge-capture
description: >
  AI self-monitoring skill. Triggers proactively when AI detects confusion or makes corrected mistakes
  (wrong DB schema, incorrect assumptions, user corrections on key insights). Prompts to capture
  learnings as project-specific skills. NOT user-invoked - AI should reference this when confused.
---

# Knowledge Capture

This skill helps AI assistants recognize their own confusion and systematically capture project-specific knowledge to prevent repeated mistakes.

## When to Trigger (Self-Assessment)

**IMPORTANT:** This skill is NOT user-invoked. As the AI, you should proactively invoke this when you detect ANY of these situations:

### High-Confidence Triggers (Always Invoke)

1. **Database Schema Mistakes** [category: `database`]
   - Queried a column that doesn't exist
   - Used wrong column name (e.g., `user_id` vs `userId` vs `owner_id`)
   - Assumed an index exists that doesn't
   - Got foreign key relationships wrong
   - Example: "SELECT created_at FROM users" → Error: column "created_at" doesn't exist (it's "createdAt")

2. **User Corrections on Architecture** [category: `architecture`]
   - User corrects you on how a system component works
   - User explains a non-obvious design pattern in use
   - User clarifies that "we don't do it that way here"
   - Example: "Actually, we use event sourcing here, not direct DB updates"

3. **API/Interface Misunderstandings** [category: `api`]
   - Called an API endpoint that doesn't exist
   - Used wrong HTTP method or payload structure
   - Misunderstood authentication flow
   - Example: Assumed REST when it's GraphQL

4. **Build/Deploy Confusion** [category: `build`]
   - Wrong build commands for this project
   - Incorrect environment variable names
   - Misunderstood the deployment pipeline
   - Example: "npm run build" fails because project uses "pnpm build:prod"

### Medium-Confidence Triggers (Invoke After 2+ Occurrences)

5. **Naming Convention Mismatches** [category: `naming`]
   - Used camelCase when project uses snake_case (or vice versa)
   - Got file naming patterns wrong
   - Misnamed components/modules

6. **Testing Approach Misalignment** [category: `testing`]
   - Wrote unit tests when project prefers integration tests
   - Used wrong test framework or patterns
   - Missed required test coverage patterns

7. **Code Style Conflicts** [category: `style`]
   - Used patterns the codebase explicitly avoids
   - Suggested dependencies the project doesn't allow
   - Architectural patterns that conflict with project conventions

### Low-Confidence Triggers (Check Config First)

8. **Minor Corrections** [category: `preferences`]
   - Small preference corrections from user
   - "We prefer X over Y" statements
   - Style guide clarifications

## Invocation Protocol

### Step 0: Check for Permanent Override

**FIRST**, check if user has permanently disabled this skill:

```bash
# If project has override skill, this skill is permanently disabled
if [ -f ".claude/skills/knowledge-capture/SKILL.md" ]; then
  # User has "shut up forever" - do nothing
  exit 0
fi
```

If override exists, **do not prompt** - the user has explicitly disabled this skill.

### Step 0.5: Check User Preferences for Category Exclusions

Check `~/.claude/CLAUDE.md` for excluded categories:

```bash
grep -A 20 "## AI Suggestion Preferences" ~/.claude/CLAUDE.md 2>/dev/null
```

Look for sections like:
```markdown
## AI Suggestion Preferences

### knowledge-capture
skip: database, authentication, infrastructure
```

If the current trigger category is in the skip list, **do not prompt**.

### Step 1: Check Configuration

```bash
cat .panopticon/knowledge-capture.json 2>/dev/null || echo "{}"
```

**Default configuration** (if file doesn't exist):
```json
{
  "enabled": true,
  "mode": "normal",
  "promptCooldownMinutes": 30,
  "lastPromptTimestamp": null,
  "capturedCount": 0,
  "dismissedCount": 0,
  "sessionDismissals": 0
}
```

**Mode settings:**
- `"aggressive"` - Prompt on every trigger
- `"normal"` - Prompt on high/medium triggers, respect cooldown
- `"minimal"` - Only high-confidence triggers, longer cooldown
- `"silent"` - Log but never prompt (user said "shut up")
- `"disabled"` - Completely off

### Step 2: Respect Cooldowns and Dismissals

```javascript
// Pseudocode for decision
if (mode === "disabled") return; // Do nothing
if (mode === "silent") { logInternally(); return; }
if (sessionDismissals >= 3) return; // User said "not now" 3 times
if (Date.now() - lastPromptTimestamp < cooldownMinutes * 60000) return;
```

### Step 3: Present to User

When conditions are met, present the learning opportunity:

---

**Knowledge Capture Opportunity** [category: {CATEGORY}]

I just encountered confusion about **[SPECIFIC THING]**:
- What I assumed: [YOUR ASSUMPTION]
- What's actually true: [THE CORRECTION]

This seems like project-specific knowledge that would help me (and other AI assistants) avoid this mistake in the future.

**Would you like to capture this as project documentation?**

| Option | What happens |
|--------|--------------|
| **Yes, create skill** | I'll draft a project-specific skill with this knowledge |
| **Yes, add to CLAUDE.md** | I'll add a note to the project's CLAUDE.md file |
| **Not now** | Skip this time (I'll ask less frequently) |
| **Skip this category** | Never prompt about {CATEGORY} issues (updates your ~/.claude/CLAUDE.md) |
| **Too frequent** | Reduce how often I ask (switch to minimal mode) |
| **Stop asking** | Turn off prompts for this project (silent mode) |
| **Shut up forever** | Permanently disable for this project (creates override) |

---

### Step 4: Handle Response

**If "Yes, create skill":**
1. Create `.claude/skills/project-knowledge/SKILL.md` (or add to existing)
2. Document the specific confusion and correct behavior
3. Include examples
4. Update config: `capturedCount++`

**If "Yes, add to CLAUDE.md":**
1. Add section to project's `.claude/CLAUDE.md` (create if needed)
2. Document under "## Project-Specific Notes" or similar
3. Update config: `capturedCount++`

**If "Not now":**
1. Update config: `sessionDismissals++`, `lastPromptTimestamp = now`
2. Continue working

**If "Skip this category":**
1. Update `~/.claude/CLAUDE.md` to add category to skip list
2. Acknowledge: "Got it - I won't prompt about {CATEGORY} issues anymore. You can edit ~/.claude/CLAUDE.md to change this."

**If "Too frequent":**
1. Update config: `mode = "minimal"`, `promptCooldownMinutes = 120`
2. Acknowledge: "Got it - I'll only prompt for significant confusions."

**If "Stop asking":**
1. Update config: `mode = "silent"`
2. Acknowledge: "Understood - I'll stop prompting but continue to work normally. Say 're-enable knowledge capture' to turn prompts back on."

**If "Shut up forever":**
1. Create override skill to permanently disable:
```bash
mkdir -p .claude/skills/knowledge-capture
cat > .claude/skills/knowledge-capture/SKILL.md << 'EOF'
---
name: knowledge-capture
description: disabled-override-Qx7nR3
---
Disabled by user.
EOF
```
2. Acknowledge: "Knowledge Capture permanently disabled for this project. Delete `.claude/skills/knowledge-capture/` to re-enable."

### Step 5: Update Configuration

After any interaction, update the config file:

```bash
# Ensure directory exists
mkdir -p .panopticon

# Write updated config
cat > .panopticon/knowledge-capture.json << 'EOF'
{
  "enabled": true,
  "mode": "normal",
  "promptCooldownMinutes": 30,
  "lastPromptTimestamp": "2024-01-15T10:30:00Z",
  "capturedCount": 3,
  "dismissedCount": 1,
  "sessionDismissals": 0
}
EOF
```

## User Preferences in ~/.claude/CLAUDE.md

Users can exclude specific categories globally by adding to their personal `~/.claude/CLAUDE.md`:

```markdown
## AI Suggestion Preferences

### knowledge-capture
skip: database, authentication, infrastructure

### refactor-radar
skip: database-migrations, build-system
welcome: naming, code-organization, testing
```

### Available Categories

| Category | What it covers |
|----------|----------------|
| `database` | Schema mistakes, column names, indexes, relationships |
| `architecture` | System design, patterns, component interactions |
| `api` | Endpoints, HTTP methods, payloads, auth flows |
| `build` | Build commands, env vars, deployment pipelines |
| `naming` | Naming conventions, file patterns |
| `testing` | Test frameworks, patterns, coverage |
| `style` | Code style, dependencies, patterns to avoid |
| `preferences` | Minor user preferences |
| `authentication` | Auth-specific confusions (subset of api/architecture) |
| `infrastructure` | DevOps, CI/CD, cloud config |

### Why Skip Categories?

**Database:** "Our DBA handles all schema work - I don't need AI help here."

**Authentication:** "Auth is locked down by security team - any changes go through them."

**Infrastructure:** "We have a dedicated platform team - I just write application code."

**Build:** "Build system is stable and rarely changes - not worth documenting."

### Updating Preferences

To add a category exclusion:
```bash
# AI will add this section if it doesn't exist
cat >> ~/.claude/CLAUDE.md << 'EOF'

## AI Suggestion Preferences

### knowledge-capture
skip: database
EOF
```

To modify:
```bash
# Edit directly
nano ~/.claude/CLAUDE.md
```

To remove all exclusions:
```bash
# Remove the AI Suggestion Preferences section
sed -i '/## AI Suggestion Preferences/,/^## /d' ~/.claude/CLAUDE.md
```

## User Commands (Escalating Silence)

Users can control this skill via natural language, from gentle to nuclear:

| Command | Effect | Scope | Reversible? |
|---------|--------|-------|-------------|
| "Not now" / "Skip" | Skip this prompt | This session | Yes (automatic) |
| "Skip database suggestions" | Add to skip list | All projects | Yes (edit CLAUDE.md) |
| "Ask less often" | Minimal mode | This project | Yes |
| "Stop asking" / "Silent mode" | Never prompt | This project | Yes |
| "Disable knowledge capture" | Completely off | This project | Yes |
| "Shut up forever" | Create override | This project | Yes (delete file) |

**To re-enable after "shut up forever":**
```bash
rm -rf .claude/skills/knowledge-capture/
```

## Example Captured Knowledge

### Example 1: Database Schema

**Trigger:** AI queried `users.created_at` but column is `users.createdAt`

**Captured skill content:**
```markdown
## Database Conventions

This project uses **camelCase** for all database columns, not snake_case.

| Wrong | Correct |
|-------|---------|
| created_at | createdAt |
| user_id | userId |
| is_active | isActive |

The ORM is Prisma with `@map` directives for legacy compatibility.
```

### Example 2: Build System

**Trigger:** AI ran `npm run build` but project uses pnpm workspaces

**Captured skill content:**
```markdown
## Build Commands

This is a **pnpm monorepo**. Never use npm directly.

| Task | Command |
|------|---------|
| Install | `pnpm install` |
| Build all | `pnpm build` |
| Build specific | `pnpm --filter @app/backend build` |
| Dev mode | `pnpm dev` |
| Tests | `pnpm test` |

Root package.json scripts are workspace-aware.
```

### Example 3: Architecture Pattern

**Trigger:** User corrected AI about direct DB access: "We use CQRS here"

**Captured skill content:**
```markdown
## Architecture: CQRS Pattern

This project uses **Command Query Responsibility Segregation**.

**Commands** (writes): Go through `src/commands/` handlers
**Queries** (reads): Go through `src/queries/` with read models

NEVER:
- Write directly to DB from API handlers
- Mix read and write operations in same service
- Query the write models directly

Event flow: Command → Handler → Event → Projector → Read Model
```

### Example 4: Testing Approach

**Trigger:** AI wrote unit tests but project prefers E2E

**Captured skill content:**
```markdown
## Testing Philosophy

This project prioritizes **E2E tests over unit tests**.

- Use Playwright for all user-facing features
- Unit tests only for pure utility functions
- No mocking of database - use test fixtures
- All tests must be deterministic (no Math.random, Date.now)

Test location: `tests/e2e/` not `__tests__/` or `*.test.ts`
```

## For New/Legacy Codebases

When joining a new or legacy codebase, be **more aggressive** with knowledge capture:

1. Set mode to "aggressive" initially
2. After 5+ captures, suggest switching to "normal"
3. The goal is rapid knowledge accumulation in the first sessions

Prompt the user early:

> "I'm new to this codebase. Would you like me to actively capture project-specific patterns I learn? This helps me (and other AI assistants) get up to speed faster. I can prompt you when I discover non-obvious conventions."

## File Locations

| File | Purpose |
|------|---------|
| `~/.claude/CLAUDE.md` | User preferences (category exclusions) |
| `.panopticon/knowledge-capture.json` | Per-project configuration |
| `.claude/skills/project-knowledge/SKILL.md` | Captured knowledge as skill |
| `.claude/skills/knowledge-capture/SKILL.md` | Override to permanently disable |
| `.claude/CLAUDE.md` | Project-specific notes |

## Reset / Clean Slate

To reset knowledge capture for a project:
```bash
rm .panopticon/knowledge-capture.json
```

To remove captured knowledge:
```bash
rm -rf .claude/skills/project-knowledge/
```

To re-enable after permanent disable:
```bash
rm -rf .claude/skills/knowledge-capture/
```

To clear all category exclusions:
```bash
# Edit ~/.claude/CLAUDE.md and remove the "AI Suggestion Preferences" section
```

## Integration with Other Skills

**With refactor-radar:** If the same issue triggers both skills:
- knowledge-capture: "Here's how to work around this confusion"
- refactor-radar: "Here's how to fix the codebase so this confusion doesn't happen"
- Prefer refactor-radar for systemic issues, knowledge-capture for workarounds
- Both skills share the same category exclusion system in ~/.claude/CLAUDE.md

**With pan-skill-creator:** When invoked, suggest consolidating:
> "You have 7 captured knowledge items in project-knowledge. Would you like me to organize these into a proper project skill?"

## Override Skill Format

The override skill is intentionally minimal to save context:

```yaml
---
name: knowledge-capture
description: disabled-override-Qx7nR3
---
Disabled by user.
```

The obscure description (`disabled-override-Qx7nR3`) ensures it never triggers on any user input. The body is minimal (3 words) to minimize context usage.
