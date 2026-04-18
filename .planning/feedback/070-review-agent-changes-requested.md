---
specialist: review-agent
issueId: PAN-540
outcome: changes-requested
timestamp: 2026-04-18T21:48:06Z
---

CODE REVIEW BLOCKED for PAN-540:

Blocking regression in settings model selection: the new Settings UI now offers and persists model IDs like gpt-4o, gpt-4o-mini, o3-deep-research, gemini-2.5-pro, gemini-2.5-flash, glm-4.7, glm-4.7-flash, and kimi-k2, but the backend/provider registry and related resolution paths still only recognize the older IDs (for example src/dashboard/server/routes/settings.ts:47-77 still maps test-api-key models to the old catalog, and src/lib/settings.ts / src/lib/providers.ts / src/lib/model-capabilities.ts still define the old provider model sets). That means users can save overrides to IDs the runtime cannot route or validate consistently, breaking API key tests and model execution. Fix by making the model catalog a single consistent source of truth across frontend and backend, then add regression tests covering a newly introduced model end-to-end.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-540 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
