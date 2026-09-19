---
name: pan-foreman
description: >-
  The work-agent protocol for an issue whose xBRIEF plan has parallel waves.
  The foreman is the issue's work agent: it dispatches same-family workers as
  in-harness subagents in worktrees and cross-family workers as terminal-backend
  panes via `pan spawn`, owns claim/commit/`pan task done` per item, integrates
  every item onto the feature branch, and runs `pan done` once at the end.
triggers:
  - pan foreman
  - foreman
  - parallel waves
  - dispatch workers
allowed-tools:
  - Bash
  - Read
  - Agent
---

# pan foreman

Use this when the issue's xBRIEF plan (`pan task show <id>`) has more than
one dispatchable item in a wave. A plan with a single linear chain of items
does not need this — just work the checklist item by item as the plain work
agent. This skill is the foreman's own protocol, not a separate role: the
foreman IS the work agent for this issue, holding the pane whose backend
metadata names `role: work`.

## Same-family vs. cross-family

- **Same-family** (same harness as you, e.g. another Claude Code instance) —
  dispatch as an in-harness subagent (the `Agent` tool) in its own git
  worktree under the issue's workspace. Cheap, fast, shares your context
  window's tooling.
- **Cross-family** (a different harness, or you need it visible as its own
  terminal pane for the operator to watch or intervene) — dispatch as a
  terminal-backend pane:

  ```bash
  pan spawn --issue <id> --item <item-id> --model <model> [--harness <h>]
  ```

  This creates a worker pane inside the issue's workspace, stamped with
  backend metadata `issue=<id>`, `role=worker`, `harness=<h>`, `model=<m>`.

Either way, give the worker an exact file-ownership map (which files/paths
this item owns) restated in its dispatch prompt — concurrent workers in one
worktree WILL clobber shared files. Items whose ownership maps overlap run
serially, in the same wave, never concurrently; disjoint items run
concurrently.

## Per-item protocol (every worker follows this)

1. `pan task claim <id> <item-id>` — claims the item in the continue file.
2. Implement. One item, one concern.
3. One commit with the trailer `Item: <item-id>`, on the worker's own branch
   (its worktree branch for an in-harness subagent, or the feature branch
   directly for a `pan spawn` pane working in the shared workspace).
4. Push (a `pan spawn` pane pushes the feature branch itself; an in-harness
   subagent hands its worktree back to the foreman, which integrates and
   pushes).
5. `pan task done <id> <item-id>` — verifies the `Item:` trailer is present
   on a pushed commit on the feature branch and records completion in
   `.pan/continues/<id>.xbrief.json`. Run this from wherever the commit
   actually landed on the feature branch — after the foreman's integration
   step for an in-harness subagent, immediately for a `pan spawn` pane.

A worker never runs `pan done` — only the foreman does, once, at the end.

## Foreman-only responsibilities

- **Integrate.** Pull each in-harness subagent's worktree commit onto the
  feature branch (cherry-pick or merge — if you squash, re-add the `Item:`
  trailer so `pan task done` can still find it) and push. A `pan spawn`
  pane already commits and pushes directly to the shared feature branch, so
  there is nothing to integrate for those — just confirm the push landed.
- **Own messaging.** Only the foreman's pane (`role: work`) or an operator
  conversation may `pan tell` a worker pane; a worker pane refuses a prompt
  from anything else (backend-enforced, FR-17). Workers do not message each
  other — route cross-item questions through the foreman.
- **Watch waves.** Do not start wave N+1 items until wave N's file-ownership
  conflicts are clear (either wave N landed, or the conflicting item is
  done).
- **Finish once.** After every xBRIEF item is done and integrated:

  ```bash
  pan done <id>
  ```

  Run this exactly once, from the foreman's own pane, after the last item
  lands on the feature branch.

## What this protocol does not do

No inspection gate, no claim written to a pipeline record, no recovery
ladder, no stop hook chases a forgotten `pan done`. Item status is the
`.pan/continues/<id>.xbrief.json` checklist plus the `Item:` commit trailers
on the feature branch — nothing else needs to agree with it.

## See Also

- `pan-task` skill — claim/done verbs and the continue file
- `pan-done` skill — the single finishing call
- `pan-flywheel` skill — what picks the issue that lands here
- `docs/FOREMAN.md` — the protocol in full
