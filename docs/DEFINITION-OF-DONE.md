# Definition of Done

An Overdeck issue is **done** when every row in this table is green — not when the PR merges,
and not when the tracker issue closes. Each row names its **mechanical owner**: the code that
performs it and the surface where its result is visible. A row with no live owner is a pipeline
gap — file an issue for it. "Is anything missed?" is answered by
the `pan close` DoD gate (PAN-2715), never by reasoning from memory. The shared row definition
lives in `src/lib/lifecycle/dod.ts`; `tests/unit/lib/lifecycle/dod-doc-drift.test.ts` prevents
this table and that module from drifting silently.

| # | Gate ID | Step | Mechanical owner | Visible at |
| --- | --- | --- | --- | --- |
| 1 | `review` | Review passed (mode per issue policy); strike-landed work skips because no reviewer runs, and tracker-closed landed work skips when no negative review verdict exists | review role → `pan admin specialists done review` → review-status write door; terminal settlement in `evaluateDodGate()` | `reviewStatus: passed`, or `skip` preserving the original verdict and naming the strike/terminal reason |
| 2 | `tests` | Tests passed (incl. browser UAT when required); strike-landed work skips because no test specialist runs, and tracker-closed landed work may settle under the rule below | test role → `pan admin specialists done test`; terminal settlement in `evaluateDodGate()` | `testStatus: passed`, or `skip` preserving the original verdict and naming the strike/terminal reason |
| 3 | `verification` | Verification green on the branch (typecheck, lint, suite, build); tracker-closed landed work may settle under the rule below | supervised verification worker (`verification-runner.ts` / `verification-worker.ts`); UAT promotion (PAN-3114); terminal settlement in `evaluateDodGate()` | `verificationStatus: passed` (or policy `skipped`), or terminal `skip` preserving the original verdict |
| 4 | `merged` | Merged to main: forge/durable merge evidence resolved per required repository through either convention head (`feature/<id>` or `strike/<id>`). Polyrepo probes run inside each resolved repository; forge squash-merge detection covers GitHub PRs and GitLab MRs, with GitLab artifacts matched to the branch head SHA. The last resort is a non-PR landing where the shared L2-work lens finds at least one convention-branch ref contained in its repository's default branch with the tip off the first-parent line and zero unmerged refs across all configured repositories. | merge door: `triggerMerge` → merge specialist (`merge-agent.ts`); verification: `verifyBranchMergedImpl()` + `getForgeAdapter().findMergedArtifact()`; fallback: `gatherIssueBranchContainment()` | PR/MR id and URL, `mergeStatus: merged`, durable merge record, or branch-containment evidence |
| 5 | `post-merge` | Post-merge handoff: work/planning agents paused, workspace Docker stack + networks stopped, `verifying-on-main` label; for a containment-evidenced non-PR landing, passes when no work/planning agents are running because no observed merge event could trigger the lifecycle; for a strike landing, skips on the same quiescence test because the strike path never runs the work-agent handoff (PAN-3180) | `postMergeLifecycle()` (`merge-agent.ts`) — at-most-once per merge (PAN-328 in-flight guard); DoD containment and strike fallbacks | issue labels, agent states |
| 6 | `main-verify` | Verified on main: every named required check is present and successful on the merge commit, or — when any is missing or unsuccessful — a later default-branch head that contains the merge commit has every required check green (PAN-3202, PAN-3589) | deacon verify-on-main flow; `checkMainVerifyRow()` (`dod-gate.ts`) | `verifying_on_main` → verified; the observed string names either the merge commit or the later green head, including any missing required checks |
| 7 | `ship` | Version strings propagated for the merged UAT batch; direct merges and projects without `version_sync` skip explicitly | ship runner (`version-ship.ts`) via `finishPromote()` or the batch-card Ship version action; conservative all-member settlement in `checkShipRow()` | aggregate of every member's durable `pipeline.ship`; any missing, pending, partial, or failed member blocks the whole batch |
| 8 | `deploy` | **Deployed: the live dashboard runs a canonical build that includes the merge.** When the `merged` row misses without resolving a merge commit, this row skips and reports its row-4 dependency instead of recording a second miss. | staleness-gated Step 0 (`merge-agent.ts`) + Deacon deploy patrol (`deploy-patrol.ts`) + deploy intent queue (`pending-deploy.json`), guarded by `getDeployBlockReason()` | `/api/health` `buildCommit`, `buildDirty`, and `buildBranch` + stale-build chip; the row misses when the build is dirty or `buildCommit` is not an ancestor of `origin/main` |
| 9 | `teardown` | Close-out: worktree removed, branches per `close_out` config, xBRIEF `plan.status: completed`, planning artifacts archived, tracker issue CLOSED + `closed-out` label, review status cleared, Docker `_devnet` teardown verified, open recovery trips acknowledged and operator-gate flags (`stoppedByUser`/`paused`/`troubled`) cleared on the issue's stopped agent rows so it stops re-surfacing in the parked population (PAN-3727) | `pan close <id>` / dashboard Close Out (`closeOut`); closed-issue reaper (`reapIssueResidue`) as backstop; deacon's `reconcileTerminalIssueResidue` patrol as a recurring backstop for residue predating this fix | issue state, `workspaces/` dir |

## Verdict durability

Rows 1–3 read live status first and fall back to the per-issue record's `pipeline` block on `overdeck-state` when live status is absent. The durable journal preserves the full verdict triple (review/tests/verification) plus `lastVerifiedCommit` through close-out and across database rebuilds, so rows continue to read and pass after live status is cleared or the SQLite database is re-derived. Re-running `pan close <id>` on a fully closed-out issue is an idempotent no-op that returns success without re-evaluating the gate or re-running any ceremony step; it names the original `closedOutAt` timestamp to prove completion on the original run.

## Rules of the table

- **Merged ≠ done.** Steps 5–9 are where "shipped" actually happens; step 8 is where the fix
  starts existing for users. On 2026-07-15, three merges (PAN-2684/2690/2701) were fully
  closed-out while the live server ran a build from three merges earlier — every fix inert.
- **The ship row is batch-scoped and reads the all-member aggregate.** A project with no
  `version_sync` and a direct merge with no batch ship record both skip explicitly. A configured
  batch passes only when every durable `pipeline.ship` verdict passes with the same version;
  missing, pending, partial, and failed members keep every member's row at miss.
- **Every row must name a live owner.** Doctrine ("the flywheel usually does X") is not an
  owner; only code with a trigger is. When you find an ownerless step, drive it manually for
  velocity and file the gap issue — the flywheel follows the same backstop-as-symptom rule
  (`roles/flywheel.md`).
- **Enforcement is the gate, not this doc.** `pan close` enumerates rows from
  `src/lib/lifecycle/dod.ts`, verifies them mechanically (PAN-2715), and reports any miss
  instead of completing silently. Changing the DoD means changing the shared definition and
  this table in the same commit; the doc-drift test blocks a partial edit.
- **Auto-close-out uses the same gate.** A missed row blocks Deacon's automatic close-out and
  surfaces through its recorded auto-close-out failure. Automation never accepts a miss on
  the operator's behalf; `flywheel-*` callers are mechanically barred from `--accept-*`.
- **Branch absence is not merge evidence.** The `merged` row requires positive evidence from
  the forge, the durable close-out merge record, or the shared L2-work containment lens. A merged
  GitLab MR for an absent convention branch is positive forge evidence recorded with its MR iid
  and URL. The L2-work containment lens remains the last-resort fallback, labeled `non-PR landing`,
  and passes only when merged-work refs exist and no configured repository reports an unmerged ref,
  so deleting an unmerged branch or finding only fresh pointers remains a miss. A strike-landed
  issue passes through the strike branch's own merge evidence; unmerged commits on the superseded
  feature branch remain in the observed string instead of causing a miss.
- **Residue disposition handles tracker-closed pre-record-era issues** (PAN-3396). When `pan close --residue` is used, the DoD gate is skipped and every row reports skip with the verified disposition evidence. The command closes stale convention PRs/MRs with an honest "no merge claim" comment, verifies the tracker issue is closed (tracker-agnostic via `isTrackerIssueClosed`), and marks the issue terminal without asserting `mergeStatus` (which is unknowable for recordless work). Residue is operator-conversation-only and mutually exclusive with `--abandon` and `--accept-*` flags.
- **The verification verdict is the row; `lastVerifiedCommit` is not required** (PAN-3067). The
  runner writes that anchor best-effort — it snapshots HEAD inside a `try/catch` for the
  test-skip drift check, and a policy `skipped` verdict never has one — so its absence proves
  nothing about whether verification ran, while requiring it made merged, green, deployed
  issues permanently un-closable. UAT batch promotion records a `passed` verdict for each
  non-terminal member at promote time, and close-out heals members of batches promoted before
  that write path existed (PAN-3114). The row still reports the anchor's presence or absence,
  so a reader never has to guess which condition a miss came from.
- **Terminal closure can settle rows 1–3 without fabricating verdicts** (PAN-3187). When the
  tracker issue is closed and row 4 proves that work landed, an absent or non-negative pending
  verdict records `skip`; this covers verdicts that were never produced after stale review intent
  expired or the closed-issue reaper removed it, but it never turns stale intent into a pass. A
  negative test or verification verdict settles only when row 6 (`main-verify`) passes, proving
  that the landed state superseded it. A negative review verdict never settles, because later CI
  cannot prove that review feedback was addressed. Tracker-open issues, closed issues without
  landed work, and negative test/verification verdicts without a passing row 6 remain misses.
  Every settled row's observed string preserves the original missing, pending, or negative value
  and states why the gate recorded `skip`.
- **A later green main run containing the merge verifies row 6** (PAN-3202, PAN-3589). A merge that
  lands inside a red-main window can never green its required checks on its own commit, so pinning
  row 6 to that one run left it permanently unsatisfiable even after main went green hundreds of
  times with the commit included — three July merges needed operator `--accept-main-verify`
  overrides for exactly that reason. The required set comes from main branch protection and falls
  back to the project's configured list (`test`, `lint`, `build (22)`, and `guard` by default),
  so an unrelated successful check such as Mintlify Deployment cannot certify an absent CI run.
  When any merge-commit required check is missing or unsuccessful, the row walks the default-branch
  first-parent line above the merge, newest first, and accepts the first head (of at most five
  probed) where every required check succeeded. That is strictly stronger evidence than the
  original run, because it proves main is healthy *with* the merge included; the observed string
  names every missing required check before recording any later-green evidence.
- **A strike skips rows 1, 2 and 5; it never passes them** (PAN-3180). Bypassing review and
  test is the entire point of the strike path, so "never ran" and "still outstanding" are
  different facts and the gate now tells them apart. The waiver keys on
  `strikeLandingState: landed` — the merge door's own durable statement that the work reached
  main through `strike/<id>`, mirrored into the per-issue record's `pipeline` block. Every
  earlier landing state is a strike still in flight and earns nothing; a specialist that ran
  and returned `failed`/`blocked`/`dispatch_failed` still blocks, because a rejection is not
  an absence; and a live work or planning agent still misses row 5. The rows land in the
  close-out record as `skip` with an observed string naming the strike path, so a reader can
  always tell a strike-landed issue from a fully-reviewed one.

## Related

- `docs/OVERDECK_DEV_SOP.md` — dashboard restart/deploy mechanics (Node 22 dist, health timeout)
- `roles/flywheel.md` — backstop-interventions-are-symptoms rule
- PAN-2713 (deploy step + staleness signal), PAN-2715 (`pan close` DoD gate)
