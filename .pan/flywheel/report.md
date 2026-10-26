# Flywheel report — 2026-10-26 (conv 3341)

## Shipped

- PAN-4534: CI failure feedback names the failing test. It had merged on
  2026-10-24; closed out this run, with every Definition-of-Done row passing.
- PAN-4633: adds GPT-6.1 Terra (gpt-6.1-terra) to the catalog, pricing,
  Codex floor and CLIProxy route. PR #4635 merged at 20:18 UTC, went live in
  0.72.0, and is closed out.
- PAN-4630: dashboard terminals no longer loop on "Connection lost", because
  Herdr streams now spawn with ~/.local/bin on PATH. PR #4631 merged through
  the merge door, main CI was green at 4775d716, `pan reload` deployed
  7a659f67, and the issue is closed out.

## In flight

Nothing.

## Waiting on the operator

- PAN-4636: an outside PR that the pipeline adopts can never pass
  verification. Adoption never skips the plan-checklist check, which only
  strikes skip, so it fails `incomplete-plan-items`, and the failure reaches
  no agent. It is labeled `needs-handoff` (review machinery, TENET-10) and
  needs a supervised `pan handoff`. Until it is fixed, recover each instance
  with `pan start <id> --plan auto`; that worked for PAN-4630.
- PAN-4626: stop and archive pending state on conversation rows. It is
  planned (`pan plan --auto`) and ranked first, and it waits for the
  `released` label.
- PAN-4616: verify that GitHub's mergeable state honors `merge=union`. A
  leftover planning workspace from the 2026-10-24 mis-start remains; it is
  not released.

## Substrate fixes this run

- Filed PAN-4636, with file:line root cause and recovery recipe in
  `.pan/flywheel/state.md`.
- Observed once, not filed: the merge door counts the non-blocking flake-lane
  CI job as pending (`pr-facts.ts` line 242). It can delay an approved merge
  by up to 30 minutes.
