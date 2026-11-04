# Flywheel report — 2026-11-04

## Shipped (merged, deployed, closed out)

- **Agent MCP epic PAN-4927, complete:** all 29 items (PAN-4930 to PAN-4958), including the Hermes, OpenClaw, grok-build and grok-bot integration packages, their CI (PAN-4957) and docs (PAN-4958). The epic is closed.
- **Phone app (PAN-4823):** store, Firebase and APNs setup and first builds (PAN-4841), Android push decrypt (PAN-4840), link fixes (PAN-5018, PAN-5046), notification preferences (PAN-5019), PostHog (PAN-5016), light mode (PAN-5041), conversations grouped by project (PAN-5045).
- **Orchestrator and operator requests:** PAN-4998 (scratch out of /tmp), PAN-4999 (`pan tell` bare names), PAN-4960 (Account card), PAN-4885 (Fly secure-channel budget), PAN-5000 (Anywhere display bugs), PAN-5005 and PAN-5006 (lane display), and five strike PRs (PAN-4669, PAN-4673, PAN-4674, PAN-4690, PAN-4702).

## Substrate fixes driven this run

- PAN-4993: review convergence check treated the first block after an approval as a stuck loop and withheld feedback.
- PAN-5003: merge door rebased away merge-main conflict resolutions.
- PAN-5011: composer locked on every idle Herdr work agent.
- PAN-5015: review verdicts lost on GitHub GraphQL errors.
- PAN-5020: `architecture.md` last-verified line conflicted every parallel PR.
- PAN-5036: auto-merge scheduler skipped PRs silently; now reports reasons.
- PAN-5042: PR listing read flapped (heavy query, swallowed errors).
- PAN-5054: `apps/mobile/ACCEPTANCE.md` marked merge=union.
- PAN-5007: operator-owned restart hold (`pan restart hold` / `release`).

## In flight

Nothing.

## Parked or waiting on the operator

- PAN-4886 (live relay check): parked until an approver with a connected browser is present.
- PAN-4842 (phone docs): orchestrator-owned.
- Not released, no workspace: PAN-4887, PAN-5021, PAN-5022, PAN-5043, PAN-5048 (phone follow-ups).
- Operator step: publish the integration packages to external registries (PAN-4927 D-5).
