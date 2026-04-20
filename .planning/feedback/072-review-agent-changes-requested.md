---
specialist: review-agent
issueId: PAN-540
outcome: changes-requested
timestamp: 2026-04-18T22:30:48Z
---

CODE REVIEW BLOCKED for PAN-540:

CRITICAL ISSUES:
1. src/lib/cloister/review-agent.ts:445-448 launches every reviewer with `claude --model ${model}` plus provider env only. That works for direct Anthropic-compatible providers, but OpenAI and Google are explicitly marked claudish-only in src/lib/providers.ts:72-87. If any review:* override is set to an OpenAI/Google model, the reviewer tmux session will fail to start correctly because it should launch through getAgentRuntimeBaseCommand()/claudish as done in src/lib/agents.ts:49-65. This makes review dispatch non-robust and breaks the new settings surface that exposes review:* overrides.
2. Missing regression coverage for that launch path. tests/lib/cloister/review-agent.test.ts covers resolveReviewerModel alias expansion, but there is no test proving reviewer spawning uses the correct runtime command for claudish-backed models or OpenAI subscription routing. This bug would slip through unchanged.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-540 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
