# RUN-63 — Drain the Pipeline, Then a Release (NO new intake)

**Operator-released 2026-07-13. This brief is the explicit go.**
Successor to RUN-62 (2026-07-08→07-10: Lane B B3–B8 CI/CD reliability batch
landed + deployed; B7/B8 hit and remedied the PAN-2567 stuck-after-review loop;
filed PAN-2567/PAN-2569). Since RUN-62 ended, operator conversations landed B9
(PAN-2149), the Dolt-native beads cutover (PAN-2564), the beads-write-outage
fixes (PR #2617), and releases through v0.45.16.

Your durable doctrine — identity, tick loop, pickup gate, constraints — lives in
`roles/flywheel.md`; *why* the loop exists lives in `vision.mdx`. Read both
before acting. This brief overrides only the SCOPE sections of the standard
brief (`docs/flywheel-brief.md`); every doctrine constraint still applies.

## The mission — three phases, strictly in order

**Phase 1 — DRAIN. Put NOTHING new into the pipeline.** The order book
(`docs/master-plan-cicd-and-refactoring.md`) is ON HOLD — do NOT dispatch its
remaining items (A13=PAN-2445, B10=PAN-2232, B11=PAN-2233, B12=PAN-2190,
B13=PAN-2189). Do NOT pick up backlog items (`flywheel.auto_pickup_backlog` is
false and stays false). Do NOT spawn planning for anything. The ONLY sanctioned
spawns are pipeline-advancing specialists (review/test/merge) for work already
in flight, re-drives of already-in-flight agents, and emergency `blocks-main`
strikes per doctrine.

Drive every in-flight issue to merged + closed-out. Inventory at run start
(verify it yourself on tick 1 — it moves):

- In progress (live agents): PAN-2229 (work agent started 2026-07-13 09:35 —
  already in flight, it DRAINS, do not kill it; it is the last Lane A order-book
  item), PAN-2616, PAN-2607 (slot-3), PAN-2602 (+ review convoy), PAN-2596
  (review convoy).
- In review (no live agent — shepherd to verdict → merge → close-out):
  PAN-2598, PAN-2611, PAN-2597, PAN-2568, PAN-1491, PAN-1232, PAN-1234.
- Near close-out: PAN-2564 (cutover complete; finish its close-out).
- Known remedies: if a reviewed+green PR wedges in the advancing-verdict loop
  (PAN-2567 pattern), apply the RUN-62 remedy — review PASSED + full CI green +
  clean/mergeable + main-delta orthogonal → manual `gh pr merge --squash`.
  `pan close` first run may fail at sync-beads (PAN-2611) — run it twice.

An issue that turns out to be blocked/unworkable: park it with a needs-you and
move on — do not replace it with new intake.

**Phase 2 — RELEASE READINESS.** When the pipeline is drained (everything
merged+closed-out or explicitly parked with a needs-you), verify main is green,
deploy (build from primary main → boot-test → `pan restart --dashboard
--health-timeout 180000` → verify new pid binds :3011 with deacon=on), then
REPORT release readiness to the operator and SUGGEST the next cut. **The
operator cuts releases — you never tag.**

**Phase 3 — ONE new dispatch, only after the operator has cut the release:**
[PAN-2377] — first-class "special orders" runs: make the operator-supplied
order book a proper Overdeck feature with lane semantics. This is the single
item allowed into the pipeline this run. Dispatch = re-verify/author PRD →
`pan plan PAN-2377 --auto` → `pan start PAN-2377` → shepherd it to
merged+closed-out. The remaining order-book items (A13, B10–B13) stay ON HOLD
until after PAN-2377 lands; a future run will resume them using the new
feature.

## Constraints and inherited state

- Boot gate: `resume=off` (Boot --no-resume) — stopped agents do NOT auto
  -resume. YOU are the re-drive: watch for in-flight agents going
  status=stopped and `pan start <id>` them (confirm liveness via state.json
  lastActivity, NOT the pane — RUN-62 tick-23 lesson).
- PAN-2569 is still open: planning→work auto-start can silently no-op. Watch
  for "planned but no work agent" on anything you re-drive and re-dispatch.
- Stale stopped agents from old runs exist (e.g. agent-pan-1969,
  agent-pan-1970-*, ~24 days old, gated Boot --no-resume). Do NOT blindly
  resume them; triage — if their issues are not in the in-flight inventory
  above, leave them and note them in the run report.
- Lane M (Mind Your Now): MIN voice-UX / push-notifications / notification-tray
  items are in Verifying under an explicit **operator UAT hold — do not merge
  them**; they are not part of this drain.
- Tiered execution stays on: never pass `--model` / `--harness` on spawns —
  Cloister routes.
- Deploys: you are the deployer (primary main build + restart as in Phase 2).
- Red main = stop the line (strike-first). Never `--admin-bypass` while main is
  red.
- Record run state in `docs/FLYWHEEL-STATE.md` per tick — but commit only
  materially-important ticks (RUN-62 lesson: routine doc commits × flaky suite
  = red-main noise). Hand over via a fresh run before grinding past ~85%
  context.
