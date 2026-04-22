---
specialist: review-agent
issueId: PAN-569
outcome: changes-requested
timestamp: 2026-04-22T22:53:18Z
---

# Review: CHANGES_REQUESTED

## Summary

All 27 vBRIEF acceptance criteria are implemented and the `exec`→`execFile` hardening in `clean-planning.ts` is a real security improvement. However, two critical issues should block merge: (1) a client-side bug in `KanbanBoard.tsx:1045-1065` that overwrites pre-marked `skipped` results with `failed: "Missing from server response"` whenever users proceed past the active-agent warning, and (2) a spoofable `Host`-header fallback in the new bulk-close-out route's origin check that weakens CSRF protection on a destructive endpoint. Additional high-priority correctness issues in `issues.ts` (tmux session name built from un-normalized GitHub IDs; dead `split('-')[0]` prefix fallback) and in `KanbanBoard.tsx` (non-null assertions on optional bulk props) should land together. Performance concerns (O(N×M) agent scans in the warning dialog; per-card planning-state polling) are non-blocking. Recommend changes before merge.

## Security Issues

- Host-header fallback enables CSRF on bulk-close-out endpoint
- Content-Type substring match permits pathological values

## Performance Issues

- O(selectedIssues × agents) scans in BulkAgentWarningDialog
- Per-card planning-state polling fan-out
- Nested selectedIssues×issuesWithAgents membership check

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-569 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

