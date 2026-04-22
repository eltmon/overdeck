---
specialist: review-agent
issueId: PAN-569
outcome: changes-requested
timestamp: 2026-04-22T22:37:24Z
---

# Review: CHANGES_REQUESTED

## Summary

Requirements are fully met (27/27 vBRIEF acceptance criteria) and the PR improves security by replacing shell-interpolated `exec` with `execFile` in clean-planning. However, two blockers prevent merge: (1) the branch is stale against main and will regress the shared MergeButton/RecoverButton refactor from 8b7fc0b4, and (2) the bulk endpoint runs `closeOut()` with `concurrency: 3` against the same projectPath, contradicting the vBRIEF and risking git index-lock races. Additionally, `hasActiveAgentForIssue()` is defined but never called, making the active-agent guardrail client-only — a direct POST will wipe workspaces of running agents. Progress modal can hang if the response omits an ID. Minor medium-severity hardening recommended around issue-ID validation, Origin check, and memoizing agent lookups.

## Security Issues

- Missing issueId format validation on bulk endpoint
- Origin check accepts missing Host and does not enforce Content-Type

## Performance Issues

- Repeated O(selected × agents) scans during bulk-close warning
- Per-card planning-state fan-out generates many small HTTP requests

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-569 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

