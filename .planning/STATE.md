# PAN-496: gh issue view fails due to projects classic deprecation warning

## Status: Implementation Complete

## Current Phase
All work complete. Ready for review.

## Completed Work
- [x] feature-pan-489-w71: Added CLAUDE.md section requiring --json for gh issue view (commit: 3e46672d)
- [x] feature-pan-489-zw1: Updated github-cli skill + plan skill + .claude/skills mirrors with --json warning and correct examples (commit: pending)

## Remaining Work
None

## Key Decisions
- D1: Added note immediately before "No Blocking Calls" section in CLAUDE.md for high visibility
- D2: github-cli SKILL.md now shows WRONG (bare) vs CORRECT (--json) examples with a WARNING callout
- D3: plan SKILL.md inline note on the gh issue view line — keeps it compact while explaining why

## Specialist Feedback
(none yet)
