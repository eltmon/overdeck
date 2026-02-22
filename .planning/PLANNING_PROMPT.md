# Planning Session: PAN-238

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
  - PRD file at `docs/prds/active/{issue-id}-plan.md` (copy of STATE.md, required for dashboard)
- Present options and tradeoffs for the user to decide

When planning is complete, STOP and tell the user: "Planning complete - click Done when ready to hand off to an agent for implementation."

---

## Issue Details
- **ID:** PAN-238
- **Title:** Cost recording generates ~50% duplicate events despite flock serialization
- **URL:** https://github.com/eltmon/panopticon-cli/issues/238

## Description
## Problem

Cost event recording in `record-cost-event.ts` generates ~50% duplicate events despite the flock serialization added in PAN-220. Analysis of `events.jsonl` shows:

- 326 total events, only 161 unique token signatures (50.6% duplicates)
- Duplicates appear as timestamp pairs (13 occurrences) and triples (3 occurrences)
- Pattern: identical `(model, input, output, cacheRead, cacheWrite)` tuples at the same millisecond

## Impact

- **Cost reporting inflated ~2x** — every metric that sums from events.jsonl is doubled
- Requires periodic manual deduplication to get accurate numbers
- Undermines trust in the cost tracking system

## Current Architecture

```
PostToolUse event → heartbeat-hook (bash)
  → flock -x -w 30 on per-session lock file
  → echo $TOOL_INFO | node record-cost-event.js
    → reads transcript from byte offset
    → processes new assistant messages with usage data
    → appends cost events to events.jsonl
    → saves new byte offset
```

## Flock Implementation (heartbeat-hook lines 169-172)

```bash
{
  flock -x -w 30 200
  echo "$TOOL_INFO" | node "$COST_SCRIPT" 2>/dev/null || true
} 200>"$LOCK_FILE"
```

Lock file is per-session: `~/.panopticon/costs/state/${SESSION_ID}.lock`

## Hypothesis

The flock serialization should prevent concurrent access, but duplicates persist. Possible causes:

1. **Node process startup race** — flock holds until node exits, but if node's file I/O isn't fully flushed before exit, the next flock holder may read stale offset
2. **Offset file write not fsynced** — `writeFileSync` in Node.js doesn't guarantee fsync; the next process may read the old offset value from OS cache
3. **Multiple session IDs** — if `session_id` is missing from TOOL_INFO, falls back to "unknown", creating a shared lock file that doesn't match the per-session offset files
4. **Transcript compaction** — Claude Code may rewrite/compact the transcript file, invalidating byte offsets

## Reproduction

```bash
python3 -c "
import json
from collections import Counter
events = [json.loads(l) for l in open('\$HOME/.panopticon/costs/events.jsonl') if l.strip()]
keys = [(e.get('model',''), e.get('input',0), e.get('output',0), e.get('cacheRead',0), e.get('cacheWrite',0)) for e in events]
total, unique = len(keys), len(set(keys))
print(f'{total} events, {unique} unique, {total-unique} dupes ({100*(total-unique)/total:.1f}%)')
"
```

## Proposed Fix Direction

1. Add `requestId` from transcript entries as a dedup key in events.jsonl
2. Before appending, check if the `requestId` already exists in recent events
3. Consider using `fsyncSync` after writing the offset file
4. Add a content-hash based dedup as defense-in-depth

## Files

- `scripts/record-cost-event.ts` — cost event recording logic
- `~/.panopticon/bin/heartbeat-hook` — flock serialization wrapper
- `~/.panopticon/costs/events.jsonl` — event store
- `~/.panopticon/costs/state/*.offset` — per-session byte offsets
- `~/.panopticon/costs/state/*.lock` — per-session flock files

---

## Your Mission

You are a planning agent conducting a **discovery session** for this issue.

### Phase 1: Understand Context
1. Read the codebase to understand relevant files and patterns
2. Identify what subsystems/files this issue affects
3. Note any existing patterns we should follow

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

When creating beads tasks, include difficulty labels:
```bash
bd create "PAN-XX: Task name" --type task -l "PAN-XX,linear,difficulty:medium" -d "Description"
```

### Phase 3: Generate Artifacts (NO CODE!)
When discovery is complete:
1. Create STATE.md with decisions made
2. Copy STATE.md to PRD at `docs/prds/active/{issue-id}-plan.md` (required for dashboard)
3. Create beads tasks with dependencies using `bd create` (include difficulty:LEVEL labels)
4. Summarize the plan and STOP

**IMPORTANT:** Create the PRD file BEFORE creating beads tasks.

**Remember:** Be a thinking partner, not an interviewer. Ask questions that help clarify.

Start by exploring the codebase to understand the context, then begin the discovery conversation.
