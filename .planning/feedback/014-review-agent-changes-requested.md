---
specialist: review-agent
issueId: PAN-705
outcome: changes-requested
timestamp: 2026-04-14T19:25:40Z
---

CODE REVIEW BLOCKED for PAN-705:

6 issues found requiring fixes before merge: (1) .claude/skills/pan-plan-finalize/SKILL.md is tracked in git but still references pan plan-finalize everywhere — command is now pan plan finalize; (2) .claude/skills/pan-tldr/SKILL.md tracked but references pan tldr status/warm/start/stop — should be pan admin tldr *; (3) src/lib/cloister/prompts/work.md:189 says those endpoints will 404 but /api/review/* endpoints now exist — factually wrong; (4) .claude/skills/rebase-and-submit/SKILL.md:29 same false 404 claim for /api/review/*; (5) src/cli/index.ts:283 status command description says shorthand for work status but pan work status no longer exists; (6) CLAUDE.md lines 44 and 94 still reference pan work done in quality gates section — should be pan done

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-705 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
