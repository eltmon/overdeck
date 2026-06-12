# Correctness Review - 2026-06-12T07:44:46Z

## Summary
Found 0 correctness blockers and 1 non-blocking correctness advisory. The main remote-session synthesis path and the local/remote SessionPanel rendering path look correct for the reviewed acceptance scenario, so the overall correctness verdict is PASS with one follow-up suggested for an alternate terminal-entry path.

## Findings

None.

## Non-blocking Notes

### ~ Remote session context-menu terminal action still targets local tmux — `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx:1235`
**Evidence tier:** Tier 1
**Changed code:** `FeatureItem` passes `onViewTerminal` through to every visible `SessionNode`; the PR now synthesizes remote work sessions with `remote` metadata and no `tmuxSession` in `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts:269`, while `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:427` handles remote output only inside `SessionPanel`'s Terminal tab.
**Problem:** Clicking the remote session row opens the corrected SessionPanel path, but the existing `View Terminal` context-menu path still opens a standalone terminal pane by session id. That standalone terminal pane is local-tmux-only, so remote sessions have a reachable action that points at a non-existent local tmux session.
**Runtime impact:** The primary row-click flow works, but users who choose `View Terminal` from a remote session's context menu can get a dead/missing local terminal instead of the remote output view.
**Fix:** Route `onViewTerminal` for `session.remote` rows to the session-backed pane's Terminal view, teach the standalone terminal pane to render remote output for remote session ids, or hide the `View Terminal` action for remote sessions.

## Clean Areas Checked

- `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts` remote-state synthesis: active remote agents get a work `SessionNode`, active presence, no local `tmuxSession`, and remote metadata.
- `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx` remote rendering: remote sessions without JSONL default to Terminal view and render `/api/agents/:id/output` output instead of `XTerminal`.
- `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx` aggregate activity ordering: active work sessions outrank idle planning input in the row summary.
- `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/packages/contracts/src/types.ts` `SessionNode.remote` schema addition matches the server/frontend data shape.
- Changed tests and `.panopticon/projects.yaml` were reviewed for correctness-sensitive regressions; no blocker found.
