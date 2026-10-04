# Flywheel report — overnight run 2026-10-04

Run: 2026-10-04 02:04 → in progress (updated 09:20 UTC). Auto-pickup was OFF.
The loop drained the issues the operator started with `pan start` and the
issues it filed itself. The operator authorized restart approvals for this
night only.

## Headline

- **All 12 issues the operator started merged, deployed and (all but two)
  closed out**, plus PAN-4383 (stuck in review for 2 days) and the 5 issues
  the Flywheel filed and launched (PAN-4522, PAN-4523, PAN-4528, PAN-4529,
  PAN-4541). **18 PRs merged overnight.**
- **Live build: `cd27acfd` = `origin/main` tip**, deployed 09:07 UTC. It
  contains every merge from tonight, including both God View fixes.
- Deploys were blocked 05:35-09:07 by PAN-4541: the boot preflight read
  `from "custom"` inside a JSDoc comment as an import. It is fixed, merged and
  deployed; the preflight now reads real imports only.
- **The God View video (conversation 3215) is released**: told at 09:08 that
  the fixes are live.
- **Closed out: 16 of 18.** PAN-4498 and PAN-4508 are blocked by a stale
  `running` verification artifact left by a duplicate run. PAN-4543 (in
  flight) fixes that and the flaky deploy-row probe; after it lands they close
  with no override. Alternative now: `pan close <id> --accept-verification`
  (an explicit override, your call).

## Merged tonight (`origin/main`)

| Issue | Commit | What |
| --- | --- | --- |
| PAN-4509 | d28b9815 | Docs lint: Mintlify math `$` and bare `<` |
| PAN-4507 | 967f1411 | Issue poller backs off when nothing changes |
| PAN-4506 | f68331a7 | Herdr review-kickoff `invalid_request` fix (unblocked PAN-4383) |
| PAN-4258 | 5ea1be0e | Planning effort levels |
| PAN-4383 | c90bc115 | Work agents blocked on an operator decision reach Needs-you |
| PAN-4257 | be8b33e4 | Tier effort reaches slots |
| PAN-4498 | 9ecda10a | Conversation bookmarks |
| PAN-4508 | 66777e33 | Jev settings in the dashboard (its comment triggered PAN-4541) |
| PAN-4528 | f22dee6a | New-conversation Skills field: descriptions and collapsible groups |
| PAN-4514 | ff4bad3d | AskUserQuestion placeholder / status-only questions |
| PAN-4256 | 832b65e0 | Effort on role launch surfaces |
| PAN-4522 | 849baa1d | God View: liveness survives dashboard restart |
| PAN-4529 | e98acf50 | Claude Code mods evaluation (report only) |
| PAN-4515 | 6d2e0eb7 | Chats: idle Claude Code conversations jump to 'active just now' hourly |
| PAN-4523 | 9c871fc4 | God View river: bands, merged-exit, stage counters |
| PAN-4260 | 19089607 | Harness effort correctness |
| PAN-4259 | 6eb8d3d1 | Show effort everywhere, record it in cost data |
| PAN-4541 | cd27acfd | Deploy preflight reads real imports only (unblocked all deploys) |

All of the above is deployed (`cd27acfd`).

## Release inputs (v0.64.0 → next)

- Since v0.64.0: **~145 commits, 58 PR merges**.
- Recommendation: **v0.65.0** is the honest next number. **v0.70.0** is
  defensible as a showcase milestone. It is the operator's call
  (`pan release stable --version X.Y.Z`).
- Pre-condition met: PAN-4541 merged and deployed, so the tagged build boots.
  Optionally wait for PAN-4543 so close-out is clean.

## Deliverables for review

- **Claude Code mods evaluation:** https://claude.ai/artifact/JevxSris6qA2X34rjXxxdc
  (also at `docs/research/claude-code-mods-evaluation.md`). Top-ranked adoption
  is an operator-state band in each agent's pane (size S). It proposes two
  follow-up issues and files neither. Open bug #92533 (a Bash `tool.call` hook
  breaks isolated-worktree agents) matters for Overdeck.

## needs-handoff: operator / supervised handoff (TENET-10, not auto-started)

All of these are verification, merge or flywheel machinery found tonight.
They explain most of the night's slow review throughput.

1. **PAN-4532:** a dashboard restart during verification loses the review
   dispatch, and the re-request discards the finished result and re-runs
   every gate.
2. **PAN-4531:** verification runs ~25 min of local gates on a head whose CI
   already failed, or whose PR already merged, while holding the single CPU
   admission slot.
3. **PAN-4527:** a re-review joins a worker started on the previous head and
   fails the new head on the old head's CI result.
4. **PAN-4540:** auto-merge records a gate refusal inside `triggerMerge` as
   `failed`, so approved green PRs are stranded. The trigger is a transient
   `mergeable` recompute after any push to `main`.
5. **PAN-4534:** CI failure feedback names no failing test, because the relay
   reads completed workflow runs while the run is still in progress.
6. **PAN-4530:** Flywheel skill: go idle when clear, keep the conversation
   open, stuck is not clear (operator-approved rule).

Suggested: one supervised handoff for 1–5 (they share
`verification-worker-supervisor.ts`, `verification-runner.ts` and the
auto-merge executor), then PAN-4530 with the design session.

## Unaddressed SHOULD-level review findings (merged anyway)

- PR #4513 (PAN-4509): `tests/unit/scripts/lint-docs.test.ts` uses
  `new URL(...).pathname`; it should use `fileURLToPath` (breaks on checkout
  paths with spaces). CodeRabbit and our reviewer both flagged it.

## Design calls for the operator

- **Gate admission is serialized machine-wide (PAN-4311):** one heavy gate at
  a time on 24 cores. Overnight, 5–7 PRs queued 1–2 hours behind it. Allowing
  2 concurrent gates is a CPU-storm-risk trade-off for you to make.
- **CodeRabbit findings rated SHOULD evaporate on approval;** decide whether
  they should become follow-up issues automatically.

## Housekeeping

- The primary checkout's local `main` is 3+ commits behind `origin/main`. Its
  fast-forward is blocked by another session's untracked
  `.pan/continues/PAN-4383.xbrief.json`, which differs from the merged copy.
  The Flywheel left it untouched.
- The operator's overnight restart authorization ends with this run
  (recorded in `state.md`).

## In flight

- **PAN-4543:** `pan close` false refusals (deploy probe single 3 s try vs a
  4-5 s event-loop stall measured during close-out; stale `running`
  verification artifact). Auto-planning at 09:20 UTC.

## Substrate fixes this run

PAN-4506 (Herdr kickoff, landed), PAN-4522 and PAN-4523 (God View, landed),
PAN-4541 (deploy preflight, landed), PAN-4543 (close-out DoD, in flight), plus the six needs-handoff items
above. Details in `.pan/flywheel/state.md`.
