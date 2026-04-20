---
specialist: review-agent
issueId: PAN-540
outcome: changes-requested
timestamp: 2026-04-18T17:45:44Z
---

CODE REVIEW BLOCKED for PAN-540:

1. src/lib/cloister/review-agent.ts:530-533 + src/lib/cloister/config.ts:74-85 — review_agents is advertised as user-configurable, but the runner hardcodes code-review-<name>.md templates. Any custom reviewer name without a baked-in template crashes the whole review flow, so users cannot actually add/swap reviewers from config. 2. src/lib/cloister/review-agent.ts:101-104,495-500,530-559 — if specialists.review_agents is present but all entries are disabled, getReviewAgents() returns an empty array and runParallelReview still proceeds to synthesis with zero reviewers, allowing a review result with no reviewer output. 3. tests/lib/cloister/review-agent.test.ts:668-690 — the new review_agents configuration path has no regression coverage for either custom reviewer names or the all-disabled case, so the added functionality ships untested.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-540 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
