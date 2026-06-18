# Overdeck Remodel

The Overdeck → **Overdeck** data-architecture remodel
([PAN-1938](https://github.com/eltmon/overdeck/issues/1938)): collapse a
sprawling, drift-prone data layer into one source of truth per domain, rebuilt on
a fresh, empty `overdeck.db`.

## What this remodel is

Not a DB refactor — a **complexity amputation**, all-in on Effect. We rebuild on a
fresh, empty `overdeck.db` (the old `panopticon.db` stays untouched as backup), so
this is a *low-risk* big-bang, not a dangerous migration. We keep only what we
genuinely **NEED**.

## The locked principles

1. **Reduce complexity — delete a LOT of code.** Every field, table, endpoint, and
   transition justifies itself by a concrete decision it drives, or it's deleted.
2. **Two doors per domain.** One read door (a resolver `Service`) and one write
   door (a writer `Service`); nothing else touches a store. Enforced by Effect's
   type system (the `Db` handle reaches only the two doors) **plus** an
   import-boundary lint rule on routes/RPC/CLI — types alone don't stop a raw import.
3. **A tiny set of legal moves**, each behind the domain API.
4. **Effect all the way down** — `@effect/schema` entities, a **Drizzle over
   node:sqlite/bun:sqlite** cache behind the `Db` service (Node-safe; PAN-1579;
   deliberately *not* `@effect/sql`), `HttpApiGroup` controllers, typed errors.
   ("State" is not a domain.)

## Design docs (the deliverable)

| Doc | What |
|---|---|
| [`PRD.md`](PRD.md) | The execution plan — requirements, phased work, build gates, acceptance criteria. **Start here.** References the rest rather than repeating it. |
| [`END-STATE.md`](END-STATE.md) | The end-state architecture: domains/entities, the cache ERD, and the API controllers. |
| [`overdeck-schema.ts`](overdeck-schema.ts) | The locked Drizzle schema — every table and field (24 tables). |
| [`ARCHITECTURE-CONVENTIONS.md`](ARCHITECTURE-CONVENTIONS.md) | The Effect v4-beta house style every domain follows (verified against `4.0.0-beta.73`). |
| [`services/`](services/) | The per-domain API tier (8 docs): no-loss mapping + resolver/writer/controller. |

## Investigations (the evidence base)

| Doc | Question | Status |
|---|---|---|
| [`investigations/review-state-audit.md`](investigations/review-state-audit.md) | Of the review/verification/merge state fields, which do we NEED? | ✅ |
| [`investigations/pipeline-transitions.md`](investigations/pipeline-transitions.md) | The canonical pipeline stages, and every way an agent moves between them? | ✅ |
| [`investigations/agents-state-audit.md`](investigations/agents-state-audit.md) | Of the agent runtime fields (table + `state.json`), which do we NEED? Does `state.json` survive? | ✅ |
| [`investigations/conversations-transcripts-audit.md`](investigations/conversations-transcripts-audit.md) | The irreplaceable conversation data + the Transcript boundary? | ✅ |
| [`investigations/cost-audit.md`](investigations/cost-audit.md) | Which cost fields do we NEED? Is Cost pure cache? | ✅ |
| [`investigations/observability-audit.md`](investigations/observability-audit.md) | Is `events` event-sourced truth or disposable pub/sub? | ✅ |
| [`investigations/orchestration-config-audit.md`](investigations/orchestration-config-audit.md) | Of the orchestration + config tables, which do we NEED? One domain or several? | ✅ |
| [`investigations/effect-v4-idioms.md`](investigations/effect-v4-idioms.md) | The verified Effect `4.0.0-beta.73` idioms for every architectural primitive. | ✅ |

## Headline findings

- **8 → 6 DB-cache domains + Config (file-backed).** Transcripts is a shared
  service, Observability is infra (an EventBus) — neither is a domain.
- **35 → ~14 cache tables**, with **foreign keys enforced** (today: zero).
- Deletions booked: `state.json` plane (48 files), 8 status axes → 1 stage,
  ~148 transition sites → ~15 legal moves, `ready_for_merge` + 2 repair sweeps,
  3 of 4 cost stores, 6 dead tables.
