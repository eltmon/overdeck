---
name: pan-gauntlet-loop
description: Run a Gauntlet Loop — fan out builder sub-agents per area, judge each with a SEPARATE harsh critic in a blind A/B against a named reference bar, keep looping until every area wins, and track it all on a live progress page. Use when the user wants to take any project, feature, or domain to an extreme quality tier ("make it AAA", "at the level of <reference>", "utterly perfect", "run the gauntlet", "gauntlet loop"). Works for any domain: games, UI, CLIs, APIs, libraries, docs, performance, writing.
triggers:
  - gauntlet loop
  - run the gauntlet
  - gauntlet
  - AAA quality pass
  - at the level of
  - utterly perfect
  - fan out sub-agents
allowed-tools:
  - Bash
  - Read
  - Write
  - Edit
  - WebFetch
  - WebSearch
  - Task
---

# Gauntlet Loop

Take any domain to a named quality bar with a builder/critic loop: fan out a
builder sub-agent per area, judge each area with a **separate** harsh critic
(fresh context, blind A/B against the reference, binary verdict), feed defects
back, and loop until every area is WOWED. A live progress page tracks every
area, screenshot, verdict, and defect list.

Origin: Matt Shumer's gauntlet prompt; hardened by run #1 lessons
(`references/lessons.md` — read it before the first fan-out).

## Phase 0 — Intake: fill the slots, ask about the gaps

Extract these slots from the user's request. For every slot that is missing or
vague, ask via AskUserQuestion — batch up to 4 questions per call, each
self-contained (the operator may answer from a dashboard dialog without the
transcript: state the situation, then ask). Never guess the mission.

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

REFERENCE is the load-bearing slot. Before accepting it, verify it is:

- **Named** — a specific thing ("Civilization VII", "stripe.com's docs"),
  not a category ("a good strategy game").
- **Fetchable** — the critic can screenshot, read, run, or open it. Fetch the
  reference evidence during setup (below); if you cannot, say so and pick
  another bar with the operator.
- **Comparable** — the subject's evidence and the reference's evidence can sit
  side by side for a judge to pick one.

## Phase 1 — Setup (before any builder launches)

1. **Isolate the work.** Default: `git worktree add ../<repo>-gauntlet -b
   gauntlet-loop-pass` and run the whole gauntlet there. Offer the current
   checkout instead only when the operator asked to enhance in place.
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
4. **Serve the progress page:** from `gauntlet/`, run
   `python3 -m http.server <port>` in the background and report the URL.
   (Browsers block `fetch()` from `file://` — the page needs HTTP.)
5. **Operator approval gate.** Show the filled `gauntlet/PROMPT.md` to the
   operator and get an explicit go before the first fan-out. The gauntlet
   burns real tokens; the mission it burns them on is the operator's call.

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
      "updated": "<ISO>"
    }
  }
}
```

`verdict` is `"WOWED"`, `"NOT_YET"`, or `null`. `defects` holds the top ≤5
(strings, or `{"element","fix"}` objects). The page polls it every 5s.

## Phase 2 — The loop (per area, areas in waves)

1. **Wave plan.** Assign each area a file-ownership map. Areas that share
   files run in the same wave **serially**; disjoint areas may run in
   parallel. Concurrent agents in one worktree WILL clobber shared files.
2. **Build.** Spawn a builder sub-agent for the area with its ownership map,
   the mission prompt, and the current defect list as its work order.
   Builders never commit; the orchestrator reviews and commits per area with
   path-scoped `git add` (in-flight agents keep the tree dirty).
3. **Capture evidence.** Launch the real thing and drive it — Playwright for
   UI (1920×1080, realistic data, dev chrome hidden), the CLI at its command,
   the benchmark at its load. Save the canonical shot to
   `gauntlet/shots/<area-key>.png` (or transcript/benchmark to notes/).
4. **Critique.** Spawn the critic — ALWAYS a separate sub-agent from the
   builder, fresh context, frontier-tier model, evidence + refs/ only. It
   judges blind per `refs/REFERENCE-BAR.md` and returns the verdict JSON.
   Save it to `gauntlet/notes/critique-<area>-iter<n>.json`.
5. **Update the dashboard at every transition** — agent launched / landed /
   awaiting critique / verdict — not just after critiques. A stale dashboard
   is a bug.
6. **NOT_YET → the defect list becomes the next iteration's work order** for
   the same area. WOWED → area done. **No fixed round count**: the exit is
   winning, or the operator stopping the run.

## Phase 3 — Stop conditions

- **The operator is the brake.** The loop does not finish on its own; when
  they say stop, stop, commit cleanly, and report state.
- **All areas WOWED** → final report: per-area verdicts and iteration counts,
  the commit log, the dashboard URL, and anything deferred to a later pass.

## The four ways the loop silently fails

1. **Vague bar** — the critic invents a comparison and approves everything.
2. **Builder judging its own work** — the critic must be a fresh agent with no
   knowledge of the builder's effort or reasoning.
3. **Soft critic** — the verdict is binary (WOWED / NOT_YET + concrete fixes),
   never a score out of 10.
4. **Fixed round count** — "3 iterations" ships a prototype. Loop until WOWED.

## Sub-agents and model routing

- Fan out with the Agent tool inside this conversation. Gauntlet builders and
  critics are ephemeral conversation sub-agents — the "work agents run through
  `pan`" rule governs managed pipeline issues, not this loop. If the gauntlet
  uncovers work that belongs in the managed pipeline, file an issue and route
  it through `pan start`.
- Route deliberately: frontier-tier model for design-heavy areas and for ALL
  critics; workhorse-tier for mechanical implementation, tests, and asset
  runs. Critics are where model quality pays — never cheap out on the judge.
- Sub-agent fan-out requires a harness with the Agent tool. GPT-routed
  claude-code sessions cannot spawn sub-agents — run the gauntlet from a
  Claude session.

## References

- `references/lessons.md` — run-#1 operational lessons (file ownership,
  headless rendering, evidence capture, critic protocol, dashboard contract).
  Read before the first fan-out; fold applicable lines into agent prompts.
- `references/domains.md` — per-domain CHECK (evidence capture), sample area
  splits, automatic-failure lists, and storefront-test phrasing.
- `assets/` — `gauntlet-index.html` (progress page), `PROMPT.template.md`,
  `STYLE.template.md`, `REFERENCE-BAR.template.md`.
