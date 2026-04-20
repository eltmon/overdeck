---
specialist: review-agent
issueId: PAN-714
outcome: changes-requested
timestamp: 2026-04-18T16:08:05Z
---

CODE REVIEW BLOCKED for PAN-714:

1. src/lib/work/done-preflight.ts:23-26 regresses the missing-beads-CLI path. This helper now treats only ENOENT as skippable, but child_process.exec runs through a shell, so a missing `bd` typically surfaces as exit 127/stderr from the shell, not ENOENT. Result: `pan done` starts failing with `Open beads check failed` on systems where the beads CLI is unavailable, whereas the previous behavior correctly skipped this check. The new tests only mock an ENOENT callback shape and do not cover real exec semantics. 2. src/lib/cloister/deacon.ts:1702-1753 claims to auto-retry transient CI merge failures, but after PAN-354 the MERGE button is the sole merge trigger. This branch only flips review status back to `mergeStatus: pending` and `readyForMerge: true`; it does not enqueue or trigger a merge attempt. In practice the issue just returns to awaiting-merge state and no retry happens until a human clicks MERGE again, so the new CI retry state machine does not implement the behavior it documents. The added tests assert only status mutations, not an actual re-entry into the merge flow.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-714 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
