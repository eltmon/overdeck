---
specialist: review-agent
issueId: PAN-444
outcome: changes-requested
timestamp: 2026-04-04T21:16:51Z
---

CODE REVIEW BLOCKED for PAN-444:

REVIEW BLOCKED — 3 issues:

## 1. BLOCKING: .planning/ artifacts committed despite .gitignore

4 files under .planning/ are tracked on the branch:
- .planning/.planning-complete
- .planning/PLANNING_PROMPT.md
- .planning/STATE.md
- .planning/plan.vbrief.json

.planning/ is in .gitignore. Fix: git rm --cached .planning/ and commit.

## 2. BLOCKING: No test files for new code

PAN-444 adds significant new logic:
- scripts/post-merge-deploy.sh (94 lines) — shell script, testing not required
- src/lib/cloister/merge-agent.ts: new step 0 logic (~30 lines) — the deploy spawn, pending file write, repoRoot derivation. Existing merge-agent tests (merge-agent-spawn.test.ts, merge-agent-quality-gates.test.ts) exist but do NOT cover the new step 0 deploy logic.
- src/dashboard/server/main.ts: pending lifecycle hook (~40 lines) — reads/parses pending file, validates staleness, schedules delayed lifecycle call. No tests.

Need at minimum:
- Unit test for the pending file read/parse/stale-check logic in main.ts startup hook
- Unit test for the step 0 repoRoot derivation and pending file write in merge-agent.ts

## 3. NON-BLOCKING: repoRoot derivation is fragile

merge-agent.ts:243-245:
```
const repoRoot = __dirname.includes("/src/")
  ? __dirname.replace(/\/src\/.*$/, "")
  : join(__dirname, "..");
```

This regex-based path extraction from __dirname is brittle — it breaks if the repo is nested inside a path containing /src/ (e.g., /home/user/src/projects/panopticon-cli). Consider using a git-root detection or package.json walk instead. Non-blocking because the current deployment environment is known, but worth noting.

## Code quality notes (non-blocking, passed):
- No execSync/writeFileSync/readFileSync violations in server code (main.ts uses fs/promises correctly)
- existsSync usage is acceptable per CLAUDE.md
- Idempotency design is correct: pending file is unlinked before processing, stale threshold prevents zombie files
- Deploy script uses set -euo pipefail, proper health checks, setsid for backgrounding
- The early return in postMergeLifecycle step 0 is correct — process will be killed, fresh process picks up lifecycle
- postMergeLifecycle signature change (added optional sourceBranch) is backwards-compatible
- notifyTldrDaemon export is correct — needed by main.ts pending hook

Fix items 1 and 2, then resubmit.

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-444/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
