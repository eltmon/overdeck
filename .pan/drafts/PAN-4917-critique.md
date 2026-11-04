plan-digest: 2a23a36c8170f9c5ae730ed629696559a5df509d51c22bcf2a241e46fa053aea

## blocks-the-design: Failed fetch misses the required error

The proposed `fetch_history` runs `git fetch` as a bare command in a `set -euo pipefail` script ([PRD](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4917/.pan/drafts/PAN-4917.md), lines 117-128; [script](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4917/scripts/check-prompt-change-trailer.sh), line 2). If `origin` is missing, Bash exits before the proposed `fail` call. I reproduced that command shape against a missing local remote: it exited 128 with Git's `fatal:` text and no `prompt-trailer:` line. This contradicts FR-2's exit-1/prefixed-error requirement. The planned `clone-broken` case checks only nonzero and absence of `skipping` (PRD lines 186-193), so it would pass despite the defect. Wrap the fetch failure in `if ! git fetch ...; then fail "history fetch failed ..."; return 1; fi`, and assert the prefixed message and exit code in that case.

## blocks-the-design: Fallback restores the costly checkout

The PRD measures `fetch-depth: 0` plus `filter: blob:none` as still fetching about 700,000 commits and trees, mostly from `overdeck-state` (PRD lines 52 and 75). Its SHA-refusal fallback nevertheless prescribes exactly that checkout and drops `--fetch` (PRD line 231). If the checkpoint triggers, the resulting job again fetches every branch and violates FR-5 and AC-4, while the original timeout risk remains. Keep the fallback targeted: fetch `main` and the advertised `refs/pull/<number>/merge` ref rather than an unadvertised SHA, then run the same trailer check and verify the timing bound.

## sharpens-framing: Missing-base skip does not work

The PRD says the no-argument script logs `base ref origin/main not found; skipping` and exits 0, and that local `lint:prompt-trailer` relies on this path (PRD lines 54 and 79). In the current script, `check` captures `resolve_merge_base` in command substitution, so its log becomes the `merge_base` value ([script](/home/eltmon/Projects/overdeck/workspaces/feature-pan-4917/scripts/check-prompt-change-trailer.sh), lines 19-24 and 50-55). I ran `PROMPT_CHANGE_BASE_REF=nonexistent bash scripts/check-prompt-change-trailer.sh`; it exited 128 with `fatal: invalid object name 'prompt-trailer'.` Correct those claims in the PRD, or explicitly fix and test the existing no-argument skip path if it is intended to be a supported behavior.
