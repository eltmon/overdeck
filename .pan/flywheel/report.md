# Flywheel run report — 2026-10-24 (conversation 3302)

Run window: 08:10–17:00 UTC. Operator-directed run: no backlog pickups
(nothing was `released`); every start below was requested by the operator.
Ended with the v0.70.0 release and a pause, on the operator's instruction.

## Released

**v0.70.0** (tag `v0.70.0`, release commit `fb6e836cd69`), changelog in
`changelog.mdx`. Shipped with 17 merged fixes; PAN-4534 was left for the next
release by operator choice.

## Merged today (18 PRs)

| Issue | PR | What it does |
| --- | --- | --- |
| PAN-4584 | #4588 | Archiving a conversation shows progress and reports failures |
| PAN-4583 | #4587 | Editor pane reads markdown anywhere under $HOME (read-only) |
| PAN-4582 | #4600 | Each Herdr agent gets its own tab; no more blank terminals |
| PAN-4589 | #4604 | CI test gate recognizes commit-status CI (Dagger Cloud) |
| PAN-4609 | #4615 | Verification docs: what runs, why it is slow, which gates to keep |
| PAN-4585 | #4611 | Opt-in Semgrep install and doctor checks (phase 1) |
| PAN-4597 | #4607 | Approved PRs stay on Awaiting Merge; issue-view Merge button back |
| PAN-4595 | #4601 | `pan show --health` stops calling working Herdr agents stuck |
| PAN-4546 | #4617 | Two concurrent quality-gate slots (+ PAN-4610 stranded-ticket fix) |
| PAN-4596 | #4606 | Held handoffs show their unsent kickoff with a Start button |
| PAN-4598 | #4603 | Merge-train batches assemble again; per-row Merge on the Flywheel |
| PAN-4614 | #4619 | `concerns.md` marked merge=union (no more conflicts) |
| PAN-4605 | #4620 | PRs opened outside a workspace are adopted into the pipeline |
| PAN-4618 | #4621 | CI skips bookkeeping commits, cancels superseded runs |
| PAN-4532 | #4602 | Dashboard restart no longer loses a verification's review dispatch |
| PAN-4527 | #4599 | A re-review never joins a verification of the previous head |
| PAN-4531 | #4608 | Verification stops early once CI already failed for the head |
| PAN-4540 | #4612 | Gate refusals no longer strand approved green PRs in auto-merge |

Closed out (deployed): all of the above except PAN-4527, PAN-4531 and
PAN-4540, whose deploy (`pan reload` started ~17:00) was waiting for the
operator's restart approval at pause time. After the restart, run
`pan close PAN-4527 --force`, `pan close PAN-4531 --force`,
`pan close PAN-4540 --force` once `buildCommit` contains `226808ad7`.

## In flight at pause

- **PAN-4534** (#4613): CI failure feedback names the failing test. Built in
  conversation 3304, entering verification/review. Not in v0.70.0.

## Parked

None.

## Substrate fixes this run

Filed and fixed: PAN-4595, PAN-4596, PAN-4597, PAN-4598, PAN-4605,
PAN-4609, PAN-4610, PAN-4614, PAN-4618 (see table). Operator-approved
speedups: local verification gates for panopticon-cli trimmed to install +
typecheck (machine config, backup `projects.yaml.bak-2026-10-24-gates`), two
gate slots (PAN-4546), early stop on red CI (PAN-4531).

## Operator decisions and other work

- Flywheel granted merge authority for approved, green, clean PRs on a green
  main (memory `flywheel-may-merge-ready-prs`).
- Disk: removed 19 merged MYN worktrees and pruned unused Docker images
  (29 GB → 72 GB free). Restic backups verified healthy; the 8 failures in
  the prior week were all "no space left on device".
- Lessons recorded in `.pan/flywheel/state.md`: handoff conversations need
  pipeline workspaces, a PRD/plan, and recorded ACs (now automated by
  PAN-4605 adoption); the merge door can refuse transiently right after
  another merge; CI runner starvation from bookkeeping commits.

## Unaddressed SHOULD-level review findings

Not collected this run.
