---
specialist: review-agent
issueId: PAN-540
outcome: changes-requested
timestamp: 2026-04-18T16:07:54Z
---

CODE REVIEW BLOCKED for PAN-540:

Blocking issues found: (1) src/lib/cloister/review-agent.ts:425-462 spawns plain Claude tmux sessions and waits for session exit, but the reviewer/synthesis prompts only instruct writing an output file and do not instruct the Claude CLI to exit. These sessions can stay open indefinitely, causing waitForReviewer() to time out and fail every review after 20 minutes. (2) src/dashboard/server/routes/workspaces.ts:2540-2574 still uses wakeSpecialistOrQueue in the passed-state rerun path, while the new implementation moved review dispatch to dispatchParallelReview elsewhere (e.g. 2768-2807). This leaves one request-review entrypoint on the old specialist pipeline, so reruns after passed state can bypass the new parallel review flow and its review:* routing/config behavior.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-540 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
