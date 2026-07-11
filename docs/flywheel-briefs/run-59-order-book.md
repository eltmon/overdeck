# RUN-59 — The Order Book Run (continuation)

**Operator-released 2026-07-08. This brief is the explicit go.**
Successor to RUN-58 (which ran 2026-07-05→07-08: v0.44.0 shipped — the cost &
metering trio PAN-2387/2388/2389 all landed; resolved two red-main incidents
PAN-2490/PAN-2496; filed swarm substrate gap PAN-2498; reconciled primary main).

Your durable doctrine — identity, tick loop, pickup gate, constraints — lives in
`roles/flywheel.md`; *why* the loop exists lives in `vision.mdx`. Read both before
acting. This brief overrides only the SCOPE sections of the standard brief
(`docs/flywheel-brief.md`); every doctrine constraint still applies.

## Binding documents

1. `docs/master-plan-cicd-and-refactoring.md` — the order book (binding order).
   Lane A (parallel-safe) + Lane B (strictly serial). Where this brief and the
   master plan disagree, the master plan wins.
2. `docs/ci-cd/CICD-QUEUE.md` + `docs/codebase-health/REFACTOR-QUEUE.md` —
   per-campaign detail. Update their Status columns as items land (commit with
   close-outs).
3. `docs/FLYWHEEL-STATE.md` — durable memory from prior runs.
4. This file — run-specific rules; they add release policy and refreshed scope,
   and override nothing in the order book.

## The mission — drain what remains (verified open on GitHub 2026-07-08)

The order book is **8/10 Lane A done and B0–B2 done**. Drain the remainder:

**Lane A — 2 remaining (dispatch anytime, overlap freely):**
- A9 = [PAN-2229](https://github.com/eltmon/overdeck/issues/2229) — prompt-regression evals. Pre-epic PRD — **re-verify before dispatch**.
- A11 = [PAN-2108](https://github.com/eltmon/overdeck/issues/2108) — flywheel cannot recover context-exhausted / user-stopped / troubled work agents. Operator-priority; cloister-adjacent — coordinate with Lane B if diffs collide.

**Lane B — strictly serial, START AT B3 (B0–B2 done). Small-fixes-first, decompositions-second:**

CI/CD reliability fixes (land these first — several fix strike/swarm bugs that
slow *this* flywheel):
- B3 = [PAN-2167](https://github.com/eltmon/overdeck/issues/2167) — clean-tree gate (pipeline records dirty the worktree, block `pan review request`).
- B4 = [PAN-2359](https://github.com/eltmon/overdeck/issues/2359) + [PAN-2363](https://github.com/eltmon/overdeck/issues/2363) — shared provably-merged guard (one PRD, two issues; fresh 0-commit branches must not classify as merged).
- B5 = [PAN-2360](https://github.com/eltmon/overdeck/issues/2360) + [PAN-2300](https://github.com/eltmon/overdeck/issues/2300) — strike contract + squash verification (one PRD, two issues).
- B6 = [PAN-2270](https://github.com/eltmon/overdeck/issues/2270) — review pipeline must handle strike-originated PRs.
- B7 = [PAN-2372](https://github.com/eltmon/overdeck/issues/2372) — atomic statusOverrides on slot done.
- B8 = [PAN-2364](https://github.com/eltmon/overdeck/issues/2364) — per-slot failure isolation.

Refactor Phase 3 decompositions (after the CI/CD fixes; **re-verify each PRD
against current main before dispatch** — see the ⚠️ note below):
- B9 = [PAN-2149](https://github.com/eltmon/overdeck/issues/2149) — decompose `cloister/service.ts`.
- B10 = [PAN-2232](https://github.com/eltmon/overdeck/issues/2232) — decompose `cloister/specialists.ts`.
- B11 = [PAN-2233](https://github.com/eltmon/overdeck/issues/2233) — decompose `cloister/merge-agent.ts`. (Its dependency A8 = PAN-2297 is **DONE** ✅.)
- B12 = [PAN-2190](https://github.com/eltmon/overdeck/issues/2190) — decompose `routes/workspaces/merge-ops.ts`.
- B13 = [PAN-2189](https://github.com/eltmon/overdeck/issues/2189) — decompose `cloister/deacon.ts`. **PRD authored fresh only after B1–B12 land** (its seams shift with each).

Drip rules (from the master plan, binding): **exactly one Lane B item in flight**;
main green + close-out between Lane B items; 1–3 Lane A items alongside; respect
`cloister.concurrency`. TENET-10 on Lane B: full suite green before merge (no
`--changed` shortcuts on cloister files), verify against `origin/main` HEAD.

## ⚠️ Fresh-main hazard — PAN-2507 just landed (2026-07-08, THIS session)

The preemptive-scheduler feature **PAN-2507** merged to main immediately before
this run, touching the exact cloister-core files several decompositions target:
`deacon.ts` (+9), `deacon-auto-resume.ts` (+10), `deacon-review-status.ts`, plus a
new `src/lib/cloister/preemption.ts`, and it **bumped the file-size baselines**
(`deacon.ts` 3593, `deacon-auto-resume.ts` 1035, `schema.ts` 1660 in
`scripts/file-size-baseline.txt`). Consequences you must honor:

- **B9 / B11 / B13 PRD re-verification is now mandatory, not optional** — their
  grep anchors and line numbers drifted. Re-verify against current `origin/main`
  before dispatch; if a PRD's before/after snippets no longer match, send it back
  through planning rather than dispatching stale.
- A decomposition that lands must **shrink** its file below the new baseline (the
  file-size guard blocks growth). Wiring PAN-2507 grew these files; the
  decompositions are how they come back down.

## Release policy (operator-decided)

- **v0.44.0 has SHIPPED** (2026-07-08; the cost & metering trio + earlier
  order-book items). That release target is spent.
- **This run has no fixed release target.** Order-book items are CI/CD reliability
  and refactor debt — they never, by themselves, gate a release. When a coherent
  batch of the Lane B CI/CD fixes (B3–B8) has landed + deployed + verified, **report
  release readiness and SUGGEST** the next cut (a v0.44.1 patch if it's fixes-only,
  or v0.45.0 if it carries user-visible change). **The operator cuts releases — you
  never tag.** If the operator names a specific milestone mid-run, adopt it.

## Inherited state at RUN-59 start (verified 2026-07-08)

- **Pipeline is clean** — no order-book work in flight; no work/plan/review/strike
  agents running (only operator conversation sessions). Your first tick is a clean
  Observe → Act.
- `flywheel.auto_pickup_backlog=false` (drain posture): the order book **replaces**
  backlog saturation. Do NOT start unlisted work — emergency `blocks-main`
  unblockers excepted (strike-first, per doctrine).
- `flywheel.require_uat_before_merge=false` (current config). Lane B still requires
  the full suite green before merge regardless (TENET-10).
- **PAN-399** swarm slots are preserved; the operator chose NOT to restart it — do
  not merge or GC its slot branches. **PAN-2498** (swarm failed-slot never
  auto-redispatched/surfaced) is filed but NOT in this run's scope unless the
  operator adds it — though B7/B8 are adjacent.

## Standing rules (carried from RUN-58)

- **PAN-2507 preemptive scheduler is now LIVE** (`[concurrency] preemption = true`
  in `cloister.toml`). A blocked review/test/merge dispatch may now yield an idle
  work agent to free a slot, then resume it oldest-first. Expect activity-feed
  lines like `Yielded agent-… to run review for PAN-…`; this is working as designed,
  not a fault.
- Tiered execution (Standing Crew) is ENABLED globally. Never pass `--model` /
  `--harness` on spawns — Cloister routes.
- Dispatch = re-verify PRD if needed → `pan plan <id> --auto` → `pan start <id>`.
  PRDs live at `.pan/drafts/PAN-<n>.md`.
- `pan handoff` is NOT for delegated implementation (it forks the caller).
- **Deploys**: build from primary main + `pan restart --dashboard --health-timeout
  180000` (ms). You are the deployer. After restart, verify the new pid binds
  :3011 with `deacon=on`.
- Releases are operator-owned. Report readiness; never tag.
- Red main = stop the line (strike-first). Never `--admin-bypass` while main is red.
- Record run state in `docs/FLYWHEEL-STATE.md` per tick. Hand over via a fresh run
  before grinding past ~85% context.
