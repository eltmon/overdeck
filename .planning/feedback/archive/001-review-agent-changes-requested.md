---
specialist: review-agent
issueId: PAN-569
outcome: changes-requested
timestamp: 2026-04-22T23:05:15Z
---

# Review: CHANGES_REQUESTED

## Summary

Feature scope is complete (28/28 acceptance criteria implemented with evidence) and security hygiene is reasonable (localhost origin, strict content-type, ID regex, 50-item cap, execFile migration). However, the PR diff removes shared MergeButton/RecoverButton components added in commit 8b7fc0b4 on main and re-inlines duplicated logic in KanbanBoard.tsx and ActionsSection.tsx — this is a silent regression that must be resolved by rebasing. Additional high-priority items: client/server mismatch on "active agent" predicate (client misses `failed`), permissive GitHub ID regex, origin-only CSRF on a highly destructive endpoint, and O(n) planning-state fetch fan-out in the kanban board. Recommend changes requested: rebase + unify predicate + tighten regex + empty-array guard before merge; treat CSRF/auth layer and bulk planning-state endpoint as follow-up tickets.

## Security Issues

- Origin-only CSRF protection on bulk-close-out endpoint
- Permissive GitHub issue-ID regex allows shell metacharacters
- Missing audit logging and rate limiting on bulk destructive endpoint

## Performance Issues

- N-per-issue planning-state fetch fan-out in KanbanBoard
- Repeated git ls-files subprocesses in cleanPlanningArtifacts

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-569 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

