<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-507

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
- **ID:** PAN-507
- **Title:** beads db not initialized on fresh install — bd init must be run once per project
- **URL:** https://github.com/eltmon/panopticon-cli/issues/507

## Description
## Summary

On a fresh Panopticon installation, `pan install` installs the `bd` binary but nothing initializes the Dolt database for each project. The first time planning completes and an agent tries to start, beads creation silently fails (or fails with a cryptic "database not found" error), causing Start Agent to return a 422 with no visible feedback.

## Root Cause

`createBeadsFromVBrief` sets up a `.beads/redirect` file pointing to the project root's `.beads/` directory, but assumes the Dolt database there already exists. If `bd init` was never run at the project root, there is no database — `bd list` fails and no beads are created.

`pan install`, `pan sync`, and `pan up` all install or check for the `bd` binary, but none ensure the project database exists.

## Fix (landed in this commit)

Three layers of protection now prevent this from blocking users:

### 1. `createBeadsFromVBrief` auto-init (`src/lib/vbrief/beads.ts`)
After setting up the redirect file, tests db connectivity with `bd list`. If it fails with "database not found", auto-runs `bd init --prefix <issue-prefix>` before creating beads.

### 2. `POST /api/agents` auto-recovery (`src/dashboard/server/routes/agents.ts`)
When beads are missing at agent-start time, attempts `createBeadsFromVBrief` as a recovery step before returning 422. In most cases this recovers silently and the agent starts normally.

### 3. `pan sync` health check (`src/cli/commands/sync.ts`)
For each registered project that has a `.beads/` directory, tests connectivity and auto-runs `bd init` if the database is missing. This fires on every `pan sync` run, giving a natural recovery point.

## Documentation updates

- `docs/USAGE.md`: Added `bd init --prefix <project-name>` as explicit step 4 in first-time setup
- `CONTRIBUTING.md`: Added beads init to dev setup section with `bd list` in verify step
- `src/cli/commands/install.ts`: Updated "Next steps" to include the `bd init` instruction

## Workaround (before fix)

```bash
cd /path/to/project
bd init --prefix <project-name>   # e.g. bd init --prefix panopticon
# Then if planning already completed:
curl -X POST http://localhost:3011/api/issues/PAN-<id>/complete-planning \
  -H 'Content-Type: application/json' -d '{"skipKill": true}'
```

## Related

Discovered while diagnosing PAN-506 (Start Agent silently fails).

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
    "description": "Plan for PAN-507: <issue title>"
  },
  "plan": {
    "id": "pan-507",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<generate a UUID v4>",
    "author": "agent:claude-opus-4-6",
    "sequence": 1,
    "created": "<ISO 8601 timestamp — same as vBRIEFInfo.created>",
    "updated": "<ISO 8601 timestamp — same as created>",
    "references": [
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/507", "label": "PAN-507", "type": "issue" }
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
          "issueLabel": "pan-507"
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
- `plan.id` MUST be the issue ID in lowercase (e.g., "pan-507")
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
