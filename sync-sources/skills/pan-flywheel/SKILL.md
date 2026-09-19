---
name: pan-flywheel
description: >-
  pan flywheel start — run the Fix-All Flywheel as a loop skill: tick the
  order books and backlog sequence in `.pan/`, pick the next issue, launch
  work with `pan start`, watch its PR and checks to landing, run `pan
  reload` after an overdeck merge lands with green CI, and park whatever it
  cannot decide.
triggers:
  - pan flywheel
  - flywheel
  - fix-all flywheel
  - start flywheel
  - run the flywheel
---

# pan flywheel

The Flywheel is a loop, not a daemon. It runs inside this conversation, ticks
the backlog, and keeps issues moving through `pan start` → PR → review →
merge without a supervising process or a stored run record. State is never
duplicated here: every fact this loop acts on is read live from `.pan/`, the
tracker, and the forge.

```bash
pan flywheel start
pan orders start <book-id>
```

`pan flywheel start` opens this skill in a conversation working the open
backlog directly. `pan orders start <book-id>` opens the same skill bound to
one order book (`pan orders show <book-id>`).

## Phase 1 — Orient

1. Read `.pan/backlog/sequence.md` for the operator-set pickup order.
2. If an order book is bound (started via `pan orders start`, or one is
   `running`), read it with `pan orders show <book-id>` — its Lane A/B items
   and prereqs take priority over the general backlog.
3. List in-flight work: `gh pr list --search "is:open"` for this repo, and
   `pan status` for live sessions. Anything already moving does not need a
   new pick.

## Phase 2 — Pick the next item

Walk the backlog sequence (or the bound order book's next lane item whose
prereqs are terminal) and pick the first issue that is not already in flight,
not blocked, and not parked. "Parked" means the tracker issue carries the
`parked` label or is listed in `.pan/parked.md` — skip it silently, it was
parked on purpose.

If nothing is pickable — every remaining item is blocked, parked, or the
book/backlog is empty — say so plainly (`needs-you: pipeline idle — nothing
pickable`) and stop the loop rather than inventing work.

## Phase 3 — Launch

```bash
pan start <issue-id>
```

`pan start` plans (if unplanned) and starts the work agent in one command.
Do not use `pan spawn`, `pan swarm`, or any lower-level launcher for the
Flywheel's own picks — `pan spawn` is for the foreman dispatching item
workers *within* an already-started issue, not for the Flywheel picking a
new one.

## Phase 4 — Watch to landing

Poll the issue's derived state, not a stored one:

| Signal | Source |
|---|---|
| Is work still running? | `pan status` / `pan show <id>` |
| Is a PR open? | `gh pr view` for the feature branch |
| Is it in review? | PR review requested, or a reviewer pane live |
| Changes requested? | Latest PR review state is `CHANGES_REQUESTED` |
| Ready to merge? | PR approved, checks green, `mergeable` true |
| Merged? | PR merged |

An issue sitting in "changes requested" for a while is normal — the work
agent handles its own review feedback loop. Only intervene (`pan tell`) if
the agent looks stuck (idle with unaddressed feedback) — deacon-lite already
nudges this case; give it a chance before you do.

Once a PR onto Overdeck's own `main` merges with green CI, run:

```bash
pan reload
```

Only for an Overdeck merge — not for merges in other projects the loop is
also driving. Other projects deploy their own way; do not `pan reload` on
their behalf.

## Phase 5 — Park what you cannot decide

Some calls are the operator's: ambiguous scope, a design tradeoff with no
clear default, anything destructive, anything outside the issue's stated
acceptance criteria. For those, write the issue to `.pan/parked.md` with a
one-line reason and move to the next pickable item. Do not block the loop on
an operator decision — park it and keep going.

## Stop conditions

- **The operator is the brake.** Nothing here finishes on its own; when told
  to stop, stop cleanly and report what shipped, what's in flight, and
  what's parked.
- **Backlog and bound book both exhausted** — every item merged, parked, or
  blocked with no path forward. Report and stop; do not manufacture more
  scope.

## Guardrails

- Do not start a second Flywheel loop in the same repo while one is active
  in another conversation — check `pan status` first.
- Do not auto-merge or deep-wipe from the loop; those stay explicit,
  human-triggered actions (the MERGE button, `gh pr merge`, `pan wipe`).
- Do not write a pipeline status field anywhere. If you find yourself about
  to `curl` a `/status` endpoint, stop — that endpoint does not exist
  anymore; the derived state table above is the only source of truth.

## See Also

- `pan-gauntlet-loop` skill — the loop shape this skill follows
- `pan-orders` skill — order book verbs
- `pan-foreman` skill — how a single issue's parallel waves get dispatched
  once the Flywheel has started it
- `pan-start` skill — the paved-road launcher
