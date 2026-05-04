---
specialist: review-agent
issueId: PAN-712
outcome: changes-requested
timestamp: 2026-04-15T08:48:30Z
---

CODE REVIEW BLOCKED for PAN-712:

Incomplete implementation: acceptance criteria requires 0 hits for `pan (work|cloister|specialists)` in .claude/skills/, but 194 stale references remain across 18 untouched skill files. The work agent incorrectly audited the scope — only 2 files were fixed while 18 more need updates. Files with stale refs include: pan-help/SKILL.md, pan-issue/SKILL.md, pan-tell/SKILL.md, pan-kill/SKILL.md, pan-approve/SKILL.md, pan-status/SKILL.md, pan-plan/SKILL.md, pan-quickstart/SKILL.md, pan-rescue/SKILL.md, pan-diagnose/SKILL.md, pan-down/SKILL.md, pan-projects/SKILL.md, pan-setup/SKILL.md, pan-tracker/SKILL.md, pan-up/SKILL.md, send-feedback-to-agent/SKILL.md, session-health/SKILL.md, work-complete/work-complete/SKILL.md.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-712 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
