# Requirements Coverage Review - 2026-06-12T07:44:26.200Z

## Summary
**Issue:** PAN-1775
**Requirements found:** 2
**In-PR-scope:** 1
**Whole-feature-scope:** 0
**Pre-existing:** 1
**Implemented (in_pr_scope):** 1
**Partial (in_pr_scope):** 0
**Missing (in_pr_scope):** 0
**Overall:** COMPLETE

## Coverage Matrix
| Requirement | Source | Scope | Status | Evidence |
| --- | --- | --- | --- | --- |
| Local agents keep the full session-row baseline: Work + model, live last-heard/current-tool signal, duration, and openable terminal. | AC-1 (PAN-1765 local agent baseline) | pre_existing | Implemented (pre-PR baseline preserved) | Local session nodes still receive `tmuxSession`, `model`, `status`, `presence`, and `duration` from `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts:238`; the existing row renderer shows label/model, live last-heard, current-tool phase icon/title, duration, and View Terminal from `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx:608`, `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx:617`, `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx:395`, `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx:639`, and `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx:703`. |
| Remote Fly work agents with no local tmux session appear as active work sessions, and active work outranks an idle planning input prompt in the issue headline. | AC-2 (PAN-1762 remote agent) | in_pr_scope | Implemented | The session-tree route now reads `remote-state.json`, treats `location: remote` plus `running`/`starting` as active, skips local tmux runtime lookup for active remote agents, emits a `type: 'work'` node with `presence: 'active'`, and marks `remote: { provider: 'fly.io', vmName }` at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts:210`, `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts:221`, `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts:225`, and `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts:238`. The headline summary gives running work precedence over input/idle states at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:355`, `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:367`, and `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:424`. Regression coverage exists at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/tests/unit/dashboard/server/routes/projects.test.ts:229` and `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.test.tsx:357`. |

## Findings
None.

## Non-blocking Notes
- ≉ **Unscoped verification-gate behavior change** — scope: in_pr_scope. The manifest requirements are about Command Deck session visibility for local vs. remote agents, but the diff also changes the Panopticon project `quality_gates.test` command to `vitest --changed {{CHANGED_BASE}}` for root and frontend tests at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/.panopticon/projects.yaml:81`. That is pipeline-visible behavior outside the stated acceptance criteria. It is not a requirements blocker for PAN-1775 because the in-scope remote-session requirements are covered, but it should be intentional and separately justified if retained.

## Clean Requirements Checked
- Remote Fly agents with only `remote-state.json` are synthesized into the session tree as active work sessions instead of disappearing.
- Remote session rows carry a remote marker and can open a Terminal tab backed by `/api/agents/:id/output` through `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:216` and `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:426`.
- Active work sessions outrank idle planning input in the feature headline summary and badge ordering, covered by `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.test.tsx:357`.
- Local-agent session row wiring remains present and is not contradicted by the PR.
