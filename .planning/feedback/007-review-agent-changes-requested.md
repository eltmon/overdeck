---
specialist: review-agent
issueId: PAN-705
outcome: changes-requested
timestamp: 2026-04-14T17:58:20Z
---

CODE REVIEW BLOCKED for PAN-705:

CHANGES_REQUESTED — 4 blockers:

1. BANDAID: Backward-compat alias routes in workspaces.ts (lines 4146-4276). The forwardAlias() function and 9 alias routes have an explicit TODO comment: "Remove these aliases in a follow-up once all specialist code has migrated." This is intentional deferred tech debt forbidden by CLAUDE.md (No Bandaids, zero intentional technical debt). Two source files were not updated and the aliases are papering over them.

2. service.ts:654 — calls old route /api/workspaces/${issueId}/review instead of /api/review/${issueId}/trigger. The alias hides this bug.

3. verification-runner.ts:136 and :294 — still contain old URL api/workspaces/${issueId}/request-review in agent feedback messages. Line 244 was correctly updated to use pan review request, but lines 136 and 294 were missed. Agents receiving these messages get stale curl instructions.

4. resolveIssueId() in src/lib/issue-id.ts:123 has zero test coverage. Used in reset-session.ts, kill.ts, and done.ts. New exported functions require happy-path AND error-case tests.

MINOR: tests/unit/cli/sync-main.test.ts:59 test description says api/workspaces/:issueId/sync-main but the assertion correctly checks /api/issues/PAN-242/sync-main — stale test name.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-705 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
