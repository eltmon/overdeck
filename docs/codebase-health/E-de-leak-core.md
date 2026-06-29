# Epic E — De-leak core: project-specifics out of Overdeck core

**Status:** identified + documented 2026-06-28 (`main@ddfa3ef7e`). Tier 1 ready to schedule; Tier 2 direction pending operator.
**Roadmap:** [`docs/CODEBASE-HEALTH-ROADMAP.md`](../CODEBASE-HEALTH-ROADMAP.md)

---

## Problem

Overdeck core (the `pan` CLI + the dashboard server) orchestrates coding agents and workspaces for **any** project. But some **project-specific** logic — concretely, the Mind Your Now (MYN) project's Postgres/Flyway database setup — is **hardcoded into core files**. Two consequences:

1. Features that should be generic only work for MYN (e.g. `pan db seed` would drop/create a database literally named `myn` for *any* project).
2. Core carries domain knowledge (Postgres, Flyway internals) it has no business knowing.

This is the same class of problem as the god-files (wrong-layer / over-broad core); here the flavor is **domain leakage** rather than file size.

## Findings (audit 2026-06-28)

All 46 `myn` references in `src/` were reviewed. **Most are benign** — comments, `e.g.` examples, `--project` help text, and a Rally integration vendor header (`X-RallyIntegrationVendor: 'Mind Your Now'`, which is a legitimate per-user API value). **No action needed on those.**

**Real leakage — hardcoded `myn` database name in executable code (two files):**

1. `src/cli/commands/db.ts` — five hardcoded references:
   - `:305` — ``DROP DATABASE IF EXISTS myn; CREATE DATABASE myn;`` (core CLI creating the MYN database)
   - `:288`, `:318`, `:337`, `:410` — `psql ... -d myn ...` (seed / verify / status)
2. `src/dashboard/server/routes/workspaces.ts:2898` — passes the literal `'myn'` into `repairFlywayIfNeeded()` (a ~100-line Postgres/Flyway schema-history repair routine at `:1190–1290`).

**Root enabler:** `src/lib/workspace-config.ts` — the workspace `database` config has `container_name` and `migrations`, but **no `name` field**. There is nowhere to declare the database name, so the code hardcodes `myn`. (The rest of the DB config is already generic: `migrations.type: 'flyway' | 'liquibase' | 'prisma' | 'typeorm' | 'custom'`, `migrations.command`, `seed_file`, `container_name` with a `{{PROJECT}}` placeholder.)

## Disposition — two tiers

### Tier 1 — De-hardcode (low risk, clearly correct, do regardless)

- Add a `name` field (and any other missing fields) to the `database` config in `src/lib/workspace-config.ts`.
- Thread it through and replace the ~6 hardcoded `myn` literals in `db.ts` and `workspaces.ts` with the configured name.
- **Result:** the existing DB features become project-agnostic and config-driven. Removes the leak without changing where the logic lives.

### Tier 2 — De-core the DB machinery (architectural; direction TBD)

The Flyway/Postgres surgery (reading `flyway_schema_history`, checksum sync, `DROP`/`CREATE DATABASE`) is project-**type**-specific and should not live in a core route/CLI. Two options:

- **(a) Config-driven command** — core simply invokes the project-declared seed/migrate command (`migrations.command` / `seed_file` already exist). The project owns the SQL/Flyway specifics; core stays generic. *Lower effort; the hooks largely exist.*
- **(b) Plugin / extension** — DB-provisioning becomes an optional module that loads only for projects that opt in; core has zero Postgres/Flyway knowledge. *More work; cleanest separation.*

**Decision pending operator.** Recommendation: do Tier 1 now; for Tier 2 start with **(a) config-driven command** (smaller, reversible), keeping **(b) plugin** as a later evolution if a true plugin system is built.

## Acceptance criteria (Tier 1)

- No hardcoded `myn` remains in `db.ts` or `workspaces.ts`; the DB name is read from project config.
- A project whose config declares a different DB name drives `pan db` + workspace Flyway-repair correctly (verified via config, with no implicit dependence on a database named `myn`).
- `npm run typecheck`, `npm run lint`, `npm run build`, and tests pass.

## Notes

- Execution follows the same handoff-orchestration model as Epics A/B (supervised non-pipeline agents; orchestrator verifies + merges). See the roadmap's "Execution model" section.
- Tier 2's "plugin/extension" option presumes a plugin system Overdeck does not yet have; if pursued, that scaffolding is itself a prerequisite work item.
