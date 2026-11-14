plan-digest: fc39ce655a8e3ba9dc9548a75291053857f11367214d9e351e9759ec00179c3d

## blocks-the-design: A merged artifact cannot prove review or tests

The PRD, lines 74–80 and decision D-6, makes both rows pass solely because one required repository has a merged PR/MR. The current row definitions explicitly require a passed review and passed tests ([dod.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5209/src/lib/lifecycle/dod.ts), lines 22–35), and [dod-gate.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5209/src/lib/lifecycle/dod-gate.ts), lines 427–445, reads the PR review decision and check results separately. A merged MR can have no approvals or failing checks, so this plan records both as `pass` without observing either fact. Smallest resolution: obtain per-artifact review and test verdicts, or keep the rows as `miss`/existing settlement until the operator explicitly changes their expected meaning. Add tests for merged artifacts with absent or negative review/check verdicts.

## blocks-the-design: Missing fallback target can pass row 4

The PRD's `resolveTargetComparison` (lines 125–134) returns the bare local target whenever fetch fails, without checking that the local ref exists. The existing verifier's three-dot diff command suppresses git errors with `2>/dev/null || true`, then treats empty output as success ([workflows.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5209/src/lib/lifecycle/workflows.ts), lines 700–711). Thus a checkout with a feature branch, no local `main`, and a failed target fetch can report “Code changes squash-merged to main” even though it has no comparison ref. Smallest resolution: verify that the fallback target resolves to a commit; otherwise fail the merged step with the fetch reason. Test this case with real git.

## blocks-the-design: Source fetch failures become no branch work

FR-6 step 2 (PRD line 76) ignores every source fetch failure and then trusts cached `origin/<source>` or a missing ref. FR-9 (line 82) says failed git reads must be `unverifiable`, and the existing gate treats failed forge reads as misses ([dod-gate.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5209/src/lib/lifecycle/dod-gate.ts), lines 405–416). If the source fetch fails because of auth or network and no local source ref exists, the proposed code returns `no-branch-work`; another repository's merged artifact can then make both rows pass on incomplete evidence. Smallest resolution: distinguish a verified absent source branch from a fetch error; return `unverifiable` for the latter, and do not use a cached remote-tracking ref after an unsuccessful refresh. Add a fetch-error test with another repo marked merged.

## blocks-the-design: Empty delta passes the GitLab state-plane rule

WI-4 (PRD lines 181–186) extracts the GitHub post-merge delta logic verbatim for GitLab. In the existing logic, the three-dot fallback sets `statePlaneOnly = deltaFiles.every(...)` without requiring any files ([workflows.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5209/src/lib/lifecycle/workflows.ts), lines 967–979). For two unmerged post-MR commits that change and then restore a file, both diffs can be empty; `[].every()` is true, so the new GitLab path accepts them as “state-plane commits (0 file(s): .pan)” although FR-5 says post-MR commits outside the target must fail unless the branch-unique delta touches only `.pan/`. Smallest resolution: require at least one `.pan/` file in the three-dot fallback, then exercise a real or explicitly mocked empty-delta case.

## footnote: Extraction range omits the closing brace

The PRD and xBRIEF say to move [workflows.ts](/home/eltmon/Projects/overdeck/workspaces/feature-pan-5209/src/lib/lifecycle/workflows.ts), lines 595–990, verbatim. I checked those lines: line 990 closes the `catch`, and line 991 closes `verifySquashMergedPrByBranch`. Change the range to 595–991.
