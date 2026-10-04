# Flywheel report: overnight run 2026-10-04

Run: 2026-10-04 02:04 → 10:45 UTC. Auto-pickup was OFF. The loop drained the
issues the operator started with `pan start` plus the issues it filed itself.
The operator authorized restart approvals for this night only. **The
pipeline is clear, and the loop is idle, waiting for the operator to close
out the run.**

## Headline

- **19 PRs merged, deployed and closed out overnight.** That is all 12 issues
  the operator started, plus PAN-4383 (stuck in review for 2 days) and 6
  issues the Flywheel filed and launched.
- **Live build `b14903827a0` = `origin/main` tip.**
- **The God View video (conversation 3215) is released.** Both God View
  fixes have been live since 09:07 UTC.
- **Mods evaluation ready for review:** https://claude.ai/artifact/JevxSris6qA2X34rjXxxdc
- **6 `needs-handoff` items wait for you** (below); they are review, merge
  and flywheel machinery.

## Merged, deployed and closed (`origin/main`)

| Issue | Commit | What |
| --- | --- | --- |
| PAN-4509 | d28b9815 | Docs lint: Mintlify math `$` and bare `<` |
| PAN-4507 | 967f1411 | Issue poller backs off when nothing changes |
| PAN-4506 | f68331a7 | Herdr review-kickoff `invalid_request` fix (unblocked PAN-4383) |
| PAN-4258 | 5ea1be0e | Planning effort levels |
| PAN-4383 | c90bc115 | Work agents blocked on an operator decision reach Needs-you |
| PAN-4257 | be8b33e4 | Tier effort reaches slots |
| PAN-4498 | 9ecda10a | Conversation bookmarks |
| PAN-4508 | 66777e33 | Jev settings in the dashboard |
| PAN-4528 | f22dee6a | New-conversation Skills field: descriptions and collapsible groups |
| PAN-4514 | ff4bad3d | AskUserQuestion placeholder / status-only questions |
| PAN-4256 | 832b65e0 | Effort on role launch surfaces |
| PAN-4522 | 849baa1d | God View: liveness survives dashboard restart |
| PAN-4529 | e98acf50 | Claude Code mods evaluation (report only) |
| PAN-4515 | 6d2e0eb7 | Chats: idle Claude Code conversations jump to 'active just now' hourly |
| PAN-4523 | 9c871fc4 | God View river: bands, merged-exit, stage counters |
| PAN-4260 | 19089607 | Harness effort correctness |
| PAN-4259 | 6eb8d3d1 | Show effort everywhere, record it in cost data |
| PAN-4541 | cd27acfd | Deploy preflight reads real imports only (deploys were blocked 05:35-09:07) |
| PAN-4543 | b1490382 | `pan close`: deploy-probe retry, stale-artifact rule, async cost reads (event-loop stall) |

## Release inputs (v0.64.0 → next)

- Since v0.64.0: ~150 commits, 59 PR merges. Every merge is deployed and
  closed, and `main` is green.
- Recommendation: **v0.65.0** is the honest next number. **v0.70.0** is
  defensible as a showcase milestone. It is your call
  (`pan release stable --version X.Y.Z`, then push `main` and the tag).

## needs-handoff (TENET-10, not auto-started)

All are review, merge or flywheel machinery found tonight. They explain most
of the night's slow review throughput.

1. **PAN-4532:** a dashboard restart during verification loses the review
   dispatch; the re-request discards the finished result and re-runs every gate.
2. **PAN-4531:** verification runs ~25 min of local gates on a head whose CI
   already failed, or whose PR already merged, while holding the single CPU
   admission slot.
3. **PAN-4527:** a re-review joins a worker started on the previous head and
   fails the new head on the old head's CI result.
4. **PAN-4540:** auto-merge records a gate refusal inside `triggerMerge` as
   `failed`, which strands approved green PRs. The trigger is a transient
   `mergeable` recompute after any push to `main`; 3 instances tonight.
5. **PAN-4534:** CI failure feedback names no failing test, because the relay
   reads completed workflow runs while the run is still in progress.
6. **PAN-4530:** Flywheel skill: go idle when clear, keep the conversation
   open, stuck is not clear (your approved rule; already in `state.md`).

Suggested: one supervised handoff for 1–5, which share
`verification-worker-supervisor.ts`, `verification-runner.ts` and the
auto-merge executor. Take PAN-4530 into the flywheel/gauntlet design session.

## Unaddressed SHOULD-level review findings (merged anyway)

- PR #4513 (PAN-4509): `tests/unit/scripts/lint-docs.test.ts` uses
  `new URL(...).pathname`; it should use `fileURLToPath` (breaks on checkout
  paths with spaces). Both CodeRabbit and our reviewer flagged it.

## Design calls for you

- **Gate admission is serialized machine-wide (PAN-4311):** one heavy gate at
  a time on 24 cores. Overnight, 5–7 PRs queued 1–2 h behind it. Allowing 2
  concurrent gates is a CPU-storm-risk trade-off.
- **Close-out is not automatic** (`close_out.auto` unset): merged and
  deployed issues sat `verifying-on-main` until the Flywheel ran `pan close`.
  Decide whether to turn it on now that PAN-4543 removed the flaky refusals.
- **SHOULD-level findings evaporate on approval;** decide whether they should
  become follow-up issues automatically.

## Housekeeping

- The primary checkout's local `main` is several commits behind `origin/main`.
  Its fast-forward is blocked by another session's untracked
  `.pan/continues/PAN-4383.xbrief.json`, which differs from the merged copy.
  The Flywheel left it untouched.
- The overnight restart authorization ended with this run.
