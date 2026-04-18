---
specialist: review-agent
issueId: PAN-704
outcome: changes-requested
timestamp: 2026-04-18T15:14:41Z
---

CODE REVIEW BLOCKED for PAN-704:

Changes requested. Missing test coverage for newly extracted PlanningChips behavior. The new PlanChip and VBriefChip components add production logic around planning-state fetching and conditional rendering, but the test suite only covers TasksChip and the Rally feature suppression case. Add regression tests covering PlanChip state-driven rendering (Plan vs See Plan, Watch Planning path) and VBriefChip state-driven rendering so the refactor is fully covered.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-704 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
