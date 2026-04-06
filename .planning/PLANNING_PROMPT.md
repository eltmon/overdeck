<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-488

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
- **ID:** PAN-488
- **Title:** Project repo artifact structure: .pan/ migration + multi-tool skill sync
- **URL:** https://github.com/eltmon/panopticon-cli/issues/488

## Description
## Summary

Implement the repo artifact design defined in [docs/REPO-ARTIFACTS.md](docs/REPO-ARTIFACTS.md). This consolidates all Panopticon project-level directory/file renames, archive structure changes, and multi-tool skill sync into one cohesive feature.

## Background

See `docs/REPO-ARTIFACTS.md` for the full design rationale. Short version:
- `.panopticon/` (project-level) → `.pan/` for brevity and consistency
- `.panopticon.yaml` → `.pan.yaml`
- Planning artifacts (STATE.md, vBRIEF) live in the repo and are committed
- Archive structure moves from flat files to per-issue subdirectories
- `pan sync` gains multi-tool output (Cursor, Codex, Windsurf, Cline, Copilot, Aider)
- `.pan/skills/` in the project repo becomes a sync source with proper precedence rules

## Changes Required

### 1. Rename project-level `.panopticon/` → `.pan/`

These path constants in the codebase need updating:

| File | Old path | New path |
|------|---------|---------|
| `src/lib/costs/wal.ts` | `.panopticon/events` | `.pan/events` |
| `src/lib/costs/sync-wal.ts` | `.panopticon/events` | `.pan/events` |
| `src/lib/convoy-templates.ts` | `.panopticon/triage`, `.panopticon/health` | `.pan/convoy` (unified) |
| `src/lib/convoy.ts` | `.panopticon/convoy-output` | `.pan/convoy` |
| `src/lib/remote/remote-agents.ts` | `/workspace/.panopticon/prompts/` | `/workspace/.pan/prompts/` |
| `src/lib/projects.ts` | `".panopticon/events"` default | `".pan/events"` |

Add migration step in `pan sync` or `pan install` to rename existing `.panopticon/` subdirs in active workspaces (skip `~/.panopticon/` — that's the global tool dir, unchanged).

### 2. Rename `.panopticon.yaml` → `.pan.yaml`

- Update config loading in `src/lib/config-yaml.ts` to look for `.pan.yaml` first, fall back to `.panopticon.yaml` for backwards compatibility
- Update workspace setup code that generates `.panopticon.yaml`
- Update any documentation references

### 3. Archive structure: flat → per-issue subdirectory

Change `complete-planning` (and `archive-planning.ts`) so archived artifacts go into a subdirectory:

**Before:** `docs/prds/active/<ID>-plan.vbrief.json`, `docs/prds/active/<ID>-STATE.md`
**After:** `docs/prds/active/<issue-id>/plan.vbrief.json`, `docs/prds/active/<issue-id>/STATE.md`

Existing flat archives are left as-is. New closures always use subdirectory format.

### 4. `.pan/skills/` as sync source

Update `src/lib/sync.ts` to include `.pan/skills/` from the project repo as a sync source with this precedence:

1. `.claude/skills/<name>/` already in project repo → **skip, never overwrite**
2. `.pan/skills/<name>/` in project repo → write to tool dirs
3. `~/.panopticon/skills/<name>/` → global fallback

### 5. Multi-tool sync in `pan sync`

Read `tools.also_sync` from `~/.panopticon/config.yaml` (global) merged with `.pan.yaml` (per-project, additive only). For each configured tool, write skills/rules to the appropriate directory:

| Tool | Target |
|------|--------|
| `cursor` | `.cursor/rules/*.mdc` |
| `codex` | `AGENTS.md` (named blocks) |
| `windsurf` | `.windsurf/rules/*.md` |
| `cline` | `.clinerules/` |
| `copilot` | `.github/instructions/*.instructions.md` |
| `aider` | `CONVENTIONS.md` |

Per-project `also_sync` merges with global — never replaces it.

### 6. `.gitignore` injection

When creating or updating a workspace, ensure these paths are in `.gitignore`:

```
.pan/events/
.pan/convoy/
.pan/prompts/
```

## Acceptance Criteria

- [ ] All project-level `.panopticon/` path references updated to `.pan/`
- [ ] `.pan.yaml` is the canonical config filename; `.panopticon.yaml` falls back with deprecation warning
- [ ] `pan sync` migrates existing `.panopticon/` subdirs in active workspaces (non-destructive)
- [ ] `complete-planning` archives to `docs/prds/active/<issue-id>/` subdirectory
- [ ] `.pan/skills/` in project repo is respected as a sync source with correct precedence
- [ ] `pan sync` writes to all tools in `also_sync` (global + per-project merged)
- [ ] `.pan/events/`, `.pan/convoy/`, `.pan/prompts/` are gitignored in new workspaces
- [ ] `pan sync --dry-run` shows multi-tool output correctly
- [ ] Existing workspaces with `.panopticon.yaml` continue to work (backwards compat)
- [ ] `docs/REPO-ARTIFACTS.md` matches implemented behavior exactly

## Reference

- Design doc: `docs/REPO-ARTIFACTS.md`
- Existing sync implementation: `src/lib/sync.ts`
- Config loading: `src/lib/config-yaml.ts`
- Archive logic: `src/lib/lifecycle/archive-planning.ts`

## Cleanup Required

The following workaround was added while PAN-488 was pending and must be removed as part of this issue:

- **Delete** `.claude/rules/planning-artifacts.md` in the panopticon-cli repo — this rule was added to stop the review agent from blocking on `.planning/` being committed to feature branches. Once `.planning/` being tracked is properly established as intentional (via this issue), the rule is no longer needed.

Add to acceptance criteria:
- [ ] `.claude/rules/planning-artifacts.md` workaround rule is deleted

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
2. Copy STATE.md to implementation plan at `docs/prds/active/{issue-id}-plan.md` (required for dashboard)
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
    "author": "panopticon-cli/0.6.0",
    "description": "Plan for PAN-488: <issue title>"
  },
  "plan": {
    "id": "pan-488",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<generate a UUID v4>",
    "author": "agent:claude-opus-4-6",
    "sequence": 1,
    "created": "<ISO 8601 timestamp — same as vBRIEFInfo.created>",
    "updated": "<ISO 8601 timestamp — same as created>",
    "references": [
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/488", "label": "PAN-488", "type": "issue" }
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
          "issueLabel": "pan-488"
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
- `plan.id` MUST be the issue ID in lowercase (e.g., "pan-488")
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
