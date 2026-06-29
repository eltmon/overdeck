# E Tier 2 — Move Flyway/Postgres machinery out of core (DatabaseProvisioner registry)

**Epic:** E · **Branch:** `codebase-health/e-tier2` (off `main`) · **Executor:** GPT-5.5 (handoff), supervised by conv #182.
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit per step; the orchestrator reviews + merges. **Behavior-preserving for MYN is non-negotiable** — this code drops/recreates MYN's dev database.

## Problem
Tier 1 de-hardcoded the `myn` name. But core still contains Postgres/Flyway-specific machinery only MYN uses:
- `src/dashboard/server/routes/workspaces/container-ops.ts` — the refresh-db route (lines ~441–560): terminate connections, `DROP/CREATE DATABASE`, load seed via `psql`, `repairFlywayIfNeeded`, `seedVerifyQuery`; plus the `migrations.type === 'flyway'` gate (~336).
- `src/cli/commands/db.ts` — `db seed`, snapshot (`pg_dump`), clean-snapshot.
- `repairFlywayIfNeeded` (imported into container-ops) — the Flyway repair helper.

## Goal (Option 3 — config-selected built-in provider registry; mirrors `src/lib/runtimes/`)
1. Define `DatabaseProvisioner` interface in `src/lib/db-provisioners/types.ts` with the operations core currently inlines:
   - `refreshDatabase(ctx)` — the full drop/create/seed/repair/verify flow used by the refresh-db route.
   - `seed(ctx)` — the `db seed` flow.
   - `repairMigrations(ctx)` — wraps `repairFlywayIfNeeded`.
   - `snapshot(ctx)` / `cleanSnapshot(ctx)` — the `db.ts` pg_dump/clean flows.
   (ctx carries: projectConfig, workspacePath, pgContainer, databaseName, seedFile, seedVerifyQuery, force, logger.)
2. Implement `src/lib/db-provisioners/flyway-postgres.ts` — **move the existing Postgres/Flyway logic here verbatim** (the docker-exec psql commands + `repairFlywayIfNeeded`). Keep behavior byte-identical.
3. `src/lib/db-provisioners/index.ts` — `getDatabaseProvisioner(dbConfig)` registry: returns the `flyway-postgres` provider when `dbConfig.provisioner === 'flyway-postgres'` **OR** (back-compat) `dbConfig.migrations?.type === 'flyway'`; returns `null`/undefined when there is no db config (non-MYN projects get no DB machinery on their path).
4. **De-leak core:** `container-ops.ts` and `db.ts` resolve the provisioner from config and call `provisioner.refreshDatabase()` / `.seed()` / etc. — **no inline psql/flyway/Postgres strings remain in those core files.** If `getDatabaseProvisioner` returns null, the route/command returns the same "no database configured" response it does today.
5. Add `provisioner?: 'flyway-postgres'` to `DatabaseConfig` in `src/lib/workspace-config.ts` (optional; default inferred from `migrations.type` so MYN's existing config works unchanged).

## Requirements
**FR-1** New `src/lib/db-provisioners/{types,flyway-postgres,index}.ts`; each < 1,000 lines.
**FR-2** `container-ops.ts` + `db.ts` contain **zero** `psql`/`flyway`/`pg_dump`/`DROP DATABASE` strings after the move (`grep -niE "psql|flyway|pg_dump|DROP DATABASE" src/dashboard/server/routes/workspaces/container-ops.ts src/cli/commands/db.ts` → nothing). They call the provisioner.
**FR-3** Behavior-preserving: for MYN config, every docker-exec command + sequence is identical to today (verify by diffing the generated commands / existing tests). No logic changes — pure relocation behind the interface.
**FR-4** `getDatabaseProvisioner` returns null for projects with no `database` config; those code paths behave exactly as today (same error/no-op responses).
**FR-5** `npm run typecheck` + `npm run lint` + **the FULL test suite** (`npx vitest run --configLoader runner`, 0 failed). Full suite mandatory. Repoint/extend any container-ops/db tests in the SAME commit; add provisioner unit tests.

**NFR-1** A1 ratchet: no NEW explicit `any`; moved `any` → `eslint-any-allowlist.json`. No `execSync` (the existing code uses `execAsync`/Effect — keep async). Async tmux only.
**NFR-2** Conservative: interface + flyway-postgres impl + registry + core call-site rewiring + tests. No behavior changes, no new features.

## Acceptance criteria
- `db-provisioners/` interface + flyway-postgres provider + registry exist; core (`container-ops.ts`, `db.ts`) is provider-driven with no inline Postgres/Flyway strings.
- MYN behavior identical (commands/sequence unchanged); non-DB projects unaffected (provisioner null → same as today).
- typecheck + lint + full `vitest run` exit 0.
- If stopped early, note done vs remaining.

## Intersecting rules
No bandaids; behavior-preserving; full-suite verify (NOT a subset); verify against this worktree's post-`main` code; A1 ratchet; file-size guard; async-only/no execSync; worktree discipline (branch = `codebase-health/e-tier2`; never `git checkout <branch>`/`git stash`); conventional commits lowercase subject, never `--no-verify`; **do NOT run `pan done` or open a PR** — report when green, noting whether MYN command-output is verified identical.
