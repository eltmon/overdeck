# Refactor Queue — canonical ordered list (2026-07-02 sprint)

**This file is the single ordered list of the remaining codebase-health refactoring work.**
It supersedes the priority section of `REMAINING-BACKLOG.md` (which is retained for the
honest-state narrative). Maintained by the orchestrating conversation during the
2026-07-02 GPT-5.5 refactor sprint; update the Status column as items move.

**Execution model (operator-directed 2026-07-02):**
- **One GPT-5.5 work agent at a time** (`pan start <id> --model gpt-5.5`, harness = provider
  default/codex). Heavy refactors do not parallelize safely against each other.
- **One vBRIEF planned ahead** at all times (planning role runs on the configured default,
  claude-fable-5). Planning is **PRD-first** (see `roles/plan.md`): the PRD draft must exist
  before the vBRIEF is lowered from it.
- **PRDs written ahead of time** by a dedicated Fable 5 handoff agent, in queue order,
  to `<projectRoot>/.pan/drafts/PAN-<n>.md` (uppercase — the de-facto house convention,
  66 of 78 existing drafts).
- The Flywheel is currently idle; the orchestrating conversation is the merge gate.
  If the Flywheel comes back on, Phase 2/3 items stay `needs-handoff` (TENET-10).

**PRD chaining rule (line-number drift):** every PRD carries a
`Verified-Against: main @ <sha>` header. References use **grep anchors (quoted code)**,
never bare line numbers. A PRD whose target file is modified by an *earlier* queue item
must list those assumptions in a `## Re-verify at execution` section; if the dependency
is so heavy the PRD would be guesswork, it is **deferred** (marked below) and written
only when its predecessor lands.

## Phase 0 — already planned, dispatch serially (specs banked in `.pan/specs/`)

| # | Issue | Target | Status |
|---|---|---|---|
| 1 | PAN-2156 | `services/conversation-service.ts` (1,609) → modules | spec `proposed`; **dispatching now** |
| 2 | PAN-2154 | `lib/workspace-manager.ts` (1,736) → modules | spec `proposed`; queued |
| 3 | PAN-2153 | `routes/specialists.ts` (1,753) → modules | spec `proposed`; queued |
| 4 | PAN-2151 | `routes/misc.ts` (1,832) → modules | planned in workspace but **spec never promoted to main** (finalize silent-skip class) — re-run finalize before dispatch |

## Phase 1 — guardrails first (protect the campaign from itself)

These prevent the red-main/erosion failure modes observed 2026-06-28 → 07-02. Small,
peripheral, safe for autonomous pipeline flow once planned.

| # | Issue | What | PRD |
|---|---|---|---|
| 5 | PAN-2227 | Ratchets enforced at write point: pre-push guard, auto-lowering baselines, audited bumps | needed |
| 6 | PAN-2231 | Lint ban on source-introspection tests (red-main #2124 class) | needed |
| 7 | PAN-2230 | Circular-dependency ratchet (madge baseline in lint) | needed |
| 8 | PAN-2234 | Mechanical PRD-first gate in `pan plan finalize` / complete-planning | needed |

## Phase 2 — route thinning (the three biggest god files, done right)

**Approach decision (2026-07-02, orchestrator review):** these are *route-thinning*
refactors, NOT barrel splits. Move domain logic behind the two doors
(`src/lib/overdeck/` resolvers/writers, per the single-source-of-truth tenet and
PAN-1936); routes become thin adapters. A barrel split of a route file optimizes the
line-count metric while keeping the module shallow — the workspaces split proved it by
*creating* a new god file (`merge-ops.ts`, 1,925). PRDs must specify the door modules.

| # | Issue | Target | Notes |
|---|---|---|---|
| 9 | PAN-2148 | `routes/issues.ts` (4,065) | PRD needed (rewrite from inline barrel-split body) |
| 10 | PAN-2147 | `routes/agents.ts` (4,071) | PRD needed (same) |
| 11 | PAN-2145 | `routes/conversations.ts` (5,316 — grew +418 while gated) | PRD **deferred** until PAN-2156 lands (routes call conversation-service; seams move) |

## Phase 3 — cloister core (pipeline machinery; supervised, sequenced, never batched)

TENET-10 territory: a red main here stalls the pipeline that ships the fix. One at a
time, full suite before merge, verify against origin HEAD.

| # | Issue | Target | Notes |
|---|---|---|---|
| 12 | PAN-2149 | `cloister/service.ts` (2,057, regrowing — reddened main 07-02) | PRD needed |
| 13 | PAN-2232 | `cloister/specialists.ts` (1,749) | PRD needed |
| 14 | PAN-2233 | `cloister/merge-agent.ts` (1,414) — in-flight-guard test must stay green | PRD needed |
| 15 | PAN-2190 | `routes/workspaces/merge-ops.ts` (1,925 — created by the workspaces split) | PRD needed |
| 16 | PAN-2189 | `cloister/deacon.ts` (3,403) | PRD **deferred** until 12–15 land (deacon imports shift with each) |

## Phase 4 — deep foundations (the highest-leverage, least line-county work)

| # | Issue | What | Notes |
|---|---|---|---|
| 17 | PAN-2228 | Delivery door: one transport primitive, loud failure semantics (zombie-kickoff class) | PRD needed |
| 18 | PAN-2229 | Prompt-regression protection: evals over `roles/*.md` + CI diff gate (soul-degradation class) | PRD needed |
| 19 | PAN-1983 / PAN-1984 | Legacy `panopticon.db` module + test teardown (dual-DB coexistence) | existing issues; partial progress recorded on both |
| 20 | PAN-1936 / PAN-2008 | Read-door consolidation + store-access CI guard | largely *absorbed by Phase 2 PRDs*; close or re-scope after Phase 2 |

## Related in-pipeline items being shepherded alongside (not queue members)

- PAN-2150 — merged & goal met (SettingsPage 646 lines) but reopened 2026-07-01 without
  comment; needs an operator/orchestrator disposition.
- `strike/pan-1935` — implemented cost-recording fix stranded off-main; land or re-strike.
- `feature-pan-1864` workspace/branch — planning-only residue for a now-closed issue; clean up.

## PRD skip list (deliberately not written ahead)

- PAN-2145 (until PAN-2156 lands) and PAN-2189 (until Phase 3 items 12–15 land) — their
  target files' seams depend on predecessors; an early PRD would be guesswork against a
  future codebase. All other PRDs are writable now with grep anchors + re-verify sections.
