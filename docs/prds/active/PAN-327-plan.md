# PAN-327: Structured Verification, Decision Locking, and Hierarchical Context Patterns

## Status: Planning Complete

## Attribution

Several patterns in this PRD are adapted from the [Deft Directive](https://github.com/visionik/deft) (MIT license, Copyright 2025-2026 Jonathan Taylor). Deft is a standards/guidelines framework for AI-assisted development. We're incorporating its best ideas into Overdeck's runtime orchestration layer where they complement our existing specialist pipeline and context management.

## Problem

Five gaps in Overdeck's current implementation:

1. **Stub blindness** — The verification gate (`verification-gate.ts`) checks typecheck/lint/test but doesn't scan for incomplete implementations. The review convoy checks correctness/security/performance but doesn't detect TODO placeholders, `return null` stubs, or `pass` bodies. Agents mark work "done" with half-baked code.

2. **Decision drift** — STATE.md records decisions made during planning, but nothing prevents a work agent from silently making a different choice downstream. Feedback files include rationale, but there's no formal mechanism to lock decisions or require explicit justification to override them.

3. **Flat context accumulation** — Beads are flat (labels + status). Feedback files accumulate sequentially (001-, 002-, 003-). After 3+ review cycles, an agent resuming work must read every feedback file to understand the current state. No hierarchical compression exists.

4. **Unstructured interruption recovery** — When a work agent crashes or hits context limits, recovery depends on the agent reading STATE.md + `.planning/feedback/` + beads state and reconstructing where it was. There's no structured checkpoint that says "here's exactly where you stopped and what to do next."

5. **Bulk skill loading** — `mergeSkillsIntoWorkspace()` copies all 67+ skills into every workspace. Most agents need 3-5 skills for their task. The rest is dead weight in the filesystem and noise if the agent scans available skills.

## Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| Stub detection location | Verification gate + review convoy prompt | Gate catches mechanical stubs (grep-able patterns). Review catches semantic stubs (functions that exist but don't do real work). Two layers. |
| Decision locking format | Structured section in STATE.md with LOCKED/UNLOCKED markers | Keeps decisions co-located with planning artifacts. Agents already read STATE.md on startup. |
| Summarization approach | Feedback rollup file, not beads hierarchy | Beads are an external tool (`bd`). Modifying beads structure is out of scope. Feedback rollup is fully in our control. |
| Checkpoint format | `.planning/checkpoint.json` (structured JSON) | JSON is machine-parseable. Agents can read it deterministically. Markdown is ambiguous for resume logic. |
| Skill loading strategy | Manifest-based relevance tags + workspace skill subset | Tag skills with applicable work types. Copy only relevant skills per workspace type (planning, implementation, review). |

## Architecture

### Phase 1: Stub Detection

#### 1a. Verification Gate Enhancement

**File:** `src/lib/cloister/verification-gate.ts`

Add a fourth check after typecheck/lint/test:

```typescript
async function checkForStubs(workspacePath: string): Promise<VerificationResult> {
  const patterns = [
    // Language-agnostic
    'TODO|FIXME|HACK|XXX',
    // JavaScript/TypeScript
    'return\\s+(null|undefined|\\{\\}|\\[\\]|""|\'\')\\s*;?\\s*$',
    'throw new Error\\([\'"]not implemented',
    // Python
    '^\\s*pass\\s*$',
    'raise NotImplementedError',
    // Go
    'panic\\("not implemented"\\)',
    // Rust
    'unimplemented!\\(\\)',
    'todo!\\(\\)',
  ];
  // grep -rn across changed files only (from git diff)
  // Exclude test files (stubs in tests are often intentional)
  // Return: file:line matches with surrounding context
}
```

**Behavior:**
- Runs on changed files only (from `git diff main...HEAD`)
- Excludes `**/*.test.*`, `**/*.spec.*`, `**/__tests__/**`
- Warns but does not block (stubs in progress are expected; stubs in "done" work are the problem)
- Warning text injected into feedback if review proceeds
- Stub count tracked in verification status for dashboard display

#### 1b. Review Convoy Enhancement

**File:** `src/lib/cloister/review-agent.ts` (convoy prompt)

Add to the review convoy's correctness reviewer prompt:

```
## Stub Detection

Scan all changed files for incomplete implementations:
- Functions that return hardcoded/empty values without logic
- Functions under 5 lines that return placeholder data
- TODO/FIXME comments that indicate unfinished work
- Empty catch blocks, no-op event handlers
- Interfaces or types defined but never used

Report any stubs found under a STUB_DETECTION section in your review output.
Mark as CHANGES_REQUESTED if stubs exist in non-test production code.
```

### Phase 2: Decision Locking

**File:** `src/lib/cloister/handoff-context.ts` (STATE.md generation)

Add a structured "Locked Decisions" section to STATE.md:

```markdown
## Locked Decisions

<!-- Decisions below are LOCKED. Work agents MUST follow these unless explicitly -->
<!-- unlocked by the user. To request an unlock, write justification to feedback. -->

| # | Decision | Choice | Locked By | Status |
|---|----------|--------|-----------|--------|
| D1 | Database schema | PostgreSQL with JSONB columns | planning-agent | LOCKED |
| D2 | Auth approach | JWT with refresh tokens | planning-agent | LOCKED |
| D3 | Error handling | Result types, no exceptions | user (discuss phase) | LOCKED |
```

**Agent instructions** (added to work agent prompt via handoff context):

```
## Decision Protocol

STATE.md contains a "Locked Decisions" table. Rules:
1. LOCKED decisions are binding. Follow them exactly.
2. If you believe a locked decision is wrong, do NOT silently override it.
   Instead, write your reasoning to .planning/feedback/ and request unlock.
3. Only the user or planning agent can change a decision from LOCKED to UNLOCKED.
4. New decisions you make during implementation should be added as LOCKED
   with your agent role as "Locked By".
```

**Files modified:**
- `src/lib/cloister/handoff-context.ts` — Add `lockedDecisions` to `HandoffContext` interface, serialize to STATE.md
- `src/lib/cloister/planning-agent.ts` — Planning agent prompt includes instructions to populate locked decisions
- `src/lib/cloister/work-agent.ts` — Work agent prompt includes decision protocol
- `src/lib/cloister/review-agent.ts` — Review checks implementation against locked decisions

### Phase 3: Feedback Rollup

**New file:** `src/lib/cloister/feedback-rollup.ts`

When feedback files exceed a threshold (3+), generate a rollup:

```markdown
<!-- .planning/feedback/ROLLUP.md -->
<!-- Auto-generated. Source files preserved in .planning/feedback/ -->

# Feedback Summary (3 cycles)

## Current Status
Review cycle 3: CHANGES_REQUESTED

## Resolved Issues (from cycles 1-2)
- [x] Missing error handling in auth middleware (cycle 1)
- [x] SQL injection in query builder (cycle 1, security)
- [x] N+1 query in user listing (cycle 2, performance)

## Outstanding Issues (from cycle 3)
- [ ] Token refresh endpoint returns 500 on expired tokens
- [ ] Missing rate limiting on login endpoint

## Decisions Made During Review
- D4: Use middleware-level rate limiting, not per-route (review-agent, cycle 2)
```

**Trigger:** Generated automatically when writing feedback file #3+.
**Agent behavior:** On startup, if ROLLUP.md exists, read it instead of individual files. Individual files remain for audit trail.

### Phase 4: Structured Session Checkpoints

**New file format:** `.planning/checkpoint.json`

```json
{
  "version": 1,
  "issueId": "PAN-327",
  "agent": "work-agent",
  "timestamp": "2026-03-16T14:30:00Z",
  "reason": "context_exhaustion|session_timeout|manual_stop|crash",
  "completed": [
    { "id": "t1", "title": "Add stub detection to verification gate", "status": "done" },
    { "id": "t2", "title": "Update review convoy prompt", "status": "done" }
  ],
  "remaining": [
    { "id": "t3", "title": "Add decision locking to STATE.md", "status": "todo" },
    { "id": "t4", "title": "Write tests for stub detection", "status": "blocked", "blocker": "t3" }
  ],
  "decisions": [
    { "ref": "D1", "what": "Used grep not AST for stub detection", "why": "AST parsing adds heavyweight deps" }
  ],
  "resumePoint": "Start with t3: add lockedDecisions to HandoffContext interface in handoff-context.ts",
  "hazards": [
    "verification-gate.ts has a known bug where /request-review bypasses the gate"
  ]
}
```

**Files modified:**
- `src/lib/cloister/work-agent.ts` — On session end/crash, write checkpoint
- `src/lib/cloister/handoff-context.ts` — On agent startup, check for checkpoint.json and inject into prompt
- `src/lib/agents.ts` — Add checkpoint writing to agent lifecycle hooks (pre-exit)

**Resume behavior:**
- If `.planning/checkpoint.json` exists, inject it into the agent prompt as the first thing to read
- Agent reads checkpoint, picks up from `resumePoint`, does NOT re-read conversation history
- After successful resume, rename to `.planning/checkpoint.consumed.json` (kept for audit, ignored on next startup)

### Phase 5: Context-Aware Skill Loading

**File:** `src/lib/skills-merge.ts`

Add relevance tags to skill manifest:

```json
{
  "name": "code-review",
  "applicableTo": ["review", "implementation"],
  "tags": ["quality", "security", "performance"]
}
```

**Modified `mergeSkillsIntoWorkspace()`:**
- Accept a `workspaceType` parameter: `planning | implementation | review | test | merge`
- Filter skills by `applicableTo` field before copying
- Always include skills tagged `universal` (e.g., `beads`, `workspace-status`)
- Log which skills were included/excluded for debugging

**Skill tagging:**
- Add `applicableTo` field to `.panopticon-manifest.json` entries
- Default: `["universal"]` (backward compatible, all skills copied)
- Over time, tag skills appropriately and reduce default set

**Expected reduction:** From 67+ skills per workspace to ~10-15 per specialist type.

## Implementation Order

1. **Phase 1a** (stub detection in verification gate) — Highest value, lowest risk. Grep-based, isolated change.
2. **Phase 2** (decision locking) — High value, moderate scope. Touches handoff-context and agent prompts.
3. **Phase 3** (feedback rollup) — Medium value, isolated. New module, no existing code modified.
4. **Phase 1b** (stub detection in review convoy) — Medium value, prompt-only change.
5. **Phase 4** (session checkpoints) — High value, moderate scope. Touches agent lifecycle.
6. **Phase 5** (skill loading) — Lower priority. Token savings are real but TLDR already mitigates context pressure.

## Out of Scope

- **Modifying beads internals** — Beads is an external tool (`bd`). We work with its output, not its internals.
- **vBRIEF format adoption** — Deft's vBRIEF is tightly coupled to their framework. Our checkpoint.json serves the same purpose without the dependency.
- **Discuss strategy as a formal Overdeck phase** — Decision locking captures the valuable part (preventing re-debate) without adding a new pipeline stage.
- **Fractal summaries as a general system** — The feedback rollup captures the specific case where this matters most. General-purpose summarization is over-engineered for current needs.

## Success Criteria

- [ ] Verification gate catches `return null` stubs in changed files and warns in feedback
- [ ] Review convoy reports stub patterns in STUB_DETECTION section
- [ ] STATE.md contains Locked Decisions table after planning phase
- [ ] Work agents that violate a locked decision get flagged in review
- [ ] Feedback rollup generated after 3+ review cycles
- [ ] Agents resume from checkpoint.json without re-reading conversation history
- [ ] Specialist workspaces contain only relevant skills (measurable reduction from 67+ baseline)
