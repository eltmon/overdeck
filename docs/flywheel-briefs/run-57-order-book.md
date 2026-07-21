# RUN-57 — The Order Book Run

**Operator-released 2026-07-05. GATE 2 IS OPEN — this brief is the explicit go.**
Successor to RUN-56 (which completed: prelude PAN-2283 + PAN-2378, B0 PAN-2318,
v0.42.0/v0.43.0 shipped, first Standing Crew test-drive PAN-2383).

## Binding documents

1. `docs/master-plan-cicd-and-refactoring.md` — the order book (binding order).
   Lane A (A1–A9, parallel-safe, A1 first) + Lane B (strictly serial; B0 DONE,
   start at B1 = PAN-2207). PRDs for all CI/CD items are in `.pan/drafts/`.
2. `docs/ci-cd/CICD-QUEUE.md` + `docs/codebase-health/REFACTOR-QUEUE.md` —
   per-campaign detail. Update statuses as items land.
3. This file — run-specific rules below override nothing in the order book;
   they add release policy and inherited duties.

## The mission

Drain the order book: 18 remaining items (A1–A9, B1–B13). Keep Lane B always
occupied (critical path), 1–3 Lane A items alongside, respect
`cloister.concurrency`. Drip rules from the master plan apply (one Lane B in
flight; main green + close-out between Lane B items; B9–B12 need PRD re-verify
before dispatch; B13's PRD is authored fresh only after B12).

## Release policy — v0.44.x (IMPORTANT, operator-decided)

- The **v0.44.x release is defined by the cost & metering trio**: PAN-2387,
  PAN-2388, PAN-2389 (GitHub milestone "v0.44.x — cost & metering legibility").
  All three are ALREADY dispatched (`pan plan --auto --auto-start`, 2026-07-05)
  — shepherd them through the pipeline as operator-priority alongside the
  order book. Suggested internal order: 2387 (attribution) before 2389
  (backfill); 2388's parsers feed both.
- **When the trio has landed + deployed + verified: report release readiness
  and SUGGEST v0.44.0.** The operator (or the oversight conversation acting
  under explicit operator authorization) cuts releases — you never tag.
- **Order-book items ride along but NEVER gate the release.** Whatever A/B
  items happen to be merged when the trio is done ship in v0.44.0; unfinished
  order-book work does NOT delay it. Do not hold the release for a Lane B item
  mid-flight — it just misses the train and ships in the next one.

## Operator-priority traffic to expect (not yours to dispatch, yours to shepherd)

- **Conversation 494 ("pan sync deleting conversation transcripts") is fixing a
  CRITICAL data-loss bug directly on main** under operator direction (cleanup
  path deleting conv-* transcript dirs). Treat its main commits as
  operator-authorized; do not revert, do not treat as agent-drift. It will also
  file + auto-start 2–3 follow-up issues (a missing-transcript UI indicator and
  causes #2/#3). Shepherd those as operator-priority when they appear; they
  outrank order-book dispatch if concurrency is tight.
- **PAN-2383** (per-issue Standing Crew toggle — the test-drive issue): work
  complete (`pan done` succeeded), now in review/test. Shepherd to merge +
  close-out. Its slots are the first tiered crew — after merge, close out
  normally.
- Main-green vigilance: with a direct-to-main critical fix landing, verify CI
  on main before advancing any Lane B merge. Red main = stop the line
  (strike-first policy), never --admin-bypass while main is red.

## Standing rules (carried from RUN-56)

- Tiered execution is ENABLED globally (Standing Crew: haiku/gpt-5.5-codex/
  opus + Fable supervisor, owns_inspection=true). Known gap PAN-2385 (commit
  feed + subscribe have no production caller) is filed but NOT in this run's
  scope unless the operator adds it.
- Never pass --model/--harness on spawns; Cloister routes.
- pan handoff is NOT for delegated implementation (forks the caller).
- Deploys: build from primary main + `pan restart --health-timeout 180000`
  (milliseconds). You are the deployer.
- Releases are operator-owned. Report readiness; never tag.
- PAN-399: slots preserved; harvest decision remains the operator's — do not
  merge or GC its slot branches.
- PAN-2297 = order-book item A8: when A8's turn comes, fold the stopped slot's
  useful work into the A8 PRD or redo clean — your discretion, note it on the
  issue.
- Record run state in docs/FLYWHEEL-STATE.md per tick as usual; hand over via a
  fresh run before grinding past ~85% context.
