---
scope: universal
---
### Spawned agents run in an isolated `--cwd` — never the primary worktree

When you spawn a supervised agent (`pan handoff`, or any spawned agent that may edit or commit code), give it an **isolated working directory** — a throwaway git worktree or a feature workspace — **never the primary/main checkout**.

An agent whose cwd is the primary repo can `git checkout -b` and commit there, which silently **drifts `main` onto a feature branch** and lets the agent commit straight to `main` — the same write-to-main hazard as PAN-2204. Your own later commits then land on the wrong branch.

For `pan handoff`, pass `--cwd` as an **absolute path to an existing directory under your home directory** — the server rejects relative paths, `/tmp` paths, and not-yet-created directories with `Invalid cwd`:

```bash
git worktree add "$HOME/Projects/hoff-<slug>" main   # if you don't already have one
pan handoff --model <m> --cwd "$HOME/Projects/hoff-<slug>" --project <key> self "Read .pan/handoff-brief.md FIRST. <goal>"
```

Run the `pan handoff` command itself from your project directory (not from the `--cwd` target or `/tmp` — sandboxed harnesses block network there). Project association inherits automatically from a project-scoped source; use `--project <key>` to override it or associate an unscoped source. Point `--cwd` at any isolated checkout — anything but the primary.

**Why:** a `pan handoff` investigation run in the primary worktree branched + committed there, silently drifting `main` and stranding later commits on the wrong branch (2026-07-01). Isolation keeps every spawned agent's commits on its own branch, where review/merge can gate them.
