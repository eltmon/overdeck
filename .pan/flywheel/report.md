# Flywheel report (2026-11-19)

## Shipped this run (merged, deployed, closed)

- Docs overhaul order book 2026-11-17-docs-overhaul-pan-5467: all 23 items merged and closed (Lane A: PAN-5483, 5505, 5472, 5468, 5470, 5473, 5475, 5477, 5479, 5481, 5500, 5502, 5504; Lane B: PAN-5469, 5471, 5474, 5476, 5478, 5480, 5482, 5503, 5501, 5499). Epic PAN-5467 stays open for the operator.
- PAN-5522: GPT-6.2 Astra and GPT-6.2 Sol models.
- PAN-5498, 5516, 5519, 5520, 5526: auto-start after planning, `pan conversations resume`, stale review runs, CPU-pressure gate bypass, finalize auto-start consent.
- PAN-5540: known skill packs (video group) discoverable from the Skills page, `pan skills pack list` and a shipped pan-skills agent skill.
- PAN-5541: a secret request opens its masked input from Needs-you and from the waiting conversation.
- PAN-5564: flaky changes-view test fixed (mock onMount race).
- Release 0.89.1 published to npm (GPT-6.2 and the fixes above it); verified with a clean npx install.

## Not yet released

PAN-5540, 5541, 5564 and the docs work are on main and deployed here but not in an npm release. The operator's Mac needs a 0.89.2 release to get the pack and secret fixes.

## In flight

None.

## Parked / waiting on the operator

PAN-4593 (Semgrep tier decisions), PAN-4294 Worker deploy, PAN-5342 live checks, PAN-5241 spillover settings, GitHub App Issues permission, author-gate bot decision, AAB upload, overdeck-landing#7, Grok retest.

## Substrate fixes this run

PAN-5516, 5519, 5520, 5526, 5540, 5541, 5564 (see .pan/flywheel/state.md for learnings).
