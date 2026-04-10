---
specialist: review-agent
issueId: PAN-505
outcome: changes-requested
timestamp: 2026-04-10T19:43:24Z
---

CODE REVIEW BLOCKED for PAN-505:

BLOCKING: src/dashboard/server/routes/issues.ts imports sync `sessionExists` (which uses execSync) in a dashboard server route handler. This violates the project rule against blocking calls in server code (PAN-70/PAN-446). An async alternative `sessionExistsAsync` already exists in src/lib/tmux.ts:86 — use that instead.

All other changes look good:
- CI: Drop Node 18, add Bun — correct
- sync.ts: Beads init reorder uses `key` instead of `config.key` — minor improvement
- App.tsx: Agent deep-linking via hash — clean implementation
- AgentOutputPanel: XTerminal with log fallback — well structured
- KanbanBoard: Ready to Merge badge — good UX
- store.ts + tests: Done column always visible — tests updated correctly
- pending-lifecycle.ts: skipDeploy prevents infinite rebuild loop — critical fix
- merge-agent.ts: Abort on conflicts instead of resolving — safer approach
- specialists.ts: Extracted buildTestAgentPromptContent — eliminates empty prompt bug
- workspaces.ts + deacon.ts + test-agent-queue.ts: Queue busy specialists instead of failing — consistent pattern across all call sites
- workspaces.ts: gh pr create without --json --jq, parse URL from last stdout line — fixes compatibility

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/PAN-505/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
