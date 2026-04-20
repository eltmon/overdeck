---
specialist: review-agent
issueId: PAN-714
outcome: changes-requested
timestamp: 2026-04-18T18:32:54Z
---

CODE REVIEW BLOCKED for PAN-714:

1. src/lib/sync.ts:827 — mirrorProjectSkills() claims pre-existing target dirs outside the manifest are user-managed and must not be touched, but it still calls syncDirContents() unconditionally for every source-backed skill. If a user already has .claude/skills/<name>/ and the source skills/<name>/ also exists, pan sync will overwrite or delete user files despite the documented ownership rule. 2. tests/lib/mirrorProjectSkills.test.ts — there is no regression test for the same-name collision case (user-managed target dir outside manifest + matching source skill). The existing conv-lookup test only covers a non-colliding name, so it would not catch the overwrite bug.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-714 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
