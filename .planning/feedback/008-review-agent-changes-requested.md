---
specialist: review-agent
issueId: PAN-275
outcome: changes-requested
timestamp: 2026-02-27T08:14:05Z
---

CODE REVIEW BLOCKED for PAN-275:

4 BLOCKING issues (2 crashes, 2 missing tests): (1) CRASH: linear-states.ts:3 imports join from os — join is from path, not os. Will crash at runtime. (2) CRASH: prd-draft.ts:115 uses PRDS_DIR but only imports PRD_DRAFTS_DIR and PRD_PUBLISHED_DIR. ReferenceError at runtime. (3) NO TESTS: prd-draft.ts has 7 exported functions with zero tests. (4) NO TESTS: linear-states.ts has 2 exported commands with zero tests. Also: prd-draft.ts:142 reads entire file for size (use statSync), line 147 returns new Date() instead of real mtime; server/index.ts:7739 tells users to use Complete/Abort Planning endpoints that return 410.

Fix these issues, commit and push, then RESUBMIT for review by running:
curl -X POST http://localhost:3011/api/workspaces/PAN-275/request-review -H "Content-Type: application/json" -d '{}'
Do NOT stop until review passes.
