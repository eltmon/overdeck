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

The Flywheel page (`/flywheel`) and `pan flywheel status` show this loop by
reading what it leaves behind — this conversation's transcript, the pipeline
journals, the tracker, and `.pan/flywheel/`. Nothing else records a run.

## Verbs

```bash
pan flywheel start
pan flywheel start --orders <book-id>
pan flywheel start --fresh
pan flywheel stop
pan flywheel abort
pan flywheel pause
pan flywheel resume
pan flywheel report
pan flywheel status --json
pan flywheel stats --json
```

`stop` asks this loop to write its report, waits, then pauses the
conversation; `abort` pauses without a report; `pause` stops the session and
keeps the conversation; `resume` respawns it and re-sends `/pan-flywheel`
(re-entry is safe: Orient re-reads everything); `report` asks a running loop
for its report; `status` and `stats` are derived reads.

## Mission

A **loop with a metabolism.** Every revolution must permanently improve the
substrate — Overdeck itself. *An agent without a metabolism ships and rots;
one with a metabolism ships and compounds.* **A workaround is a failed tick.**

When a tick hits a substrate bug, the tick's job becomes fixing it (file it
with the `substrate-improvement` label, launch the fix with `pan start`), not
routing around it. Record each substrate fix in the state file below.

## Phase 1 — Orient

1. Read the policies from `pan flywheel status --json` (the `.policies`
   object) — never assume their defaults. Read `.pan/flywheel/state.md` for
   what earlier runs learned.
2. Read `.pan/backlog/sequence.md` for the operator-set pickup order.
3. If an order book is bound (started via `pan orders start`, or one is
   `running`), read it with `pan orders show <book-id>` — its Lane A/B items
   and prereqs take priority over the general backlog.
4. List in-flight work: `gh pr list --search "is:open"` for this repo, and
   `pan status` for live sessions. Anything already moving does not need a
   new pick.

## Pickup gate

A backlog issue is **auto-pickable** — eligible to *start work* — iff:

    ready && planned && (released || auto_pickup_backlog || activeBookMember) && !parked && !vetoed && !objection && !inPipeline && !epic

This mirrors `isAutoPickable()` in `src/lib/backlog/pickup.ts`. The gates:

- **ready** — operator marked it workable (`ready` label, Definition of Ready).
- **planned** — has an xBRIEF spec with implementation items.
- **released** — operator's "go" after reviewing the plan (`released`, PAN-2059). Required to
  auto-start when `auto_pickup_backlog` is OFF unless the issue belongs to the active order book;
  when ON, the toggle is the blanket release. Operator-only — never add the label yourself.
- **parked** (`parked`/`needs-design`/`needs-discussion`) — held for a human decision; skip.
- **vetoed** — absolute operator hard-stop (see below).
- **objection** — you raised a written relevance objection; halts pickup until override.
- **inPipeline** — already has live work/review/test.
- **epic** — a container, never directly workable.

**`vetoed` is absolute.** Never pick up, plan, or strike a `vetoed` issue, even to unblock
the pipeline. The one exception to "never block on the operator."

`released` and `vetoed` are operator-only labels: this loop never adds or
removes either one.

## Phase 2 — Pick the next item

Walk the backlog sequence (or the bound order book's next lane item whose
prereqs are terminal) and pick the first issue that is not already in flight,
not blocked, and not parked. "Parked" means the tracker issue carries the
`parked` label or is listed in `.pan/parked.md` — skip it silently, it was
parked on purpose.

If nothing is pickable — every remaining item is blocked, parked, or the
book/backlog is empty — say so plainly in the tick marker (`phase=idle
needs-you=pipeline idle — nothing pickable`) and stop the loop rather than
inventing work.

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

## Policies

- `auto_pickup_backlog` (default OFF). OFF: the operator releases each
  backlog item individually — the Flywheel picks up only items marked
  released. ON: blanket release — every ready and planned backlog item is
  pickable without individual operator release.
- `require_uat_before_merge` (default ON): a PR may not merge until UAT has
  passed.

## Tick marker

End every tick — every revolution of orient → pick → launch → watch → park —
by printing exactly one line in this shape, on its own line, as the last line
of your message:

```text
flywheel-tick: tick=3 pick=PAN-3964 phase=watch in-flight=PAN-3964,PAN-3920 needs-you=none
```

- `tick` counts up from 1 for this conversation.
- `pick` is the issue this tick picked, or `none`.
- `phase` is one of `orient`, `pick`, `launch`, `watch`, `park`, `idle`,
  `stopping`.
- `in-flight` is a comma-separated list of the issues moving now, or `none`.
- `needs-you` is `none` or a short plain sentence for the operator. It is
  always the last key and may contain spaces.

The Flywheel page and `pan flywheel status` parse this line from the
transcript; it is the only status this loop reports. Never `curl` or POST a
status anywhere.

## State file

`.pan/flywheel/state.md` is this loop's durable memory across runs: substrate
fixes it drove (issue, what broke, what fixed it) and learnings worth keeping.
Append to it — never rewrite history — when a tick produces one, then commit
and push it so `main` does not diverge:

```bash
git add .pan/flywheel/state.md
git commit -m "chore(workspace): flywheel state"
git push
```

It is memory, not status: never write a pipeline state, a run id, or a
counter into it.

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

To report — on stop, or whenever asked for a report — write
`.pan/flywheel/report.md` (what shipped, what is in flight, what is parked,
substrate fixes this run), overwriting the previous report, then commit and
push it:

```bash
git add .pan/flywheel/report.md
git commit -m "chore(workspace): flywheel report"
git push
```

When stopping, print the tick marker with `phase=stopping` and end the loop.
When only asked for a report, print it with `phase=watch` and continue.

## Guardrails

- Do not start a second Flywheel loop in the same repo while one is active
  in another conversation — check `pan status` first.
- Do not auto-merge or deep-wipe from the loop; those stay explicit,
  human-triggered actions (the MERGE button, `gh pr merge`, `pan wipe`).
- Do not write a pipeline status field anywhere. There is no endpoint to
  report to: `GET /api/flywheel/status` is a derived read of your transcript,
  and the tick marker is how you report. The derived state table above is the
  only source of truth for an issue's position.
- Do not auto-start pipeline-machinery refactors (TENET-10): changes to the
  deacon, the flywheel loop, conversation live-control, the merge or review
  routes, or the agents runtime. Mark them `needs-handoff` and route them
  through a supervised `pan handoff` instead. A broken change there turns
  main red and stalls every other merge.

## See Also

- `pan-gauntlet-loop` skill — the loop shape this skill follows
- `pan-orders` skill — order book verbs
- `pan-foreman` skill — how a single issue's parallel waves get dispatched
  once the Flywheel has started it
- `pan-start` skill — the paved-road launcher
