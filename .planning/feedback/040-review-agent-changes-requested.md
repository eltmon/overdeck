---
specialist: review-agent
issueId: PAN-714
outcome: changes-requested
timestamp: 2026-04-18T15:40:19Z
---

CODE REVIEW BLOCKED for PAN-714:

1. .claude/skills/rebase-and-submit/SKILL.md and .claude/skills/update-panopticon-docs/** are deleted, but the repo still explicitly instructs agents to use them in src/lib/cloister/prompts/work.md:187, src/lib/cloister/deacon.ts:1726, and .claude/skills/pan-docs/SKILL.md:43-45,116-118. This leaves broken skill references in production prompts/docs. 2. pan sync now mirrors canonical skills into .claude/skills/, but the branch deletes orphan project-level skills without updating all in-repo references and resource paths. The mirror logic is fine, but shipping broken references is not production-ready.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-714 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
