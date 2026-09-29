---
name: pan-foreman
description: >-
  The work-agent protocol for an issue whose xBRIEF plan has parallel waves.
  The foreman is the issue's work agent: it dispatches same-family workers as
  in-harness subagents in worktrees and cross-family workers as terminal-backend
  panes via `pan spawn`, has every worker commit on its own item branch and
  hand back, integrates each item onto the feature branch and runs `pan task
  done` for it, and runs `pan done` once at the end.
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

  This creates a worker pane in its own item worktree
  `<workspace>/.swarm/<item-id>/` on branch `<feature-branch>-<item-id>`.

  `--shared` runs the pane in the issue workspace instead, on the feature
  branch. Use it only for strictly serial work, when no other worker is
  running in the workspace. Only the foreman or the operator may pass it:
  `pan spawn --shared` from a worker pane exits 1.

Either way, give the worker an exact file-ownership map (which files/paths
this item owns) restated in its dispatch prompt — every worker has its own
worktree, but overlapping items still conflict when you integrate them.
Items whose ownership maps overlap run serially, in the same wave, never
concurrently; disjoint items run concurrently. `pan task claim` now enforces
the no-overlap rule itself: it refuses an item whose `files_scope` overlaps
another item a running agent already holds, so a dispatch mistake fails the
claim instead of silently clobbering files.

## Per-item protocol (every worker follows this)

1. `pan task claim <id> <item-id>` — claims the item in the continue file.
   The claim refuses (exit 1, nothing written) when a running agent already
   holds this item, or holds another item whose `files_scope` overlaps it. A
   worker that gets refused runs `pan task next` and picks a different item —
   only the foreman or the operator passes `--steal` to override the refusal.
   A `pan spawn` worker pane claims under its own pane name
   (`OVERDECK_CLAIM_ID`, set by `pan spawn`), so its claim can be liveness-checked.
2. Implement. One item, one concern; run only the touched tests.
3. One commit with the trailer `Item: <item-id>`, on the worker's current
   branch — its item branch `<feature-branch>-<item-id>` (or the feature
   branch for a `--shared` pane).
4. Hand back: report the commit sha and branch to the foreman — an
   in-harness subagent does this in its final result; a `pan spawn` pane
   does it with `pan tell <foreman-agent-id> "<item-id> committed <sha> on
   <branch>"`. Then stop.
5. The worker does not push, does not run `pan task done`, and never runs
   `pan done`.

### Dispatch prompt for a worker

Fill this in and send it with `pan tell <pane-id>` after `pan spawn` prints
the pane id (or pass it as the `Agent` prompt for an in-harness subagent):

```
Issue: <issue-id>
Item: <item-id>
File ownership: <the file-ownership map for this item>
Foreman agent id: <$OVERDECK_AGENT_ID>

Steps:
1. `pan task claim <issue-id> <item-id>`.
2. Implement. One item, one concern; run only the touched tests.
3. One commit with the trailer `Item: <item-id>`, on your current branch.
4. Hand back: report the commit sha and branch to the foreman — in your
   final result if you are a subagent, or with
   `pan tell <foreman-agent-id> "<item-id> committed <sha> on <branch>"` if
   you are a pane. Then stop.
5. Do not push, do not run `pan task done`, and never run `pan done`.
```

## Foreman-only responsibilities

- **Integrate.** For each handed-back item, confirm the commit from the
  issue workspace with
  `git log --format=%H -E --grep='^Item: <item-id>[[:space:]]*$' <feature-branch>..<feature-branch>-<item-id>`,
  cherry-pick or merge it onto the feature branch (re-add the `Item:`
  trailer if you squash; nothing to pick for a `--shared` worker), `git
  push`, then `pan task done <id> <item-id>`.
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
