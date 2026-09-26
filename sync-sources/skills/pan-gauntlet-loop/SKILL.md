---
name: pan-gauntlet-loop
description: >-
  Run a Gauntlet Loop — fan out builder sub-agents per area, judge each with
  a SEPARATE harsh critic in a blind A/B against a named reference bar, keep
  looping until every area wins, and track it all on a live progress page.
  Use when the user wants to take any project, feature, or domain to an
  extreme quality tier ("make it AAA", "at the level of <reference>",
  "utterly perfect", "run the gauntlet", "gauntlet loop"). Works for any
  domain — games, UI, CLIs, APIs, libraries, docs, performance, writing.
triggers:
  - gauntlet loop
  - run the gauntlet
  - gauntlet
  - AAA quality pass
---

# Gauntlet Loop

Take any domain to a named quality bar with a builder/critic loop: fan out a
builder sub-agent per area, judge each area with a **separate** harsh critic
(fresh context, blind A/B against the reference, binary verdict), feed defects
back, and loop until every area is WOWED. A live progress page tracks every
area, screenshot, verdict, and defect list.

Origin: Matt Shumer's gauntlet prompt; hardened by the operational lessons of
runs #1–#2 (folded into the phases below — every rule exists because its
absence cost an iteration).

## Phase 0 — Intake: fill the slots, ask about the gaps

**Run-file shortcut:** a run file (e.g. `gauntlet/RUN-<CODENAME>.md`) may
pre-fill every slot and carry the operator's approval in writing. When one
exists and the operator pointed you at it, the run file IS the contract —
skip intake questions and the Phase-1 approval gate, and follow the run
file wherever it is more specific than this skill.

Otherwise, extract these slots from the user's request. For every slot that is
missing or vague, ask via AskUserQuestion — batch up to 4 questions per call,
each self-contained (the operator may answer from a dashboard dialog without
the transcript: state the situation, then ask). Never guess the mission.

| Slot | Meaning | If missing |
|---|---|---|
| THING | What to build / enhance / fix | Ask. Never proceed without it. |
| REFERENCE | The named quality bar | Propose 2–3 candidates that are **named, fetchable, comparable** (below); ask the user to pick one. |
| AREAS | The fan-out split | Propose a split from THING (see `references/domains.md`); ask to confirm or edit. |
| TIER | Quality shorthand | Default: "shipped commercial quality at the level of REFERENCE". |
| LOOK | The committed direction (art / UX / language / architecture) | Seed from repo conventions; confirm in one AskUserQuestion option set. |
| STACK | Stack constraints | Default: "this repo, unchanged". Ask only if the request implies a change. |
| SCOPE | Explicit exclusions | If THING is broad, ask "what is out of bounds on this pass?" |
| CHECK | How the critic inspects the work | Derive from the domain (`references/domains.md`) — screenshots, CLI transcripts, benchmarks, rendered docs. |
| RUN | The run key every lane of this pass shares (`--run`) | Propose a short lowercase codename (e.g. `hotel`); `^[a-z0-9][a-z0-9-]{0,31}$`. |
| DEADLINE | Optional hard stop | None. When set, it overrides "no fixed round count": at the deadline, stop launching, let live lanes report, and close out. |

REFERENCE is the load-bearing slot. Before accepting it, verify it is:

- **Named** — a specific thing ("Civilization VII", "stripe.com's docs"),
  not a category ("a good strategy game").
- **Fetchable** — the critic can screenshot, read, run, or open it. Fetch the
  reference evidence during setup (below); if you cannot, say so and pick
  another bar with the operator.
- **Comparable** — the subject's evidence and the reference's evidence can sit
  side by side for a judge to pick one.

## Phase 1 — Setup (before any builder launches)

1. **Isolate the work.** Configure `projects.<key>.gauntlet` (lanes root,
   sparse patterns, role models). Every builder gets its own worktree through
   `pan lane start`; never two builders in one worktree. The primary checkout
   is the orchestrator's merge desk only. Work in the current checkout
   instead only when the operator explicitly asked to enhance in place.
2. **Scaffold `gauntlet/` in the worktree:**
   - `gauntlet/index.html` — copy `{baseDir}/assets/gauntlet-index.html`
     **verbatim** (it renders from status.json; never edit per project).
   - `gauntlet/PROMPT.md` — fill `{baseDir}/assets/PROMPT.template.md` with
     the slots. This is the mission prompt every agent reads.
   - `gauntlet/status.json` — schema below; all areas NOT STARTED.
   - `gauntlet/shots/`, `gauntlet/notes/` — empty dirs.
3. **Write the judging contracts in `refs/`:**
   - `refs/STYLE.md` — fill `{baseDir}/assets/STYLE.template.md`: one page,
     the committed direction. Every builder and every critic works from it.
   - `refs/REFERENCE-BAR.md` — fill
     `{baseDir}/assets/REFERENCE-BAR.template.md`: the verdict question,
     automatic failures, scoring dimensions, verdict JSON format.
   - `refs/press/` — the fetched reference evidence (screenshots, transcripts,
     docs). Gitignore third-party media.
4. **Build seed/test hooks NOW, not mid-loop.** Seedable state is
   load-bearing for critique: if reaching a state takes hours of wall-clock
   (filled stockpiles, advanced time, specific data), the loop can't be
   photographed. Add the hook during setup. Never restart a shared dev
   server mid-run — hot-reload kills other agents' verification sessions.
5. **Serve the progress page:** from `gauntlet/`, run
   `python3 -m http.server <port>` in the background and report the URL.
   (Browsers block `fetch()` from `file://` — the page needs HTTP.)
6. **Operator approval gate.** Show the filled `gauntlet/PROMPT.md` to the
   operator and get an explicit go before the first fan-out. The gauntlet
   burns real tokens; the mission it burns them on is the operator's call.
   (Skipped when a run file already carries the approval — see Phase 0.)

### status.json schema

```json
{
  "project": "<display title>",
  "tagline": "<one-line mission flavor>",
  "updated": "<ISO>",
  "pass": "<branch name>",
  "areas": {
    "<area-key>": {
      "title": "<human title>",
      "status": "NOT STARTED",
      "iteration": 0,
      "verdict": null,
      "defects": [],
      "note": "<one-line current state>",
      "updated": "<ISO>",
      "lane": "<optional: builder lane conversation id>",
      "critic": "<optional: critic lane conversation id, or Agent id>"
    }
  }
}
```

`verdict` is `"WOWED"`, `"NOT_YET"`, or `null`. `defects` holds the top ≤5
(strings, or `{"element","fix"}` objects). The page polls it every 5s.

`status` uses one frozen vocabulary: `NOT STARTED`, `IN PROGRESS`,
`AWAITING CRITIQUE`, `UNDER CRITIQUE`, `WOWED`, `NOT_YET`, `ACCEPTED`,
`SHIPPED`, `FOLDED`, `OPERATOR HOLD`. Merge and `ACCEPTED` are independent:
`ACCEPTED` is the orchestrator's call after a WOWED verdict, never derived.
`critic` names the real spawned session: the critic lane's conversation id,
which `pan lane show --run <run> --key <key>` proves is paired with the
builder.

## Phase 2 — The loop (per area, areas in waves)

1. **Wave plan — parallelize to the file-ownership limit.** Assign each area
   an exact file-ownership map, restated in every agent prompt. Concurrent
   agents in one worktree WILL clobber shared files, so areas that share
   files run in the same wave **serially** — but that constraint is
   per-file, not global: prefer SPLITTING areas until their maps are
   disjoint, and run everything disjoint **concurrently**. Films and
   critics for different areas are read-only-ish and parallelize freely.
   Keep the orchestrator thin; the fan-out does the work.
2. **Build.** Launch a builder for the area with its ownership map, the
   mission prompt, and the current defect list as its work order. Builders
   commit and push their own lane branch as they go; the orchestrator audits
   the diff and merges. A branch that has reported `done` is frozen; a
   rework goes on a new iteration branch. Builders never judge their own
   work. The orchestrator's own merge commits still use path-scoped
   `git add` — `git add -A` would scoop another in-flight agent's work.
3. **Capture evidence at presentation quality.** Launch the real thing and
   drive it — Playwright for UI, the CLI at its command, the benchmark at
   its load. Screenshots at 1920×1080 with realistic in-fiction data (a
   visible test username in a shot is a defect); keep dev tooling out of
   frame. Save the canonical shot to `gauntlet/shots/<area-key>.png` (or
   transcript/benchmark to notes/). Headless gotchas: black frames in
   headless Chromium are a renderer-context issue, not scene code — try
   default launch flags before forcing software rasterization; canvas/WebGL
   code must survive a React StrictMode double-mount; software-rasterized
   FPS is CPU numbers — NEVER the real perf verdict. Perf claims need a
   headed capture.
4. **Critique.** Spawn the critic — ALWAYS a separate sub-agent from the
   builder, fresh context, high-tier model (see routing below). The critic
   is blind to the builder's effort, reasoning, and transcript — but it is
   NOT tool-poor: it gets the evidence + `refs/`, and it MAY run its own
   probes and instruments against the running app, the repo, or the
   benchmark to verify or refute any claim (run-#2 precedent: critic-built
   instruments caught deploy-saving defects the builder's own numbers
   missed). It judges blind per `refs/REFERENCE-BAR.md` — literally side by
   side, which one looks better — and returns the verdict JSON. Verdicts
   are binary (WOWED / NOT_YET + every failing element with a concrete
   fix), never a score out of 10. The critic tags each defect with the
   owning area so cross-area defects merge into the right queue. Save to
   `gauntlet/notes/critique-<area>-iter<n>.json`; a critic lane names that
   file in its report with `--verdict-file`.
5. **Update the dashboard at every transition** — agent launched / landed /
   filming / awaiting critique / verdict — not just after critiques. A
   stale dashboard is a bug. The page mutates cards in place; regenerated
   media needs cache-busting or browsers replay stale files.
6. **NOT_YET → the defect list becomes the next iteration's work order** for
   the same area. WOWED → area done, and prior WOWED quality is a FLOOR no
   later iteration may regress. **No fixed round count**: the exit is
   winning, the operator stopping the run, or the DEADLINE slot when set.
7. **Test reconciliation is its own queued item.** Big visual/structural
   changes break existing test selectors; don't let a builder burn its run
   fixing them. Wave gates are: build passes, evidence captured, critique
   filed. Broken-suite repair gets its own area or follow-up.
8. **Cadence artifacts.** Commit critique JSONs and status.json to the
   branch — the pass history is reviewable. Gitignore large third-party
   reference media and regenerable sources (keep shipped assets committed).

## Phase 3 — Stop conditions

- **The operator is the brake.** The loop does not finish on its own; when
  they say stop, stop, commit cleanly, and report state.
- **All areas WOWED** → final report: per-area verdicts and iteration counts,
  the commit log, the dashboard URL, and anything deferred to a later pass.

## The four ways the loop silently fails

1. **Vague bar** — the critic invents a comparison and approves everything.
   The bar must be named, fetchable, comparable.
2. **Builder judging its own work** — the critic must be a fresh agent with
   zero knowledge of the builder's effort or reasoning trail.
3. **Soft critic** — scores out of 10 drift upward and everything passes.
   Binary verdict + concrete fixes only.
4. **Fixed round count** — "3 iterations" ships a prototype. The exit is
   WOWED, or the operator stopping the run.

Restate all four in every agent prompt — they are the whole game.

## Fan-out: the Agent tool or the lane door

Builders and critics are either Agent-tool sub-agents or **lanes**:
conversations launched with `pan lane start`, nested under the orchestrator
on the Command Deck, running any harness and model. Gauntlet lanes are not
managed pipeline issues; work that belongs in the pipeline gets an issue and
`pan start`.

**Decision rule.** Agent-tool fan-out stays valid for a Claude orchestrator
whose lanes are short, Anthropic-model and single-turn. Use the lane door
when any of these holds:

- the orchestrator's harness has no Agent tool;
- the lane's model is not available to the Agent tool;
- the lane must survive the orchestrator's context loss or run longer than
  one turn;
- the lane needs its own branch.

Critics may use either path; the board's `critic` field names the Agent id
or the critic lane's conversation id.

**The lane recipe:**

```bash
pan lane start --run hotel --key 663 --role builder --brief briefs/663.md --model <builder model>
pan lane wait --run hotel --after <cursor> --timeout 540     # repeat while exit 3
pan lane start --run hotel --role critic --for 663 --brief briefs/663-critic.md --model <critic model>   # checks out the builder's reported head
# the critic ends with: pan lane report --file r.md --verdict NOT_YET --verdict-file gauntlet/notes/critique-663-iter1.json
pan lane show --run hotel --key 663                          # i1 built → critic c1: NOT_YET (7 defects) → …
# NOT_YET: the next iteration is a new builder lane; the door cuts hotel/663-i2 from hotel/663
pan lane start --run hotel --key 663 --role builder --brief briefs/663-i2.md --model <builder model>
# a builder died mid-run: continue in the same directory and iteration
pan lane start --run hotel --key 663 --role builder --reuse --brief briefs/663-resume.md --model <builder model>
pan tell conv-<name> "<steer>"                               # never to a critic that reported
pan lane list --run hotel
pan lane reap <lane> [--park]                                # archives the conversation; --keep leaves it listed
```

A critic lane is always a fresh conversation, launched by a root
conversation, and its brief names no builder: the door links it to the
builder row and checks out the builder's reported head, but tells it only
the commit. Only a root conversation may launch critics; an orchestrator
lane launches builders, verifiers and play lanes in its run. Launch rules,
report grammar and the V3 rule table are in `references/lanes.md`.

- **Model ladder — cheapest that clears the bar, escalate on evidence.**
  Set it per role with `--model` / `--effort`, or once in
  `projects.<key>.gauntlet.roles`. The workhorse tier is the default for
  builders, films, mechanical implementation, asset processing and test
  runs. The frontier tier is for every critic by default, design-heavy build
  areas, and problems a cheaper attempt just fumbled. The top tier is for
  areas that keep failing across iterations, deep root-cause mysteries, and
  the final full-frame composition judgment. Escalate a lane's tier after
  two failed iterations on the same defect, not preemptively; de-escalate
  when the hard part is done. Critics are where model quality pays — never
  cheap out on the judge. Effort stays `high` unless the operator chooses
  otherwise.
- **Distribute and parallelize as much as possible.** Many cheap lanes in
  flight beat one expensive agent in series; the wave plan's file-ownership
  maps are the only serialization constraint.
- **No tool restrictions.** Every gauntlet agent may use whatever tools its
  session has — browsers/Playwright, WebSearch/WebFetch, image tooling,
  profilers, DB clients. "Blind critic" restricts what the critic is TOLD
  (nothing from the builder), never what it may DO.

## What a lane must never do

- Kill a process by pattern, or any PID it did not start.
- Use `/tmp` for anything durable; durable state is git and `~/`.
- Park on a waiter: never end a turn waiting on a background task or a
  monitor; wait inside one foreground command with a timeout.
- Judge its own work.
- Push the default branch (a lane pushes only its own lane branch).
- Run `npm install` (or any dependency install) in the primary checkout.

## Waiting from any harness

- **Claude Code:** run `pan lane wait …` with the Bash tool's
  `run_in_background: true`. The foreground limit is 10 minutes; a
  background command notifies you when it exits, and its stdout is the
  report.
- **Codex and other harnesses:** wait in a loop until the exit code is not
  3. A timed-out wait loses nothing: the next one still returns the report.

  ```bash
  pan lane wait --run hotel --timeout 540    # repeat while the exit code is 3
  # the status line ends with the next command, carrying the new cursor:
  pan lane wait --run hotel --after <cursor> --timeout 540
  ```

## Close-out

- Per lane, `pan lane reap <lane>`: it refuses while a process still runs
  in the lane directory (it never kills), refuses a dirty tree unless
  `--park`, removes the worktree, keeps the branch, and archives the lane's
  conversation so the finished run leaves the Command Deck. Pass `--keep`
  to leave a conversation listed.
- Reap builders before the orchestrator lane that launched them; an
  archived orchestrator lane leaves its unreaped builders as orphans.
- At run end, `pan lane list --run <key>` shows every lane `archived` or
  `stopped`, none live. The run report lists each lane's iterations, final
  verdict, conversation ids and cost (archived lanes stay in the list).
- An orchestrator that hands itself off keeps its lanes: they stay nested
  under it, its successor nests beside them, and the successor continues
  with the same `--run`.

## References

- `references/domains.md` — per-domain CHECK (evidence capture), sample area
  splits, automatic-failure lists, and storefront-test phrasing.
- `references/lanes.md` — the V3 rule table, the COMMON-brief pattern, and
  the lane report grammar.
- `assets/` — `gauntlet-index.html` (progress page), `PROMPT.template.md`,
  `STYLE.template.md`, `REFERENCE-BAR.template.md`.
