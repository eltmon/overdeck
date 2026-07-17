# RUN-64 — Toggle First, Then the Issue-Actions Chain (still NO order-book intake)

**Operator-released 2026-07-17. This brief is the explicit go.**
Successor to RUN-63 (2026-07-13→07-17: pipeline drained — all four strikes
PAN-2794/2795/2811/2819 plus PAN-1491 landed and closed; operator cut
**v0.45.21** (published 2026-07-17T09:59Z; carries the PAN-2772
conversation-disconnect fix and the PAN-2768 desktop Sync Now fix external
user Drew was waiting on). RUN-63's Phase 3 (PAN-2377) was NOT dispatched —
it remains held, see below.

Your durable doctrine — identity, tick loop, pickup gate, constraints — lives
in `roles/flywheel.md`; *why* the loop exists lives in `vision.mdx`. Read both
before acting. This brief overrides only the SCOPE sections of the standard
brief (`docs/flywheel-brief.md`); every doctrine constraint still applies.

## The mission — an operator-sequenced three-item run

The ONLY issues this run may put into the pipeline, strictly in this order:

1. **PAN-2822 — Issues-pane toggle to show/hide `planned_backlog` (spec-only)
   pipeline members.** First thing; dispatch immediately
   (`pan plan PAN-2822 --auto` → `pan start PAN-2822`, or `pan start` alone
   which auto-plans). The issue body carries the full spec incl. acceptance
   criteria; it is display-only filtering — membership semantics
   (`src/lib/pipeline-membership.ts`) must NOT change.
2. **PAN-2661 — Organize the issue actions context menu into clear sections.**
   May be dispatched once PAN-2822 is in flight (they touch different
   surfaces); an interactive mockup was committed 2026-07-15 — the plan should
   reference it.
3. **PAN-1610 — Consistent issue actions across all surfaces (shared action
   registry).** Strictly AFTER PAN-2661 merges — it builds on 2661's grouping.
   Its mockup is also committed.

Drive each to merged + closed-out + deployed per doctrine. Nothing else
enters:

- The order book (`docs/master-plan-cicd-and-refactoring.md`) stays ON HOLD —
  A13=PAN-2445, B11=PAN-2233, B12=PAN-2190, B13=PAN-2189 remain undispetched
  (B10=PAN-2232 already landed in RUN-63's operator set). PAN-2377
  (order-book-as-feature) stays held until the operator reassesses.
- `flywheel.auto_pickup_backlog` is false and stays false. No backlog pickup.
- The `planned_backlog` rows now visible in the pipeline view (PAN-532,
  PAN-538, PAN-608, PAN-783, PAN-804, and similar) are PAN-1966's spec lens
  surfacing months-old proposed specs. They are DISPLAY-ONLY — not authorized
  work. Leave them alone.
- Emergency `blocks-main` strikes per doctrine remain sanctioned, as do
  pipeline-advancing specialists (review/test/merge) for the three items
  above.

## Constraints and inherited state

- Live server runs build ≥ `abe1de3bbb` with the PAN-2820 boot fixes; the
  boot-time pipeline-lens gather degrades per-project now, but treat any boot
  failure as stop-the-line and boot-test on an isolated port before touching
  the live server (RUN-63 lesson — the PAN-2820 outage was amplified by an
  untested restart path).
- Deploys: you are the deployer (primary main build → boot-test →
  `pan restart --health-timeout 120000` minimum → verify new pid binds :3011).
- Tiered execution stays on: never pass `--model` / `--harness` on spawns —
  Cloister routes.
- Red main = stop the line (strike-first). Never `--admin-bypass` while main
  is red.
- Record run state in `docs/FLYWHEEL-STATE.md` per tick — commit only
  materially-important ticks. Hand over via a fresh run before grinding past
  ~85% context.
