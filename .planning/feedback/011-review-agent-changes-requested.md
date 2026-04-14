---
specialist: review-agent
issueId: PAN-705
outcome: changes-requested
timestamp: 2026-04-14T18:49:48Z
---

CODE REVIEW BLOCKED for PAN-705:

Three stale API route references in changed skill files that will break after merge (routes were renamed in this PR). Plus one stray semicolon.

1. skills/pan-oversee/SKILL.md — 9 occurrences of the old API routes (file IS in the diff):
   - Lines 92, 207, 238, 270, 289, 308: api/workspaces/$ISSUE_ID/review-status → /api/review/$ISSUE_ID/status
   - Lines 223, 258: api/workspaces/PAN-{ID}/review → /api/review/PAN-{ID}/trigger
   - Lines 359-362: API reference table entirely stale (approve, request-review, review-status routes all wrong)

2. skills/pan-sync-main/SKILL.md:27 — (file IS in the diff):
   - curl -X POST .../api/workspaces/PAN-XXX/sync-main → must be /api/issues/PAN-XXX/sync-main

3. .claude/skills/pan-tts/SKILL.md:117 — (file IS in the diff):
   - pan work issue PAN-XXX → must be pan start PAN-XXX

4. src/dashboard/server/routes/show.ts:21 — stray semicolon on its own line after the last import block (cosmetic but dead code)

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-705 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
