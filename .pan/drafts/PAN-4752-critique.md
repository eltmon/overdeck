plan-digest: 4d9d85c8ed926132ec7118f901bafbef94e229239b3d0289dab5c2c30d7804bb

## blocks-the-design: A prior merged strike can hide a new strike

The PRD's W3 uses `forgeReader(projectPath)('', projectPath, branch)`. Both readers take the first matching row from an all-state listing: `readPrWithGh` uses `rows.find` in `src/lib/overdeck/derived-issue-state.ts`, lines 390-391 and 441-444; `readMrWithGlab` does the same at lines 496-512. `pan strike` assigns the same `strike/<id>` branch on every run (`src/cli/commands/strike.ts`, lines 117-132), and its worktree setup explicitly allows a prior branch to exist (lines 207-223). A new strike workspace can therefore be present while the cached listing still contains an older merged PR for that head. W3 would treat that PR as the current strike's merge and remove the live row, even before the new strike opens its PR. If several PRs share the head, `rows.find` can also select a merged or closed PR ahead of an open one. The repository already has a branch-PR selector that ranks open above merged and closed (`src/lib/github-pr-selection.ts`, lines 1-36), and the loaded GitHub row includes `headRefOid` (`src/lib/overdeck/derived-issue-state.ts`, lines 331-350).

Revise W3 to select the active PR for a reused head and require evidence that a merged PR belongs to the current strike workspace before it drops the row. Add tests for a new strike workspace with only an older merged PR, and for multiple PRs on one strike head with an open PR present.

## sharpens-framing: “Never ready” conflicts with feature-PR precedence

D6 and W3 say `derived.pr` wins and `readStrikePr` is skipped when the base feature PR exists. The proposed W3 state expression then returns `derived.state`, which can be `ready`: `deriveState` returns it for an approved feature PR with green checks and a mergeable head (`src/lib/overdeck/derived-issue-state.ts`, lines 160-178). Thus a row marked `strike: true` can show `ready` when both workspaces exist. D7 and W6 instead say a strike row never derives `ready`.

Limit that promise in D7, W6, and the documentation to **state derived from a strike PR**; keep the stated feature-PR precedence.

## sharpens-framing: The last-tick pick can still show a strike ID

D2 says no `-STRIKE` ID can reach the board from either source, but W2 normalizes only candidate IDs. The deriver returns the original `lastTick` (`src/lib/flywheel/derive-status.ts`, lines 255-256 and 344-351), and the page and CLI display `lastTick.pick` directly (`src/dashboard/frontend/src/components/flywheel/FlywheelStatusPane.tsx`, line 113; `src/cli/commands/flywheel.ts`, line 161). A tick with `pick=PAN-8-STRIKE` will still display that ID even though its in-flight row folds to `PAN-8`.

State explicitly that the guarantee applies to in-flight row IDs, as FR-1 does, or also normalize the displayed tick pick and test that case.
