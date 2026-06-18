---
scope: universal
---
### Context placement — say "add a `<scope>` rule"

Overdeck distributes context through the **context layers** system
(`docs/CONTEXT-LAYERS.md`; user docs:
https://overdeck.ai/configuration/context-layers). All placement
requests use one shorthand — **"add a `<scope>` rule: `<content>`"** — where the
scope word alone determines the destination:

| You say | Applies to | Where it goes |
| --- | --- | --- |
| **universal rule** | every machine, every project | bundled rule: `sync-sources/rules/<name>.md` in overdeck, `scope: universal` |
| **dev rule** | Overdeck development only | bundled rule: `sync-sources/rules/<name>.md`, `scope: dev` |
| **project rule** | one project | `<projectRoot>/.pan/context/project.md` (project layer) |
| **machine rule** | this machine only | `~/.panopticon/context/global.md` (global layer) |

After writing any of them, run `pan sync`. Changes reach **new** sessions only.

The rendered outputs — the managed region of `~/.claude/CLAUDE.md`, project
`CLAUDE.md`/`AGENTS.md`, and `pi-global.md`/`codex-global.md` — are **harness
context files**; never edit them directly.

Translate vague or ad-hoc terms ("global context template", "the CLAUDE.md
template") into one of the four scopes above, and confirm the routing when the
universal-vs-project choice is ambiguous.
