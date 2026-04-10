# PAN-505: Enable branch protection on main after PAN-475 merges

## Status: Implementation Complete

## Current Phase
All beads complete — ready for merge

## Completed Work
- [x] feature-pan-489-axn: Fix CI workflow — switch to Bun, separate typecheck/lint/test jobs (commit: f4d2f0e4)
- [x] feature-pan-489-xqn: Enable GitHub branch protection on main via API (commit: pending)

## Remaining Work
(none)

## Key Decisions
- D1: PAN-475 has already merged (commit 35555d5b), so branch protection can be enabled now
- D2: Root cause of all CI failures: project uses Bun (bun.lock only, no package-lock.json) — `npm ci` rejected by npm. Fix: use `oven-sh/setup-bun@v2` + `bun install`
- D3: CI separated into `typecheck`, `lint`, `test` jobs matching required status check names in branch protection
- D4: Branch protection enabled immediately via GitHub API (runs live on eltmon/panopticon-cli/main)

## Specialist Feedback
- **[2026-04-07T19:04Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/001-review-agent-changes-requested.md`
- **[2026-04-10T19:41Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/002-review-agent-changes-requested.md`
- **[2026-04-10T19:43Z] review-agent → CHANGES-REQUESTED** — `.planning/feedback/003-review-agent-changes-requested.md`
- **[2026-04-10] All blocking issues resolved** — sessionExistsAsync (no execSync in route), onDisconnect wired in AgentOutputPanel, PAN-XXX placeholder removed
