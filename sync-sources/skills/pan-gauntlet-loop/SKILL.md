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
      "updated": "<ISO>"
    }
  }
}
```

`verdict` is `"WOWED"`, `"NOT_YET"`, or `null`. `defects` holds the top ≤5
(strings, or `{"element","fix"}` objects). The page polls it every 5s.

## Phase 2 — The loop (per area, areas in waves)

1. **Wave plan — parallelize to the file-ownership limit.** Assign each area
   an exact file-ownership map, restated in every agent prompt. Concurrent
   agents in one worktree WILL clobber shared files, so areas that share
   files run in the same wave **serially** — but that constraint is
   per-file, not global: prefer SPLITTING areas until their maps are
   disjoint, and run everything disjoint **concurrently**. Films and
   critics for different areas are read-only-ish and parallelize freely.
   Keep the orchestrator thin; the fan-out does the work.
2. **Build.** Spawn a builder sub-agent for the area with its ownership map,
   the mission prompt, and the current defect list as its work order.
   Builders never commit and never judge their own work; the orchestrator
   reviews and commits per area with path-scoped `git add` — `git add -A`
   would scoop another in-flight agent's half-done work.
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
   `gauntlet/notes/critique-<area>-iter<n>.json`.
5. **Update the dashboard at every transition** — agent launched / landed /
   filming / awaiting critique / verdict — not just after critiques. A
   stale dashboard is a bug. The page mutates cards in place; regenerated
   media needs cache-busting or browsers replay stale files.
6. **NOT_YET → the defect list becomes the next iteration's work order** for
   the same area. WOWED → area done, and prior WOWED quality is a FLOOR no
   later iteration may regress. **No fixed round count**: the exit is
   winning, or the operator stopping the run.
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

## Sub-agents, model routing, and tools

- Fan out with the Agent tool inside this conversation. Gauntlet builders and
  critics are ephemeral conversation sub-agents — the "work agents run through
  `pan`" rule governs managed pipeline issues, not this loop. If the gauntlet
  uncovers work that belongs in the managed pipeline, file an issue and route
  it through `pan start`.
- **Model ladder — cheapest that clears the bar, escalate on evidence:**
  **Sonnet** is the default for as much as possible — builders, films,
  mechanical implementation, asset processing, test runs. **Opus** when
  necessary — every critic by default, design-heavy build areas, and
  problems a Sonnet attempt just fumbled. **Fable** for the really tricky
  stuff only — areas that keep failing across iterations, deep root-cause
  mysteries, and the final full-frame composition judgment. Escalate a
  LANE's tier after failures, not preemptively; de-escalate when the hard
  part is done. Critics are where model quality pays — never cheap out on
  the judge.
- **Distribute and parallelize as much as possible.** Many cheap agents in
  flight beat one expensive agent in series; the wave plan's file-ownership
  maps are the only serialization constraint.
- **No tool restrictions.** Every gauntlet agent may use whatever tools the
  session has — browsers/Playwright, WebSearch/WebFetch, image tooling,
  profilers, DB clients. "Blind critic" restricts what the critic is TOLD
  (nothing from the builder), never what it may DO.
- Sub-agent fan-out requires a harness with the Agent tool. GPT-routed
  claude-code sessions cannot spawn sub-agents — run the gauntlet from a
  Claude session.

## References

- `references/domains.md` — per-domain CHECK (evidence capture), sample area
  splits, automatic-failure lists, and storefront-test phrasing.
- `assets/` — `gauntlet-index.html` (progress page), `PROMPT.template.md`,
  `STYLE.template.md`, `REFERENCE-BAR.template.md`.
