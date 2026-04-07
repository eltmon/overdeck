# PAN-505: Enable branch protection on main after PAN-475 merges

## Status: In Progress

## Current Phase
Committing bead feature-pan-489-axn: CI workflow updated — awaiting inspection, then moving to branch protection

## Completed Work
- [x] feature-pan-489-axn: Fix CI workflow — switch to Bun, separate typecheck/lint/test jobs (commit: pending)

## Remaining Work
- [ ] feature-pan-489-xqn: Enable GitHub branch protection on main via API

## Key Decisions
- D1: PAN-475 has already merged (commit 35555d5b), so branch protection can be enabled now
- D2: Current CI has `build` and `lint` jobs; issue spec requires `typecheck`, `lint`, `test` — updating CI to match spec
- D3: Branch protection enabled via GitHub API (not UI) for repeatability/documentation

## Specialist Feedback
(none yet)
