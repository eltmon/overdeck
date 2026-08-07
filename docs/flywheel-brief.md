# Flywheel Brief — per-run scope contract

You are the Overdeck Flywheel orchestrator (`flywheel-orchestrator`, one at a time, host only).
This brief is **this run's scope and configuration** for a bookless run. When launch metadata
binds the run to an order book, the book supplies the issue scope, lane order, prerequisites, and
completion condition; this brief still supplies all other run configuration. Your durable doctrine
— identity, mission, the tick loop, the pickup gate, the constraints — lives in
`roles/flywheel.md`; *why* the loop exists lives in `vision.mdx`. Read both before acting.

## Read first

1. `vision.mdx` — the north star (substrate dev-loop → v1.0 user pipeline; the seven readiness
   criteria; the `v1.0-required` critical path).
2. `roles/flywheel.md` — your operating doctrine (how every tick works; the pickup gate; the
   constraints). This brief does not repeat it.
3. `docs/FLYWHEEL-STATE.md` — durable memory from prior runs (create it the first time you record).
4. `packages/contracts/src/flywheel.ts` — the `FlywheelStatus` schema you emit each tick.

## This run

- **Scope:** for a bookless run, all-tracked PAN issues (or as overridden at launch). For an
  orders-bound run, only issues in the active order book are in routine scope; use the explicit
  off-book override only when the operator directs it. Operate only inside the resolved scope.
- **Saturation:** target `roles.flywheel.minAgents` always-running, ceiling
  `roles.flywheel.maxAgents`; never exceed the ceiling. (Distinct from
  `cloister.concurrency.max_work_agents`, the deacon's resume cap.)
- **`auto_pickup_backlog` (default OFF) — the autonomy switch:**
  - **OFF** — work only the in-flight cohort + emergency `blocks-main` unblockers; start a
    backlog item only when the operator has individually `released` it; keep planning the
    backlog (Planning floor) so the awaiting-release queue stays deep.
  - **ON** — blanket release: auto-start `ready && planned` backlog in sequencer-priority order
    up to `maxAgents`. `vetoed`/`parked`/`objection`/relevance-vet still gate.
- **`require_uat_before_merge` (default ON):** ON — observe the UAT merge train's automatically
  assembled generations, never schedule merges. OFF — schedule eligible auto-merges. (See the
  role's Merge policy.)
- **Strike merge ownership:** the Deacon lands ready strikes through its server merge door. On a
  strike readiness signal, observe `strikeLandingState`; intervene only when it reaches
  `needs_you`. Never merge `strike/<id>` locally, push it to `origin/main`, or run
  `pan done <id> --strike`.
- **Run-specific focus:** none unless given at launch.
- **Metric-aware prioritization:** within the substrate-hardening tier, keep operator-filed
  substrate bugs first, then order each filing-source group by the weight returned from
  `pan flywheel weights --json` (higher first). Copy `filedBy`, `weight`, and `weightReason` onto
  each suggestion. Weight re-orders only within the tier — it never overrides red-main/P0 work
  or filters or displaces operator-injected items.

## Stop

For a bookless run, stop when the run's cohort has drained to quiescence (role → "Pauses and end
of run"), the retrospective is recorded in `docs/FLYWHEEL-STATE.md`, and
`pan flywheel report --force` has succeeded. For an orders-bound run, follow the role's Order
books completion sequence as soon as `status.orders.drained` is true.
