# CI/CD Reliability Queue — canonical ordered list (2026-07-04)

**Epic:** [PAN-2376](https://github.com/eltmon/overdeck/issues/2376). This file is the single
ordered list for the CI/CD reliability campaign, in the same format as
`docs/codebase-health/REFACTOR-QUEUE.md`. Maintained by the orchestrating conversation;
update the Status column as items move.

**Why (one paragraph):** the RUN-55 stability drain proved delivery machinery is the
bottleneck, not code health. One flaky test stalled a release and burned three
verification cycles on an unrelated lint change; strike and swarm merge paths each
stranded finished work in the same week; `pan reload` can deploy stale code because
local main runs ~60 auto-commits/day ahead of origin; APPROVED PRs stall before merge
with no convergence guarantee. This queue makes the delivery spine boring.

**Principles (from the epic):**
1. Nothing intermittent may gate (flakes → retry + audited quarantine; CodeRabbit →
   opportunistic, structurally non-gating).
2. Done work must converge to merged without a human nudge (durable, idempotent
   completion signals + reconcilers with tombstones — the PAN-2357/PAN-2367 lesson).
3. Destructive patrols require durable proof, never `ahead==0` inference.
4. Deploys build from origin/main, always.

**Execution model:** same as the refactor sprint — PRD-first (drafts in
`drafts/PAN-<n>.md` on `overdeck-state`, `Verified-Against` header, grep anchors, re-verify sections),
one work agent at a time within a phase; Phase 0/3/4 items are peripheral and safe for
normal pipeline flow; Phase 1/2 touch pipeline machinery (TENET-10: red main stalls the
pipeline that ships the fix) — one at a time, full suite before merge, verify against
origin HEAD.

**Interleaving with the refactor campaign (2026-07-04):** cross-campaign ordering is
owned by `docs/master-plan-cicd-and-refactoring.md`. Summary: Phases 0/3 and the
non-cloister Phase 4 items are **Lane A** (parallel-safe, dispatch any time); Phases
1/2 are **Lane B** (strictly serial, one in flight) and land BEFORE refactor Phase 3's
cloister decompositions — small fixes rebase cheaply under a later decomposition, the
reverse rewrites every PRD anchor at once. PAN-2297 must land before refactor PAN-2233.

**PRD chaining rule** applies verbatim from REFACTOR-QUEUE.md: every PRD carries
`Verified-Against: main @ <sha>`; grep anchors, never bare line numbers; if a PRD's
target is modified by an earlier queue item, list assumptions in
`## Re-verify at execution`; heavy-dependency PRDs are deferred and written when the
predecessor lands.

## Phase 0 — flakes stop gating (release unblockers, do first)

| # | Issue | What | Status |
|---|---|---|---|
| 1 | [PAN-2373](https://github.com/eltmon/overdeck/issues/2373) | Flake policy: CI `retry: 1` + audited quarantine list + non-blocking flake lane + verification-runner integration | **PRD written — on main** |
| 2 | [PAN-2371](https://github.com/eltmon/overdeck/issues/2371) | Fix conversation-supervisor-uat flake (readiness wait before `#create` click); leaves quarantine when green 20× | **PRD written — on main** |
| 3 | [PAN-2336](https://github.com/eltmon/overdeck/issues/2336) | beads DB setup race in CI (`table not found: issues`) — deterministic schema init | **PRD written — on main** |

## Phase 1 — verification-to-merge convergence (absorbs closed umbrella PAN-2198)

| # | Issue | What | Status |
|---|---|---|---|
| 4 | [PAN-2207](https://github.com/eltmon/overdeck/issues/2207) | `pan done` idempotent per step + deacon patrol for "PR open + beads closed + review never requested" | **PRD written — on main** |
| 5 | [PAN-2341](https://github.com/eltmon/overdeck/issues/2341) | Boot-time convoy reconcile + zombie review/test agent reap (advancing-ceiling jam) | **PRD written — on main** |
| 6 | [PAN-2167](https://github.com/eltmon/overdeck/issues/2167) | Clean-tree gate exempts pipeline-owned state paths (the pre-migration record/test layout) | **PRD written** |

## Phase 2 — strike + swarm merge-path hardening (TENET-10; one at a time)

| # | Issue | What | Status |
|---|---|---|---|
| 7 | [PAN-2359](https://github.com/eltmon/overdeck/issues/2359) + [PAN-2363](https://github.com/eltmon/overdeck/issues/2363) | One shared "provably merged" guard (had commits AND all in main / durable completion override) used by strike reaper AND slot GC — kills the `ahead==0` class | **PRD written — on main** (single PRD, two issues) |
| 8 | [PAN-2360](https://github.com/eltmon/overdeck/issues/2360) + [PAN-2300](https://github.com/eltmon/overdeck/issues/2300) | Strike contract: kickoff template stops instructing merge/push-to-main (2360); `pan done --strike` verifies via PR merged-state not ancestry (2300, re-scoped) | **PRD written — on main** (single PRD, two issues) |
| 9 | [PAN-2270](https://github.com/eltmon/overdeck/issues/2270) | Strike-originated PRs reviewable: resolve review target from PR branch (no phantom feature workspace required) | **PRD written — on main** |
| 10 | [PAN-2372](https://github.com/eltmon/overdeck/issues/2372) | Slot `pan done` writes statusOverrides atomically + verified (empty continue.json class) | **PRD written — on main** |
| 11 | [PAN-2364](https://github.com/eltmon/overdeck/issues/2364) | Per-slot failure isolation (failedMergeBlock keyed by slot) | **PRD written — on main** |

## Phase 3 — deploy + state hygiene

| # | Issue | What | Status |
|---|---|---|---|
| 12 | [PAN-2095](https://github.com/eltmon/overdeck/issues/2095) | `pan reload` builds from freshly-fetched origin/main, never local primary HEAD | **PRD written — on main** |
| 13 | [PAN-2375](https://github.com/eltmon/overdeck/issues/2375) | Auto-commit churn: debounce/coalesce flushes, auto-push policy, divergence surfaced in `pan doctor` | **PRD written — on main** |

## Phase 4 — review automation + guardrails

| # | Issue | What | Status |
|---|---|---|---|
| 14 | [PAN-2374](https://github.com/eltmon/overdeck/issues/2374) | CodeRabbit: install config, ingest reviews opportunistically into convoy context, reply-on-address, structurally non-gating (locked by test) | **PRD written — on main** |
| 15 | [PAN-2229](https://github.com/eltmon/overdeck/issues/2229) | Prompt-regression evals for `roles/*.md` + CI diff gate (soul-degradation class) | PRD exists on main (pre-epic) — re-verify at execution |
| 16 | [PAN-2230](https://github.com/eltmon/overdeck/issues/2230) | Circular-dependency ratchet (madge shrink-only baseline in lint chain) | **IMPLEMENTED** — `npm run lint:circular` guards `src/` against new cycles; 77-cycle baseline at `scripts/circular-deps-baseline.txt` |
| 17 | [PAN-2297](https://github.com/eltmon/overdeck/issues/2297) | File-size baseline auto-lowering on the UAT batch merge path | **PRD written — on main** |
| 18 | [PAN-2265](https://github.com/eltmon/overdeck/issues/2265) | GraphQL quota exhaustion remediation | already in-review — shepherd to close, no new PRD |

## Cleanup log

- [PAN-2198](https://github.com/eltmon/overdeck/issues/2198) closed 2026-07-04 — umbrella consolidated into Phase 1 (comment on issue).
- [PAN-2300](https://github.com/eltmon/overdeck/issues/2300) re-scoped 2026-07-04 to the squash-ancestry defect only; kickoff-contract defect is canonical in [PAN-2360](https://github.com/eltmon/overdeck/issues/2360).
- [PAN-2358](https://github.com/eltmon/overdeck/issues/2358) (transformMessageForHarness restore) reviewed for membership and deliberately EXCLUDED — it is a behavior fix, not delivery machinery; it stays in normal pipeline flow.

## Exit criteria (from the epic)

- A release cuts with zero manual test-retry loops.
- 14 consecutive days without an operator unstick of an APPROVED-but-unmerged issue.
- Zero reaps/GCs of workspaces holding unmerged or fresh work.
- `pan reload` provably ships origin/main HEAD.
- CodeRabbit findings reach review-convoy context when present; merge readiness provably never reads CodeRabbit state.

**Baseline for measurement:** main @ `facf1685785dc553f44e2c0257a00a12bf36bcea` (2026-07-04).
