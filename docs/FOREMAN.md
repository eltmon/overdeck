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
  pan spawn --issue <id> --item <item-id> --model <model> [--harness <h>]
  ```

  This creates a worker pane inside the issue's workspace, stamped with
  backend metadata `issue=<id>`, `role=worker`, `harness=<h>`, `model=<m>`.

Every worker gets an exact file-ownership map in its dispatch prompt. Items
whose maps overlap run serially in the same wave; disjoint items run
concurrently.

## Per-item protocol

Every worker, whichever way it was dispatched, follows the same loop:

1. `pan task claim <id> <item-id>` — claims the item in `.pan/continues/<id>.xbrief.json`.
2. Implement only that item, and run only the tests it touched, with the
   project's test runner scoped to those files (`npx vitest run <files>` in a
   vitest project). Never the full suite — the verification gate runs it
   after `pan done` (PAN-3965).
3. One commit with the trailer `Item: <item-id>`.
4. Push (a `pan spawn` pane pushes the shared feature branch directly; an
   in-harness subagent hands its worktree back to the foreman to integrate).
5. `pan task done <id> <item-id>` — verifies a pushed commit on the feature
   branch carries the trailer, then records completion in the continue file.

A worker never calls `pan done`.

## Foreman-only responsibilities

- **Integrate.** Pull each in-harness subagent's commit onto the feature
  branch (cherry-pick or merge; re-add the `Item:` trailer if you squash)
  and push. A `pan spawn` pane already pushed the shared branch itself —
  just confirm it landed.
- **Own messaging.** Only the foreman's own pane, or an operator, may
  `pan tell` a worker pane — a worker pane refuses a prompt from anywhere
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
