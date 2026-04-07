---
specialist: review-agent
issueId: PAN-513
outcome: changes-requested
timestamp: 2026-04-07T04:37:12Z
---

CODE REVIEW BLOCKED for PAN-513:

BLOCKING ISSUES:

1. [BUG] src/cli/commands/sync.ts:245,250 — listProjects() called TWICE. Line 245 creates `projects`, line 250 creates `registeredProjects`. Both are used later. Wasteful and confusing — should be a single call.

2. [BUG] src/cli/commands/sync.ts:252,264 — `projectKey` destructured but NEVER USED (dead code). The prefix at line 264 was changed from `(config.key || config.name)` to `config.name`, but config.key was always undefined — the actual project key comes from the destructured `key`. The fix should use `projectKey` for the prefix, not `config.name`.

3. [BUG] src/dashboard/frontend/src/components/AgentOutputPanel.tsx:27,79 — `terminalFailed` state is initialized to `false` and NEVER set to `true`. XTerminal at line 79 does not pass `onDisconnect` callback, so the specialist log fallback (line 50) is DEAD CODE that can never execute.

4. [DEAD CODE] src/cli/commands/sync.ts:252 — `projectKey` destructured but unused. Violates no-dead-code requirement.

5. [PLACEHOLDER] src/lib/cloister/specialists.ts:792 — Comment says `PAN-XXX` instead of actual issue number.

6. [MISSING TESTS] No test files for new exported functions:
   - src/lib/env-loader.ts:getMemoryThresholds() — new exported function, no tests
   - src/lib/cloister/specialists.ts:buildTestAgentPromptContent() — new 150-line function, no tests

Fix ALL issues before resubmitting.

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-513/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
