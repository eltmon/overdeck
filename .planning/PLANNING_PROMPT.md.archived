<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-491

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
- **ID:** PAN-491
- **Title:** bun:sqlite named param binding broken in event-store.ts (NOT NULL on :name params)
- **URL:** https://github.com/eltmon/panopticon-cli/issues/491

## Description
## Bug

**Discovered during:** PAN-488 oversight run

`POST /api/issues/:id/start-planning` returned `{"error":"NOT NULL constraint failed: events.type"}` when the dashboard runs under Bun.

## Root Cause

`bun:sqlite` requires the sigil prefix in binding objects when using named parameters. Unlike `better-sqlite3`, which accepts `{ name: value }` for `:name` params, bun:sqlite requires `{ ':name': value }`.

`event-store.ts` used `:name` style SQL with `{ name: value }` bindings — works under Node/better-sqlite3, silently nulls all params under Bun.

**Confirmed with:**
```bash
bun -e "
const { Database } = require('bun:sqlite');
const db = new Database(':memory:');
db.exec('CREATE TABLE test (type TEXT NOT NULL)');
const stmt = db.prepare('INSERT INTO test (type) VALUES (:type)');
stmt.run({ type: 'hello' }); // FAILS — NOT NULL constraint
stmt.run({ ':type': 'hello' }); // WORKS
"
```

## Fix (applied inline, needs to land on main)

Changed all SQL params in `event-store.ts` from `:name` to `$name` style and updated binding objects to use `$name` keys. Both runtimes handle `$name` consistently.

**Files changed:** `src/dashboard/server/event-store.ts`

## Status

Fixed inline during PAN-488 oversight. The fix exists on `feature/pan-488` branch and needs to be cherry-picked or will land when PAN-488 merges — but that's a long-running branch. Should be fast-tracked to main.

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
    "description": "Plan for PAN-491: <issue title>"
  },
  "plan": {
    "id": "pan-491",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<generate a UUID v4>",
    "author": "agent:claude-opus-4-6",
    "sequence": 1,
    "created": "<ISO 8601 timestamp — same as vBRIEFInfo.created>",
    "updated": "<ISO 8601 timestamp — same as created>",
    "references": [
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/491", "label": "PAN-491", "type": "issue" }
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
          "issueLabel": "pan-491"
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
- `plan.id` MUST be the issue ID in lowercase (e.g., "pan-491")
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
