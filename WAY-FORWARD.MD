# WAY FORWARD — orchestrator-led execution

**Date:** 2026-09-18
**Origin:** MIN-1039 (GPT-Live routing), a 21-item xBRIEF, executed first under the
serial per-item work loop, then switched mid-issue to the approach described here.
**Status:** operator decision. Overdeck is to be revamped around this model.

## The idea in one paragraph

The swarm factory — registered slots, `pan swarm dispatch/wait/merge/recover`, per-item
inspection gates, foreman transcripts, intervention counters — was built to compensate
for executors that wandered. That problem has mostly gone away. What has *not* gone away
is that context is finite and that an author is blind to their own code. So the new shape
keeps exactly two things from the old one — **parallelism for context isolation** and
**independent review** — and drops the rest. One capable model authors the xBRIEF, then
that same model orchestrates: it dispatches a wave of workers per DAG level, each in its
own worktree, merges the results itself, and hands each merged wave to a reviewer from a
different model family. The orchestrator's own context is spent on coordination and
merges, never on writing or reviewing item code.

## What we observed that led here

On MIN-1039, running the serial loop:

- The DAG had three parallel waves in its first six items. They were done one at a time.
  Roughly the middle twelve of twenty-one items were dispatchable and weren't.
- The two most valuable catches came from opposite places. A cache-copy bug
  (`VoiceConfigService.copyOf` dropping fields that `@Builder.Default` silently reset)
  was found by the model *writing* the code. A schema deadlock (an `ON DELETE SET NULL`
  foreign key whose implicit UPDATE tripped an append-only trigger, making customers
  undeletable) was found by an *independent* inspector after the author had written it,
  tested it, and watched the tests pass. Intelligence caught the first. Fresh eyes caught
  the second. Neither substitutes for the other.
- The per-item ceremony — claim, commit, push, done, re-read metadata, inspect, wait for
  `pan tell`, next — cost more than the items in several cases, and it serialized what
  the plan said was parallel.
- The foreman protocol existed in the role file and was not followed. The serial loop was
  written first and read as the instructions; swarm eligibility lived in plan data, not
  in the prose the agent was reading. Two protocols in one file is one too many.

## The model

### 1. Plan once, well

A strong model writes the xBRIEF against the PRD-authoring standard already in the rules:
exact paths, before/after snippets, decisions made in the document, numbered requirements,
`files_scope` per item, a `blocks` DAG. This is the leverage point. Everything downstream
is cheaper if the plan lets a smaller model execute an item without re-research.

### 2. Execute by wave, not by item

The orchestrator reads the DAG, takes every item whose blockers are all merged, and
dispatches them together. Each worker:

- gets **one item**, the PRD section it traces to, the contract/evidence documents, and
  `files_scope` as a hard boundary — not a suggestion;
- works in **its own worktree** on a branch off the feature branch, so nothing it does can
  touch a sibling's files until merge;
- is told the repo's mechanical rules that intersect its item (fake timers for delays,
  `./mvnw` never `mvn`, one commit, no `pan`, no push);
- reports back with the commit, what it verified, and anything it deviated on or left
  undone.

The orchestrator merges each worker's branch into the feature branch, runs the affected
suite, pushes, and records the item as done. If two items in a wave share a file, the
plan's `files_scope` should have said so; if it didn't, that's a planning defect to
record, not a merge to force.

**Wave-level resource assignment is the orchestrator's job.** On MIN-1039 wave one, two
items each needed "the next unused Flyway version". Dispatched blind, both would pick the
same number. The orchestrator assigns V300 and V301 in the briefs. Anything that is
"next unused" — migration versions, port numbers, enum ordinals — is allocated centrally
before dispatch.

### 3. Pick the worker by what the item *is*, not by its size tag

The plan's `difficulty: complex` mostly measures size. The model choice should measure
risk:

- **Cheaper model (Sonnet-class)** when there is a pattern in the repo to copy and the
  item is plumbing over a core that already exists: controllers over a finished service,
  entities and migrations that mirror an earlier one, UI over a defined API, test suites
  written against a spec, documentation, opt-in smoke harnesses.
- **Stronger model (Opus-class)** when the item *is* the core: concurrency and bounded
  shutdown, money and cumulative accounting, an authorization boundary, a shared write
  door with existing invariants, or an interface that several later items build on.

On MIN-1039 that split was 8 Opus / 9 Sonnet across the remaining seventeen items.

**Escalation rule:** a cheaper worker's item that comes back from review with a blocking
finding is retried by the stronger model, not by the same tier. Second attempts on the
same failure class are where the savings get burned.

### 4. Review by wave, by a different model family

After a wave merges, the orchestrator writes a short brief — items landed, their
acceptance criteria, the commits, the contract documents — and hands it to a reviewer
from another model family (on MIN-1039: GPT-5.6-Sol via `pan handoff`, read-only in the
feature workspace). The ask is narrow: *was the deed done, what breaks, what disagrees
across items.*

Why per wave and not per item: a wave is a set of items that touched adjacent code at the
same time. File-scope collisions, two workers making incompatible assumptions about a
shared type, drift between an SPI and its first consumer — none of that is visible in any
one item's diff. The per-item inspector was the wrong tool for it.

Why a different family: a same-family reviewer is fresh-context but same-eyes. A model
with different training is wrong about different things, which is the point of a second
opinion.

Findings go to a file (`<wave>-FEEDBACK-<model>.md`, the same naming as PRD feedback) and
the reviewer wakes the orchestrator with `pan tell`. Blocking findings become fix commits
before dependents dispatch. Advisory findings fold into the next wave's briefs.

**Don't block the next wave on the review** unless the wave contained a *foundation* —
an item with many dependents (the plan's `foundationFor`). For those, hold dependents
until the reviewer signs off. For everything else, the next wave's workers start while
the review runs; a merged, pushed wave is not at risk from a review in flight.

### 5. Keep the durable bits, drop the machinery

This section shipped as PAN-3917, "The Overdeck Cut." For the actual keep/drop
decisions and the full no-loss accounting, see the PRD (`.pan/drafts/pan-3917.md`
on the archived `overdeck-state` branch, now migrated to `.pan/drafts/pan-3917.md`
in this repo) and [`docs/THE-CUT.md`](docs/THE-CUT.md).

### 6. What this costs, honestly

- **Dashboard visibility.** Workers spawned as in-harness subagents are not registered
  agents. They have no `state.json`, no tmux session on the `overdeck` socket, and the
  dashboard cannot see, pause, or recover them. Worktree isolation plus per-item pushes
  is the mitigation: if the orchestrator dies mid-wave, every merged item is on origin
  and every in-flight worker's branch is in the object store. The revamp should decide
  whether to give the dashboard a read-only view of in-harness subagents, or accept the
  blind spot.
- **Orchestrator context.** Seventeen items' worth of merge conflicts, test output and
  worker reports accumulate in one session. This is why review is delegated and why the
  orchestrator does not write item code. If context degrades, `pan handoff` with a
  file-backed state summary is still the right move.
- **Polyrepo friction.** A worktree per worker is a worktree per repo the item touches.
  Briefs should name the single repo an item lives in wherever the plan allows it.

## Concrete asks for the revamp

1. Collapse the work role to one protocol: read the DAG, dispatch the ready wave, merge,
   push, record, review by wave, repeat. Delete the serial per-item loop and the foreman
   protocol as separate texts.
2. Make the planner emit per-wave resource allocations (migration versions and the like)
   so the orchestrator does not have to discover them.
3. Give `pan handoff` a first-class read-only reviewer mode: a brief file, a feedback
   file path, a model, and an automatic `pan tell` back on completion.
4. Let the model split be a plan attribute (`metadata.workerTier: core | plumbing`) so
   the orchestrator reads it instead of inferring it.
5. Decide on dashboard visibility for in-harness subagents (see costs above).
6. Keep the PRD-authoring rule as the load-bearing standard. The cheaper the worker, the
   more the plan has to carry.
