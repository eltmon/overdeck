# E Tier 1 — De-hardcode the `myn` database name (config-driven)

**Epic:** E · **Branch:** `codebase-health/e-tier1` (off `main`) · **Executor:** GPT-5.5 (handoff), supervised by conv #182
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit on this branch; the orchestrator reviews + merges.
**Background:** read `docs/codebase-health/E-de-leak-core.md` first (the audit + rationale).

---

## Problem
Core hardcodes the MYN database name `myn` (and a MYN-schema-specific probe) so the DB features only work for MYN. Verified current locations:
- `src/cli/commands/db.ts`: `:288 :305 :318 :337 :410` — `psql ... -d myn ...` and `DROP DATABASE IF EXISTS myn; CREATE DATABASE myn;`
- `src/dashboard/server/routes/workspaces/container-ops.ts`: `:320 :493 :497 :507 :514 :530` — `-d myn`, `DROP DATABASE IF EXISTS myn`, `terminate_backend ... datname='myn'`, seed into `myn`, **and a MYN-schema probe `SELECT count(*) FROM customer`** (`:530`).

## Goal (Tier 1 = de-hardcode, config-driven; behavior-preserving for MYN via config)
1. **Schema:** in `src/lib/workspace-config.ts`, add to the workspace `database` config: `name: string` (the database name) and `seedVerifyQuery?: string` (optional post-seed sanity query; replaces the hardcoded `SELECT count(*) FROM customer`).
2. **Code:** replace every hardcoded `'myn'` **database name** in `db.ts` and `container-ops.ts` with the configured `database.name` resolved from the project config (the same `projectConfig.workspace.database` already read nearby). Replace the `customer`-table probe with `database.seedVerifyQuery` — **skip the probe entirely if `seedVerifyQuery` is unset**. **No hardcoded `'myn'` fallback** — if a project has `database` config but no `name`, throw a clear config error.
3. **Behavior preservation for MYN:** locate the MYN project entry in the Overdeck project config (`grep -rn "myn" projects.yaml` and any `*.yaml` under the repo / config dir). Set `database.name: myn` and `seedVerifyQuery: "SELECT count(*) FROM customer"` there so MYN's flow is byte-identical. **Implementation checkpoint:** if `projects.yaml` (or the MYN entry) is NOT in this repo (it may be machine-local under `~/.overdeck/`), do **not** guess — STOP and report to the orchestrator, who will set MYN's local config before merge. Proceed with the code+schema changes regardless.

## Requirements
**FR-1** `WorkspaceDatabaseConfig` has `name: string` + `seedVerifyQuery?: string` (with doc comments).
**FR-2** Zero hardcoded `'myn'` database-name remains in `db.ts` / `container-ops.ts` (`grep -rin "\bmyn\b" src/cli/commands/db.ts src/dashboard/server/routes/workspaces/container-ops.ts` returns nothing except possibly comments). The DB name comes from `database.name`.
**FR-3** The `customer`-table probe is replaced by `seedVerifyQuery` (skipped when unset). No hardcoded table names remain.
**FR-4** No silent `'myn'` fallback — missing `database.name` (when `database` config exists) throws a clear error.
**FR-5** `npm run typecheck` + `npm run lint` + `npm run build` pass; db/container tests pass.

**NFR-1** Surgical; only the schema field + the substitutions + (if in-repo) the MYN config entry. No unrelated changes.
**NFR-2** No new explicit `any` (A1 ratchet). No `execSync` (use the existing `execAsync`).
**NFR-3** The MYN-specific Flyway *repair logic itself* (the broader "should this be in core at all" question) is **Tier 2 — out of scope here.** Tier 1 only removes the hardcoded name + schema-coupled probe.

## Verification
```
npm run typecheck && npm run lint && npm run build
npx vitest run --configLoader runner $(grep -rl "db\b\|database\|container" tests/unit | tr '\n' ' ')
grep -rin "\bmyn\b" src/cli/commands/db.ts src/dashboard/server/routes/workspaces/container-ops.ts   # expect: nothing (or comments only)
```

## Acceptance criteria
- `database.name` + `seedVerifyQuery` in the config schema; both used in `db.ts` + `container-ops.ts`.
- No hardcoded `myn` DB-name or `customer` table reference in those two files.
- Missing `database.name` errors clearly (no silent fallback).
- MYN config entry set (if in-repo) OR reported to orchestrator (if machine-local).
- typecheck/lint/build green; tests pass.

## Intersecting rules (restated)
No bandaids; surgical; A1 ratchet (no new `any`); no `execSync`; worktree discipline (branch = `codebase-health/e-tier1`; never `git checkout <branch>` / `git stash`); conventional commits, never `--no-verify`; **do NOT run `pan done` or open a PR** — report blockers (esp. the MYN-config-location checkpoint) to the orchestrator.

## Out of scope (Tier 2, later)
Moving the Flyway/Postgres repair machinery out of core (config-driven command vs plugin) — that's the documented Tier 2 decision in `E-de-leak-core.md`.
