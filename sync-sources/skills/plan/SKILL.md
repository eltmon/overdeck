---
name: plan
description: >
  Opus-driven planning for issues before Sonnet implementation. Creates workspace,
  .pan/continue.json, .pan/spec.vbrief.json with beads, and updates issue tracker.
  Ensures strategic decisions are made by Opus, not cheaper models.
triggers:
  - plan
  - /plan
  - create plan
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Grep
  - Glob
  - ToolSearch
version: "2.0.0"
author: "Ed Becker"
license: "MIT"
---

# Plan Skill

**Trigger:** `/plan <issue-id>`

**CRITICAL:** This skill MUST be run by Opus. The entire point is that Opus does ALL the thinking so Sonnet just executes. If you are Sonnet or Haiku, STOP and tell the user to switch to Opus.

## Core Principle

**Opus plans EVERYTHING. Sonnet executes.**

Do NOT leave any decisions for the implementation agent. Every architectural choice, every file path, every function name, every edge case - all decided here. The implementation agent should be able to work through beads mechanically without making any design decisions.

---

## EXECUTION STEPS

### Step 1: Parse Issue ID and Create Workspace

```bash
# PAN-XXX -> ~/Projects/panopticon-cli (GitHub)
# MIN-XXX -> ~/Projects/myn (Linear)
# HH-XXX  -> ~/Projects/househunt (Linear)
# JH-XXX  -> ~/Projects/jobhunt (Linear)

# CRITICAL: Create a proper git worktree with feature branch
# DO NOT use mkdir -p - that creates a directory without git tracking!
cd <project>
pan workspace <issue-id>   # Creates workspaces/feature-<id>/ with feature branch

# Then create the canonical Panopticon workspace directory
mkdir -p workspaces/feature-<issue-id-lowercase>/.pan
```

**IMPORTANT:** The `pan workspace` command creates a git worktree on a feature branch.
This is REQUIRED so that work agents don't commit directly to main.
If `pan workspace` fails, fix the issue before continuing.

### Step 2: Fetch Issue Details

**GitHub (PAN-*):** `gh issue view <number>`
**Linear:** Use `mcp__linear__get_issue` tool

Read the FULL issue. Understand what's being asked.

### Step 3: Deep Discovery

**YOU MUST** thoroughly explore the codebase. Use `Task` tool with `subagent_type=Explore` or manually:

1. Find ALL related files:
   - Where does the feature touch?
   - What patterns exist?
   - What tests exist?

2. Read key files completely:
   - Don't skim - read line by line
   - Understand the data flow
   - Note function signatures

3. Identify:
   - Files to create (new)
   - Files to modify (existing)
   - Files to delete (cleanup)
   - Tests to write/update

### Step 4: Write `.pan/continue.json`

Create `.pan/continue.json` with COMPLETE planning context:

```json
{
  "version": "1",
  "issueId": "<ISSUE-ID>",
  "created": "<ISO timestamp>",
  "updated": "<ISO timestamp>",
  "gitState": { "branch": "<branch>", "sha": "<short sha>", "dirty": false },
  "decisions": [
    { "id": "D1", "summary": "<decision and why>", "recordedAt": "<ISO timestamp>" }
  ],
  "hazards": [
    { "id": "H1", "summary": "<risk/edge case>", "mitigation": "<how to handle it>" }
  ],
  "resumePoint": null,
  "beadsMapping": {},
  "agentModel": "plan",
  "sessionHistory": [
    { "timestamp": "<ISO timestamp>", "reason": "planning", "note": "Initial planning session", "agentModel": "plan" }
  ]
}
```

### Step 5: Produce `.pan/spec.vbrief.json`

Create `.pan/spec.vbrief.json` following the vBRIEF schema. This replaces the manual `bd create` loop — `pan plan finalize` reads this file and creates beads automatically.

```json
{
  "vBRIEFInfo": {
    "version": "0.5",
    "created": "<ISO timestamp>"
  },
  "plan": {
    "id": "<ISSUE-ID>",
    "title": "<Full issue title>",
    "status": "approved",
    "author": "plan",
    "tags": ["<relevant>", "<tags>"],
    "narratives": {
      "Problem": "<What problem this solves>",
      "Proposal": "<How we solve it>",
      "Constraint": "<Any constraints>",
      "Risk": "<Key risks>",
      "Alternative": "<What alternatives were considered>"
    },
    "items": [
      {
        "id": "<kebab-case-id>",
        "title": "<ISSUE-ID>: <Specific task name>",
        "status": "pending",
        "priority": "high",
        "metadata": {
          "difficulty": "simple|medium|complex",
          "issueLabel": "<issue-id-lowercase>"
        },
        "narrative": {
          "Action": "<Exact what to do: file paths, function names, specific changes>"
        },
        "subItems": [
          {
            "id": "<parent-id>.<ac-name>",
            "title": "<Specific testable acceptance criterion>",
            "status": "pending",
            "metadata": { "kind": "acceptance_criterion" }
          }
        ]
      }
    ],
    "edges": [
      {
        "from": "<item-id>",
        "to": "<item-id>",
        "type": "blocks"
      }
    ]
  }
}
```

**CRITICAL vBRIEF Structure Rules:**

1. **Acceptance criteria MUST be subItems, NEVER top-level items.** Each AC is nested under its parent task/requirement as a `subItems` entry. Top-level items with `kind: "acceptance_criterion"` will fail vBRIEF Studio validation.

2. **Hierarchical IDs required.** SubItem IDs must use dot-notation from the parent: `parent-id.ac-name`. Example: `work-prompt-ac.injects-ac-per-bead`. The parent prefix is mandatory.

3. **Only actionable tasks are top-level items.** Requirements, tasks, and architectural decisions go in `items[]`. Acceptance criteria go in `subItems[]` under their parent.

4. **Every task SHOULD have at least one acceptance criterion** in `subItems` to define "done."

**Bead sizing guidance:**
- Each item should be completable in one focused session
- Include exact file paths and function names in the Action field
- Set `edges` to capture blocking relationships between items
- `difficulty`: trivial (typo/config), simple (1 file), medium (2-3 files), complex (multi-system)
- 10-40 items for a typical feature; more for large refactors
- SubItems (acceptance criteria) are NOT converted to beads — they're verification checklists

**After writing the JSON file:**
```bash
# Materialize beads and mark the workspace spec proposed
pan plan finalize
```

**Cloister hand-off:** When `pan plan finalize` runs, it automatically:
1. Reads `.pan/spec.vbrief.json` from the workspace
2. Calls `createBeadsFromVBrief()` to convert vBRIEF items into beads tasks
3. Preserves dependency relationships from `edges` (blocking order)
4. Includes acceptance criteria in bead descriptions
5. Marks `plan.status` as `proposed` so the dashboard shows Done

You do NOT need to run `bd create` manually — `pan plan finalize` handles the full conversion.

### Step 6: Stitch Integration (UI Work)

If issue involves UI, YOU MUST use Stitch:

```bash
# Load Stitch tools
ToolSearch query: "+stitch"

# Create project
mcp__stitch__create_project name="<issue-id>-design"

# Design each screen
mcp__stitch__generate_screen_from_text ...
```

Document all designs in `.pan/STITCH_DESIGNS.md`.

### Step 7: Update Issue Tracker

**GitHub (PAN-*):**
```bash
gh label create "planned" --color "0E8A16" 2>/dev/null || true
gh label create "ready-for-implementation" --color "1D76DB" 2>/dev/null || true
gh label create "opus-planned" --color "7057FF" 2>/dev/null || true

gh issue edit <number> --add-label "planned,ready-for-implementation,opus-planned"

gh issue comment <number> --body "## Planning Complete
**Planned by:** Claude Opus 4.6
**Workspace:** workspaces/feature-<issue-id>/

### Beads: <N> items in .pan/spec.vbrief.json
### Next: /work-issue <ISSUE-ID>"
```

### Step 8: Output Summary

```
## Planning Complete for <ISSUE-ID>

**Workspace:** <path>
**.pan/continue.json:** decisions, hazards, and planning context
**.pan/spec.vbrief.json:** <N> items, <M> edges

**Unblocked Items:**
1. <item-id>: <title> [P<n>]
...

**Next:** /work-issue <ISSUE-ID>
```

---

## Task Breakdown Templates

### For Backend API Work:

```
Items:
- Define types/interfaces in types.ts
- Create endpoint handler function
- Add route registration
- Add request validation
- Add error handling
- Write unit tests for handler
- Write integration tests for endpoint
```

### For React Component Work:

```
Items:
- Create component file with shell
- Add props interface
- Implement render logic
- Add state management (if needed)
- Add event handlers
- Style with Tailwind/CSS
- Add loading/error states
- Write unit tests
- Wire into parent component
```

### For Bug Fixes:

```
Items:
- Write failing test that reproduces bug
- Identify root cause (document in Action field)
- Implement fix
- Verify test passes
- Add regression tests
```

### For Refactoring:

```
Items:
- Write tests for current behavior (if missing)
- Extract function/module
- Update all call sites
- Run tests, fix failures
- Remove old code
```

---

## Quality Checklist

Before completing /plan, verify:

- [ ] `.pan/continue.json` has complete planning context
- [ ] `.pan/spec.vbrief.json` is valid JSON with all required fields
- [ ] Each item has exact file paths in Action field
- [ ] Dependencies (edges) are set correctly
- [ ] `pan plan finalize` run successfully
- [ ] Issue tracker updated
- [ ] No decisions left for implementation agent
