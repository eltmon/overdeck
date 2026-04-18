---
specialist: review-agent
issueId: PAN-711
outcome: changes-requested
timestamp: 2026-04-18T16:21:12Z
---

CODE REVIEW BLOCKED for PAN-711:

1. src/lib/rebase-helper.ts:218 shells conflicted file paths directly into git checkout/git add with only double-quote wrapping. A filename containing command substitution (for example $(touch /tmp/pwned)) will execute during conflict resolution, so this is a command-injection bug in a code path that handles repository content. Use execFile/spawn with argument arrays, or otherwise pass file paths without invoking a shell. 2. tests/unit/lib/rebase-helper.test.ts covers only ordinary planning file names and misses the regression for shell-special filenames, so the bug above is untested. Add a test with a .planning file whose name includes shell metacharacters and assert no command execution occurs while the rebase succeeds. 3. tests/unit/dashboard/no-alias-routes.test.ts asserts canonical merge/status routes but does not guard the newly documented approve endpoint. Since PAN-711 updates both skill docs to /api/issues/:issueId/approve, add a regression assertion that this route is registered too.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-711 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
