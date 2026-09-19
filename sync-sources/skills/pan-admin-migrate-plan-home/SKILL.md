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

- `--commit` — commit the copied artifacts in the plan home once something copied
- `--dry-run` — report what would be copied without writing anything
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
