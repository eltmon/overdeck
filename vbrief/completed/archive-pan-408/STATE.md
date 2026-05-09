# PAN-408: Wire vBRIEF Acceptance Criteria into Specialist Pipeline

## Current Status
Implementation complete. All 15 beads closed. 56 tests passing.

## What Was Done

### Part 1: Wire AC into Specialist Pipeline
1. **acceptance-criteria.ts** — New module with extractAcceptanceCriteria(), formatAcceptanceCriteria(), checkAllCriteriaCompleted(), extractACFromDocument()
2. **io.ts** — Added updateSubItemStatus() for atomic AC status updates
3. **beads.ts** — Added getVBriefACStatus() utility for structured per-item AC status
4. **work-agent-prompt.ts** — Enhanced readBeadsTasks() to inject per-bead AC as indented checklist
5. **review-agent.md/ts** — Added {{acceptanceCriteria}} conditional block and variable substitution
6. **test-agent.md/ts** — Added {{acceptanceCriteria}} conditional block and variable substitution
7. **merge-agent.md** — Added Step 5: Pre-Merge AC Validation
8. **verification-runner.ts** — Added vbrief-ac gate after quality gates
9. **done.ts** — Added Check 3: AC completion check to pan work done pre-flight
10. **work-complete SKILL.md** — Added Step 4: Verify Acceptance Criteria

### Part 2: Documentation Alignment
11. **WORK-TYPES.md** — Removed prd-agent, decomposition-agent, triage-agent; updated planning section
12. **MODEL_RECOMMENDATIONS.md** — Removed deleted agent sections; added vBRIEF note
13. **plan SKILL.md** — Added Cloister hand-off explanation
14. **INDEX.md** — Added HIERARCHICAL-PLANNING.md; added vBRIEF/DAG keywords
15. **SPECIALIST_WORKFLOW.md** — Updated beads creation; added DAG/AC sections
16. **HIERARCHICAL-PLANNING.md** — Added Beads Conversion, DAG, AC Pipeline sections
17. **CLAUDE.md** — Replaced .planning/PRD.md with plan.vbrief.json
18. **CONFIGURATION.md** — Removed decomposition-agent config example

## Remaining Work
None. Implementation complete.

## Decisions
- AC extraction module in src/lib/vbrief/acceptance-criteria.ts (new file)
- getVBriefACStatus in src/lib/vbrief/beads.ts (existing file, extended)
- updateSubItemStatus in src/lib/vbrief/io.ts (existing file, extended)
- Review and test agent prompt builders switched from raw .replace() to processIfBlocks() for conditional template support
- Verification gate AC check runs AFTER quality gates (typecheck/lint/test)

## Specialist Feedback
None received.
