---
specialist: review-agent
issueId: PAN-540
outcome: changes-requested
timestamp: 2026-04-18T14:52:39Z
---

CODE REVIEW BLOCKED for PAN-540:

1. src/lib/cloister/deacon.ts:1215-1275 and src/lib/cloister/service.ts:314-335 still detect active reviews only through legacy review-agent specialist runtime/session tracking. The new parallel review flow in src/lib/cloister/review-agent.ts spawns ad-hoc tmux sessions (review-<issue>-<ts>-<role>) but never registers runtime state/currentIssue, so active reviews can be misdetected as orphaned and reset/re-dispatched while reviewers are still running. 2. src/lib/settings-api.ts:187-197 still hard-codes anthropic: true in loadSettingsApi(), but getMiniMaxDefaultsApi() now returns anthropic: false. That means the new MiniMax-only preset cannot round-trip through save/load and the UI/API will report Anthropic enabled after reload. 3. Missing regression coverage for the new orchestration bug above: tests/lib/cloister/review-agent.test.ts only covers pure helpers/dispatch status mapping and does not cover active-review tracking/orphan recovery for the new ad-hoc reviewer sessions, so this production failure mode is untested.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-540 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
