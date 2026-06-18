# Legacy Codebase Support

[Back to README](../README.md)

---

> **"AI works great on greenfield projects, but it's hopeless on our legacy code."**
>
> Sound familiar? Your developers aren't wrong. But they're not stuck, either.

## The Problem Every Enterprise Faces

AI coding assistants are trained on modern, well-documented open-source code. When they encounter your 15-year-old monolith with:

- Mixed naming conventions (some `snake_case`, some `camelCase`, some `SCREAMING_CASE`)
- Undocumented tribal knowledge ("we never touch the `processUser()` function directly")
- Schemas that don't match the ORM ("the `accounts` table is actually users")
- Three different async patterns in the same codebase
- Build systems that require arcane incantations

...they stumble. Repeatedly. Every session starts from zero.

## Overdeck's Unique Solution: Adaptive Learning

Overdeck includes two AI self-monitoring skills that **no other orchestration framework provides**:

| Skill | What It Does | Business Impact |
|-------|--------------|-----------------|
| **Knowledge Capture** | Detects when AI makes mistakes or gets corrected, prompts to document the learning | AI gets smarter about YOUR codebase over time |
| **Refactor Radar** | Identifies systemic code issues causing repeated AI confusion, creates actionable proposals | Surfaces technical debt that's costing you AI productivity |

### How It Works

```
Session 1: AI queries users.created_at → Error (column is "createdAt")
           → Knowledge Capture prompts: "Document this convention?"
           → User: "Yes, create skill"
           → Creates project-specific skill documenting naming conventions

Session 2: AI knows to use camelCase for this project
           No more mistakes on column names

Session 5: Refactor Radar detects: "Same entity called 'user', 'account', 'member'
           across layers - this is causing repeated confusion"
           → Offers to create issue with refactoring proposal
           → Tech lead reviews and schedules cleanup sprint
```

### The Compound Effect

| Week | Without Overdeck | With Overdeck |
|------|-------------------|-----------------|
| 1 | AI makes 20 mistakes/day on conventions | AI makes 20 mistakes, captures 8 learnings |
| 2 | AI makes 20 mistakes/day (no memory) | AI makes 12 mistakes, captures 5 more |
| 4 | AI makes 20 mistakes/day (still no memory) | AI makes 3 mistakes, codebase improving |
| 8 | Developers give up on AI for legacy code | AI is productive, tech debt proposals in backlog |

### Shared Team Knowledge

**When one developer learns, everyone benefits.**

Captured skills live in your project's `.claude/skills/` directory - they're version-controlled alongside your code. When Sarah documents that "we use camelCase columns" after hitting that error, every developer on the team - and every AI session from that point forward - inherits that knowledge automatically.

```
myproject/
├── .claude/skills/
│   └── project-knowledge/     # ← Git-tracked, shared by entire team
│       └── SKILL.md           # "Database uses camelCase, not snake_case"
├── src/
└── ...
```

No more repeating the same corrections to AI across 10 different developers. No more tribal knowledge locked in one person's head. The team's collective understanding of your codebase becomes permanent, searchable, and automatically applied.

**New hire onboarding?** The AI already knows your conventions from day one.

### For Technical Leaders

**What gets measured gets managed.** Overdeck's Refactor Radar surfaces the specific patterns that are costing you AI productivity:

- "Here are the 5 naming inconsistencies causing 40% of AI errors"
- "These 3 missing FK constraints led to 12 incorrect deletions last month"
- "Mixed async patterns in payments module caused 8 rollbacks"

Each proposal includes:
- **Evidence**: Specific file paths and examples
- **Impact**: How this affects AI (and new developers)
- **Migration path**: Incremental fix that won't break production

### For Executives

**ROI is simple:**

- $200K/year senior developer spends 2 hours/day correcting AI on legacy code
- That's $50K/year in wasted productivity per developer
- Team of 10 = **$500K/year** in AI friction

Overdeck's learning system:
- Captures corrections once, applies them forever
- Identifies root causes (not just symptoms)
- Creates actionable improvement proposals
- Works across your entire AI toolchain (Claude, Codex, Cursor, Gemini)

**This isn't "AI for greenfield only." This is AI that learns your business.**

### Configurable Per Team and Per Developer

Different teams have different ownership boundaries. Individual developers have different preferences. Overdeck respects both:

```markdown
# In ~/.claude/CLAUDE.md (developer's personal config)

## AI Suggestion Preferences

### refactor-radar
skip: database-migrations, infrastructure  # DBA/Platform team handles these
welcome: naming, code-organization         # Always happy for these

### knowledge-capture
skip: authentication                       # Security team owns this
```

- **"Skip database migrations"** - Your DBA has a change management process
- **"Skip infrastructure"** - Platform team owns that
- **"Welcome naming fixes"** - Low risk, high value, always appreciated

The AI adapts to your org structure, not the other way around.

---

## Shadow Mode

Shadow mode lets you run Overdeck agents without updating your issue tracker. This is useful when:

- You're evaluating Overdeck on a real issue without committing tracker changes to stakeholders
- You want to test the pipeline on a legacy codebase before going live
- You're running training or demos and don't want to pollute your issue tracker

### How Shadow Mode Works

When shadow mode is enabled, agents run normally — they plan, implement, review, and commit code — but all issue tracker updates (status changes, comments, assignments) are suppressed. The work proceeds, but it stays invisible to your tracker.

Shadow state is persisted to `~/.panopticon/shadow/` so it survives restarts. Each issue has its own shadow state: once an issue enters shadow mode, it stays shadowed for all subsequent operations.

When shadow mode ends, you can replay the suppressed updates or simply let the next non-shadow run update the tracker normally.

### How to Enable Shadow Mode

**Per-run (CLI flag):**
```bash
pan start MIN-123 --shadow
```

**Per-project (config file):**
```yaml
# In <project>/.panopticon.yaml
shadow:
  enabled: true
```

**Globally (config file):**
```yaml
# In ~/.panopticon/config.yaml
shadow:
  enabled: true
```

**Environment variable:**
```bash
SHADOW_MODE=true pan start MIN-123
```

**Per-tracker override:**
```yaml
# In .panopticon.yaml — only shadow Linear, not GitHub
shadow:
  enabled: false
  trackers:
    linear: true
    github: false
```

### Priority Order

Shadow mode respects a priority chain (highest to lowest):
1. `--shadow` / `--no-shadow` CLI flag
2. Existing shadow state for the issue (once shadowed, always shadowed)
3. Per-project `.panopticon.yaml` `shadow.enabled`
4. Global `~/.panopticon/config.yaml` `shadow.enabled`
5. `SHADOW_MODE` environment variable
6. Default: disabled

### The INFERENCE.md Artifact

When shadow mode is active and an agent runs planning or inference, it writes an `INFERENCE.md` file to the workspace `.planning/` directory. This file captures:

- What the agent inferred about the codebase
- Decisions made during shadow mode
- Any corrections or assumptions that should be reviewed

If you later move the issue out of shadow mode, `INFERENCE.md` provides a record of what happened during the shadow run.

The presence of `INFERENCE.md` in a workspace is how the dashboard identifies shadow-mode workspaces (shown with the `isShadow` flag in the kanban view).

### Implementation Reference

Shadow mode is implemented in `src/lib/shadow-mode.ts`. Key functions:

| Function | Purpose |
|----------|---------|
| `resolveShadowMode(options)` | Resolve the effective shadow mode setting |
| `isShadowModeEnabled(options)` | Convenience boolean check |
| `shouldSkipTrackerUpdate(issueId, cliFlag, trackerType)` | Main guard for tracker writes |
| `getShadowModeStatus(options)` | Human-readable status string |

Shadow state persistence is in `src/lib/shadow-state.ts`. Original implementation: PAN-28.
