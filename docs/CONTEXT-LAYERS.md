# Layered Context Distribution

How Panopticon distributes context — engineering rules, project guidance,
skills, agents — to the coding-agent harnesses it drives. Introduced by
PAN-1201, which replaced the `sync.devroot` model.

## The three layers

Context composes from three layers, outermost to innermost:

| Layer | Source file | Applies |
|---|---|---|
| **Global** | `~/.panopticon/context/global.md` | Every harness session on this machine |
| **Project** | `<projectRoot>/.pan/context/project.md` | Sessions whose CWD is under a registered project |
| **Workspace** | `<workspace>/.pan/context/workspace.md` | Inside one issue workspace |

The global layer is per-machine and lives under `~/.panopticon`. The project
layer is committed to the repo. The workspace layer is **auto-assembled** by
Panopticon at workspace creation — never hand-authored — and is gitignored.

The global layer may also carry the user's own skills and agents under
`~/.panopticon/context/global/{skills,agents}/`.

Register projects with `pan projects add <path>`. The older singular
`pan project add <path>` command remains available as a compatibility alias,
but new docs and examples should use the plural command group.

## Authoring model: one source, N harnesses

Each layer is a single canonical markdown file. Harness-specific divergence
is expressed with Mustache-style blocks:

```markdown
All agents follow the engineering philosophy: fix root causes, no bandaids.

{{#harness:claude}}
Prefer the beads CLI (`bd`) for task tracking.
{{/harness:claude}}

{{#harness:pi}}
Write completion markers via `/pan-done` when ready for review.
{{/harness:pi}}
```

Rendering rules:

- Text **outside** any block is always-on — every harness gets it.
- A `{{#harness:X}}…{{/harness:X}}` block renders only when targeting `X`.
- Blocks may be **stacked** to mark a span for several harnesses (union):
  `{{#harness:claude}}{{#harness:pi}}…{{/harness:claude}}{{/harness:pi}}`
  renders for both. The renderer tracks open markers as independent counters,
  so stacked blocks need not be strictly nested.
- A block for an unrecognised harness renders for no current harness;
  `pan context validate` warns about it but does not reject it, so a layer
  can be authored ahead of a harness adapter shipping.

## `pan sync` and the managed region

`pan sync` renders each layer for the `claude-code` harness and writes it into
a **managed region** of the target CLAUDE.md, delimited by HTML comment
markers:

```
<!-- BEGIN PANOPTICON CONTEXT — managed by `pan sync`; edit the layer source, not this region -->
…rendered content…
<!-- END PANOPTICON CONTEXT -->
```

Content **outside** the markers is preserved untouched — a hand-authored
`~/.claude/CLAUDE.md` is never clobbered. Edit the layer source
(`global.md` / `project.md`) and re-run `pan sync`; never edit the region
directly.

For each registered project that has a `project.md`, the project layer is
rendered into **two** target files: `<root>/CLAUDE.md` (rendered for
`claude-code`) and `<root>/AGENTS.md` (rendered for `pi`). Both use the same
managed-region markers, so a hand-authored `AGENTS.md` is preserved exactly
like `CLAUDE.md`. A project with no `project.md` gets neither file touched.

`pan sync` also:

- distributes Panopticon's bundled skills → `~/.claude/skills/` and agent
  definitions → `~/.claude/agents/`, with manifest-based conflict resolution
  (a file you modified is left alone; an unmodified one is updated);
- folds the bundled **engineering rules** into the global CLAUDE.md region.

## Respecting your existing context

Panopticon is designed to **augment, never replace** any context files you
already maintain. Three guarantees:

1. **Managed-region surgery.** `pan sync` only ever owns the span between the
   `BEGIN/END PANOPTICON CONTEXT` markers in `~/.claude/CLAUDE.md`, each
   project's `CLAUDE.md`, and each project's `AGENTS.md`. Everything outside
   the markers — including content you add *above* or *below* the region — is
   preserved verbatim across every sync.

2. **First-injection backup.** The first time a sync injects a region into a
   file that already had hand-authored content (no region yet), that file is
   snapshotted into `~/.panopticon/backups/<timestamp>/context/` *before* the
   write. `pan sync` prints a one-time notice naming the file and its backup so
   the very first write that touches your content always has a safety net.

3. **Opt-in per project.** A project's files are touched only when its
   `.pan/context/project.md` exists. Register a project but write no
   `project.md` and its `CLAUDE.md`/`AGENTS.md` are never modified.

The Pi **global** layer is the one exception to "we only write managed
regions": it renders to `~/.panopticon/context/pi-global.md`, a
Panopticon-owned file (whole-file write), not your `AGENTS.md`. Project-level
Pi context *does* go into your `AGENTS.md` as a managed region.

The dashboard Context page surfaces all of this: for the selected layer it
lists the exact target files, whether each already has your own content
(preserved), and restates that the region is the only part `pan sync` owns.

## Bundled rules

Panopticon ships engineering rules under `sync-sources/rules/`. Each rule
carries a `scope:` frontmatter key:

- `scope: universal` — folded into the rendered CLAUDE.md everywhere;
- `scope: dev` — folded in only on a panopticon-cli checkout (`isDevMode()`),
  for rules about developing Panopticon itself.

## `pan context` CLI

```
pan context list                  # show all three layers and their files
pan context list --layer global   # one layer
pan context edit                  # open global.md in $EDITOR
pan context edit --layer project  # open this project's project.md
pan context sync                  # render the layers into harness CLAUDE.md
pan context diff                  # show what each harness would receive
pan context diff --harness pi     # just one harness
pan context validate              # lint templates for malformed blocks
pan context migrate               # one-shot migration off sync.devroot
```

## Dashboard Context page

The dashboard Context page edits the same layered files as the CLI. Use the
layer selector to switch between Global, Project, and Workspace context; project
and workspace selectors choose the registered project or workspace whose
`.pan/context/project.md` or `.pan/context/workspace.md` file is loaded.

The editor shows per-harness previews for Claude Code and Pi. A separate **Full
injected prompt** pane shows the complete Panopticon-controlled bundle that will
be injected, including rendered layer content and audit sections for memory,
status, and workspace briefing. It does not fabricate private harness base
prompts that Panopticon cannot read.

Previewing is read-only. **Save** writes only the selected layer file. **Save &
Sync** writes the selected layer first, then explicitly runs `pan context sync`
so the rendered Claude Code target files update. Live preview and ordinary Save
do not run sync.

## `sync-sources/` — Panopticon's own bundled content

Everything `pan sync` distributes *from the package itself* lives under one
explicit top-level directory:

```
sync-sources/
  skills/   dev-skills/   agents/
  rules/    hooks/        templates/
```

`src/lib/paths.ts` exposes a single `SYNC_SOURCES_ROOT`. A glance at the repo
root shows exactly what sync distributes. This replaced the scattered
`SOURCE_*_DIR` constants whose ambiguity let the stale top-level `rules/`
silently rot while the maintained rules accumulated elsewhere (#1359).

## Migrating off `sync.devroot`

`sync.devroot` is deprecated. `pan sync` no longer distributes anything via
`<devroot>/.claude/`; a still-configured value only triggers a warning.

`pan context migrate` is the one-shot migration:

1. copies `<devroot>/.claude/CLAUDE.md` → `~/.panopticon/context/global.md`;
2. copies `<devroot>/.claude/{skills,agents}/` → `~/.panopticon/context/global/`;
3. offers to register each project found under `~/Projects/`;
4. prints where the old location is preserved.

If a non-interactive migration skips registration, register projects with
`pan projects add <path>`. The singular `pan project ...` form remains available
as a compatibility alias, but new docs and prompts prefer `pan projects ...`.

It never overwrites an existing target (safe to re-run) and never deletes the
source. After verifying the migration, delete the old location and set
`sync.devroot` to `null` to silence the warning.
