---
specialist: review-agent
issueId: PAN-513
outcome: changes-requested
timestamp: 2026-04-07T04:39:56Z
---

CODE REVIEW BLOCKED for PAN-513:

BLOCKING ISSUES:

1. [CRITICAL - execSync in route handler] src/dashboard/server/routes/issues.ts:964 — sessionExists() from src/lib/tmux.ts uses execSync("tmux has-session ...") which BLOCKS the Node.js event loop. This is called in the postIssueCompletePlanningRoute Effect handler. CLAUDE.md explicitly prohibits execSync in dashboard server routes (PAN-70, PAN-446). Fix: create an async sessionExistsAsync() using execAsync, or inline an async tmux check.

2. [MISSING TESTS] src/lib/cloister/specialists.ts:794 — buildTestAgentPromptContent() is a new 150-line EXPORTED function with no test file. Per mandatory requirements, every new function must have tests.

Prior review issues (1-5) have been FIXED: sync.ts now uses single listProjects() call with projectKey for prefix; AgentOutputPanel wires onDisconnect to set terminalFailed; PAN-XXX placeholder removed; getMemoryThresholds has tests in env-loader.test.ts.

Fix the 2 remaining issues before resubmitting.

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-513/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
