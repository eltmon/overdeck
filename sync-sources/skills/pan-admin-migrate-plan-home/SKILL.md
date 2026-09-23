---
name: pan-admin-migrate-plan-home
description: "pan admin migrate-plan-home <project-key> — one-time bridge that copies planning artifacts and item progress from the state worktree into <planHome>/.pan/ (PAN-3917 D8)"
triggers:
  - pan admin migrate-plan-home
  - migrate plan home
  - migrate overdeck-state
  - D8 migration
allowed-tools:
  - Bash
---

# pan admin migrate-plan-home

Run the command now:

```bash
pan admin migrate-plan-home <project-key> [--commit] [--dry-run]
pan admin migrate-plan-home <project-key> --repair-ignore [--dry-run]
```

## Usage

```
pan admin migrate-plan-home lexerra --dry-run   # preview only, writes nothing
pan admin migrate-plan-home lexerra --commit    # copy + commit in the plan home
pan admin migrate-plan-home lexerra --repair-ignore  # only drop the legacy .pan/ ignore line, commit .gitignore
```

Options:

- `--commit` — commit the migrated artifacts in the plan home, and repair a legacy `.pan/`
  ignore rule (below). The commit holds only files this run wrote, plus files an earlier run
  copied that still match the state worktree. Any other uncommitted `.pan/` change (an operator
  or live agent edit) is listed as "left uncommitted" and stays out of the commit.
- `--force-remigrate` — run even though the state worktree carries `migration-complete.json`
  (every run otherwise refuses before copying; `--dry-run` still previews and names the marker)
- `--repair-ignore` — do only the ignore repair: remove Overdeck's legacy `.pan/` line and commit
  `.gitignore` alone. Copies nothing and never calls the tracker. Not combinable with `--commit`.
- `--dry-run` — report what would be copied, and whether `.pan/` is ignored, without writing anything
- `--state-root <dir>` / `--plan-home <dir>` — override resolution (tests, odd setups)
- `--open-issues <file>` — read open issue ids from a file instead of calling the tracker

## What It Does

Copies `drafts/`, `specs/`, `continues/`, `orders/`, `notes/`, and
`backlog/sequence.md` for **open** issues out of
`~/.overdeck/state/<project>/` into `<planHome>/.pan/` — the same `.pan/`
home `resolvePlanHome` and the rest of the xBRIEF/orders/backlog code already
read. Closed-issue artifacts stay behind on the archived `overdeck-state`
branch. It also reads each open issue's `records/<issue>.json`
(`tasks.statusOverrides`, falling back to the top-level field) and merges
those item statuses into `.pan/continues/<ISSUE>.xbrief.json`'s `items` map
(`completed` → `done`), so a project's in-flight checklist progress survives
the cutover.

It never replaces a file that already exists under `.pan/`. A destination
that differs from the state copy (including a continue file whose records
statuses changed) is listed as a `conflict`, left alone, and counted in
`remaining`, so the run exits 1 until you reconcile it by hand. The state
worktree stopped moving at the Cut, so the plan-home copy is often the newer
one.

Idempotent: run it again and it copies nothing and reports `0 remaining`.
It never writes to the state worktree, never deletes anything, and never
pushes.

## A plan home that ignores `.pan/` (PAN-3996)

Before the Cut, Overdeck wrote `.pan/` into project `.gitignore` files. Before
copying anything, the command runs `git check-ignore` against `.pan/` in the
plan home:

- **Overdeck's legacy line** (an exact `.pan/` or `.pan` line in the repo's
  top-level `.gitignore`): with `--commit` that line is removed and
  `.gitignore` is committed together with the artifacts through
  `git add -- <paths>` + `git commit --only -- <paths>`, so unrelated staged or
  unstaged work stays out of the commit. If `.gitignore` already has
  uncommitted changes, `--commit` refuses before copying. If the commit then
  fails (a hook, a foreign rule behind the legacy line), the line is put back,
  so a rerun repairs it again. Without `--commit` nothing is edited and it
  warns that the copies are ignored by git. `--dry-run` names the rule.
  `--repair-ignore` makes the same edit and commits `.gitignore` alone.
- **Any other rule** (nested `.gitignore`, `.git/info/exclude`,
  `core.excludesFile`, a broader pattern): never edited. It is reported with
  its `file:line`; `--commit` refuses before copying.

A refused run or a git failure prints one `migrate-plan-home: …` line and
exits 1. When the ignore check itself cannot run, a copy or `--dry-run`
reports that and carries on; `--commit` stops. `pan doctor`'s `Plan home .pan/ tracking` row flags the same
condition for every registered project.

## When to Use

- Once per project, before that project's record plane is deleted (PAN-3917
  D8) — `panopticon-cli` and `mind-your-now` first (FR-16).
- `--dry-run` first, always — see how many open issues and files it found
  before `--commit`.

## See Also

- `docs/THE-CUT.md` — the no-loss map; this verb's own row explains when it
  in turn gets dropped.
- `src/lib/pan-dir/migrate-plan-home.ts` — the library.
- `docs/WORKSPACES-AND-PROJECTS.md` — plan-home / `pan_records.repo` resolution.
