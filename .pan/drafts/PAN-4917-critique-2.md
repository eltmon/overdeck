plan-digest: d6b58fe8fd370234ecc44c90eab019dd2bbb05accbc8bb1edd45458b756225bc

## sharpens-framing: Test the pull request merge checkout

The PRD says `pull_request` checks out a merge commit at `refs/pull/<n>/merge` (D3), but WI-1's shallow-clone loop tests only ordinary branch tips (`.pan/drafts/PAN-4917.md`, lines 171-186). WI-2's live CI check expects the “no ... changes; ok” path (line 234), so it cannot show that a prompt change on a shallow PR merge checkout is correctly rejected or accepted. The existing script derives the changed files and trailer range from `git merge-base "$BASE_REF" HEAD` (`scripts/check-prompt-change-trailer.sh`, lines 19-24 and 50-70), making that checkout shape relevant. The `no-trailer` loop case also accepts any nonzero exit, without checking the required `prompt-trailer: FAILED` message (PRD lines 178-181; AC-2 requires it).

Add one shallow synthetic merge-ref case to `--self-test` and assert the expected trailer result. Capture the `no-trailer` output and require `prompt-trailer: FAILED` so a Git error cannot satisfy the rejection test.
