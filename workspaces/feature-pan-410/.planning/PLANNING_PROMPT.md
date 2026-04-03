<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-410

## CRITICAL: PLANNING ONLY - NO IMPLEMENTATION

**YOU ARE IN PLANNING MODE. DO NOT:**
- Write or modify any code files (except STATE.md)
- Run implementation commands (npm install, docker compose, make, etc.)
- Create actual features or functionality
- Start implementing the solution

**YOU SHOULD ONLY:**
- Ask clarifying questions (use AskUserQuestion tool)
- Explore the codebase to understand context (read files, grep)
- Generate planning artifacts:
  - STATE.md (decisions, approach, architecture)
  - Beads tasks (via `bd create`)
  - Implementation plan at `docs/prds/active/{issue-id}-plan.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-410
- **Title:** DAG visualization: match vBRIEF Studio quality — edge labels, status badges, item metadata
- **URL:** https://github.com/eltmon/panopticon-cli/issues/410

## Description
## Summary

Our DAG visualization in the BeadsTasksPanel works but is basic compared to vBRIEF Studio's rendering. Match Studio's quality for the dashboard.

## What Studio Has That We Don't

From the screenshot of our PAN-404 plan in vBRIEF Studio:

### Edge Labels
- Studio shows edge type labels on connections ("blocks", "informs")
- Our edges are plain lines with no labels — you can't tell blocks from informs without clicking

### Status Badges on Nodes
- Studio shows colored status badges ("pending", "completed") on each node
- Our nodes show a colored dot but no text label for status

### Difficulty/Priority Badges
- Studio shows metadata badges on nodes (difficulty level, priority)
- Our nodes show a small letter (M/S) but it's not obvious what it means

### Item Metadata Panel
- Studio shows full item details inline when you hover/click (narrative, metadata, sub-items)
- Our click-through exists but could show more detail

### Edge Type Styling
- Studio uses distinct arrow styles for different edge types (solid vs dashed)
- We have this partially (solid=blocks, dashed=informs) but arrows could be more visible

### Node Layout
- Studio's vertical flow layout is cleaner with more consistent spacing
- Our dagre layout works but nodes sometimes overlap or cluster awkwardly

## Reference
- vBRIEF Studio: https://vbrief-studio.fly.dev
- Studio uses ReactFlow (same as us) — so all these features are achievable with our existing dependency

## Issue Comments

**IMPORTANT: Read these comments carefully — they contain context, decisions, and references to previous work.**

### eltmon (2026-04-02):
🤖 **Agent completed work:**

Implemented all 6 DAG visualization improvements: edge labels, status badges, priority/difficulty badges, distinct edge colors with larger arrows, increased layout spacing, and enriched item detail panel. All 223 tests pass.

---

### eltmon (2026-04-02):
🤖 **Agent completed work:**

All 6 DAG visualization improvements implemented, typecheck fixes applied, all tests pass.

---

### eltmon (2026-04-02):
🤖 **Agent completed work:**

All checks passed. DAG visualization improvements: edge labels, status badges, priority/difficulty badges, distinct edge colors, improved layout spacing, enriched metadata panel.

---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. **If a spec file was provided above**, read it thoroughly — it's your primary input
2. Read the codebase to understand relevant files and patterns
3. Identify what subsystems/files this issue affects
4. Note any existing patterns we should follow

### Phase 2: Discovery Conversation
Use AskUserQuestion tool to ask contextual questions:
- What's the scope? What's explicitly OUT of scope?
- Any technical constraints or preferences?
- What does "done" look like?
- Are there edge cases we need to handle?

### Difficulty Estimation

For each sub-task, estimate difficulty using this rubric:

| Level | When to Use | Model |
|-------|-------------|-------|
| `trivial` | Typo, comment, formatting only | haiku |
| `simple` | Bug fix, single file, obvious change | haiku |
| `medium` | New feature, 3-5 files, standard patterns | sonnet |
| `complex` | Refactor, migration, 6+ files, some risk | sonnet |
| `expert` | Architecture, security, performance, high risk | opus |

Consider these factors:
- **Files to modify**: 1-2 (simple), 3-5 (medium), 6+ (complex/expert)
- **Cross-cutting**: None (simple), Some (medium), Many (complex/expert)
- **Risk level**: Low (simple), Medium (medium), High (expert)
- **Domain knowledge**: Standard (simple), Research needed (medium), Deep expertise (expert)

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to implementation plan at `docs/prds/active/{issue-id}-plan.md` (required for dashboard)
3. Create a vBRIEF plan file at `.planning/plan.vbrief.json` (structured machine-readable plan — see format below)
4. Summarize the plan and STOP

**DO NOT run `bd create` commands.** Beads tasks are created automatically from `plan.vbrief.json` by Cloister when planning completes. Your job is to produce the vBRIEF plan — the system handles beads creation mechanically.

### vBRIEF Plan Format

Create `.planning/plan.vbrief.json` — a structured plan with items and dependency edges.
Cloister converts this file into beads tasks with proper dependency links automatically.

```json
{
  "vBRIEFInfo": { "version": "0.5", "created": "<ISO 8601 timestamp>" },
  "plan": {
    "id": "PAN-410",
    "title": "<issue title>",
    "status": "approved",
    "author": "plan",
    "tags": ["<relevant tags>"],
    "narratives": {
      "Problem": "<what problem this solves>",
      "Proposal": "<the approach chosen>",
      "Constraint": "<limitations and boundaries>",
      "Risk": "<potential issues and mitigations>",
      "Alternative": "<other options considered and why rejected>"
    },
    "items": [
      {
        "id": "<short-kebab-id>",
        "title": "<task title>",
        "status": "pending",
        "priority": "high|medium|low",
        "metadata": {
          "difficulty": "trivial|simple|medium|complex|expert",
          "issueLabel": "pan-410"
        },
        "narrative": { "Action": "<what needs to be done>" },
        "subItems": [
          {
            "id": "<short-kebab-id>.<ac-name>",
            "title": "<specific testable acceptance criterion>",
            "status": "pending",
            "metadata": { "kind": "acceptance_criterion" }
          }
        ]
      }
    ],
    "edges": [
      { "from": "<source-item-id>", "to": "<target-item-id>", "type": "blocks|informs|invalidates|suggests" }
    ]
  }
}
```

**Edge types:**
- `blocks` — target MUST wait for source to complete (hard dependency)
- `informs` — target benefits from source context (soft dependency)
- `invalidates` — source completion makes target unnecessary
- `suggests` — weak recommendation, no dependency

**CRITICAL vBRIEF Structure Rules:**
1. **Acceptance criteria MUST be subItems, NEVER top-level items.** Nest them under their parent task. Top-level items with kind "acceptance_criterion" will fail vBRIEF Studio validation.
2. **Hierarchical IDs required for subItems.** Use dot-notation: `parent-id.ac-name`. Example: `work-prompt-ac.injects-per-bead`.
3. **Only actionable tasks at top level.** Tasks, requirements, and architectural decisions go in `items[]`. Acceptance criteria go in `subItems[]`.
4. **Every task SHOULD have at least one acceptance criterion** in subItems.
5. **SubItems are NOT converted to beads** — they are verification checklists for the work agent.

**IMPORTANT:** Create the plan file BEFORE creating beads tasks.
**NOTE:** `*-spec.md` files are human-written specs — do NOT overwrite them. Your output is `*-plan.md`.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.

<!-- panopticon:orchestration-context-end -->
