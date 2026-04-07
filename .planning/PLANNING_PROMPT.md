<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-460

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
  - Implementation plan at `docs/prds/active/{issue-id}/STATE.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-460
- **Title:** Dashboard rebrand: rename Mission Control, unified design system, fix light/dark mode
- **URL:** https://github.com/eltmon/panopticon-cli/issues/460

## Description
## Summary

Full visual rebrand of the Panopticon dashboard:

1. **Rename "Mission Control" → "Command Deck"** — avoid name collision with other AI orchestrators, reduce overloaded naming
2. **Unified design system (T3Code-inspired)** — replace the current 3 divergent visual languages with one cohesive token-based system borrowing from T3Code's proven design language
3. **Fix light/dark mode** — currently completely broken (white text on white backgrounds). Root cause: hardcoded Tailwind color classes instead of semantic tokens
4. **Navigation redesign** — replace overcrowded 13-item horizontal nav with grouped collapsible sidebar
5. **Typography update** — DM Sans body font (`font-medium` 500 everywhere), Space Grotesk limited to brand text and numeric stat values only
6. **Component unification** — consistent card, badge, and status indicator patterns across all views (T3Code patterns: rounded-2xl cards, ambient shadows, opacity-based borders)
7. **Fractal noise texture** — `body::after` pseudo-element with SVG feTurbulence at 3.5% opacity (from T3Code)
8. **Official style guide** — `design/style-guide/STYLE-GUIDE.md` as the canonical reference for all current and future UI work

## Artifacts

### Core Documents
- **PRD**: [`design/prd/PRD-REBRAND.md`](design/prd/PRD-REBRAND.md) — comprehensive implementation spec with T3Code file references, migration tables, file change list
- **Style Guide**: [`design/style-guide/STYLE-GUIDE.md`](design/style-guide/STYLE-GUIDE.md) — canonical design reference: colors, typography, components, spacing, animation, accessibility

### Mockups (preferred — T3Code-inspired, hand-tuned)
- [`design/stitch-exports/board-v2-t3-dark.html`](design/stitch-exports/board-v2-t3-dark.html) — **Dark mode board** (final, DM Sans, font-medium, noise texture)
- [`design/stitch-exports/board-v2-t3-light.html`](design/stitch-exports/board-v2-t3-light.html) — **Light mode board** (final, warm neutrals, borderless cards, ambient shadows)

### Mockups (earlier Stitch-generated, for reference only)
- `design/stitch-exports/board-view-dark.html/.png` — Original dark board
- `design/stitch-exports/board-view-light.html/.png` — Original light board
- `design/stitch-exports/command-deck-dark.html/.png` — Command Deck layout
- `design/stitch-exports/agents-view-dark.html/.png` — Agents list layout

### Current State Screenshots (before — captured via Playwright)
- `design/screenshots/01-landing.png` — Board dark mode (current)
- `design/screenshots/02-mission-control.jpeg` — Mission Control (current, Codex theme)
- `design/screenshots/03-agents.jpeg` — Agents page (current)
- `design/screenshots/04-settings.jpeg` — Settings page (current)
- `design/screenshots/06-board-light.jpeg` — Board light mode (**completely broken**)
- `design/screenshots/08-settings-light.jpeg` — Settings light mode (**broken**)
- `design/screenshots/09-plan-dialog.jpeg` — Plan dialog (positioning bug)

### Stitch Project
- Google Stitch project: `projects/4014658539033902919` ("Panopticon Dashboard Rebrand")
- Design systems: "Obsidian & Signal" + "Panopticon — T3Code-Inspired"

### Design Tokens (to be populated during implementation)
- `design/tokens/`

## Design References

- **T3Code index.css**: `/home/eltmon/Projects/t3code/apps/web/src/index.css` — token architecture, noise texture, scrollbars, color-mix(), OKLCH
- **T3Code components**: `/home/eltmon/Projects/t3code/apps/web/src/components/ui/` — card, button, badge, dialog, sidebar patterns
- **T3Code index.html**: `/home/eltmon/Projects/t3code/apps/web/index.html` — font loading (DM Sans)

## Key Design Decisions (from iteration)

1. **DM Sans body font** — chosen for its clean single-story "g" (open tail). Space Grotesk's double-story "g" looks wrong in body text.
2. **Space Grotesk restricted to brand + numbers** — any text containing the letter "g" must use DM Sans
3. **`font-medium` (500) for all UI text** — no font-semibold, no font-bold. Hierarchy via size and color, not weight.
4. **Warm `neutral-*` palette, never cold `slate-*`** — slate creates harsh clinical feel, neutral is warm and premium
5. **Light mode cards: borderless** — defined by ambient shadow `0_1px_2px rgba(0,0,0,0.04)` against off-white background, not explicit borders
6. **Background: `#f7f9fb`** (light) / `color-mix(neutral-950 95%, white)` (dark) — T3Code's exact values

## Scope

This is a large, sweeping change that touches every frontend component. The PRD describes it as one cohesive feature — per CLAUDE.md, all must be delivered together.

🤖 Generated with [Claude Code](https://claude.com/claude-code)

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

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to implementation plan at `docs/prds/active/{issue-id}/STATE.md` (required for dashboard)
3. Create a vBRIEF plan file at `.planning/plan.vbrief.json` — **MUST follow the exact format below**
4. Summarize the plan and STOP

**DO NOT run `bd create` commands.** Beads tasks are created automatically from `plan.vbrief.json` by Cloister when planning completes.

### vBRIEF Plan Format (REQUIRED)

The plan file MUST conform to vBRIEF v0.5 spec (https://github.com/deftai/vBRIEF).
It MUST have exactly two top-level keys: `vBRIEFInfo` and `plan`.

```json
{
  "vBRIEFInfo": {
    "version": "0.5",
    "created": "<ISO 8601 timestamp>",
    "author": "panopticon-cli/0.0.0",
    "description": "Plan for PAN-460: <issue title>"
  },
  "plan": {
    "id": "pan-460",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<generate a UUID v4>",
    "author": "agent:claude-opus-4-6",
    "sequence": 1,
    "created": "<ISO 8601 timestamp — same as vBRIEFInfo.created>",
    "updated": "<ISO 8601 timestamp — same as created>",
    "references": [
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/460", "label": "PAN-460", "type": "issue" }
    ],
    "tags": ["<relevant tags>"],
    "narratives": {
      "Problem": "<what problem this solves>",
      "Proposal": "<the approach chosen>"
    },
    "items": [
      {
        "id": "<short-kebab-id>",
        "title": "<task title>",
        "status": "pending",
        "priority": "medium",
        "created": "<ISO 8601 timestamp>",
        "metadata": {
          "difficulty": "trivial|simple|medium|complex|expert",
          "issueLabel": "pan-460"
        },
        "narrative": { "Action": "<what needs to be done>" },
        "subItems": [
          {
            "id": "<parent-id>.ac1",
            "title": "<specific testable acceptance criterion>",
            "status": "pending",
            "metadata": { "kind": "acceptance_criterion" }
          }
        ]
      }
    ],
    "edges": [
      { "from": "<source-item-id>", "to": "<target-item-id>", "type": "blocks" }
    ]
  }
}
```

**CRITICAL vBRIEF rules:**
- The file MUST have `vBRIEFInfo` and `plan` as the ONLY top-level keys
- `plan.id` MUST be the issue ID in lowercase (e.g., "pan-460")
- `plan.uid` MUST be a freshly generated UUID v4
- Do NOT use `issue`, `issueId`, or `issue_id` — use `plan.id`
- `items[].status` MUST be one of: draft, proposed, approved, pending, running, completed, blocked, cancelled
- Acceptance criteria MUST be `subItems` with `metadata.kind: "acceptance_criterion"`
- `metadata.difficulty` and `metadata.issueLabel` are Panopticon extensions to the vBRIEF spec
- Edge types: `blocks` (hard dependency), `informs` (soft), `invalidates`, `suggests`

**IMPORTANT:** Create the plan file BEFORE creating beads tasks.
**NOTE:** `*-spec.md` files are human-written specs — do NOT overwrite them. Your output is `*-plan.md`.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.

<!-- panopticon:orchestration-context-end -->
