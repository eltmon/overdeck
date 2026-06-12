# Requirements Coverage Review - 2026-06-12T19:17:27Z

## Summary
**Issue:** PAN-1775
**Requirements found:** 5
**In-PR-scope:** 4
**Whole-feature-scope:** 0
**Pre-existing:** 1
**Implemented (in_pr_scope):** 4
**Partial (in_pr_scope):** 0
**Missing (in_pr_scope):** 0
**Overall:** COMPLETE

## Coverage Matrix
| Requirement | Source | Scope | Status | Evidence |
| --- | --- | --- | --- | --- |
| Local work agents retain the established full row baseline: Work/model, live last-heard, active status signal, duration, and terminal access. | AC1: PAN-1765 local agent | pre_existing | Implemented (pre-PR) | Row runtime/last-heard/duration presentation lives in `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx:502`, `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx:543`, `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx:617`, `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.tsx:639`; local terminal path is in `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:316` and `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:426`. |
| A Fly remote work agent with no local tmux session is included in the issue session tree as an active `work` session. | AC2: PAN-1762 remote agent missing row | in_pr_scope | Implemented | `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts:210` reads `remote-state.json`; `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts:221` treats running/starting remote agents as active without local runtime; `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts:238` emits a `work` node with `remote`; regression coverage in `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/tests/unit/dashboard/server/routes/projects.test.ts:229`. |
| The remote session payload is contract-compatible and can be consumed by the frontend. | AC2: PAN-1762 route-to-UI wiring | in_pr_scope | Implemented | Contract adds `SessionNode.remote` at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/packages/contracts/src/types.ts:562`; server fills it at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts:269`; frontend detects it at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:246`. |
| Opening a remote session provides an openable output view instead of trying to attach to a missing local tmux target. | AC2: PAN-1762 remote session row usability | in_pr_scope | Implemented | Remote sessions default to terminal/output view when no JSONL exists at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:248`; local tmux fallback is disabled for remote sessions at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:316`; remote output renders at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:426`; regression coverage in `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.test.tsx:160`. |
| The issue headline is not hijacked by an idle planning `! INPUT` session when an active work agent exists. | AC2: PAN-1762 headline badge hijack | in_pr_scope | Implemented | Aggregate state gives running sessions priority over awaiting-input sessions at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:355`; running work produces the headline summary at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:383`; work badge is emitted before the input badge at `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:424`; regression coverage in `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.test.tsx:357`. |
| Manifest policy guardrails are not contradicted by this PR: no JSONL deletion, no speculative destructive HTTP call, no manual release/versioning, no node_modules symlink workaround. | Policy notes | in_pr_scope | Implemented | Changed source/test files introduce no direct `unlink`/`rm`/release/symlink operations; the only deep-wipe mention remains the existing confirmation-gated UI callback in `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:710`. |

## Findings
None.

## Non-blocking Notes
- ~ **Local row presentation is pre-existing, not part of this diff.** Scope: pre_existing. AC1 is the known-good local-agent baseline used to compare the remote failure. The row implementation lives in `SessionNode.tsx`, which this PR did not change. Existing tests also document that the current design uses icon state rather than a literal `working` pill for work rows (`/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/SessionNode.test.tsx:207`). If the operator intended literal current-tool/status text in the issue tree row itself, that is outside this PR's changed scope.
- ≉ **Unrelated continue-state artifact is included in the diff.** Scope: in_pr_scope. `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/.pan/continue.json:3` records `issueId: "PAN-1788"`, not PAN-1775. It does not affect the remote-session acceptance behavior, but it is unrelated review surface for this PR.

## Clean Requirements Checked
- Remote Fly agents with `remote-state.json` now synthesize active work-session nodes without requiring local tmux.
- The server, contracts package, and SessionPanel are wired together through the new `SessionNode.remote` field.
- Remote session rows are openable through a remote output view rather than a missing local terminal.
- Feature headline activity now prioritizes active work over idle planning input prompts, with regression tests for the PAN-1762 scenario.
- Manifest policy guardrails were checked against the changed files; no in-scope policy contradiction was found.
