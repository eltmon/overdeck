# Overdeck Remodel — kickoff

You're starting a fresh, focused effort **with the operator**. Read the artifacts below, form your own
view, and work domain by domain (down to field level where it matters). The prior conversation reached
some conclusions — treat them as a **starting point to challenge**, not settled fact. Keep your context
lean: pull detail from the artifacts on demand rather than front-loading it.

## The goal

A **big-bang data-architecture remodel + rebrand** — Overdeck → **Overdeck** (DNS already parked).
Collapse a sprawling, drift-prone data layer into **one source of truth**: the SQLite DB becomes a
disposable cache behind **one canonical resolver per domain** (reads) and **one write surface** (writes);
nothing touches a store directly. Design the **target schema and resolvers, domain by domain**, then cut
over to a fresh `overdeck.db`.

## Why

The recurring state/pipeline bugs root-cause to scattered access: the same fact is **read from 8+
endpoints and written from 100+ call sites** across the DB, the `.pan/` filesystem, `state.json`, and
GitHub, with no shared resolver — so they drift. The DB is a ~1.4 GB junk-drawer (34 tables, ~0 enforced
foreign keys, god-tables, unbounded caches, duplicated entities).

## Freedoms & constraints

- **No backward compatibility** — the operator is the only user. Redesign clean.
- **Sacred data:** the code (git) and the JSONL transcripts (`~/.claude/projects/.../*.jsonl`).
  Everything else in the DB is a rebuildable cache or junk. The only non-derivable DB data worth
  preserving is `conversations` + `favorites` (see PAN-1937).
- **Big-bang cutover:** a fresh `overdeck.db`; the old `~/.overdeck/panopticon.db` stays untouched as
  rollback.
- **Inspect the live DB read-only** (`~/.overdeck/panopticon.db`) or on a copy — never mutate it.
- **Tenet (locked):** one canonical resolver per domain; no direct store access; **"state" is NOT a
  domain.** (`sync-sources/rules/single-source-of-truth.md`)
- Recoverable actions only (no force-push / history rewrite / deletes of JSONL or branches).

## Read these — form your own view

- **Master epic:** PAN-1938 (umbrella: problem, end-state, workstreams).
- **API surface map + end-state diagram + write audit:** `docs/API-SURFACE.md`.
- **ERD of the current 34-table schema:** `docs/overdeck-db-erd.excalidraw` (open in Excalidraw — a
  live canvas with it loaded is at http://localhost:3000, or open the file directly).
- **Tenet:** `sync-sources/rules/single-source-of-truth.md`.
- **State model:** `reference/state-model.mdx`.  ·  **Export design:** PAN-1937.
- **Live DB:** `~/.overdeck/panopticon.db` (SQLite; read-only). Schema = 34 tables; inspect with
  `python3 -m sqlite3`.

## Where the prior conversation landed (a draft to challenge)

Proposed domain list — **refine with the operator**:
- **Core entities:** Issues (incl. plan + verdicts), Agents, Conversations, Transcripts
- **Supporting:** Cost, Projects & Config, Observability
- **Control plane:** Orchestration

Open questions left deliberately unresolved: verdicts inside Issues or their own domain? Transcripts
standalone or folded into Conversations+Agents? Cost standalone or part of Observability? Orchestration a
domain or just commands? Don't anchor on these answers — derive your own from the ERD + the data.

## How to work

Domain by domain, with the operator: name the domain → its entities & fields → which current
tables/columns map in → cache vs source-of-truth per field → target table(s) + the resolver. Capture each
as design (issues / PRDs under PAN-1938) before building. The other (prior) conversation is finishing
unrelated in-flight cleanup — this effort is yours and the operator's.
