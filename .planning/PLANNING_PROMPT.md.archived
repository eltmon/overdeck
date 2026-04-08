<!-- panopticon:orchestration-context-start -->
<!-- This is Panopticon orchestration context injected automatically.
     It contains planning session setup instructions, not agent reasoning.
     Session summarizers should SKIP this block and focus on the agent's
     actual work, decisions, and tradeoffs that follow. -->

# Planning Session: PAN-542

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
- **ID:** PAN-542
- **Title:** PAN: New session on compaction — rotate specialist JSONL when Claude compacts
- **URL:** https://github.com/eltmon/panopticon-cli/issues/542

## Description
## Overview

When Claude Code compacts a specialist's context (writes a `compact_boundary` entry to the JSONL), we should start a fresh Claude Code session seeded with the compact summary. This keeps specialist sessions small and clean — instead of one ever-growing JSONL accumulating months of history, each compaction becomes a natural breakpoint.

## Background

Specialist sessions use `--resume "${deterministicSessionId}"`, so the same JSONL grows indefinitely. Claude Code handles compaction internally — writing:
1. A `{ "type": "system", "subtype": "compact_boundary" }` entry
2. A `{ "type": "user", ..., "isCompactSummary": true }` entry containing the full context summary

Claude's own `--resume` handles this fine, but the JSONL keeps accumulating. After 30 days, Claude Code deletes old session files. More immediately: the session can contain months of irrelevant history.

**Current mitigation (already shipped):** `parseFromLastCompactBoundary()` in `conversation-service.ts` makes the dashboard display only show messages since the last compaction. This solves the display problem but not the accumulation problem.

## Proposed Approach

When a specialist spawns (`spawnEphemeralSpecialist`), before writing the launcher script:

1. Locate the current specialist JSONL (via the stored session UUID)
2. Scan for the last `compact_boundary` entry
3. If found — and we haven't already rotated for this boundary (checked via `session_compact_offsets` in SQLite, see #541):
   a. Extract the `isCompactSummary` user entry (the full summary text)
   b. Generate a new random UUID
   c. Write a seed JSONL at `~/.claude/projects/{encoded-cwd}/{newUUID}.jsonl` containing just the compact_boundary + isCompactSummary entries
   d. Update the stored session ID to `newUUID`
   e. Record the rotated boundary offset in SQLite so we don't rotate again for the same compaction
4. Use `--resume "${currentSessionId}"` in the launcher (now pointing to the fresh seed JSONL)

The seed JSONL lets Claude `--resume` from just the compacted summary, starting a clean session with full context but no accumulated noise.

## Dependencies

- **#541** (SQLite migration) — needs `session_compact_offsets` table to durably track which compaction boundaries have already been rotated. Without this, we'd rotate on every spawn once a compaction has occurred.

## Acceptance Criteria

- [ ] `spawnEphemeralSpecialist` detects `compact_boundary` in the existing JSONL before spawning
- [ ] On detection, generates a seed JSONL containing only the compact_boundary + isCompactSummary entries
- [ ] Updates specialist session ID to the new UUID
- [ ] Records the rotated boundary offset in `session_compact_offsets` (from #541)
- [ ] Subsequent spawns do NOT re-rotate for the same compaction (idempotent)
- [ ] If no compaction exists, behavior is unchanged (normal `--resume`)
- [ ] `test-agent` is excluded — it already uses `--session-id` (stateless, no resume)

## Related

- #541 — SQLite migration (prerequisite: `session_compact_offsets` table)
- `src/lib/cloister/specialists.ts` — `spawnEphemeralSpecialist`, `setSessionId`
- `src/dashboard/server/services/conversation-service.ts` — `findLastCompactBoundary`, `parseFromLastCompactBoundary`

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
    "description": "Plan for PAN-542: <issue title>"
  },
  "plan": {
    "id": "pan-542",
    "title": "<issue title>",
    "status": "approved",
    "uid": "<generate a UUID v4>",
    "author": "agent:minimax-m2.7-highspeed",
    "sequence": 1,
    "created": "<ISO 8601 timestamp — same as vBRIEFInfo.created>",
    "updated": "<ISO 8601 timestamp — same as created>",
    "references": [
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/542", "label": "PAN-542", "type": "issue" }
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
          "issueLabel": "pan-542"
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
- `plan.id` MUST be the issue ID in lowercase (e.g., "pan-542")
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
