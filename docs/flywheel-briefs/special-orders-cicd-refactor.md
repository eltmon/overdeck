# Flywheel Brief — SPECIAL ORDERS run: CI/CD reliability × Refactor Phase 3

You are the Overdeck Flywheel orchestrator (`flywheel-orchestrator`, one at a time, host only).
This brief is **this run's scope and configuration**. Your durable doctrine — identity, mission,
the tick loop, the pickup gate, the constraints — lives in `roles/flywheel.md`; *why* the loop
exists lives in `vision.mdx`. Read both before acting. This brief overrides only the SCOPE
sections of the standard brief (`docs/flywheel-brief.md`); every doctrine constraint still applies.

## What a special-orders run is

The operator has handed you an explicit, pre-released order book:
**`docs/master-plan-cicd-and-refactoring.md`** (Lane A / Lane B, epic
[PAN-2376](https://github.com/eltmon/overdeck/issues/2376) + refactor Phase 3). Read it in full
before your first dispatch — its lane rules, ordering, re-verify obligations, and dispatch
mechanics are binding. Where this brief and the master plan disagree, the master plan wins.

- **Every item in the order book is operator-released.** You do not wait for per-item release;
  the plan itself is the release. `auto_pickup_backlog` is OFF for everything NOT in the order
  book — do not start unlisted work (emergency `blocks-main` unblockers excepted, per doctrine).
- **PRDs are written ahead** at `.pan/drafts/PAN-<n>.md`. Dispatch = re-verify PRD if needed →
  `pan plan <id> --auto` → `pan start <id>`. Never pass `--model`/`--harness`.
- **Lane semantics are the core of this run:** Lane A items may overlap each other and Lane B
  freely. Lane B is strictly serial — one in flight, main green + close-out before the next.
  Lane B order B1→B13 is fixed; Lane A order A1→A9 is preferred but items may interleave.

## Read first

1. `docs/master-plan-cicd-and-refactoring.md` — the order book (binding).
2. `roles/flywheel.md` — operating doctrine.
3. `docs/ci-cd/CICD-QUEUE.md` + `docs/codebase-health/REFACTOR-QUEUE.md` — per-item detail;
   update their Status columns as items move (commit with close-outs).
4. `docs/FLYWHEEL-STATE.md` — durable memory from prior runs.

## This run

- **START GATE 1 — clean table (operator-directed 2026-07-04):** nothing dispatches until
  BOTH hold: (1) the v0.42.0 release is verifiably published (Release workflow green,
  GitHub Release exists, npm packages at 0.42.0) — if the workflow goes red, escalate to
  the operator, never fix-forward into a release; and (2) the pipeline is fully clear —
  inherited swarms dispositioned, their sessions gone, no other agents in flight. The
  inherited-cleanup work below proceeds immediately; it is what clears the table.
- **PRELUDE — tiered execution ships first (operator-directed 2026-07-04):** once Gate 1
  opens, dispatch the prelude BEFORE any order-book item:
  [PAN-2283](https://github.com/eltmon/overdeck/issues/2283) (tiered-execution ignition:
  config load + dispatch wiring + read-only panel) then
  [PAN-2378](https://github.com/eltmon/overdeck/issues/2378) (tiered-execution
  configuration UI). Normal pipeline flow, PRD-first planning (no pre-written PRDs exist
  for these — planning writes them). The operator expected this in v0.42 — it targets a
  **v0.43.x** release instead (v0.42 stands, no unpublish). When both land + deploy,
  report readiness and SUGGEST cutting v0.43.0; the operator cuts releases.
- **B0 — PAN-2318, operator-priority (added 2026-07-05, EXEMPT from Gate 2):**
  [PAN-2318](https://github.com/eltmon/overdeck/issues/2318) (dashboard event-loop
  starvation) is released NOW as order-book item B0 — the operator explicitly wants it
  before everything else in the book because the watchdog "unreachable" false-positive
  restarts the dashboard unrequested (2026-07-05 incident), removing the operator's
  ability to quickly stop agents. Start `pan plan PAN-2318` immediately (planning is
  code-free, runs alongside the prelude). PRD exists: `.pan/drafts/pan-2318.md` — direct
  planning to (1) re-verify which work streams already landed (stream 1, deacon
  extraction, landed as 5f718b963d; streams 2–4 remain) and scope beads to the remainder
  only, and (2) add one scope item: a supervisor-watchdog boot grace period so a
  freshly-booted, busy-but-alive server is not declared unreachable (PAN-1714
  recurrence). Work runs in its isolated workspace in parallel, but the MERGE waits
  until PAN-2378 lands (one cloister-adjacent change in flight at a time). B1 and the
  rest of the order book remain behind Gate 2.
- **START GATE 2 — operator test-drive (explicit go required):** after the prelude lands,
  HOLD again. The operator may run a few test issues with tiered execution enabled. Do
  NOT begin the order book (A1/B1 onward — B0 is exempt, see above) until the operator
  explicitly says to start the special orders. Report "prelude complete, holding for
  operator go" and wait.
- **Scope:** ONLY the order book (now 19 issues: B0 + the two campaigns) + shepherding
  [PAN-2265](https://github.com/eltmon/overdeck/issues/2265) (already in review) to close.
- **Saturation:** the order book replaces backlog saturation. Keep Lane B always occupied
  (that's the critical path) and run 1–3 Lane A items alongside; respect
  `cloister.concurrency` ceilings as usual.
- **`require_uat_before_merge`:** per standard config. Lane B items additionally require the
  full suite green before merge (TENET-10) — no `--changed` shortcuts on cloister files.
- **Inherited cleanup (first tick):**
  - v0.42.0 was tagged and its Release workflow was in flight when this run started — confirm
    it published (npm + GitHub Release) and record it in FLYWHEEL-STATE.md; escalate if red.
  - Two off-plan swarms were auto-dispatched during the drain (the no-status-gate gap):
    [PAN-399](https://github.com/eltmon/overdeck/issues/399) — NOT in the order book: stop its
    swarm (`pan swarm stop`), work is preserved on origin slot branches; leave the issue for
    normal backlog. [PAN-2297](https://github.com/eltmon/overdeck/issues/2297) — IS order-book
    item A8, but its swarm predates the epic PRD: your discretion — fold the slot work into the
    PRD's scope if it matches, otherwise stop + redo via the PRD. Record the decision.
- **Reporting:** normal tick emissions; additionally, keep an "Order book: <n>/18 landed,
  lane B at B<k>" line in every status so the operator can read progress at a glance.
- **Releases stay operator-owned.** When the order book drains, report completion + suggest the
  next release; do not tag.
