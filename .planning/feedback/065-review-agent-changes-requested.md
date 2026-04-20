---
specialist: review-agent
issueId: PAN-540
outcome: changes-requested
timestamp: 2026-04-18T17:59:09Z
---

CODE REVIEW BLOCKED for PAN-540:

1. src/lib/cloister/review-agent.ts:536,564,606 loads reviewer templates from CACHE_AGENTS_DIR (~/.panopticon/agent-definitions) instead of the workspace/repo templates changed in this branch, so PAN-540's updated agents/*.md files are ignored unless an external cache sync happens. This makes review behavior stale and branch changes to the review prompts non-effective. 2. Missing tests for the new orchestration path in src/lib/cloister/review-agent.ts:513-639 and 742-783. tests/lib/cloister/review-agent.test.ts covers helper parsing/status functions, but there is no coverage for runParallelReview/spawnReviewAgent happy-path or failure-path behavior, which is required for new functionality.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-540 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
