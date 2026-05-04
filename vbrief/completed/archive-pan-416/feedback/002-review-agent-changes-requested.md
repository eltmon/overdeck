---
specialist: review-agent
issueId: PAN-416
outcome: changes-requested
timestamp: 2026-04-04T21:20:02Z
---

CODE REVIEW BLOCKED for PAN-416:

REVIEW BLOCKED — 3 issues (1 critical, 2 hygiene):

## 1. CRITICAL: Schema migration conflict — conversations table will never be created on existing DBs

Main already has SCHEMA_VERSION=5 (PAN-437 projection_cache). PAN-416 also uses v4→v5 for the conversations table. On any existing database, user_version is already 5, so the migration `if (currentVersion < 5)` will be skipped — the conversations table is never created.

Fix: Bump SCHEMA_VERSION to 6 and change the migration guard to `if (currentVersion < 6)`. Also add the projection_cache table to initSchema() since PAN-437 already merged it to main.

Affected files:
- schema.ts:11 — change SCHEMA_VERSION from 5 to 6
- schema.ts:258 — change migration guard from `currentVersion < 5` to `currentVersion < 6`
- schema.ts initSchema() — add projection_cache CREATE TABLE (already on main, needs to be in the full schema definition)

## 2. Branch hygiene: .planning/plan.vbrief.json

.planning/ is in .gitignore but plan.vbrief.json is tracked on the branch. Should be removed: git rm --cached .planning/plan.vbrief.json

## 3. Branch hygiene: scripts/record-cost-event.js.map

Unrelated build artifact change (sourcemap). Should not be on this feature branch.

## What PASSED:
- writeFileSync/mkdirSync → async fs/promises (previous blocking issue FIXED)
- triage-agent.md and other .planning/ artifacts removed (previous blocking issues FIXED)
- Test files added for all 3 new modules:
  - conversations-db.test.ts (114 lines, 9 tests) — CRUD, uniqueness constraint
  - conversations.test.ts (108 lines, 6 tests) — sanitize, name gen, DB integration
  - conversation-lifecycle.test.ts (96 lines, 6 tests) — poll logic with injectable session checker
- No execSync violations in server code
- Lifecycle service properly testable via dependency injection (sessionChecker param)
- Schema migration is idempotent (CREATE TABLE IF NOT EXISTS)
- Frontend components well-structured with React Query
- Proper graceful shutdown cleanup in main.ts

Fix the schema version conflict (critical) and branch hygiene, then resubmit.

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-416/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
