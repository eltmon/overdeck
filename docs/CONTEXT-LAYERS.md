# Layered Context Distribution

How Overdeck distributes context — engineering rules, project guidance,
skills, agents — to the coding-agent harnesses it drives. Introduced by
PAN-1201, which replaced the `sync.devroot` model.

## The three layers

Context composes from three layers, outermost to innermost:

| Layer | Source file | Applies |
|---|---|---|
| **Global** | `~/.overdeck/context/global.md` | Every harness session on this machine |
| **Project** | `<projectRoot>/.overdeck/context/project.md` | Sessions whose CWD is under a registered project |
| **Workspace** | `<workspace>/.overdeck/context/workspace.md` | Inside one issue workspace |

The global layer is per-machine and lives under `~/.overdeck`. The project
layer is committed to the repo. The workspace layer is **auto-assembled** by
Overdeck at workspace creation — never hand-authored — and is gitignored.

The global layer may also carry the user's own skills and agents under
`~/.overdeck/context/global/{skills,agents}/`.

### Canonical terminology

Use these names — in docs, in chat, in code comments — so placement requests
are unambiguous:

| Term | Meaning |
|---|---|
| **Context layers** | This whole distribution system |
| **Global layer** (machine context) | `~/.overdeck/context/global.md` — per-machine quirks only |
| **Project layer** | `<root>/.overdeck/context/project.md` |
| **Workspace layer** | auto-assembled per issue; never hand-authored |
| **Bundled rule** | `sync-sources/rules/<name>.md` (`scope: universal` or `dev`) — every-machine engineering rules |
| **Managed-session launch artifacts** | Overdeck-owned renders under `~/.overdeck/context/` delivered explicitly at launch |

There is no "global context template": a request phrased that way means either
a **bundled rule** (every machine) or the **global layer** (this machine). The
`context-nomenclature` bundled rule ships this table to every agent session.

**Shorthand:** placement requests use "add a `<scope>` rule" — the scope word
alone routes the content:

| You say | Destination |
|---|---|
| "add a **universal rule**" | `sync-sources/rules/<name>.md`, `scope: universal` |
| "add a **dev rule**" | `sync-sources/rules/<name>.md`, `scope: dev` |
| "add a **project rule**" | `<root>/.overdeck/context/project.md` |
| "add a **machine rule**" | `~/.overdeck/context/global.md` |

The `rule-authoring` bundled rule (`scope: dev`) carries the authoring
procedure for the first two.

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

## `pan sync` and launch-time delivery

`pan sync` writes only Overdeck-owned global renders:
`~/.overdeck/context/claude-global.md`, `pi-global.md`, and
`codex-global.md`. Each workspace's `.overdeck/context/workspace.md` remains
harness-neutral. At managed-session launch, Overdeck renders global rules and
the canonical project layer for the active harness, combines them exactly once
with workspace-only content in `~/.overdeck/context/launch/`, and delivers that
private artifact explicitly. Native harness files are never sync targets.

Claude Code receives the artifact through its append-system-prompt launch
mechanism, Codex through `developer_instructions`, and Pi through its spawn-time
system context. Native Kimi has no launch-only system-prompt flag, so Overdeck
sends a clearly delimited context envelope once as the first user message after
capturing Kimi's generated session id. The context block precedes the original
operator task, and a per-session receipt prevents resume/recovery paths from
injecting it again. This transport does not create or edit `AGENTS.md`,
`CLAUDE.md`, or any other native instruction file.

`pan sync` also:

- writes a sync-input manifest. After an Overdeck upgrade changes bundled
  context, hooks, agents, or skills, the dashboard shows a **Sync now** banner;
  the button runs `pan sync` on the host and disappears only after the manifest
  matches the installed package;
- folds bundled engineering rules into harness-specific launch artifacts.

## Respecting your existing context

Native instruction files are a strict no-touch boundary. Overdeck may let a
harness read the user's files normally, but no automatic Overdeck path creates,
edits, cleans, backs up, migrates, or deletes them. Historical marked regions
can be removed only through the explicit dry-run-first `pan context detach`
migration.

## Bundled rules

Overdeck ships engineering rules under `sync-sources/rules/`. Each rule
carries a `scope:` frontmatter key:

- `scope: universal` — folded into managed launch context everywhere;
- `scope: dev` — folded in only on a overdeck checkout (`isDevMode()`),
  for rules about developing Overdeck itself.

### Config gating (`context.rules`)

Every bundled rule is on by default. `context.rules` in
`~/.overdeck/config.yaml` is a per-rule opt-out map keyed by the rule's file
basename (no `.md`): `false` omits the rule, any absent key (or `true`) keeps
it. Example: `context: { rules: { ste-writing: false } }`.

The gate lives in `disabledRuleNames()` (`src/lib/context-layers/rules.ts`)
and threads through both render surfaces — `renderGlobalLayer()` (sync, ACP,
`pan context diff`) and the dashboard Context-page preview
(`renderBundledRulesAsync` in `src/dashboard/server/routes/context.ts`) — so
the preview always matches what ships. The map is read at render time:
toggling requires `pan sync` plus a new session. First gated rule:
`ste-writing` (PAN-3658).

## `pan context` CLI

```
pan context list                  # show all three layers and their files
pan context list --layer global   # one layer
pan context edit                  # open global.md in $EDITOR
pan context edit --layer project  # open this project's project.md
pan context sync                  # refresh managed-session launch artifacts
pan context detach --dry-run      # preview historical managed blocks
pan context detach --apply        # back up and remove unambiguous blocks
pan context diff                  # show what each harness would receive
pan context diff --harness pi     # just one harness
pan context validate              # lint templates for malformed blocks
pan context migrate               # one-shot migration off sync.devroot
```

## Dashboard Context page

The dashboard Context page edits the same layered files as the CLI. Use the
scope selector to switch between Machine, Project, and Workspace context; project
and workspace selectors choose the registered project or workspace whose
`.overdeck/context/project.md` or `.overdeck/context/workspace.md` file is loaded.
The canonical context files are under `.overdeck/context/`; context is
code-owned and is not stored in the permanent-state worktree.

**Edit source** and **Preview for agent** share the available width so the editor
remains usable beside the dashboard navigation. The preview selector includes
Claude Code, Codex, Pi, Kimi Code, ACP, and an all-harness audit view. Preview
content identifies its sources; it is not a transcript or a complete view of a
harness's private system prompt. Draft edits remain when switching views or scopes.

Previewing is read-only. **Save** writes only the selected source. **Save & refresh
outputs** saves first, then runs `pan context sync`. **Generated output files**
shows the output locations and provides a separate refresh action when there are
no unsaved edits. **Other instruction sources** explains bundled rules and the
additional guidance a harness can load. Existing conversations retain their
context; saved instructions apply to new sessions.

The editor and its worker are bundled locally, so editing does not depend on a
public CDN. At narrow widths the scope selector sits above the work area, with
all actions retained.

## `sync-sources/` — Overdeck's own bundled content

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

1. preserves native instruction files in place;
2. copies `<devroot>/.claude/{skills,agents}/` → `~/.overdeck/context/global/`;
3. offers to register each project found under `~/Projects/`;
4. prints where the old location is preserved.

If a non-interactive migration skips registration, register projects with
`pan projects add <path>`. The singular `pan project ...` form remains available
as a compatibility alias, but new docs and prompts prefer `pan projects ...`.

It never overwrites an existing target (safe to re-run) and never deletes the
source. After verifying the migration, delete the old location and set
`sync.devroot` to `null` to silence the warning.

## Instruction source inventory

Overdeck-managed context and harness-native discovery are separate inputs.
Changing the transport does not disable a user's native instructions.

| Input | Canonical source | Delivery |
| --- | --- | --- |
| Machine context | `~/.overdeck/context/global.md` | Harness-filtered launch composition |
| Bundled rules | `sync-sources/rules/*.md` | Applicable scope and enabled rules, each labeled with its source path |
| Project context | `<project>/.overdeck/context/project.md` | Resolved from the registered project at launch |
| Workspace context | `<workspace>/.overdeck/context/workspace.md` | Issue metadata, memory, and status |
| Legacy context paths | `.pan/context/project.md`, `.pan/context/workspace.md` | Read fallback only when the canonical file is absent |
| Role instructions | Role definition selected by the launcher | Frontmatter removed; source path retained in the role prompt |
| Session briefing | The briefing resolver's Overdeck-owned file | Added to the launch context |

Global render files are outputs, not independent sources. Claude receives one
composed append-file argument, including role context and briefing; conversation
and work launchers use the same composition. Codex uses developer instructions,
including on app-server thread start and resume. Native Codex project discovery
remains enabled. Fresh managed Codex config homes use `codex-home-v2`; their
`sessions` directory points to the established `codex-home/sessions` location,
so old instruction copies are excluded without moving transcript data.

Claude's native inputs include the user `~/.claude/CLAUDE.md`, user rules under
`~/.claude/rules/`, project `CLAUDE.md` or `.claude/CLAUDE.md`, `CLAUDE.local.md`,
project `.claude/rules/`, applicable ancestor and descendant files, and `@`
imports. Organization policy lives at `/etc/claude-code/CLAUDE.md` on Linux,
`/Library/Application Support/ClaudeCode/CLAUDE.md` on macOS, and
`C:\Program Files\ClaudeCode\CLAUDE.md` on Windows. Additional-directory settings
can extend discovery. Claude auto memory is another input, normally under
`~/.claude/projects/<project>/memory/`; it is not a context-layer source.

Codex's native global input is `$CODEX_HOME/AGENTS.override.md`, otherwise
`$CODEX_HOME/AGENTS.md`. Overdeck explicitly preserves the user's ordinary
`~/.codex/AGENTS.override.md` or `AGENTS.md` because managed sessions use a private
config home. Project discovery follows the repository-root-to-working-directory
chain, choosing `AGENTS.override.md`, then `AGENTS.md`, then configured fallback
filenames in each directory. Nested files govern their directory scope.

Skills, plugins, hooks, subagent definitions, explicit operator messages, and
resumed conversation history can supply additional guidance. An instruction
appearing in a transcript is not proof that it came from a file of the same
name. Use source labels and the launch receipt to establish provenance.

References: [Claude memory](https://code.claude.com/docs/en/memory) and
[Codex instructions](https://developers.openai.com/codex/guides/agents-md).

Legacy workspace bundles with an invalid or missing project boundary require
review before launch. The renderer refuses to truncate ambiguous sections,
because those sections can contain memory or status. Preserve that content when
rebuilding the workspace layer; marked bundles retain every non-project section.

## Retired workspace template audit

The old generated `CLAUDE.md` combined three template sections. Their contents
have the following destinations; the old template generator is no longer called.

| Old surface | Destination or deliberate retirement |
| --- | --- |
| Issue, branch, and workspace path | Harness-neutral workspace context; covered by assembly tests |
| Project-specific instructions | Canonical project layer, rendered once for the launch harness |
| Memory and workspace status | Preserved workspace sections; legacy-boundary tests reject ambiguous truncation |
| Hardcoded Docker URL guesses | Retired; workspace resource metadata supplies actual service endpoints |
| `/work-*` command list and obsolete skills directory | Retired; installed skills and the current CLI command registry provide supported commands |
| Investigation, isolation, tmux, and completion guidance | Existing bundled rules and role prompts remain explicit launch inputs |
| Mandatory `Co-Authored-By` example and blanket `git add -A` | Retired; current repository commit rules and the commit skill govern commits |

The directory guide formerly named `docs/AGENTS.md` is now
`docs/AGENT-DIRECTORIES.md`, with its contents preserved. It is documentation,
so it should not implicitly become instructions for agents editing `docs/`.
