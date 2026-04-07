# PAN-467: Copy live Panopticon config into workspaces for UAT testing

## Status: Implementation Complete

## Current Phase
All work complete — commit, push, and signal done.

## Completed Work
- [x] feature-pan-489-0ei: Implement full feature — copy-live-config utility, CLI command, plan dialog checkbox, spawn-planning integration (commit: pending)

## Remaining Work
None

## Key Decisions
- D1: Config files are copied to workspace `.panopticon/` (not `.pan/`) since that is what the dashboard server reads from `~/`.
- D2: `.git/info/exclude` handles worktrees by detecting the `gitdir:` file and writing to the worktree-specific exclude path.
- D3: Docker compose injection uses a marker comment to detect already-patched files and only patches services that already have a `volumes:` block.
- D4: Config copy in `spawnPlanningSession` is non-fatal (warns on error, doesn't abort) so a missing config file never blocks planning.

## Specialist Feedback
- **[2026-04-07T06:02Z] review-agent → CHANGES-REQUESTED** — addressed: sessionExists→async, duplicate listProjects, unused projectKey, PAN-XXX placeholder, added tests for copy-live-config and buildTestAgentPromptContent
- **[2026-04-07T06:13Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/010-review-agent-changes-requested.md`
