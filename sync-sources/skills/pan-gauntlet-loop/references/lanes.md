# Gauntlet lanes: rules, briefs and reports

Lanes are conversations launched with `pan lane start`. This file holds the
rules a lane run follows, how to write lane briefs, and the report grammar
lanes use to hand results back. The last column says where each rule is
enforced: "Door" means `pan lane start`, `pan lane report` or `pan lane reap`
refuse the wrong move; "Skill" means the orchestrator enforces it.

## The V3 rule table

| # | Rule | Enforced by |
|---|---|---|
| V1 | One worktree per lane, never two builders in one worktree | Door: per-lane worktree; refuses a second live lane in a busy directory |
| V2 | Worktrees never in `/tmp`; durable state is git + `~/` | Door: lanes root must be under `$HOME` and not under `/tmp` |
| V3 | Sparse checkout to skip multi-GB asset packs | Door: optional `gauntlet.sparse_checkout` per project |
| V4 | Builders commit and push their OWN branch as they go; only the supervisor merges | Skill (replaces the old shared-commit rule); door refuses a builder `done` report with a dirty tree or unpushed commits |
| V5 | A branch that has posted DONE is frozen; rebase into a new branch | Skill; the report records `head`, so a later rewrite is visible |
| V6 | Exactly one fresh blind critic per iteration; never reuse or re-task a critic | Door: a critic lane is always a new conversation; `pan tell` refuses a critic that already reported `done` |
| V7 | The board's `critic` field must name the real spawned session | Skill: the field holds the lane's conversation id; `pan lane list` proves it exists |
| V8 | An orchestrator never spawns its own critic | Door: only a root conversation (by effective launcher) may launch `critic` lanes |
| V9 | Cold play-agents see nothing but the game: no repo, no CLAUDE.md | Door: `play` gets an empty directory outside the repo, `bareContext` and `skipClaudeMd` forced |
| V10 | Subagents never park on a waiter | Lane contract text and skill |
| V11 | Crash-safety: incremental notes, respawn with continuation; stop only through the harness that spawned it | Door: `pan lane stop` uses the conversation stop door; iteration counting and `--reuse` support respawn-with-continuation |
| V12 | Recover lost lanes from transcripts | Skill: `pan conv jsonl <id>` per lane; lanes are conversations, so transcripts are indexed |
| V13 | Worktree + process close-out is part of shipping; never kill by pattern | Door: `pan lane reap` refuses while any process has its cwd in the lane directory and lists PIDs; never kills |
| V14 | Dirty worktrees are never removed unasked; park dirty state as patches | Door: reap refuses a dirty tree unless `--park` |
| V15 | Sentinel vocabulary DONE / BLOCKED / NOT_YET-2 / RULING / … | Door: report status `done|blocked|failed`; skill maps RULING / SPEND / ONE-WAY to `blocked` with a first-line tag |
| V16 | Premium-model cost discipline: one issue per session, effort `high` by default, post the spend | Skill; lanes are conversations, so `totalCost` is already attributed per lane and shown by `pan lane list` |
| V17 | Model-comparison ledger line per lane | Skill: `pan lane list --run <key> --json` gives model, iteration and outcome per lane |
| V18 | Escalate the tier after two failed iterations on one defect; STRUCTURAL rulings | Skill; `pan lane list` shows `iN` so the rule is checkable |
| V19 | Orchestrator tiers: supervisor → cluster orchestrators → builders | Door: `orchestrator` role; display nesting capped at depth 2 |
| V20 | Rig caps via `flock`, private stacks on free ports, forbidden ports, `DISPLAY=:99` | Run file (project-specific); the skill says "put machine limits in the run file and restate them in COMMON brief" |
| V21 | Merge and ACCEPTED are independent; frozen board vocabulary | Skill: adopt the frozen list in `status.json`; `gauntlet-index.html` renders it |
| V22 | Deadline runs: a hard stop overrides the unbounded loop | Skill: optional `DEADLINE` slot; `pan lane list` + `pan lane stop` make the close-out mechanical |
| V23 | Push egress blocked by a tool reviewer → `BLOCKED … push`, supervisor pushes | Skill (restated in the lane contract as "report blocked, do not stop working") |

## The COMMON-brief pattern

Write one shared rules file for the run (for example
`gauntlet/briefs/COMMON.md`) and one short brief per lane that starts by
pointing at it:

- `COMMON.md` holds everything every lane must obey: the mission prompt
  path, the file-ownership map, machine limits (ports, `flock` caps,
  `DISPLAY`), the four ways the loop silently fails, and the rules above that
  a lane must follow itself (never kill by pattern, never park on a waiter,
  push only its own branch).
- Each lane brief (`briefs/<key>.md`, `briefs/<key>-critic.md`) says
  "Read `gauntlet/briefs/COMMON.md` first", then gives only that lane's work
  order: the area, the defect list to fix, the evidence to capture, and
  where to write its result.
- A critic brief names the area, the evidence, `refs/REFERENCE-BAR.md` and
  the verdict file path. It never names the builder, its branch, its
  conversation or its reasoning; the door checks the critic out at the
  builder's reported head and tells it only the commit.

`pan lane start --brief <file>` copies the brief into the lane's state
directory once, so later edits to the file do not change a running lane.

## The report grammar

A lane ends its work with `pan lane report --file <markdown>`:

- `--status done` (default): the brief is complete. A builder's done report
  needs a clean tree whose branch is pushed (`--allow-unpushed` waives only
  the push check). The report records the head SHA and branch.
- `--status blocked`: the lane needs a decision. The report's first line is
  one tag, then the question:
  - `RULING` — a design or scope decision only the orchestrator can make;
  - `SPEND` — the next step costs more than the brief allows;
  - `ONE-WAY` — the next step cannot be undone (a destructive migration, a
    force push, a deletion);
  - `BLOCKED` — anything else that stops the lane, including a blocked push
    (`BLOCKED … push`: the orchestrator pushes for it).
- `--status failed`: the brief cannot be done as written; say why.

A critic or verifier files exactly one verdict, with its done report:

```bash
pan lane report --file r.md --verdict NOT_YET --verdict-file gauntlet/notes/critique-663-iter1.json [--defects 7]
```

The verdict is binary per the reference bar (`WOWED` / `NOT_YET`, or `PASS`
/ `DEFECTS`; `IMPRESSED` when the bar defines it). The defect count defaults
to the length of the verdict file's `defects` array. A second done report
from the same critic is refused; the next iteration gets a fresh critic.

The critic link is metadata: the door records which builder row a critic
judges (`--for`) and checks the critic out at that builder's reported head,
but the critic brief still names no builder. The board's `critic` field is
the critic lane's conversation id.

The orchestrator reads reports with `pan lane wait --run <key>`, which
returns them oldest first and prints the next command with its cursor, and
proves each builder ↔ critic pairing with
`pan lane show --run <key> --key <lane key>`.
