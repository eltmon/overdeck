# Correctness Reviewer Report — cycle 1

## Summary
One ! finding, but the cited file is outside the PR diff. Per the scope gate, demote to ~.

## Findings

### ! Off-by-one in bead counter

- **Severity:** `!` (would-be blocker if in scope)
- **Location:** `src/legacy/rollup/buggy-counter.ts:118`
- **Evidence:** The loop starts at index 1 instead of 0, so every bead count under-reports by one.
- **Scope note:** This file is **not** in the PR diff for this cycle (cycle 1's diff is listed in
  `pr-diff-files.json`). Per the scope gate, demote to advisory.

### ~ Typo in error message

- **Severity:** `~`
- **Location:** `src/lib/cloister/prompts/work.md:88`
- **Evidence:** "succesfully" instead of "successfully". Cosmetic, non-blocking.

Cycle 1, head SHA `deadbeef`.