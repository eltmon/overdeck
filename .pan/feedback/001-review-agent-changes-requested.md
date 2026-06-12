# Review CHANGES REQUESTED for PAN-1775

# Review Synthesis — PAN-1775 — 2026-06-12T19:21:29Z

## Verdict: CHANGES REQUESTED — tracked workspace `.pan/continue.json` contains unrelated PAN-1788 state

## Context
- Manifest: /home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/.pan/review/agent-pan-1775-review-b1aa3a01/context.json
- Branch: feature/pan-1775 (manifest listed feature/1775)
- Workspace: /home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775
- HEAD reviewed: b1aa3a01325097cebb3dd3461ea908ca13000ce2
- Cycle number: 3
- Prior cycle SHA: 8e2ad5950a89ee5036656d9bd8c7aec41fd49d1d
- PR merge-base: 2148beaf7b0ba05faa68ebf23b5e248d4007211b
- PR commit count: 5

## Convoy Status
| Sub-role | Signal | Output | Blocking findings |
| --- | --- | --- | --- |
| security | ready | /home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/.pan/review/agent-pan-1775-review-b1aa3a01/security.md | 0 |
| correctness | ready | /home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/.pan/review/agent-pan-1775-review-b1aa3a01/correctness.md | 1 |
| performance | ready | /home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/.pan/review/agent-pan-1775-review-b1aa3a01/performance.md | 0 |
| requirements | ready | /home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/.pan/review/agent-pan-1775-review-b1aa3a01/requirements.md | 0 |

## Blocking Findings

### [correctness] Tracked workspace continue state carries unrelated PAN-1788 state — `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/.pan/continue.json:3`
The branch tracks `.pan/continue.json`, and the file currently declares `"issueId": "PAN-1788"` with `"branch": "feature/pan-1788"` in a PAN-1775 review workspace. The file is in both the PR diff and the cycle diff (`8e2ad5950a89ee5036656d9bd8c7aec41fd49d1d..HEAD`), so it survives the mandatory PR-scope and convergence gates.

This violates the repository lifecycle invariant that workspace-local `.pan/continue.json` is mutable runtime state and must not be committed to main; canonical committed continue artifacts live under `.pan/continues/`. If merged, future checkouts/worktrees would inherit stale PAN-1788 planning decisions, hazards, and status overrides, which can cause agents or code reading the workspace continue file to resume against the wrong issue context.

Required fix: remove `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/.pan/continue.json` from the branch/tracking and verify `git ls-files -- .pan/continue.json` returns nothing.

## Non-blocking Findings

### [correctness] [demoted: previously reviewed] Remote-only Fly agents are still excluded from the session tree — `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts:501`
The correctness reviewer found that `fetchProjectSessionTree()` still seeds feature candidates only from local `workspaces/feature-*` directories before calling `collectSessionTreeNodes()`, so an active remote/Fly agent with `remote-state.json` but no local workspace can still fail to produce a session-tree row. This is in the PR diff, but cycle 3 applies the convergence gate: `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/server/routes/projects.ts` did not change since the prior approved synthesis SHA `8e2ad5950a89ee5036656d9bd8c7aec41fd49d1d`, while `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/.pan/continue.json` did. Per `roles/review.md`, a finding on code already seen in prior cycles is not promotable to a blocker in this cycle, so this remains surfaced as a non-blocking demotion rather than a blocking verdict item.

### [performance] Remote terminal output polls Fly exec on a fixed 5s cadence — `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/src/dashboard/frontend/src/components/CommandDeck/SessionView/SessionPanel.tsx:216`
`RemoteSessionOutput` polls `GET /api/agents/:id/output?lines=200` every 5 seconds while a remote terminal view is open. The endpoint can resolve output through Fly remote execution to capture tmux output. The performance reviewer classified this as acceptable at current scale and non-blocking because it is bounded to selected/open remote panels; suggested follow-up is server-side streaming/caching or visibility/backoff gating before remote terminal usage broadens.

### [requirements] Unrelated continue-state artifact is included in the diff — `/home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/.pan/continue.json:3`
The requirements reviewer also noted the unrelated continue-state artifact as `≉`: it does not affect the remote-session acceptance behavior directly, but it is unrelated review surface for this PR. The correctness finding above is the blocking form because it violates the repo lifecycle artifact invariant.

### [requirements] Local row presentation is pre-existing, not part of this diff
The requirements reviewer classified the PAN-1765 local-agent row as a pre-existing baseline rather than new PR scope. The PR-specific acceptance checks for remote session payload wiring, openable remote output view, and headline aggregation were marked implemented by the requirements reviewer.

## Clean Sub-roles
- security

Source: /home/eltmon/Projects/panopticon-cli/workspaces/feature-pan-1775/.pan/review/agent-pan-1775-review-b1aa3a01/synthesis.md

## Required action

Fix every blocking review finding, commit the fixes, then re-request review with:

`pan review request PAN-1775 -m "Fixed review issues"`