---
name: pan-lane
description: "pan lane start|list|wait|report|stop|reap — launch gauntlet lanes (builder, critic, verifier, play, orchestrator conversations) from any harness, wait on their reports, and reap them. Lanes nest under the conversation that launched them."
triggers:
  - pan lane
  - launch a lane
  - gauntlet lane
allowed-tools:
  - Bash
  - Read
---

# Gauntlet Lanes

## Overview

`pan lane start` launches a **lane**: an ordinary Overdeck conversation with its own working
directory, any harness, model and effort, and four launch-time facts on its row (parent, run key,
lane key, role). It nests under the conversation that launched it on the Command Deck and the Agents
page. The command reads `$OVERDECK_CONVERSATION`, so any conversation can launch lanes, whatever its
harness. Reports go through the worker report store; waiting reuses `pan worker wait` semantics.

Full reference: `reference/lanes.mdx` in the Overdeck docs.

## When to use

- Fan out gauntlet builders and critics (the `pan-gauntlet-loop` skill) when your harness has no
  Agent tool, the lane needs a model the Agent tool cannot run, the lane must outlive your context or
  one turn, or the lane needs its own branch.
- Anything issue-linked inside the managed pipeline is a worker (`pan worker run`), not a lane.
- Continuing a lane's own work in a fresh conversation is `pan lane start --reuse`, not `pan handoff`.

## Commands

```bash
# builders (run key from a root conversation; an orchestrator lane's launches inherit its run)
pan lane start --run hotel --key 663 --role builder --brief briefs/663.md --model claude-sonnet-5
pan lane start --run hotel --key 663 --role builder --reuse --brief briefs/663-resume.md
pan lane start --run hotel --key 663 --role builder --replace --brief briefs/663.md

# critics: a fresh lane per iteration, launched by a root conversation; --for names the builder
pan lane start --run hotel --role critic --for 663 --brief briefs/663-critic.md --model claude-opus-5-5
#   (no --at: the door checks the critic out at the builder's newest done head)
#   the critic ends with one verdict:
#   pan lane report --file r.md --verdict NOT_YET --verdict-file gauntlet/notes/critique-663-iter1.json
pan lane show --run hotel --key 663                     # i1 built → critic c1: NOT_YET (7 defects) → …

# cold play-tester: an empty directory, no Overdeck context, no CLAUDE.md
pan lane start --run hotel --key cold-1 --role play --brief briefs/play.md

# watch
pan lane list --run hotel
pan lane wait --run hotel --timeout 540                 # next report of any lane in the run
pan lane wait --run hotel --after <cursor> --timeout 540
pan lane wait conv-<name> --timeout 540                 # one lane

# inside a lane, at the end of its brief
pan lane report --file result.md
pan lane report --file ruling.md --status blocked       # first line: RULING, SPEND, ONE-WAY or BLOCKED

# steer, stop, clean up
pan tell conv-<name> "<steer>"
pan lane stop conv-<name>
pan lane reap conv-<name>                               # removes the worktree, archives the conversation
pan lane reap conv-<name> --park                        # saves uncommitted work to a verified patch first
pan lane reap conv-<name> --keep                        # leaves the conversation listed
```

With no `--model`, the role's model comes from `projects.<key>.gauntlet.roles.<role>.model`; with
none there, the launch is refused. `--effort` takes `low`, `medium` or `high`.

## Rules the door enforces

- One working directory per lane, under the project's lanes root (never `/tmp`, never the primary
  checkout). A second live lane with the same run, key and role is refused unless `--replace`.
- Only a root conversation launches `orchestrator` and `critic` lanes. An orchestrator lane launches
  builders, verifiers and play lanes in its run. Builder, critic and verifier lanes launch nothing.
- Iteration n ≥ 2 of a builder gets a new branch `<run>/<key>-i<n>` cut from the previous
  iteration's branch; a branch that reported done is frozen.
- A builder reports `done` only from a clean, pushed tree (`--allow-unpushed` waives the push).
- A critic needs `--for <builder key>`; a critic or verifier files exactly one verdict
  (`--verdict`, with `--verdict-file` naming its JSON). `pan tell` refuses a critic or verifier lane
  that already filed its done report: launch a fresh one instead.
- A critic's brief names no builder; the door links the builder row and tells the critic only the
  commit it judges.
- `pan lane reap` never kills a process and never discards work: it refuses while a process runs in
  the lane directory, and refuses a dirty tree unless `--park`.

## How to wait from each harness

- **Claude Code:** run `pan lane wait …` with the Bash tool's `run_in_background: true`. The
  foreground limit is 10 minutes; a background command notifies you when it exits, and its stdout is
  the report.
- **Codex and other harnesses:** wait in a loop until the exit code is not 3. A timed-out wait loses
  nothing: the next one still returns the report.

Exit codes for `wait` and `report`: 0 done, 4 blocked or failed, 2 exited or idle without a report,
3 timeout (still running), 1 error. A run wait's status line ends with the next command and its
cursor; pass that cursor with `--after` so you never read a report twice.

## Close-out

Reap each lane when its work is merged or abandoned; reap builders before the orchestrator lane that
launched them. At run end, `pan lane list --run <key>` shows every lane `archived` or `stopped`.
Archived lanes stay in the list, so the run's ledger (iterations, reports, cost) stays complete.
