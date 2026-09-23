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
```

## Usage

```
pan admin migrate-plan-home lexerra --dry-run   # preview only, writes nothing
pan admin migrate-plan-home lexerra --commit    # copy + commit in the plan home
```

Options:

- `--commit` — commit the migrated artifacts in the plan home (copied now, or already in place
  from an earlier run but never committed), and repair a legacy `.pan/` ignore rule (below)
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
  uncommitted changes, `--commit` refuses before copying. Without `--commit`
  nothing is edited and it warns that the copies are ignored by git.
  `--dry-run` names the rule.
- **Any other rule** (nested `.gitignore`, `.git/info/exclude`,
  `core.excludesFile`, a broader pattern): never edited. It is reported with
  its `file:line`; `--commit` refuses before copying.

A refused run or a git failure prints one `migrate-plan-home: …` line and
exits 1. `pan doctor`'s `Plan home .pan/ tracking` row flags the same
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
