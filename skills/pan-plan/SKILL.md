---
name: pan-plan
description: "pan plan — planning lifecycle commands (finalize, done). Use when working inside a planning workspace to materialize the vBRIEF into beads and complete planning."
triggers:
  - pan plan
  - plan finalize
  - plan done
  - finalize planning
  - complete planning
  - promote vbrief
allowed-tools:
  - Bash
  - Read
  - Glob
  - Grep
---

# Panopticon Planning Lifecycle

`pan plan` is the **planning-lifecycle** namespace. It does not start a planning
session — planning is kicked off from the dashboard. `pan plan` exists so an
agent running inside a planning workspace can finalize its work and hand off
to implementation.

## Available subcommands

```
pan plan finalize [-w <path>] [--json]   # Materialize plan into beads, mark spec proposed
pan plan done <id>                       # Complete planning, promote vBRIEF, transition issue to Planned
```

`pan plan` with no subcommand prints the help. There is no `pan plan <id>` form
to start a session — that's the dashboard's job.

## How a planning session actually starts

There are two entry points today:

1. **Dashboard.** Click the "Plan" button on an issue's card. Panopticon
   creates a planning workspace, spawns a planning agent, and opens a tmux
   pane for interactive Q&A. The agent role is `plan` (see `roles/plan.md`),
   the workspace is `workspaces/planning-<issue-id>/`, and the tmux session
   is `planning-<issue-id>`.
2. **CLI (coming soon — tracked in #1071).** `pan plan <id> --auto` will run
   the planning agent end-to-end non-interactively. Not yet shipped; check
   `pan plan --help` to see if it's available.

The planning agent reads the issue body and any linked PRD, explores the
codebase, asks discovery questions through the dashboard chat, and writes
`<workspace>/.pan/spec.vbrief.json` as it goes.

## Finalizing (`pan plan finalize`)

Run this from **inside the planning workspace** when the planning agent has
produced a complete vBRIEF and you want to materialize it into beads.

```bash
cd workspaces/planning-pan-1072
pan plan finalize
```

What it does:

1. Reads `.pan/spec.vbrief.json` from the current workspace (walks up if needed).
2. Materializes each `plan.items[]` entry into a corresponding bead in
   `.beads/issues.jsonl`, respecting declared dependencies.
3. Flips the spec's `plan.status` from `draft` to `proposed`.
4. Returns a summary of beads created (or JSON when `--json` is passed).

Use `-w <path>` to point at a workspace other than the cwd:

```bash
pan plan finalize -w workspaces/planning-pan-1072 --json
```

## Completing planning (`pan plan done`)

After `finalize`, run `pan plan done <issue-id>` to fully close out the
planning phase:

```bash
pan plan done PAN-1072
```

What it does:

1. Promotes the workspace vBRIEF to the canonical location at
   `<projectRoot>/.pan/specs/<date>-<ISSUE>-<slug>.vbrief.json`.
2. Syncs beads from the workspace to the project's beads database.
3. Transitions the issue's tracker state to **Planned** (Linear) or applies
   the equivalent label/status on GitHub.

At this point the issue is ready for `pan start <id>`, which spawns the
work agent against the proposed vBRIEF.

## When to use vs. when to skip planning

Use planning when the issue is non-trivial — unclear requirements, multiple
implementation approaches, security/perf sensitivity, or work that touches
unfamiliar subsystems. The planning artifact (vBRIEF + beads) becomes the
contract the implementation, review, and test agents all work against.

Skip planning for trivial work — typo fixes, comment cleanups, version bumps.
`pan start <id> --auto` (coming in #1071) will let you bypass the planning
agent entirely and synthesize a minimal vBRIEF directly from the issue body.

## Troubleshooting

**`pan plan finalize` says no spec found:** the planning agent never wrote
`.pan/spec.vbrief.json` to this workspace. Confirm you're in the planning
workspace (not the main repo) and that the planning session actually ran.
`cat .pan/spec.vbrief.json | head` should show a vBRIEF document.

**`pan plan done` says issue not transitioning:** the tracker integration
(Linear OAuth or GitHub token) may be expired. Check `pan admin tracker
status` and re-authenticate if needed.

**The dashboard "Plan" button does nothing:** confirm the dashboard is
healthy via `pan status` and that the project is registered (`pan project
list`).

## Related skills

- `/pan-start` — spawn an implementation agent after planning completes
- `/pan-show` — inspect planning agent state, vBRIEF contents, health
- `/pan-tell` — send a message to a running planning agent
- `/pan-kill` — stop a planning agent (workspace preserved)
- `/pan-workflow` — full pipeline reference (plan → work → review → ship)

## See also

- `roles/plan.md` — the planning role's frontmatter and prompt
- `docs/VBRIEF.md` — vBRIEF schema, the five-artifact model, lifecycle states
- `docs/SKILLS-CONVENTION.md` — why this skill is named `pan-plan` and how
  it relates to the `pan plan` CLI verb
