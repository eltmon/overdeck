---
specialist: review-agent
issueId: PAN-540
outcome: changes-requested
timestamp: 2026-04-19T08:38:13Z
---

CODE REVIEW BLOCKED for PAN-540:

Two data-model contradictions: (1) gpt-4o/gpt-4o-mini displayName says (deprecated) in MODEL_CAPABILITIES but they are NOT in MODEL_DEPRECATIONS — the comment explicitly forbids it — yet gpt-4o-mini is FALLBACK_DEFAULT_MODEL and the only OpenAI option in ModelOverrideModal. This causes (deprecated) to appear in the live settings UI. (2) glm-4.7/glm-4.7-flash are in MODEL_DEPRECATIONS pointing to glm-5.1, but model-fallback.ts FALLBACK_MAP separately maps them to claude-sonnet-4-6/claude-haiku-4-5. These are contradictory fallback targets depending on which code path runs first. Also, their displayName lacks (deprecated) unlike all other deprecated models.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-540 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
