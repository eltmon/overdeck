# Flywheel and gauntlet as one "run": design brief for a grilling session

**Status:** brief for a recorded design session (2026-10-04). Nothing here is decided.
**How to run the session:** use the `grilling` skill. Work the design tree in rounds, give a recommended answer for every question, look facts up yourself (sub-agents for the codebase), and use Artifacts for interactive mockups whenever a question is about what the operator sees. Do not build or file anything until the operator confirms a shared understanding.

## The question

The Flywheel and the Gauntlet Loop are similar things: each is a run that spawns and tracks related work. Should they become one concept, a **run**, shown as a special type of conversation, with a fixed scope like an order book but still open-ended enough that, especially in gauntlet mode, agents propose new improvements?

## What the operator wants from the Flywheel (its original purpose)

The first Flywheel prompt (the `all-up` skill, 2026-04-12, `git show cbfbc1d8bf6:skills/all-up/SKILL.md`) existed to take everything already in the pipeline and drive it to merge, and to fix every substrate bug it hit at the root ("a flywheel, not a loop": each revolution must permanently improve Overdeck). It identified what was stalling items, worked out why, and fixed or filed the cause instead of patching over it.

## How it drifted (findings from 2026-10-03)

- Today's `pan-flywheel` skill (`sync-sources/skills/pan-flywheel/SKILL.md`) became a backlog picker: start the next released issue, watch only its own pick. With auto-pickup off and nothing labelled `released`, a run idles on its first tick.
- The doctrine and rails in `roles/flywheel.md` (root cause first, recurrence is a class, the author/assignee security gate, the saturation cap) were never loaded: nothing launches that file.
- There was no cadence: a run ticked once and stopped.
- A stopgap patch (`3eb0648`) now quotes the doctrine and rails into the skill, adds a "drain what is already in flight" phase before picking, and schedules the next tick (450 s while work moves, 1000 s idle). The design from this session should supersede it.
- Real stalls the Flywheel should have caught on its own that day: an empty legacy tmux server that refused every fresh agent start for 10 hours (fixed in `85c0a43`); a dead work agent with merge conflicts untouched for 37 hours (PAN-4383); close-outs blocked because nothing deployed; a reviewer that never received its kickoff and was re-dispatched in a loop (PAN-4506).

## The Cut and what was lost

The big refactor (PAN-3917, `docs/THE-CUT.md`) deleted the Flywheel page, its run telemetry, substrate-bug scoring and the run record, on the principle "Overdeck stores no status it can derive". PAN-3964 brought the page back as a view derived from the Flywheel conversation's transcript (`docs/FLYWHEEL.md`). The operator felt the Cut went too far and lost features they loved; find out which, and whether a run design brings them back without a stored run record.

## The Gauntlet today

`pan lane` (`reference/lanes.mdx`, the `pan-gauntlet-loop` skill): builder, critic, verifier, play and orchestrator lanes run as conversations nested under the conversation that launched them, judged by a separate harsh critic against a named reference bar, looping until every area wins.

## Branches to grill (a starting tree, not a script)

- Is a run a conversation type, a page, both? What does the operator see while it runs and after?
- Scope: order book, open backlog, a goal statement, or a mix? How does fixed scope coexist with ideation?
- Modes: "drain and fix" (flywheel) through "improve and ideate, judged by critics" (gauntlet). One dial or separate kinds?
- Children: how spawned work (issues, lanes, agents) attaches to its run, and how the run tracks it without storing derivable status.
- Learning: where a run records what it fixed and learned (`.pan/flywheel/state.md` today), and how the next run uses it.
- Authority: what a run may do alone (file, start, deploy) and what stays with the operator (merges under UAT, `released`, `vetoed`), plus TENET-10 (no autonomous edits to pipeline machinery).
- Cadence and liveness: how a run stays awake, and how the operator knows it is alive.
- Migration: what happens to `pan flywheel`, `pan orders`, `pan lane` and the Flywheel page.
