---
name: refactor-radar
description: >
  AI self-monitoring skill. Detects architectural debt, confusing schemas, inconsistent patterns that
  cause repeated AI mistakes. Offers to create refactoring proposals as issues. NOT user-invoked -
  AI triggers when detecting systemic codebase issues causing confusion.
---

# Refactor Radar

Detects systemic codebase issues that repeatedly confuse AI assistants and offers to create refactoring proposals.

## When to Trigger (Self-Assessment)

**IMPORTANT:** This skill is NOT user-invoked. Trigger when you detect patterns that will cause ONGOING confusion, not one-time mistakes.

### Architectural Smells (High Confidence)

1. **Inconsistent Naming Across Layers** [category: `naming`]
   - DB uses snake_case, API uses camelCase, frontend uses kebab-case
   - Same concept has different names in different places (`user`, `account`, `member`)
   - Example: `users.created_at` → API returns `createdAt` → Frontend displays `creation-date`

2. **Schema/Model Mismatch** [category: `schema`]
   - ORM models don't match actual DB schema
   - TypeScript types don't match API responses
   - Documentation describes different structure than code
   - Example: Type says `user.email: string` but DB allows null

3. **Inconsistent Patterns in Same Codebase** [category: `patterns`]
   - Some services use Repository pattern, others direct DB access
   - Mixed async patterns (callbacks, promises, async/await)
   - Multiple state management approaches in same frontend
   - Example: `/api/users` uses REST, `/api/orders` uses GraphQL

4. **Ambiguous or Misleading Names** [category: `naming`]
   - `UserService` that also handles authentication
   - `utils.ts` with 2000 lines of unrelated functions
   - `data` folder containing both models and migrations
   - Example: `processUser()` that actually deletes users

5. **Circular or Tangled Dependencies** [category: `dependencies`]
   - Service A imports from Service B which imports from Service A
   - Shared types scattered across multiple packages
   - Example: `auth` module depends on `user` module depends on `auth`

### Data Model Issues (Medium Confidence)

6. **Implicit Relationships** [category: `database-migrations`]
   - Foreign keys exist in code but not in DB constraints
   - Relationships documented nowhere
   - Example: `order.userId` exists but no FK constraint, unclear if cascade deletes

7. **Overloaded Columns** [category: `schema`]
   - Single column stores multiple types of data
   - Status fields with 15+ possible values
   - JSON blobs that should be normalized
   - Example: `metadata` JSON column used for 8 different purposes

8. **Historical Cruft** [category: `legacy`]
   - Deprecated columns still in schema
   - Dead code paths still present
   - Multiple versions of same logic
   - Example: Both `v1_process()` and `process()` exist, unclear which to use

### Convention Drift (Lower Confidence)

9. **Style Guide Violations** [category: `code-organization`]
   - Older code doesn't follow current patterns
   - Different developers used different conventions
   - Example: Half the codebase uses `async/await`, half uses `.then()`

10. **Missing Abstractions** [category: `code-organization`]
    - Same boilerplate repeated across many files
    - Copy-paste patterns that should be utilities
    - Example: Same 20-line auth check in 15 different handlers

## Invocation Protocol

### Step 0: Check for Permanent Override

**FIRST**, check if user has permanently disabled this skill:

```bash
# If project has override skill, this skill is permanently disabled
if [ -f ".claude/skills/refactor-radar/SKILL.md" ]; then
  # User has "shut up forever" - do nothing
  exit 0
fi
```

### Step 0.5: Check User Preferences for Category Exclusions

Check `~/.claude/CLAUDE.md` for excluded categories:

```bash
grep -A 20 "## AI Suggestion Preferences" ~/.claude/CLAUDE.md 2>/dev/null
```

Look for sections like:
```markdown
## AI Suggestion Preferences

### refactor-radar
skip: database-migrations, build-system, infrastructure
welcome: naming, code-organization
```

If the current trigger category is in the skip list, **do not prompt**.

### Step 1: Check Configuration

```bash
cat .panopticon/refactor-radar.json 2>/dev/null || echo "{}"
```

**Default configuration:**
```json
{
  "enabled": true,
  "mode": "normal",
  "promptCooldownMinutes": 60,
  "lastPromptTimestamp": null,
  "proposalsCreated": 0,
  "dismissedCount": 0,
  "sessionDismissals": 0
}
```

**Modes:**
- `"aggressive"` - Prompt on every detected issue
- `"normal"` - High/medium confidence issues, respect cooldown
- `"minimal"` - Only obvious architectural problems
- `"silent"` - Log internally, never prompt
- `"disabled"` - Completely off

### Step 2: Respect Cooldowns

Skip prompting if:
- Mode is "disabled" or "silent"
- `sessionDismissals >= 2` (user said "not now" twice this session)
- Less than `promptCooldownMinutes` since last prompt
- Already proposed this exact issue before

### Step 3: Present to User

---

**Refactor Radar: Architectural Issue Detected** [category: {CATEGORY}]

I've noticed a systemic issue that's causing confusion:

**Issue:** [SPECIFIC PROBLEM]

**Evidence:**
- [CONCRETE EXAMPLE 1]
- [CONCRETE EXAMPLE 2]

**Impact:** This will likely cause repeated mistakes for me and other AI assistants working on this codebase.

**Would you like me to create a refactoring proposal?**

| Option | What happens |
|--------|--------------|
| **Yes, create issue** | I'll draft a detailed refactoring proposal as a GitHub/Linear issue |
| **Yes, but just notes** | I'll add notes to project documentation instead |
| **Not now** | Skip this time (I'll ask less often) |
| **Skip this category** | Never suggest {CATEGORY} refactors (updates your ~/.claude/CLAUDE.md) |
| **Not important** | Don't track this issue (I may notice similar issues later) |
| **Too frequent** | Switch to minimal mode |
| **Stop asking** | Silent mode - log but don't prompt |
| **Shut up forever** | Permanently disable for this project |

---

### Step 4: Handle Responses

**"Yes, create issue":**
Create issue with template:
```markdown
## Refactoring Proposal: [TITLE]

### Problem
[Description of the architectural issue]

### Evidence
- [Specific examples found in codebase]
- [File paths and line numbers]

### Impact
- AI assistants repeatedly make mistakes due to this
- New developers likely face same confusion
- Increases maintenance burden

### Proposed Solution
[Concrete refactoring steps]

### Migration Path
[How to incrementally fix without breaking things]

### Acceptance Criteria
- [ ] [Specific measurable outcomes]

---
*Generated by Refactor Radar - AI-detected architectural improvement opportunity*
```

**"Skip this category":**
1. Update `~/.claude/CLAUDE.md` to add category to skip list
2. Acknowledge: "Got it - I won't suggest {CATEGORY} refactors anymore. You can edit ~/.claude/CLAUDE.md to change this."

**"Shut up forever":**
Create override skill to permanently disable:
```bash
mkdir -p .claude/skills/refactor-radar
cat > .claude/skills/refactor-radar/SKILL.md << 'EOF'
---
name: refactor-radar
description: disabled-override-xK9mQ2
---
Disabled by user preference.
EOF
```
Acknowledge: "Refactor Radar permanently disabled for this project. Delete `.claude/skills/refactor-radar/` to re-enable."

### Step 5: Update Configuration

```bash
mkdir -p .panopticon
cat > .panopticon/refactor-radar.json << 'EOF'
{
  "enabled": true,
  "mode": "normal",
  "promptCooldownMinutes": 60,
  "lastPromptTimestamp": "2024-01-15T10:30:00Z",
  "proposalsCreated": 2,
  "dismissedCount": 1,
  "sessionDismissals": 0,
  "knownIssues": ["inconsistent-naming-user-account"]
}
EOF
```

## User Preferences in ~/.claude/CLAUDE.md

Users can exclude specific categories globally by adding to their personal `~/.claude/CLAUDE.md`:

```markdown
## AI Suggestion Preferences

### knowledge-capture
skip: database, authentication

### refactor-radar
skip: database-migrations, build-system, infrastructure
welcome: naming, code-organization, testing
```

### Available Categories

| Category | What it covers |
|----------|----------------|
| `naming` | Inconsistent naming, ambiguous names |
| `schema` | ORM/DB mismatches, overloaded columns, type mismatches |
| `patterns` | Inconsistent architectural patterns, mixed approaches |
| `dependencies` | Circular deps, tangled imports |
| `database-migrations` | FK constraints, schema changes, data integrity |
| `legacy` | Dead code, deprecated paths, cruft |
| `code-organization` | Missing abstractions, repeated boilerplate |
| `build-system` | Build tool inconsistencies, config issues |
| `infrastructure` | CI/CD, deployment, cloud config |
| `testing` | Test framework inconsistencies, coverage gaps |
| `authentication` | Auth flow issues, security patterns |

### Why Skip Categories?

**Database migrations:** "Schema changes require DBA approval and a formal change management process. AI suggestions here just create noise."

**Build system:** "Our build is ancient but stable. Touching it requires a dedicated sprint with full QA. Not happening anytime soon."

**Infrastructure:** "Platform team owns this. I'm a feature developer - infra proposals go nowhere."

**Legacy:** "We know there's legacy code. We have a 3-year modernization roadmap. Random cleanup PRs aren't helpful."

**Authentication:** "Security-critical code has strict review requirements. We don't want AI-generated proposals here."

### Why Welcome Categories?

**Naming:** "Naming consistency is low-risk and high-value. Always happy to fix these."

**Code organization:** "Refactoring utils and extracting abstractions is exactly what we need help with."

**Testing:** "Test improvements are always welcome - low risk, high value."

### Updating Preferences

To add a category exclusion:
```bash
# AI will add this section if it doesn't exist, or append to existing
cat >> ~/.claude/CLAUDE.md << 'EOF'

## AI Suggestion Preferences

### refactor-radar
skip: database-migrations, infrastructure
welcome: naming, code-organization
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
| "Skip database migration suggestions" | Add to skip list | All projects | Yes (edit CLAUDE.md) |
| "I like naming suggestions" | Add to welcome list | All projects | Yes (edit CLAUDE.md) |
| "Refactor radar is too frequent" | Minimal mode | This project | Yes |
| "Stop suggesting refactors" | Silent mode | This project | Yes |
| "Disable refactor radar" | Completely off | This project | Yes |
| "Never suggest refactors again" | Create override | This project | Yes (delete file) |

**To re-enable after "shut up forever":**
```bash
rm -rf .claude/skills/refactor-radar/
```

## Example Proposals

### Example 1: Naming Inconsistency

**Detected:** Same entity called `user`, `account`, `member` across codebase

**Proposal:**
```markdown
## Refactoring Proposal: Standardize User Entity Naming

### Problem
The "user" concept has inconsistent naming across layers:
- Database: `accounts` table
- Backend models: `User` class
- API responses: `member` object
- Frontend state: `currentAccount`

### Evidence
- `src/models/User.ts` maps to `accounts` table
- `GET /api/members/:id` returns user data
- Frontend calls it `useAccount()` hook

### Proposed Solution
1. Standardize on `User` everywhere
2. Create type aliases during migration: `type Account = User`
3. Update API endpoints with deprecation period
4. Rename frontend hooks/state

### Migration Path
1. Add aliases (non-breaking)
2. Update new code to use `User`
3. Migrate existing code incrementally
4. Remove aliases after full migration
```

### Example 2: Mixed Async Patterns

**Detected:** Codebase mixes callbacks, promises, and async/await

**Proposal:**
```markdown
## Refactoring Proposal: Standardize on async/await

### Problem
Three different async patterns in use:
- Older services use callbacks
- Middle-era code uses `.then()` chains
- Newer code uses async/await

### Evidence
- `src/services/legacy/email.js`: callback-based
- `src/services/payment.ts`: Promise chains
- `src/services/user.ts`: async/await

### Impact
- AI assistants inconsistently apply patterns
- Error handling differs between approaches
- Code review burden increased

### Proposed Solution
Standardize on async/await with these utilities:
- `promisify()` wrapper for callback APIs
- ESLint rule to enforce async/await
- Gradual migration of existing code

### Migration Path
1. Add ESLint rule (warn only)
2. Migrate one service at a time
3. Upgrade to error after 80% migrated
```

### Example 3: Implicit Relationships

**Detected:** Foreign keys in code but not enforced in DB

**Proposal:**
```markdown
## Refactoring Proposal: Add Missing Foreign Key Constraints

### Problem
Relationships exist in application code but lack DB constraints:
- `orders.userId` references `users.id` but no FK
- `comments.postId` references `posts.id` but no FK
- Orphaned records exist in production

### Evidence
- `prisma/schema.prisma` defines relations
- `migrations/` shows no FK constraints
- Query: `SELECT COUNT(*) FROM orders WHERE userId NOT IN (SELECT id FROM users)` returns 47

### Impact
- Data integrity issues
- AI assumes cascading behavior that doesn't exist
- Silent failures on deletions

### Proposed Solution
1. Add FK constraints with migration
2. Clean up orphaned data first
3. Add ON DELETE behavior (CASCADE or SET NULL)

### Migration Path
1. Identify all orphaned records
2. Create cleanup migration
3. Add FK constraints
4. Update application code to handle constraint errors
```

## File Locations

| File | Purpose |
|------|---------|
| `~/.claude/CLAUDE.md` | User preferences (category exclusions/welcomes) |
| `.panopticon/refactor-radar.json` | Per-project configuration |
| `.claude/skills/refactor-radar/SKILL.md` | Override to permanently disable |

## Integration

Works with:
- **knowledge-capture**: If same issue triggers both, prefer refactor-radar (systemic fix > workaround). Both skills share the same category exclusion system in ~/.claude/CLAUDE.md
- **pan-skill-creator**: Can convert proposals into project-specific guidance
- Issue trackers: Creates issues in configured tracker (Linear, GitHub, GitLab)

## Override Skill Format

The override skill is intentionally minimal to save context:

```yaml
---
name: refactor-radar
description: disabled-override-xK9mQ2
---
Disabled by user preference.
```

The obscure description (`disabled-override-xK9mQ2`) ensures it never triggers on any user input. The body is minimal (4 words) to minimize context usage.
