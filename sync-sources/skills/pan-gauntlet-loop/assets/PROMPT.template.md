# The Gauntlet — <THING> at the level of <REFERENCE>

<Fill every <ANGLE> slot from the intake, then delete this line. The three
paragraphs below ARE the mission — keep them first, keep them plain. Anyone
(model or human) who reads only them must know exactly what we're doing and
why. Everything after "The machinery" is supporting detail.>

Build <THING — one sentence naming the subject and where it lives (this repo
/ this package / this site)> at the level of <REFERENCE — the named quality
bar>. It should be utterly perfect: <LOOK — 2–4 clauses painting the
committed direction, concrete enough that "wrong even if it's pretty" is
checkable>, with every single thing done at <TIER — e.g. shipped-commercial>
quality, from <AREA_1>, to <AREA_2>, … to anything else you could think of.

Fan out sub-agents and have each one tackle a single area individually so
that <THING> is utterly perfect. Loop on each area: build it, capture real
evidence of the result (<CHECK — e.g. screenshots / CLI transcripts /
benchmarks>), and have a SEPARATE sub-agent check that evidence — a really
harsh critic, never the agent that built it — to ensure it is <TIER>. If it
isn't <TIER>, the critic's defect list goes back to the builder and the area
keeps going.

Don't stop until every area's critic is utterly wowed when the result is
compared with <REFERENCE>. The critic literally puts our evidence and
<REFERENCE>'s side by side, blind, and says which one is better — WOWED
means it picked ours without hesitation. Do this in <STACK — normally "this
repo, stack unchanged">. Loop until it's utterly perfect.

---

## The machinery (how the loop actually runs)

Everything below exists to serve the three paragraphs above. Where they
conflict, the paragraphs win.

### Why it works — four rules that are the whole game

1. **The bar is a real named thing** the critic can open — not an adjective.
2. **The builder never grades its own work** — every critic is a fresh
   sub-agent with no knowledge of the builder's effort or reasoning.
3. **The verdict is binary** — WOWED or NOT_YET with concrete fixes. Never
   a score; scores drift upward and everything passes.
4. **No fixed round count** — the exit is every critic WOWED, or the
   operator stopping the run.

### Setup state (the orchestrator has already done this)

- All work on branch `<BRANCH>` in worktree `<WORKTREE PATH>` — never the
  primary checkout.
- `refs/STYLE.md` is the committed direction; `refs/REFERENCE-BAR.md` is the
  critic's judging contract; `refs/press/` holds the fetched reference
  evidence the blind comparisons run against.
- `gauntlet/` holds the live progress page: `status.json` (the state of
  every area), `shots/` (canonical evidence per area), `notes/` (every
  critique JSON). Served at `<DASHBOARD URL>`.
- <DESIGN AUTHORITY — e.g. PRD.md / docs/ / this prompt> is the design
  authority. <List binding sections, if any.>

### Ground rules

- The orchestrator reviews and commits per area with path-scoped `git add`;
  agents do not commit.
- Scope: <IN — the only surfaces this pass touches>. Deferred: <OUT —
  explicit exclusions>.
- Model routing: design-heavy areas and ALL critics → frontier-tier;
  mechanical implementation, tests, asset runs → workhorse-tier.

### The loop contract (per area, repeated until WOWED)

1. **Implement** — builder sub-agent with the ownership map below and the
   current defect list as its work order.
2. **Capture evidence** — launch and drive the real thing; save the
   canonical capture to `gauntlet/shots/<area-key>.png` (or transcript /
   benchmark output to `notes/`).
3. **Critique** — separate harsh critic, fresh context, evidence + `refs/`
   only, judges blind per `refs/REFERENCE-BAR.md`; verdict JSON lands in
   `gauntlet/notes/critique-<area>-iter<n>.json`.
4. **Report** — update `gauntlet/status.json` at every transition (agent
   launched / landed / awaiting critique / verdict), not just after
   critiques. A stale dashboard is a bug.
5. **NOT_YET** → the defect list becomes the next iteration's work order.
   **WOWED** → area done.

### Areas

<area-key — one-line charter; one per line; each independently judgeable>

### File ownership

<one line per area: the exact paths it owns. Areas sharing files serialize
in the same wave, never parallel. This map is repeated verbatim in every
agent prompt.>
