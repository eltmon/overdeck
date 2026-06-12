# Correctness Review - 2026-06-12T19:18:51Z

## Summary
Two correctness blockers found. The remote-agent session synthesis only runs for issues that already have a local `workspaces/feature-*` directory, so fresh/overflow Fly agents still produce no session row in the Command Deck. The PR also changes and tracks a workspace-local `.pan/continue.json` for the unrelated PAN-1788 workspace, which violates the repo's own lifecycle-artifact invariant and would leak stale resume state into future checkouts. No non-blocking correctness notes.

## Findings

### ! Remote-only Fly agents are still excluded from the session tree — `src/dashboard/server/routes/projects.ts:501`
**Evidence tier:** Tier 1
**Changed code:** `fetchProjectSessionTree()` builds `featureCandidates` exclusively from `readdir(workspacesDir)` entries whose names start with `feature-`, and only calls `collectSessionTreeNodes()` inside that local-workspace loop (`src/dashboard/server/routes/projects.ts:501`-`src/dashboard/server/routes/projects.ts:523`). The new remote-state handling is inside `collectSessionTreeNodes()` (`src/dashboard/server/routes/projects.ts:210`-`src/dashboard/server/routes/projects.ts:270`).
**Problem:** The remote session synthesis is unreachable for a fresh remote/overflow issue that has `~/.panopticon/agents/agent-<issue>/remote-state.json` but no local `workspaces/feature-<issue>` directory. That is a normal remote path: remote workspace metadata is stored under `~/.panopticon/workspaces`, and the remote code runs in `/workspace`, not in a local project worktree.
**Runtime impact:** `/api/session-trees` returns no feature/session entry for remote-only active work agents. The frontend can show the resource-allocated issue from resource discovery, but `projectsWithSessions` has no session data to merge, so the issue row has no openable work session and the acceptance case for PAN-1762 remains broken on the main remote path.
**Fix:** Seed session-tree feature candidates from active remote agent state as well as local workspace directories. For example, add `listActiveRemoteAgentStates()` results whose issue belongs to the requested project to the candidate set, compute a synthetic workspace path for title/JSONL fallback, and call `collectSessionTreeNodes()` for those issues even when `workspaces/feature-<issue>` is absent. Add a test where `readdir(workspacesDir)` does not include `feature-pan-1762` but `remote-state.json` exists.

### ! Tracked `.pan/continue.json` carries unrelated PAN-1788 workspace state — `.pan/continue.json:3`
**Evidence tier:** Tier 2
**Changed code:** `.pan/continue.json` now declares `"issueId": "PAN-1788"` and `"branch": "feature/pan-1788"` (`.pan/continue.json:3`-`.pan/continue.json:8`) in a PAN-1775 review branch. The repo explicitly marks workspace working copies as excluded because they “must never reach main” (`.gitignore:54`-`.gitignore:60`), and `git ls-files --stage -- .pan/continue.json` shows this file is tracked.
**Problem:** This is workspace-local mutable state for a different issue, not a PAN-1775 source or lifecycle artifact. Keeping it in the PR breaks the PAN-1124 four-artifact model: `.pan/continue.json` is supposed to be per-workspace runtime state, while committed canonical continue files live under `.pan/continues/`.
**Runtime impact:** If merged, every new checkout/worktree inherits a stale PAN-1788 continue file with PAN-1788 decisions, hazards, and status overrides. Any code or agent prompt that reads workspace `.pan/continue.json` from the repo root/worktree can resume against the wrong issue context or trip the existing “planning artifacts are for PAN-XXXX” guard described by the ignore comment.
**Fix:** Remove `.pan/continue.json` from the branch and from tracking, keep only the appropriate committed lifecycle artifacts under `.pan/continues/`/`.pan/specs/`/`.pan/drafts/`, and verify `git ls-files -- .pan/continue.json` returns nothing.

## Non-blocking Notes
None

## Clean Areas Checked
- `packages/contracts/src/types.ts` remote `SessionNode.remote` schema addition is type-compatible with the frontend reads.
- `src/dashboard/frontend/src/components/CommandDeck/ProjectTree/FeatureItem.tsx` aggregate summary/badge changes correctly let active work outrank idle planning input once a work session is present.
- `src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx` remote output tab avoids local tmux attachment for `session.remote` sessions.
- Changed frontend tests cover the new aggregate badge and remote-output rendering happy paths, but they do not cover the remote-without-local-workspace server case above.
