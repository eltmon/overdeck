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
| 1 | `review` | Review passed (mode per issue policy; full = convoy + synthesis) | review role → `pan admin specialists done review` → review-status write door | `reviewStatus: passed` |
| 2 | `tests` | Tests passed (incl. browser UAT when required) | test role → `pan admin specialists done test` | `testStatus: passed` |
| 3 | `verification` | Verification green on the branch (typecheck, lint, suite, build) | supervised verification worker (`verification-runner.ts` / `verification-worker.ts`) | `verificationStatus: passed`, `lastVerifiedCommit` |
| 4 | `merged` | Merged to main (squash PR, revertible history) | merge door: `triggerMerge` → merge specialist (`merge-agent.ts`) | PR `MERGED`, `mergeStatus: merged` |
| 5 | `post-merge` | Post-merge handoff: work/planning agents paused, workspace Docker stack + networks stopped, `verifying-on-main` label | `postMergeLifecycle()` (`merge-agent.ts`) — at-most-once per merge (PAN-328 in-flight guard) | issue labels, agent states |
| 6 | `main-verify` | Verified on main (post-merge verification of the merged commit) | deacon verify-on-main flow | `verifying_on_main` → verified |
| 7 | `deploy` | **Deployed: the live dashboard runs a build that includes the merge** | staleness-gated Step 0 (`merge-agent.ts`) + Deacon deploy patrol (`deploy-patrol.ts`), guarded by `getDeployBlockReason()` | `/api/health` `buildCommit` + stale-build chip |
| 8 | `teardown` | Close-out: worktree removed, branches per `close_out` config, vBRIEF `plan.status: completed`, planning artifacts archived, tracker issue CLOSED + `closed-out` label, review status cleared, Docker `_devnet` teardown verified | `pan close <id>` / dashboard Close Out (`closeOut`); closed-issue reaper (`reapIssueResidue`) as backstop | issue state, `workspaces/` dir |

## Rules of the table

- **Merged ≠ done.** Steps 5–8 are where "shipped" actually happens; step 7 is where the fix
  starts existing for users. On 2026-07-15, three merges (PAN-2684/2690/2701) were fully
  closed-out while the live server ran a build from three merges earlier — every fix inert.
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
  the operator's behalf.

## Related

- `docs/OVERDECK_DEV_SOP.md` — dashboard restart/deploy mechanics (Node 22 dist, health timeout)
- `roles/flywheel.md` — backstop-interventions-are-symptoms rule
- PAN-2713 (deploy step + staleness signal), PAN-2715 (`pan close` DoD gate)
