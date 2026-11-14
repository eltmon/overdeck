# PAN-5225 — live DoD probe (read-only)

Run from the `feature/pan-5225` branch source (uncommitted-at-the-time working tree, same
code as this PR) with `npx tsx <scratchpad>/probe-dod.mts <ISSUE> /home/eltmon/Projects/myn`,
on 2026-11-14. `evaluateDodGate()` only reads — it never runs close-out teardown. **The real
`pan close MIN-1140 --force` runs after this PR merges and `pan reload` ships the fix** — the
deployed `pan` does not carry it yet. MIN-1139 still needs a fresh green verification run in
its workspace, or an operator decision to accept the failed row 3 (`--accept-verification`),
before it can close; this change does not satisfy issue requirement 3 for MIN-1139.

## MIN-1140

```
review: skip — no pull request found on the forge for this issue; forge merge complete: fe merged (https://gitlab.com/eltmon/mind-your-now/-/merge_requests/121), api no branch work, infra merged (https://gitlab.com/eltmon/myn-infra/-/merge_requests/16), docs no branch work, myn-skills no branch work, openclaw-plugin no branch work, hermes-plugin no branch work, splash no branch work; skipped — merged forge artifacts are landing evidence; the forge review decision is not read
tests: skip — no pull request found on the forge for this issue; forge merge complete: fe merged (https://gitlab.com/eltmon/mind-your-now/-/merge_requests/121), api no branch work, infra merged (https://gitlab.com/eltmon/myn-infra/-/merge_requests/16), docs no branch work, myn-skills no branch work, openclaw-plugin no branch work, hermes-plugin no branch work, splash no branch work; skipped — merged forge artifacts are landing evidence; forge check results are not read
verification: pass — verification artifact: passed at 2026-11-06T14:13:56.798Z
merged: pass — fe: All commits merged to main; api: All commits merged to main; api: Remote branch fully merged; infra: All commits merged to main; docs: All commits merged to main; docs: Remote branch fully merged; myn-skills: All commits merged to main; myn-skills: Remote branch fully merged; openclaw-plugin: All commits merged to main; openclaw-plugin: Remote branch fully merged; hermes-plugin: All commits merged to main; hermes-plugin: Remote branch fully merged; splash: All commits merged to main; splash: Remote branch fully merged
post-merge: pass — canonical state unavailable; PR mergedAt: not merged; forge merge complete: fe merged (https://gitlab.com/eltmon/mind-your-now/-/merge_requests/121), api no branch work, infra merged (https://gitlab.com/eltmon/myn-infra/-/merge_requests/16), docs no branch work, myn-skills no branch work, openclaw-plugin no branch work, hermes-plugin no branch work, splash no branch work — merged forge artifacts stand in for the PR mergedAt on a non-GitHub-tracked issue; no running work/planning agents
main-verify: skip — no merge commit resolvable — verified-on-main has no durable marker (see DoD row 6)
ship: skip — project declares no version_sync; ship step not applicable
deploy: skip — verified-on-main skipped — no merge commit resolvable, so deploy build-ancestry has no durable anchor either (same landing class as DoD row 6 skip)
passed true
```

Matches the PRD's expectation exactly: `post-merge: pass` and `passed true`.

## MIN-1139

```
review: skip — no pull request found on the forge for this issue; forge merge complete: fe merged (https://gitlab.com/eltmon/mind-your-now/-/merge_requests/122), api merged (https://gitlab.com/eltmon/mind-your-now-backend/-/merge_requests/106), infra merged (https://gitlab.com/eltmon/myn-infra/-/merge_requests/17), docs no branch work, myn-skills no branch work, openclaw-plugin no branch work, hermes-plugin no branch work, splash merged (https://gitlab.com/eltmon/mind-your-now-splash/-/merge_requests/9); skipped — merged forge artifacts are landing evidence; the forge review decision is not read
tests: skip — no pull request found on the forge for this issue; forge merge complete: fe merged (https://gitlab.com/eltmon/mind-your-now/-/merge_requests/122), api merged (https://gitlab.com/eltmon/mind-your-now-backend/-/merge_requests/106), infra merged (https://gitlab.com/eltmon/myn-infra/-/merge_requests/17), docs no branch work, myn-skills no branch work, openclaw-plugin no branch work, hermes-plugin no branch work, splash merged (https://gitlab.com/eltmon/mind-your-now-splash/-/merge_requests/9); skipped — merged forge artifacts are landing evidence; forge check results are not read
verification: miss — verification artifact: failed at 2026-11-11T08:16:11.273Z (frontend-lint)
merged: pass — fe: All commits merged to main; api: All commits merged to main; infra: All commits merged to main; docs: All commits merged to main; docs: Remote branch fully merged; myn-skills: All commits merged to main; myn-skills: Remote branch fully merged; openclaw-plugin: Code changes squash-merged to main (only planning artifacts remain on branch); openclaw-plugin: Remote code changes squash-merged to main (only planning artifacts remain on branch); hermes-plugin: All commits merged to main; hermes-plugin: Remote branch fully merged; splash: All commits merged to main
post-merge: pass — canonical state unavailable; PR mergedAt: not merged; forge merge complete: fe merged (https://gitlab.com/eltmon/mind-your-now/-/merge_requests/122), api merged (https://gitlab.com/eltmon/mind-your-now-backend/-/merge_requests/106), infra merged (https://gitlab.com/eltmon/myn-infra/-/merge_requests/17), docs no branch work, myn-skills no branch work, openclaw-plugin no branch work, hermes-plugin no branch work, splash merged (https://gitlab.com/eltmon/mind-your-now-splash/-/merge_requests/9) — merged forge artifacts stand in for the PR mergedAt on a non-GitHub-tracked issue; no running work/planning agents
main-verify: skip — no merge commit resolvable — verified-on-main has no durable marker (see DoD row 6)
ship: skip — project declares no version_sync; ship step not applicable
deploy: skip — verified-on-main skipped — no merge commit resolvable, so deploy build-ancestry has no durable anchor either (same landing class as DoD row 6 skip)
passed false
```

Matches the PRD's expectation: `review: skip`, `tests: skip` (its list contains
`openclaw-plugin no branch work`), `merged: pass`, `post-merge: pass`, and
`verification: miss` (D6), so `passed false`. **MIN-1139 cannot close until row 3 is
resolved** — either a fresh green verification run, or an operator `--accept-verification`
decision — this plan does not change that.
