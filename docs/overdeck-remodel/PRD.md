# PRD — Overdeck: the Overdeck data-architecture remodel + rebrand

**Epic:** [PAN-1938](https://github.com/eltmon/panopticon-cli/issues/1938) · **Status:** ready for implementation · **Authored:** 2026-06-17

> **This PRD is the execution plan. It deliberately does NOT repeat the design.**
> The *what* and the *how* are fully specified in the design package below; this
> document references those files and adds only the things they don't: the
> requirements, the phased work plan, the build gates, and the acceptance
> criteria. When a requirement says "per `services/agents.md`", that doc is the
> spec — do not duplicate its content here.

---

## 1. Summary

Overdeck's recurring state and pipeline bugs all trace to one disease: a single
fact is written from many places with no owner, so the stores drift. Overdeck
cures it structurally — **one read door (resolver) and one write door (writer)
per domain, nothing else touching a store** — rebuilt on a fresh, empty
`overdeck.db`, all-in on Effect v4-beta with Drizzle over `node:sqlite`. The old
`panopticon.db` is kept untouched as a backup, so this is a low-risk big-bang, and
the product is renamed **Overdeck → Overdeck**. Full narrative:
[`END-STATE.md`](END-STATE.md).

**The bar is functional parity:** keep every piece of functionality the system has
today, minus the hundred redundant and wrong ways it currently does each thing.
This is not a cache-purity exercise.

## 2. The design package (referenced, not repeated)

| File | The spec it provides |
|---|---|
| [`END-STATE.md`](END-STATE.md) | Architecture narrative — the domains, the two doors, the deletion scoreboard |
| [`overdeck-schema.ts`](overdeck-schema.ts) | The locked Drizzle schema — every table and field (24 tables) |
| [`overdeck-erd.png`](overdeck-erd.png) | The schema as an ERD |
| [`ARCHITECTURE-CONVENTIONS.md`](ARCHITECTURE-CONVENTIONS.md) | The Effect v4-beta house style every domain follows |
| [`services/`](services/) ×8 | Per-domain API tier: no-loss mapping + resolver/writer/controller (`issues`, `agents`, `conversations`, `cost`, `merge`, `control-settings`, `memory`, `observability`) |
| [`investigations/`](investigations/) ×12 | The evidence base — column-level NEED audits, the pipeline-transition map, gates, the Effect-v4 idioms |
| [`FEEDBACK-gpt5.5.md`](FEEDBACK-gpt5.5.md), [`FEEDBACK-gpt5.5-services.md`](FEEDBACK-gpt5.5-services.md) | The two external (GPT-5.5) reviews, both incorporated |

Glossary, term definitions (resolver, writer, two-door, gate, the four homes) are
in [`END-STATE.md`](END-STATE.md) §"The disease, and the cure" — canonical there.

## 3. Goals / Non-goals

**Goals.** Functional parity with today; one resolver + one writer per domain;
eliminate the redundant/duplicate access paths and the dead tables; enforce
foreign keys; Effect v4 + Drizzle/`node:sqlite`; rename to Overdeck; ship on a
fresh `overdeck.db`.

**Non-goals.** Backward compatibility; data migration from `panopticon.db`;
defending the "disposable cache / four homes" model as a literal contract;
re-deriving any design already specified in the package.

## 4. Requirements

Functional:
- **FR-1 — Two doors per domain.** Every domain exposes exactly one resolver and
  one writer; no route handler, CLI command, hook, or script reads or writes a
  store directly. Spec: [`ARCHITECTURE-CONVENTIONS.md`](ARCHITECTURE-CONVENTIONS.md) §0, §5; the eight `services/*.md`.
- **FR-2 — Functional parity (no silent loss).** Every current HTTP endpoint, CLI
  verb, and RPC method maps to a new door, or to a *named* DELETE/RELOCATE with a
  reason. Spec: the no-loss mappings (Part 1) in each `services/*.md`. **A
  remodel-wide no-loss matrix is the gate** (FR-2 is not met until every surface
  is accounted for, not just the eight domains' own surfaces).
- **FR-3 — The cache schema.** `overdeck.db` is created from
  [`overdeck-schema.ts`](overdeck-schema.ts) (24 tables; foreign keys enforced via
  `PRAGMA foreign_keys=ON`), starting empty.
- **FR-4 — Effect v4 + Drizzle on Node.** Cache layer is Drizzle over the
  runtime-bundled `node:sqlite` (Node) / `bun:sqlite` (Bun) — not `@effect/sql`
  (Bun-only), not `better-sqlite3` (dropped in PAN-1579). Spec:
  [`ARCHITECTURE-CONVENTIONS.md`](ARCHITECTURE-CONVENTIONS.md) §4.
- **FR-5 — Door enforcement.** The `Db` handle reaches only resolver/writer Layers
  (compile-time), backed by an **import-boundary lint rule** over routes/RPC/CLI.
  Side-states are written by their owning domain's writer (no generic `hold()`).
- **FR-6 — Sacred files are read-only.** Overdeck never mutates a conversation
  backing file or a memory observation file; `conversation-compaction` converts to
  the fork pattern. Spec: [`services/conversations.md`](services/conversations.md), [`investigations/conversation-backing-files.md`](investigations/conversation-backing-files.md).
- **FR-7 — Conversation metadata preserved.** The PAN-1937 export (currently
  unbuilt) preserves the irreplaceable `conversations`/`favorites`/
  `conversation_files` metadata across the cutover.
- **FR-8 — Functional-parity repairs the audits exposed.** Re-wire the dead
  cost-limit breaker; ingest native pi/codex cost (PAN-1935); build the memory FTS
  rebuilder; specify the Observability replay-gap error before trimming `events`.
- **FR-9 — Rebrand.** Rename Overdeck → Overdeck across code, the DB filename,
  DNS, and docs. `panopticon.db` is retained untouched as a rollback backup.

Non-functional:
- **NFR-1 — Node-22 / `node:sqlite`** for the dashboard server (no Bun — node-pty +
  circular-ESM constraints stand).
- **NFR-2 — Net deletion.** The remodel removes substantially more code than it
  adds (target: the [`END-STATE.md`](END-STATE.md) deletion scoreboard — 8 status
  axes→1, ~148 transition sites→~15, `state.json` plane gone, dead tables removed).
- **NFR-3 — CI guard.** Direct store access (DB / `.pan/` / `state.json` / GitHub
  for canonical state) outside the two doors fails the build.

## 5. Implementation plan

Each work item's *detail* lives in the referenced doc; this is the sequence and
the dependencies.

- **Phase 0 — Foundations & proof.**
  - WI-0.1 Add `drizzle-orm` + `drizzle-kit` (only these — `node:sqlite` is
    built-in). WI-0.2 Compile smoke-test on `node:sqlite`/Node 22 (`sqliteTable` +
    `.references()` + partial `uniqueIndex(...).where(...)` + FK enforcement + one
    resolver/writer transaction) — **confirm Drizzle's `node:sqlite` adapter
    works**; fallback = wrap `src/lib/database/driver.ts`. WI-0.3 Create
    `overdeck.db` from the schema. WI-0.4 The import-boundary lint rule. *(Gate G1.)*
- **Phase 1 — Vertical slice (Issues).** Build Issues end-to-end — entity Schema,
  the `Db` service, `IssuesResolver`, `IssueWriter` (`advance`/`setPr`/
  `setBlockers`), `IssuesApi` — through `tsc`. Spec: [`services/issues.md`](services/issues.md). *(Gate G2: it compiles and a round-trip works; proves the conventions before scaling.)*
- **Phase 2 — Remaining domains.** Agents, Conversations + Transcripts, Cost,
  Merge, Control/Settings, Memory, plus the EventBus and the file-backed Config
  resolver — each per its `services/*.md`. Includes the **non-data process
  services** (Delivery, ConversationRuntime, CloisterRuntime, AgentPermissions) per
  [`ARCHITECTURE-CONVENTIONS.md`](ARCHITECTURE-CONVENTIONS.md) §8.5.
- **Phase 3 — Reconstruction & wiring.** The sync layer that rebuilds `overdeck.db`
  from the sources (GitHub + git `.pan/records` + JSONL + tmux); the read-model +
  EventBus; the **PAN-1937 conversation export** (FR-7).
- **Phase 4 — Functional-parity repairs (FR-6, FR-8).** `conversation-compaction`
  → fork; cost-limit breaker re-wire + pi/codex ingest; memory FTS rebuilder;
  Observability replay-gap error; relocate every remaining direct-store caller onto
  its door; delete the dead tables/paths.
- **Phase 5 — Cutover & rebrand (FR-9).** Point the app at the fresh `overdeck.db`;
  rename Overdeck → Overdeck (code, DB name, DNS, docs); turn on the CI guard
  (NFR-3); retire the old access paths. Keep `panopticon.db` as backup.

## 6. Build gates (hard prerequisites)

- **G1 — Drizzle proven** (Phase 0 smoke-test passes) before any domain code.
- **G2 — Vertical slice compiles** before scaling to the other six domains.
- **G3 — Remodel-wide no-loss matrix complete** (FR-2) before declaring the API
  surface locked.
- **G4 — Sacred-file invariant** (`conversation-compaction` forked; a check that
  no production code writes an existing transcript/observation file) before cutover.
- **G5 — PAN-1937 export built + verified** before cutover (else conversation
  metadata is lost).
- **G6 — Observability replay-gap error in the RPC schema** before `events`
  retention is enabled.

## 7. Acceptance criteria

1. The Phase-1 vertical slice compiles under `tsc` on `node:sqlite`/Node 22 (G1, G2). → FR-3, FR-4
2. The remodel-wide no-loss matrix accounts for every current endpoint / CLI verb /
   RPC method (door, or named delete/relocate). → FR-2
3. The CI guard fails the build on any direct store access outside the doors. → FR-1, NFR-3
4. Every domain is implemented per its `services/*.md`; the dead tables and
   redundant paths in the deletion scoreboard are gone. → FR-1, NFR-2
5. No production code path writes an existing conversation/observation file. → FR-6
6. The PAN-1937 export round-trips the conversation/favorites/file-pointer set. → FR-7
7. The app boots on a fresh, rebuilt `overdeck.db` and passes a functional-parity
   pass per domain (the behaviors each `services/*.md` no-loss map preserved). → FR-2
8. The rebrand is complete and `panopticon.db` is intact as a backup. → FR-9

## 8. Risks & open decisions

- **Drizzle `node:sqlite` adapter** — verify in the G1 smoke-test; if a pinned
  Drizzle version lacks it, wrap the existing `driver.ts` (decided fallback).
- **Cutover sequencing** — in-flight pipeline/agent state at the switch moment;
  the rebuild-from-sources must cover active issues. (Phase 3 design point.)
- **Rebrand mechanics** — DNS (already parked), the DB filename, and the breadth
  of `Overdeck` references; sequence the rename so nothing half-renamed ships.
- **Named drops to confirm** — the dead `pan cost budget` store-B path, the
  `flywheel_substrate_bugs` telemetry, and the display-only fields the audits
  dropped: each is a recorded decision, not a silent loss.
