# xBRIEF scale and dispatch research

Collected 2026-07-26 to ground three upcoming decisions: adding `planRef` plan-sharding support (authoring + consumption), adopting per-item dispatch metadata (the deftai/xBRIEF#40 v0.9 proposal), and TRON encoding. Data sourced exclusively from the overdeck project (`/home/eltmon/Projects/overdeck`, its state worktree at `~/.overdeck/state/panopticon-cli`, and `github.com/eltmon/overdeck`); other projects were deliberately excluded.

## Corpus snapshot

The canonical spec corpus is **389 specs** in `~/.overdeck/state/panopticon-cli/specs/`: 369 pre-rename `.vbrief.json` files (April–July 2026) and 20 post-rename `.xbrief.json` files (July 2026). 266 planning artifacts (259 `.md` drafts + 7 mockup `.html` files) also live in the same worktree.

### Combined corpus

| Metric | Value |
|---|---|
| Total specs | 389 |
| Total items | 3,296 |
| Spec size p50 / p90 / max | 23.4 KB / 50.3 KB / **1,099.1 KB** |
| Spec tokens p50 / p90 / max (bytes/4) | 5,994 / 12,894 / **281,360** |
| Item count p50 / p90 / max | 6 / 16 / **227** |
| Item size p50 / p90 / max | 1.9 KB / 3.2 KB / 7.2 KB |
| Items > 8 KB (~2k tokens) | 0 / 3,296 (0%) |

### Era split

| Metric | vbrief era (369 specs) | xbrief era (20 specs) |
|---|---|---|
| Date range | 2026-04 – 2026-07 | 2026-07 |
| Spec size p50 / p90 / max | 23.0 KB / 51.1 KB / **1,099.1 KB** | 27.0 KB / 38.7 KB / 65.8 KB |
| Spec tokens p50 / p90 / max | 5,888 / 13,081 / **281,360** | 6,913 / 9,902 / 16,840 |
| Item count p50 / p90 / max | 6 / 17 / **227** | 6 / 11 / 18 |
| Item size p50 / p90 / max | 1.9 KB / 3.2 KB / 7.2 KB | 2.4 KB / 3.5 KB / 4.4 KB |
| Items > 8 KB | 0 / 3,152 (0%) | 0 / 144 (0%) |

Combined size buckets:

| Bucket | Count |
|---|---|
| < 25 KB | 209 |
| 25–75 KB | 173 |
| 75–150 KB | 6 |
| 150–500 KB | 0 |
| > 500 KB | 1 |

Top 10 largest specs (full corpus):

| Issue | Date | Era | KB | Items | Est. tokens |
|---|---|---|---|---|---|
| [PAN-1249](https://github.com/eltmon/overdeck/issues/1249) | 2026-05-20 | vbrief | 1,099.1 | 227 | 281,360 |
| [PAN-1148](https://github.com/eltmon/overdeck/issues/1148) | 2026-05-18 | vbrief | 116.1 | 43 | 29,720 |
| [PAN-1312](https://github.com/eltmon/overdeck/issues/1312) | 2026-05-22 | vbrief | 96.5 | 47 | 24,693 |
| [PAN-1048](https://github.com/eltmon/overdeck/issues/1048) | 2026-05-09 | vbrief | 89.9 | 32 | 23,027 |
| [PAN-1052](https://github.com/eltmon/overdeck/issues/1052) | 2026-05-12 | vbrief | 85.8 | 40 | 21,966 |
| [PAN-705](https://github.com/eltmon/overdeck/issues/705) | 2026-04-14 | vbrief | 83.8 | 54 | 21,450 |
| [PAN-2464](https://github.com/eltmon/overdeck/issues/2464) | 2026-07-07 | vbrief | 82.4 | 22 | 21,091 |
| [PAN-2647](https://github.com/eltmon/overdeck/issues/2647) | 2026-07-16 | vbrief | 75.0 | 18 | 19,194 |
| [PAN-1487](https://github.com/eltmon/overdeck/issues/1487) | 2026-05-25 | vbrief | 74.5 | 27 | 19,074 |
| [PAN-2543](https://github.com/eltmon/overdeck/issues/2543) | 2026-07-09 | vbrief | 73.9 | 21 | 18,926 |

The post-rename xbrief era is a narrow, small-plan slice. The historical tail contains plans an order of magnitude larger, with PAN-1249 alone at 1.1 MB and 227 items.

## What our specs already use

Overdeck consumes dispatch metadata in `src/lib/agents/slot-merge.ts` and `src/lib/xbrief/quality-lint.ts`. Feature usage across the full corpus and by era:

| Field | Combined specs | Combined items | vbrief specs | vbrief items | xbrief specs | xbrief items |
|---|---|---|---|---|---|---|
| `planRef` / `planRefs` | 0 / 389 | 0 / 3,296 | 0 / 369 | 0 / 3,152 | 0 / 20 | 0 / 144 |
| `metadata.verify_commands` | 130 / 389 | 995 / 3,296 | 110 / 369 (70% lack) | 851 / 3,152 | 20 / 20 | 144 / 144 |
| `metadata.expected_outputs` | 130 / 389 | 992 / 3,296 | 110 / 369 (70% lack) | 848 / 3,152 | 20 / 20 | 144 / 144 |
| `metadata.files_scope` | 133 / 389 | 1,237 / 3,296 | 113 / 369 (69% lack) | 1,093 / 3,152 | 20 / 20 | 144 / 144 |
| `metadata.difficulty` | 385 / 389 | 3,270 / 3,296 | 365 / 369 (1% lack) | 3,126 / 3,152 | 20 / 20 | 144 / 144 |
| Item `summary` | 0 / 389 | 0 / 3,296 | 0 / 369 (100% lack) | 0 / 3,152 | 0 / 20 | 0 / 144 |

Uniform emission of `verify_commands`, `expected_outputs`, `files_scope`, and `difficulty` is an **xbrief-era behavior only**. In the vbrief era, roughly 70% of specs lack the three verification/dispatch fields, while `difficulty` was already nearly universal. `planRef` is unused in both eras, and `summary` is absent everywhere.

Interpretation: the dispatch-metadata emit-gap is real historically. A v0.9 migration would both rename fields (`verify_commands` → `verifyCommands`, etc.) and require backfilling or accepting that pre-xbrief plans carry sparse metadata. The v0.9 proposal's new fields (`filesScopeConfidence`, `criterion` item type) are not yet emitted anywhere.

## Revision and authoring cost

Revision pressure on the 5 largest xbrief-era specs, plus PAN-1249:

| Issue | Spec revisions after creation |
|---|---|
| [PAN-1525](https://github.com/eltmon/overdeck/issues/1525) | 5 |
| [PAN-2066](https://github.com/eltmon/overdeck/issues/2066) | 4 |
| [PAN-2997](https://github.com/eltmon/overdeck/issues/2997) | 6 |
| [PAN-3076](https://github.com/eltmon/overdeck/issues/3076) | 5 |
| [PAN-3115](https://github.com/eltmon/overdeck/issues/3115) | 4 |
| [PAN-1249](https://github.com/eltmon/overdeck/issues/1249) | 1 |

Overall spec-write churn in the state worktree: 371 commits to `specs/` in the last 3 months. That figure includes both planning edits and lifecycle status transitions, so it overstates pure authoring churn, but it confirms the whole-document write path is busy. PAN-1249 itself was written once and not subsequently revised in the state worktree; the churn was in execution and issue-level scope negotiation.

## Large-plan incidents

Tracker issues that illustrate the economics of large plans and finalize churn:

- **[PAN-1249](https://github.com/eltmon/overdeck/issues/1249)** — `Complete src/lib Effect migration (single swarm dispatch)` produced a 227-item, 774-edge, 13-wave vBRIEF plan for 254 files. The issue was closed, audited, reopened, and eventually consolidated into [PAN-1313](https://github.com/eltmon/overdeck/issues/1313) because the original per-file acceptance criteria were not met. Shows that very large monolithic plans can outlive their own success criteria.

- **[PAN-1313](https://github.com/eltmon/overdeck/issues/1313)** — `Finish src/lib Effect migration: remove or justify legacy Promise/sync surfaces`. The continuation of PAN-1249; still open. Demonstrates that a large plan whose scope is not fully delivered becomes a long-running umbrella rather than a shippable unit.

- **[PAN-2202](https://github.com/eltmon/overdeck/issues/2202)** — `complete-planning silently skips spec promotion on a dead session's unanswered AskUserQuestion`. finalize reported success while the canonical spec was never written to main. Root cause: AUQ counting summed every `.jsonl` in the project dir, including orphaned sessions. Cost of finalize failure mode: silent loss of the durable plan.

- **[PAN-2241](https://github.com/eltmon/overdeck/issues/2241)** — `complete-planning is not serialized or idempotent per issue`. Concurrent finalizes for PAN-2153 raced on `<spec>.vbrief.json.tmp`, threw 500s, and thrashed beads via delete-all-recreate. Suggests whole-document finalize is a single-writer chokepoint that does not scale under contention.

- **[PAN-2195](https://github.com/eltmon/overdeck/issues/2195)** — `pan plan finalize re-plan churn: stale superseded spec on main transiently materializes the old plan`. Re-planning PAN-1762 caused the old 16-item spec's beads to appear before the new 18-item spec won. Whole-document replacement creates transient mixed-plan states.

- **[PAN-944](https://github.com/eltmon/overdeck/issues/944)** — `Make vBRIEF the durable task graph source of truth`. Open since 2026-05-02. Indicates the durable task-graph migration is still incomplete; sharding should not assume a fully settled vBRIEF storage layer.

- **[PAN-3061](https://github.com/eltmon/overdeck/issues/3061)** — `Dispatch-topology advisor: mechanical start-vs-swarm recommendation at plan-finalize`. Current planned work to use per-item metadata at finalize time to choose dispatch topology. Validating that metadata is already emitted is a prerequisite.

## Upstream state (deftai)

- **Directive** released v0.85.0 on 2026-07-26 with security fixes.
- **Overdeck's xBRIEF fork** (`eltmon/xBRIEF`) is 1 commit ahead of `deftai/xBRIEF` master with the unmerged v0.9 agentic-dispatch schema proposal ([deftai/xBRIEF#40](https://github.com/deftai/xBRIEF/pull/40)). That commit adds `difficulty`, `filesScope`/`filesScopeConfidence`, `verifyCommands`, `expectedOutputs`, and a `criterion` item type, all optional and additive.
- **Plan splitting** is documented in [docs/GUIDE.md](https://github.com/deftai/xBRIEF/blob/master/docs/GUIDE.md): large plans can reference external files via `planRef` (`file://./backend.xbrief.json`, `https://...`, or `#item-id` for internal refs).
- **TRON encoding** is documented in [docs/tron-encoding.md](https://github.com/deftai/xBRIEF/blob/master/docs/tron-encoding.md), claiming 35–40% token reduction versus JSON for typical xBRIEF documents.
- **Single-document size cap**: the v0.8 spec recommends a 10 MB maximum in §10 Security Considerations.

## Decision inputs

- **Sharding threshold**: the median spec is small (~23 KB), but the top end recurs historically. PAN-1249 is 1.1 MB / ~281k tokens / 227 items, and May 2026 alone produced five specs ≥84 KB. `planRef` sharding is justified by these top-end plans — which exceed what a model can re-read whole and stress finalize/serialization — not by the median plan. Treat sharding as a tail-risk tool, not a median-case optimization.
- **Slice boundedness**: if we shard, each slice should remain a valid standalone xBRIEF document with its own `plan.items`. The `file://` `planRef` scheme in upstream GUIDE is the natural reference shape; internal `#item-id` refs are not enough for file-level splitting.
- **Metadata emit-gap**: the gap is historical, not current. The vbrief era has ~70% sparse coverage for `verify_commands`, `expected_outputs`, and `files_scope`; the xbrief era is 100%. A v0.9 migration would rename fields and add `filesScopeConfidence`/`criterion`, but planning-agent behavior is already aligned for new specs. Backfilling old specs is probably not worth it; instead, make the dispatch advisor tolerate missing metadata on older plans.
- **TRON pilot**: the 35–40% token savings matter most against historical-scale plans like PAN-1249 (~281k tokens → ~170k tokens saved). Against the current xbrief-era corpus the payoff is small (max ~17k tokens → ~6k tokens saved). A pilot should round-trip the full 389-file corpus and decode to JSON before `src/lib/xbrief/quality-lint.ts` and `src/lib/agents/slot-merge.ts`, unless those consumers are also taught to read TRON.
- **Finalize safety before scale**: PAN-2202, PAN-2241, and PAN-2195 show that finalize is the fragile surface. Any sharding or metadata change must preserve the single-writer, idempotent finalize invariant; concurrent finalize races and superseded-spec churn are larger risks than document bytes. Idempotency and serialization fixes should land before or alongside sharding support.

## Monthly spec creation

Specs created per month (one `0000-00-00-PRODUCT-...` spec excluded because its date is unparseable):

| Month | vbrief | xbrief | Total |
|---|---|---|---|
| 2026-04 | 48 | 0 | 48 |
| 2026-05 | 102 | 0 | 102 |
| 2026-06 | 103 | 0 | 103 |
| 2026-07 | 115 | 20 | 135 |
