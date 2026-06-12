---
scope: universal
---
### Context placement nomenclature — canonical terms

Panopticon distributes context through the **context layers** system (see
`docs/CONTEXT-LAYERS.md` in panopticon-cli). Use these exact terms when adding,
moving, or discussing context, and map user requests onto them:

| Term | Source file | Use for |
| --- | --- | --- |
| **Bundled rule** | `sync-sources/rules/<name>.md` in panopticon-cli, with `scope: universal` or `scope: dev` | Engineering rules and behavioral guidance for **every machine**; ships with `pan install` / `pan sync` |
| **Global layer** (a.k.a. machine context) | `~/.panopticon/context/global.md` | Genuinely **machine-specific** quirks only ("this laptop's GPU is an RTX 3090") |
| **Project layer** | `<projectRoot>/.pan/context/project.md` | Guidance for **one project**; committed to that repo |
| **Workspace layer** | `<workspace>/.pan/context/workspace.md` | Auto-assembled per issue workspace; **never hand-edit** |

The rendered outputs — the managed region of `~/.claude/CLAUDE.md`, each
project's `CLAUDE.md` and `AGENTS.md`, and `~/.panopticon/context/pi-global.md` /
`codex-global.md` — are **harness context files**. Never edit them directly:
edit the source layer or bundled rule, then run `pan sync`.

Default routing for requests:

- "make all agents do X everywhere" → **bundled rule**, `scope: universal`
- "only when developing Panopticon itself" → **bundled rule**, `scope: dev`
- "only in this project" → **project layer**
- "only on this machine" → **global layer**

When a request uses a vague or ad-hoc term (e.g. "global context template",
"the CLAUDE.md template"), translate it to one of the four canonical terms above
and confirm the routing if the universal-rule vs project-layer choice is
ambiguous.
