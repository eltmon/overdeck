---
specialist: review-agent
issueId: PAN-539
outcome: changes-requested
timestamp: 2026-04-22T19:55:04Z
---

# Review: CHANGES_REQUESTED

## Summary

No blockers or critical issues. Four high-priority items to address before merge: (1) cap upload body size before base64 decode to prevent memory DoS on the dashboard server; (2) tighten `@`-attachment regex and reject messages containing tokens that resolve outside the managed root, preventing prompt-injection smuggling into the agent's tmux pane; (3) fix a paste-during-send race in `ComposerFooter` that orphans blob URLs and server files; (4) split conflated decode/size error messages. Requirements coverage is effectively 100% — one vBRIEF AC text diverges from the (superior) implemented cleanup design and should be reconciled. Positive: defensive upload handling (UUID filenames, MIME allowlist, path containment) and reference-aware cleanup are well-constructed.

## Security Issues

- Unbounded upload body enables memory-pressure DoS
- @-attachment regex permits token smuggling into agent pane

## Performance Issues

- Full JSONL scan on every conv-find summary request
- JSON output eagerly computes expensive session summary

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-539 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

