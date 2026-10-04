# The Foreman Protocol

The foreman is the work agent for an issue whose xBRIEF plan has more than
one dispatchable item in a wave. It is not a separate role — it's the same
`work` role, holding the pane whose terminal-backend metadata names
`role: work` for this issue. A plan with a single linear chain of items
needs no dispatch: the work agent just works the checklist item by item.

See the `pan-foreman` skill (`sync-sources/skills/pan-foreman/SKILL.md`) for
the operational version an agent follows live; this doc is the reference.

## Why

Before PAN-3917, parallel item dispatch went through `pan swarm`: slot
registration, a dispatch queue, freeze/resume, and a pipeline record
tracking each slot. That machinery stays in the tree (D11) but is not
wired into the default work path. The foreman replaces it with something
smaller: the work agent dispatches its own workers directly, using the
terminal backend and the same claim/commit/`pan task done` loop every item
already goes through.

## Dispatch: same-family vs. cross-family

- **Same-family** (same harness as the foreman) — dispatch as an in-harness
  subagent (the `Agent` tool) in its own git worktree under the issue's
  workspace.
- **Cross-family** (a different harness, or the operator should see it as
  its own pane) — dispatch as a terminal-backend pane:

  ```bash
  pan spawn --issue <id> --item <item-id> --model <model> [--harness <h>] [--effort <level>]
  ```

  This creates a worker pane in its own item worktree
  `<workspace>/.swarm/<item-id>/`, on branch `<feature-branch>-<item-id>`,
  stamped with backend metadata `issue=<id>`, `role=worker`, `harness=<h>`,
  `model=<m>`.

  `--shared` runs the pane in the issue workspace instead, on the feature
  branch. Use it only for strictly serial work, when no other worker is
  running in the workspace. Only the foreman or the operator may pass it:
  `pan spawn --shared` from a worker pane exits 1. It changes only where the
  commit lands — the foreman still pushes and runs `pan task done`.

`pan spawn` is the foreman's pane-only item worker: it has no `state.json`,
returns only a pane id, and hands back to the foreman rather than reporting
directly. `pan worker run`
(PAN-3920, [reference/workers.mdx](../reference/workers.mdx)) is the registered
worker: a native agent with role `worker`, its own state, transcript and cost,
a parent that may steer it, and a report that comes back to the caller on
stdout. Use `pan spawn` for xBRIEF items inside a wave; use `pan worker run`
to delegate a bounded brief and read its answer.

Every worker gets an exact file-ownership map in its dispatch prompt — every
worker has its own worktree, but overlapping items still conflict when you
integrate them. Items whose maps overlap run serially in the same wave;
disjoint items run concurrently. `pan task claim` now enforces this itself:
it refuses an item whose `files_scope` overlaps another item a running agent
already holds, so a dispatch mistake fails the claim instead of silently
clobbering files.

## Per-item protocol

Every worker, whichever way it was dispatched, follows the same loop:

1. `pan task claim <id> <item-id>` — claims the item in `.pan/continues/<id>.xbrief.json`.
   The claim refuses (exit 1, nothing written) when a running agent already
   holds this item, or holds another item whose `files_scope` overlaps it. A
   worker that gets refused runs `pan task next` and picks a different item —
   only the foreman or the operator passes `--steal` to override the refusal.
   A `pan spawn` worker pane claims under its own pane name
   (`OVERDECK_CLAIM_ID`, set by `pan spawn`), so its claim can be liveness-checked.
2. Implement only that item, and run only the tests it touched, with the
   project's test runner scoped to those files (`npx vitest run <files>` in a
   vitest project). Never the full suite — the verification gate runs it
   after `pan done` (PAN-3965).
3. One commit with the trailer `Item: <item-id>`, on the worker's current
   branch — its item branch `<feature-branch>-<item-id>` (or the feature
   branch for a `--shared` pane).
4. Hand back: report the commit sha and branch to the foreman — an
   in-harness subagent does this in its final result; a `pan spawn` pane does
   it with `pan tell <foreman-agent-id>`.
5. The worker does not push and does not run `pan task done`; the foreman
   does both after integrating.

A worker never calls `pan done`. `pan task done` looks for the trailer on
the issue workspace's feature branch and checks that branch is pushed
(`markItemDone`, `src/lib/xbrief/continue-state.ts`), so it can only succeed
after integration.

## Foreman-only responsibilities

- **Integrate.** For each handed-back item, confirm the commit from the
  issue workspace with
  `git log --format=%H -E --grep='^Item: <item-id>[[:space:]]*$' <feature-branch>..<feature-branch>-<item-id>`,
  cherry-pick or merge it onto the feature branch (re-add the `Item:`
  trailer if you squash; nothing to pick for a `--shared` worker), `git
  push`, then `pan task done <id> <item-id>`.
- **Own messaging.** Only the foreman's own pane, the worker's parent (for a
  `pan worker run` worker), or an operator, may `pan tell` a worker pane — a worker pane refuses a prompt from anywhere
  else (backend-enforced). Workers do not message each other; route
  cross-item questions through the foreman.
- **Sequence waves.** Don't start wave N+1 items until wave N's
  file-ownership conflicts are resolved (landed, or the conflicting item is
  done).
- **Finish once.** After every item is done and integrated:

  ```bash
  pan done <id>
  ```

  Exactly once, from the foreman's own pane, after the last item lands on
  the feature branch. `pan done` runs typecheck and lint, opens or updates
  the PR, and requests review — it writes nothing else. The full test suite
  runs on CI against the PR head where the project's tests run on CI
  (`verification.tests: ci`), else locally in the verification gate; a test
  failure comes back to the foreman as `VERIFICATION FAILED … Failed check:
  test`. Do not run the suite on the host before `pan done`.

## What this protocol does not do

No inspection gate, no claim written to a pipeline record, no recovery
ladder, no stop hook chasing a forgotten `pan done`. Item status is
`.pan/continues/<id>.xbrief.json` plus the `Item:` commit trailers on the
feature branch — nothing else needs to agree with it.

## See also

- `sync-sources/skills/pan-foreman/SKILL.md` — the operational skill
- `sync-sources/agents/pan-work-agent.md` — the work-agent prompt (the
  foreman is this role; no separate agent file)
- [`docs/XBRIEF.md`](./XBRIEF.md) — the continue-file format and task loop
- [`docs/ROLES.md`](./ROLES.md) — role taxonomy
