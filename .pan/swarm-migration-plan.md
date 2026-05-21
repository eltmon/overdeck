# src/lib Effect Migration — Swarm Plan

**Started:** 2026-05-20
**Status:** Prerequisites cleared, ready to begin pre-flight
**Owner:** eltmon
**Authority:** This is the live plan; refer to it across context compactions.

## Goal

Convert all of `src/lib/` (~250 production .ts files) from promise-based to
Effect-native via a single Panopticon swarm dispatch, using a topological-wave
DAG where each wave is fully parallel.

When this lands, **PAN-1246** (projection-cached VCS driver) unblocks naturally,
and the whole codebase matches the dashboard server's Effect-native baseline.

## Why this approach (key decisions)

1. **Swarm, not flywheel.** Flywheel is paused. The migration is mechanical and
   parallelizable — swarm's per-item DAG dispatch with `files_scope` is the
   right shape.

2. **One issue, multi-item vBRIEF plan — not many small issues.**
   PAN-1250/1251/1252 will be closed as "superseded by swarm dispatch."
   PAN-1249 (the umbrella) gets recast as the single swarm issue with N
   plan items.

3. **Topological-leaf-first slicing, not file-disjoint.** `files_scope` only
   prevents two slots writing the *same file*. It does not prevent the
   signature-cascade problem: if slot-A converts `agents.ts` from `Promise<X>`
   to `Effect.Effect<X, E>`, every caller breaks. So we migrate leaves first
   (files no one in `src/lib/` imports), then wave-by-wave up the import graph.
   By the time a file gets migrated, all its dependencies are already Effect.

4. **Effect-first, no promise→Effect adapter layer.** The dashboard server is
   already Effect; adding an adapter middle layer locks in tech debt.

## Status

### ✅ Prerequisites cleared
- **PAN-1178** (auto-advance broken, no slot-merge detector) — fixed via
  commit `90da3d3cd`. New `detectMergedSwarmSlots` deacon patrol queries
  GitHub PRs merged into parent feature branch and fires `postMergeLifecycle`
  for matching slot branches. 5-min cooldown bridges the async loopback window.
- **PAN-1194** (no recovery from unmergeable PR) — fixed via PR #1206 / commit
  `364caed8c`. `failed-merge` status, `refreshSwarmSlotMergeability` helper,
  `POST /api/swarm/:issueId/slot/:slotId/recover`, `pan swarm recover` CLI.

### Issues currently filed (will consolidate before dispatch)
- **#1246** — Perf: projection-cached VCS driver (depends on the migration; downstream beneficiary)
- **#1249** — Epic: Complete src/lib Effect migration (umbrella → becomes the swarm issue)
- **#1250** — `src/lib/checkpoint/` slice (close as superseded by swarm plan)
- **#1251** — cloister VCS-callers slice (close as superseded)
- **#1252** — `src/lib/close-out.ts` slice (close as superseded)
- **#1253** — Flywheel respect issue dependencies (independent substrate; keep)
- **#1254** — Tailscale integration (independent new work; keep)

### Open swarm bugs to know about
- **#1193** — no slot-to-slot file coordination — **MUST triage before dispatch.**
  If `hasFileOverlap` has gaps, the migration races.
- #1195 — parent agent goes silent during dispatch (annoying, not fatal)
- #1192 — `DEFAULT_SWARM_MODEL` hardcoded to `kimi-k2.6` (override at dispatch)
- #1202 — slot state dir cleanup (cosmetic)
- #1196 — workhorse routing by difficulty (future improvement)

## Plan (6 steps)

| # | Step | Owner | Status |
| --- | --- | --- | --- |
| 1 | Triage PAN-1193 — decide if it's a dispatch blocker | Claude | In progress |
| 2 | Build pre-flight analyzer (`scripts/analyze-effect-migration.ts`): parse `src/lib/**/*.ts`, build import graph, topological sort, emit vBRIEF plan with `files_scope` + `blocks` edges | Claude | In progress |
| 3 | Smoke-test swarm end-to-end with a small synthetic 3-5-item issue | eltmon drives | Pending |
| 4 | Consolidate issues — close #1250/1251/1252, attach generated vBRIEF plan to #1249 | Claude | Pending |
| 5 | Dry-run: `pan swarm 1249 --dry-run` to print wave plan | Together | Pending |
| 6 | Dispatch: `pan swarm 1249 --max-slots 10 --auto-advance --model <choice>` | eltmon launches | Pending |

## Pre-flight analyzer spec (step 2)

**Location:** `scripts/analyze-effect-migration.ts` (new)

**Input:** root of `src/lib/`

**Process:**
1. Walk all `src/lib/**/*.ts` excluding `**/__tests__/**` and `*.test.ts`
2. For each file, parse import statements (TypeScript compiler API or regex
   over `from\s+['"]([^'"]+)['"]`)
3. Resolve relative imports → absolute paths inside `src/lib/`
4. Skip files already Effect-native: today just `src/lib/cloister/flywheel.ts`
5. Build directed graph: edge `A → B` means A imports B
6. Topological sort; tie-break by file path for stability
7. Emit waves: wave-0 = leaves, wave-N = files whose imports are all in waves
   0..N-1
8. Output: vBRIEF plan JSON with one `VBriefItem` per file:
   - `id`: `effect-migrate-<sanitized-relative-path>`
   - `title`: `Effect migration: <relative path>`
   - `metadata.files_scope`: `[<relative path>]` (single-file scope)
   - `metadata.blocks`: array of item-ids this depends on (its imports' items)
   - `metadata.requiresSynthesis`: auto-set by Panopticon if blocking parents > 1

**Synthesis items:** add explicit synthesis items at wave boundaries so
downstream slots get a brief: "Wave N done — here are the new Effect
signatures for these files."

## Migration semantics — per-file acceptance criteria

Every slot migrating one file must:
- [ ] Convert `Promise<T>` return types → `Effect.Effect<T, E>` where `E` is a `Data.TaggedError`
- [ ] Replace `execAsync` / `execFileAsync` with `ChildProcessSpawner` from `@effect/platform-node`
- [ ] Replace `try/catch` with typed error channels — no thrown exceptions for expected failures
- [ ] Replace `fs/promises` with `@effect/platform` `FileSystem` service
- [ ] Update test file (if exists) to `@effect/vitest` with `it.effect()`
- [ ] No new `Effect.runPromise()` inside `src/lib/` — only at adapter boundaries
- [ ] Preserve all observable behavior — no logic changes alongside the migration
- [ ] Slot PR title format: `effect-migrate: <relative path>` for easy grep

## Dispatch parameters (planned)

- **Issue:** PAN-1249
- **Max slots:** 10 to start (24-core machine, 64GB RAM — leaves headroom)
- **Auto-advance:** yes (now that PAN-1178 is fixed)
- **Model:** TBD — override `kimi-k2.6` default per PAN-1192; mechanical migration
  fits a cheap-and-fast model, but signature work needs decent TS understanding
- **Synthesis model:** Opus or Sonnet for wave-boundary syntheses

## Rollback points

- `4627932f0` — last commit before today's planning/spec work
- `0d4686f51` — main as of "ready to start migration" (committed 2026-05-20)
- Any in-flight slot can be dropped via `pan swarm recover <id> <slot> drop`

## Key files (for re-reading after compaction)

- `features/swarm.mdx` — swarm CLI + concept docs
- `docs/SWARM.md` — engineering reference (full library API)
- `src/lib/vbrief/dag.ts` — `getDispatchableItems`, `hasFileOverlap`, `deriveSynthesisMetadata`
- `src/lib/vbrief/continue-state.ts` — `SwarmSlotRuntime`, `SwarmRuntime`, `SynthesisOutput` types
- `src/dashboard/server/routes/swarm.ts` — dispatch + recovery routes
- `src/cli/commands/swarm.ts` — `pan swarm` + `pan swarm recover`
- `roles/flywheel.md` — flywheel orchestrator (currently paused)

## PAN-1193 triage verdict (2026-05-20)

**Not a hard blocker for this migration, given three mitigations.**

Root cause of PAN-1193: `files_scope` is compiled at `swarm.ts:725` for overlap
detection at dispatch time, but **not enforced at merge time**. A slot can write
files outside its declared scope and the dispatcher doesn't reject the PR.

The original reproduction (PAN-1148, slot-2 inventing `AgentCard.tsx`) required
a slot agent to *fabricate primitives outside scope* because its test wouldn't
pass otherwise. Our migration has no such pressure: each slot converts one
existing file's signatures. Nothing to invent.

Required mitigations for safe dispatch (must be in slot prompt + plan):

1. **Per-slot prompt forbids out-of-scope file creation.** Hard rule in
   prompt: "Only modify the file in your `files_scope`. If you need a shared
   type or error class, declare it in your slot report and stop — do not
   create it yourself."
2. **Wave-0 pre-creates shared utilities.** Analyzer must emit a wave-0 item
   that lands `Data.TaggedError` subclasses (`VcsError`, `FsError`, `GitError`,
   `TmuxError`, etc.) in a new `src/lib/errors.ts` before any per-file slot
   runs.
3. **Topological wave ordering enforced by construction.** Each slot starts
   only after every file it imports is merged — so file Y already exists in
   its new Effect-native shape when slot-X runs.

Filing a real PAN-1193 fix (wire `files_scope` enforcement at merge time) is
good substrate work but doesn't block this migration. Capture as a follow-up.

## Notes / TBD

- Decide on synthesis-agent prompt template before dispatch — what context do
  downstream slots need from upstream syntheses?
- Consider committing the analyzer script + generated vBRIEF plan to a
  separate branch first so the dispatch artifact is reviewable before launch.
- After migration completes, the dispatch-time vBRIEF plan becomes a
  permanent record — keep it in the repo (e.g. `.pan/specs/` per convention)
  for forensics.
- Identify the right shared-error wave-0 list: likely `VcsError`, `FsError`,
  `GitError`, `TmuxError`, `TrackerError`, `CheckpointError`, plus a small set
  of common error tags. Will fall out of the analyzer's import graph.

## Analyzer output (step 2 complete — 2026-05-20)

Ran `scripts/analyze-effect-migration.ts`. Output at
`.pan/swarm-migration-plan.vbrief.json` (uncommitted; review before attaching
to the issue).

**Shape:**
- **254 production .ts files** to migrate (excluded: tests, `cloister/flywheel.ts`)
- **702 internal import edges**
- **227 vBRIEF items** (one per file, plus coalesced cyclic SCCs)
- **774 blocks edges** (deduped at item level)
- **13 waves** total — wave-0 = shared errors, then 12 topological waves
- **7 cyclic SCCs detected via Tarjan**, all coalesced into single multi-file items:
  - 14-file SCC at wave 6: `activity-logger.ts` + 13 more (includes `agents.ts` — the 150KB beast)
  - 7-file SCC at wave 2: `pan-dir/continue.ts` + 6 more (vbrief lifecycle)
  - 4-file SCC at wave 7: `database/review-status-db.ts` + 3 more
  - 3-file SCCs at waves 2 and 4
  - 2-file SCCs at waves 4 and 11

**Validated** against existing `src/lib/vbrief/dag.ts::groupItemsByWave` — parses
cleanly, returns 13 waves with the expected shape.

**Per-wave item counts (biggest = most parallelism):**

| Wave | Items | Notes |
| --- | --- | --- |
| 0 | 1 | Shared errors (`src/lib/errors.ts`) |
| 1 | 54 | True leaves — biggest parallel wave |
| 2 | 48 | Includes 2 cyclic SCC items |
| 3 | 28 | |
| 4 | 19 | Includes 2 cyclic SCC items |
| 5 | 15 | |
| 6 | 6 | Includes the 14-file SCC (the big one) |
| 7 | 27 | Includes the 4-file SCC |
| 8 | 21 | |
| 9 | 3 | |
| 10 | 2 | `cloister/merge-agent.ts`-cluster |
| 11 | 2 | Includes 2-file SCC with `cloister/deacon.ts` |
| 12 | 1 | `cloister/index.ts` (the top of the lib tree) |

**Critical path:** 13 waves. With ~10 parallel slots and conservative ~10min/slot,
wall-clock estimate ~3-4 hours for the migration (after first-wave warmup).

**Worst-case slot:** the 14-file SCC at wave 6 containing `agents.ts` (150KB).
That single slot rewrites 14 mutually-recursive files in one PR. Likely needs the
strongest model (Opus or Sonnet) and may warrant manual oversight.

## Session checkpoint log

- **2026-05-20** — Plan drafted. Prerequisites (PAN-1178, PAN-1194) cleared.
  Issues 1246/1249/1250/1251/1252/1253/1254 filed. Flywheel paused by eltmon.
- **2026-05-20** — Step 1 (PAN-1193 triage) complete: not a blocker given
  wave-0 shared errors + strict per-slot prompt mitigation.
- **2026-05-20** — Step 2 (analyzer) complete. `scripts/analyze-effect-migration.ts`
  generated `.pan/swarm-migration-plan.vbrief.json` — 227 items, 774 edges,
  13 waves. Awaiting step 3 (smoke test) before step 4 (consolidate issues).
