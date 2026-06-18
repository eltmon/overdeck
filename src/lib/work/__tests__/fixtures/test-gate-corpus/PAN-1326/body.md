## Summary

PR #1317 (PAN-1316 fix, commit \`89cef0f1\`) wired \`stopWorkspaceDocker(state.workspace, state.issueId.toLowerCase())\` into the dashboard \`/api/agents/:id/stop\` endpoint and the \`pan kill\` CLI. The fix is correct for **work** agents — they own the workspace, so their \`state.workspace\` field points at the right path.

But for **specialist** agents (review/test/ship), \`state.workspace\` either points at the orchestrator's workspace (the agent that spawned the specialist), or is absent. Killing a specialist via \`pan kill agent-pan-1052-ship\` therefore does **not** tear down the \`feature-pan-1052\` workspace docker stack.

## Observed

After this session:
- Killed 6 ship/test specialist agents via \`pan kill\` (PAN-1052, PAN-1228, PAN-1229, PAN-1231, PAN-1235, PAN-1249).
- \`docker ps\` still showed \`overdeck-feature-pan-1052-{frontend,dev}-1\` and \`overdeck-feature-pan-1190-{frontend,dev}-1\` up.
- I manually cleaned them with \`docker compose -p overdeck-feature-XXXX down\`.

## Root cause

In \`src/dashboard/server/routes/agents.ts:1075\` and \`src/cli/commands/kill.ts\`:

\`\`\`ts
if (stateBeforeStop?.workspace && stateBeforeStop?.issueId) {
  await stopWorkspaceDocker(stateBeforeStop.workspace, stateBeforeStop.issueId.toLowerCase());
}
\`\`\`

This uses the **specialist's own state**. Should instead resolve the workspace from the issue: \`findWorkspacePath(projectPath, issueLower)\` — the pattern \`postMergeLifecycle\` already uses in \`merge-agent.ts\`.

## Proposed fix

Replace the direct \`state.workspace\` read with the issue-keyed resolver, mirroring \`postMergeLifecycle\`:

\`\`\`ts
const issueLower = stateBeforeStop?.issueId?.toLowerCase();
if (issueLower) {
  const project = resolveProjectFromIssue(stateBeforeStop.issueId);
  const projectPath = project?.projectPath ?? process.cwd();
  const workspacePath = findWorkspacePath(projectPath, issueLower);
  if (workspacePath) {
    await stopWorkspaceDocker(workspacePath, issueLower);
  }
}
\`\`\`

This way killing a specialist tears down the **workspace** stack the specialist was operating against, not the (possibly empty) workspace field on the specialist's own state.

## Test plan

- [ ] Unit test: \`pan kill agent-PAN-XXXX-ship\` with a running workspace stack → stack torn down
- [ ] Unit test: \`pan kill agent-PAN-XXXX\` (work agent) → stack torn down (regression)
- [ ] Manual: kill a ship specialist via dashboard, confirm \`docker ps\` no longer shows that issue's stack

## Related

- Fix: #1317 (commit \`89cef0f1\`)
- Original: #1316

--- comment ---
Reopening because the implementation path is present but the issue test plan remains unproven. Both CLI and dashboard now resolve the workspace by issue before `stopWorkspaceDocker`, but I could not find tests for `pan kill agent-PAN-XXXX-ship` tearing down the issue workspace stack, the work-agent regression case, or the manual dashboard-stop confirmation. Remaining work: add the specialist/work kill regression tests and record the dashboard stop verification.

--- comment ---
🤖 **Agent completed work:**

Implemented all PAN-1326 verification beads: added killCommand docker teardown regression tests, extended dashboard stop route docker teardown tests, added docs/manual-tests/PAN-1326.md manual dashboard verification recipe, fixed stale flywheel test expectations exposed by full-suite gates. Verification: npm run typecheck, npm run lint, npm test all pass. Manual doc path for PR: docs/manual-tests/PAN-1326.md.

--- comment ---
Closed via close-out ceremony
