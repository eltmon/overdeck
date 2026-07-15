---
scope: dev
---
### Definition of Done — merged is not done, closed-out is not done if the server is stale

An issue is done only when every row of the DoD table in `docs/DEFINITION-OF-DONE.md` is
green: review, tests, verification, merge, post-merge lifecycle, verify-on-main, **deploy**
(the live dashboard runs a build containing the merge), and close-out. `pan close` is the
mechanical gate (PAN-2715) — trust its audit, not memory.

When you observe a DoD step with no live mechanical owner (doctrine or "someone usually does
it" doesn't count), drive it manually for velocity AND file the gap issue — the same
backstop-as-symptom discipline as `roles/flywheel.md`. WHY: on 2026-07-15 three merges were
fully closed-out while the dashboard ran a build from before any of them — every fix inert
until an operator asked.
