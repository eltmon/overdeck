---
specialist: review-agent
issueId: PAN-539
outcome: changes-requested
timestamp: 2026-04-24T22:51:29Z
---

# Review: CHANGES_REQUESTED

## Summary

PAN-539 adds image paste/drop to the conversation composer with strong security hygiene (magic-byte validation, path containment, async FS throughout). One blocker must be fixed: the upload rate-limit Map grows unboundedly under distinct-IP traffic, creating a heap leak and O(n) scan on every upload. Seven high-priority issues should also be addressed before merge: two frontend races (removedImageIdsRef cleared on submit; upload queue not drained on conversation switch), a JSONL reader that stalls permanently on lines >15 MB, a missing length cap on PATCH title, unvalidated readdir entries in the specialist session path, a missing spinner animation (spec says spinner, code shows text), and a duplicate vi.mock in a test file. Twelve advisory nits are safe to defer.

## Security Issues

- Unbounded rate-limit Map memory leak/DoS
- PATCH title no length cap
- readdir directory entries unvalidated for path traversal

## Performance Issues

- Unbounded rate-limit Map O(n) scan
- JSONL oversized-line infinite stall
- Unbounded Promise.all on file deletes
- Full session file re-read on cleanup

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-539 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

