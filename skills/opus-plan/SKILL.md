---
name: opus-plan
description: >
  Opus-driven planning for issues before Sonnet implementation. Creates workspace,
  PRD.md, STATE.md, beads with dependencies, and updates issue tracker. Ensures
  strategic decisions are made by Opus, not cheaper models.
triggers:
  - opus plan
  - opus-plan
  - opus planning
  - plan with opus
allowed-tools:
  - Read
  - Write
  - Bash
  - Task
  - Grep
  - Glob
  - ToolSearch
version: "1.0.0"
author: "Ed Becker"
license: "MIT"
---

# Opus Planning Skill

**Trigger:** `/opus-plan <issue-id>`

Use this skill when you need high-quality planning for an issue before handing off to Sonnet agents for implementation. This ensures strategic decisions are made by Opus, not cheaper models.

## Purpose

This skill performs comprehensive planning work:
1. Creates workspace and `.planning/` directory
2. Gathers requirements through discovery
3. Creates detailed PRD.md
4. Creates STATE.md with implementation approach
5. Creates beads for all tasks with dependencies
6. Auto-detects UI work and uses Stitch MCP for designs
7. **Updates issue tracker with planning status and labels**

## When to Use

- Before spawning a `/work-issue` agent for any significant feature
- When planning quality matters (architectural decisions, UX design)
- When an issue was poorly planned and needs a do-over

## Instructions

When the user invokes `/opus-plan <issue-id>`:

### Step 1: Setup Workspace

```bash
# Determine project path from issue prefix
# PAN-* -> /home/eltmon/projects/panopticon
# MIN-* -> /home/eltmon/projects/myn
# HH-*  -> /home/eltmon/projects/househunt
# JH-*  -> /home/eltmon/projects/jobhunt

mkdir -p /path/to/project/workspaces/feature-<issue-id>/.planning
```

### Step 2: Fetch Issue Details

Use the appropriate tool based on issue tracker:
- GitHub (PAN-*): `gh issue view <number>`
- Linear (MIN-*, HH-*, JH-*): `mcp__linear__get_issue`

### Step 3: Discovery Phase

Explore the codebase to understand:
- Current architecture and patterns
- Relevant files that will be modified
- Existing implementations to follow
- Technology constraints

Use:
- `Task` tool with `subagent_type=Explore`
- `Grep` for finding patterns
- `Read` for understanding key files

### Step 4: Create PRD.md

Write a comprehensive PRD covering:
- Executive Summary
- Problem Statement
- User Personas (who will use this)
- User Stories (at least 5-10)
- Functional Requirements (numbered, specific)
- Non-Functional Requirements
- Technical Design (architecture, API changes, component structure)
- Acceptance Criteria (checkboxes, testable)
- Dependencies
- Risks and Mitigations

### Step 5: Create STATE.md

Write implementation guidance:
- Discovery Summary (what you learned)
- Key Architectural Decisions (with rationale)
- Implementation Plan (phased, with clear tasks)
- Task Dependencies (what blocks what)
- Definition of Done
- Notes for Implementation Agent

### Step 6: Create Beads

For each task identified in STATE.md:

```bash
bd create --title "<issue-id>: <task name>" \
  --priority <1-4> \
  --labels "<issue-id>,difficulty:<trivial|simple|medium|complex>,phase-<n>" \
  --description "<detailed task description>"
```

Then set up dependencies:
```bash
bd dep add <blocked-id> <blocker-id>
```

### Step 7: Stitch Integration (UI Work)

If the issue involves UI changes, detect from:
- Keywords: "dashboard", "frontend", "settings", "modal", "component"
- File paths mentioned: `src/dashboard/*`, `*.tsx`

If UI work detected:
1. Create Stitch project
2. Design all new screens/components
3. Document designs in `.planning/STITCH_DESIGNS.md`
4. Reference designs in STATE.md

### Step 8: Update Issue Tracker

**For GitHub Issues (PAN-*):**

```bash
# Add labels
gh issue edit <number> --add-label "planned,ready-for-implementation"

# Add comment with planning summary
gh issue comment <number> --body "$(cat <<'EOF'
## Planning Complete

**Planned by:** Claude Opus 4.5
**Workspace:** `workspaces/feature-pan-<number>/`

### Artifacts Created
- `.planning/PRD.md` - Product requirements
- `.planning/STATE.md` - Implementation approach

### Beads Created
<count> tasks with dependencies configured

### Ready Work (unblocked)
<list of ready beads>

### Next Steps
Run `/work-issue PAN-<number>` to spawn implementation agent
EOF
)"
```

**For Linear Issues (MIN-*, HH-*, JH-*):**

```typescript
// Use Linear MCP to update
mcp__linear__update_issue({
  issueId: "<issue-uuid>",
  labelIds: ["<planned-label-id>", "<ready-for-impl-label-id>"],
  // Optionally move to "Planned" state if workflow supports it
})

// Add comment
mcp__linear__create_comment({
  issueId: "<issue-uuid>",
  body: "<planning summary markdown>"
})
```

### Step 9: Final Summary

Output:
- Workspace path
- PRD summary
- Number of beads created
- Ready tasks (unblocked work that can start immediately)
- Issue tracker updates made
- Any open questions that need user input

## Example Output

```
## Opus Planning Complete for PAN-121

**Workspace:** /home/eltmon/projects/panopticon/workspaces/feature-pan-121

**PRD:** Settings Page Redesign with CCR Integration
- 6 user personas identified
- 10 user stories documented
- 6 functional requirement groups

**STATE.md:** 5-phase implementation plan
- Phase 1: CCR Integration (Critical)
- Phase 2: Stitch Designs
- Phase 3: Backend API
- Phase 4: Frontend Components
- Phase 5: Testing

**Beads Created:** 14 tasks
- 4 ready to start (unblocked)
- 10 blocked by dependencies

**Issue Tracker Updated:**
- Added labels: `planned`, `ready-for-implementation`
- Added planning summary comment

**Ready Work:**
1. panopticon-97u: Add CCR detection utility (P1)
2. panopticon-xqa: Update agent spawning (P1)
3. panopticon-y0y: Add CCR integration tests (P1)
4. panopticon-pkl: Create Stitch designs (P2)

**Next:** Run `/work-issue PAN-121` to spawn agent, or manually work on ready tasks
```

## Labels to Add

| Tracker | Labels |
|---------|--------|
| GitHub | `planned`, `ready-for-implementation`, `opus-planned` |
| Linear | `Planned`, `Ready for Implementation` |

If labels don't exist, create them:
```bash
# GitHub
gh label create "planned" --color "0E8A16" --description "Planning phase complete"
gh label create "ready-for-implementation" --color "1D76DB" --description "Ready for agent to implement"
gh label create "opus-planned" --color "7057FF" --description "Planned by Claude Opus"
```

## Status Transitions

| Tracker | From | To |
|---------|------|-----|
| GitHub | Any | (labels only, no status) |
| Linear | Backlog/Todo | In Progress (or custom "Planned" state) |

## Notes

- This skill should ONLY be run by Opus (check your model ID)
- If invoked by Sonnet, warn user and suggest using Opus
- All architectural decisions should be FINAL - no "we could do X or Y"
- Issues must be ready for a junior dev to execute
- Always update the issue tracker so the planning is visible in the UI
