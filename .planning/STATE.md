# PAN-467: Copy live Panopticon config into workspaces for UAT testing

## Status: Implementation Complete

## Current Phase
All work complete — rebased onto main, pushed, resubmitting for review.

## Completed Work
- [x] feature-pan-489-0ei: Implement full feature — copy-live-config utility, CLI command, plan dialog checkbox, spawn-planning integration (commit: 31c07287)

## Remaining Work
None

## Key Decisions
- D1: Config files are copied to workspace `.panopticon/` (not `.pan/`) since that is what the dashboard server reads from `~/`.
- D2: `.git/info/exclude` handles worktrees by detecting the `gitdir:` file and writing to the worktree-specific exclude path.
- D3: Docker compose injection uses a marker comment to detect already-patched files and only patches services that already have a `volumes:` block.
- D4: Config copy in `spawnPlanningSession` is non-fatal (warns on error, doesn't abort) so a missing config file never blocks planning.

## Specialist Feedback
- **[2026-04-07T06:02Z] review-agent → CHANGES-REQUESTED** — addressed: sessionExists→async, duplicate listProjects, unused projectKey, PAN-XXX placeholder, added tests for copy-live-config and buildTestAgentPromptContent
- **[2026-04-07T06:13Z] review-agent → CHANGES-REQUESTED** — addressed: wired onDisconnect→setTerminalFailed(true) in AgentOutputPanel, removed unused readdirSync import
- **[2026-04-07T~20:55Z] merge → REBASE-CONFLICT** — rebased onto origin/main (PAN-442), resolved conflicts in KanbanBoard.tsx, AgentOutputPanel.tsx, PlanDialog.tsx, issues.ts, spawn-planning-session.ts, sync.ts; force-pushed
