# The Gauntlet — mission prompt (operator-approved <DATE>)

<Fill every <ANGLE> slot from the intake. Delete these italic instructions.
This file is the mission every builder and critic agent reads — it must stand
alone without the conversation that wrote it.>

<Build / Enhance / Fix> <THING — one sentence naming the subject and where it
lives (this repo / this package / this site)> at the level of <REFERENCE —
the named bar>. It should be utterly perfect: <LOOK — 2–4 clauses painting
the committed direction, concrete enough that "wrong even if it's pretty" is
checkable> — with every single thing done at <TIER> quality, from <AREA_1>,
to <AREA_2>, … to anything else you could think of.

## Ground rules

- All work on branch `<BRANCH>` (worktree `<WORKTREE PATH>`). The orchestrator
  reviews and commits per area with path-scoped `git add`; agents do not
  commit.
- <DESIGN AUTHORITY — e.g. PRD.md / docs/ / this prompt> is the design
  authority. <List any binding sections.> Enhance it in-branch where the work
  demands it (never renumber existing sections), then implement.
- Scope: <IN — the only surfaces this pass touches>. Deferred: <OUT —
  explicit exclusions>.
- Stack: <STACK — normally "unchanged: <the repo's stack>">.
- Direction: `refs/STYLE.md`. Critic contract: `refs/REFERENCE-BAR.md`.
  Reference evidence: `refs/press/`.
- Model routing: design-heavy areas and ALL critics → frontier-tier;
  mechanical implementation, tests, asset runs → workhorse-tier.

## The loop (per area)

1. Implement (builder sub-agent, ownership map below).
2. Launch and drive the real thing; capture evidence — <CHECK — e.g.
   "Playwright screenshots at 1920×1080 across the key states">.
3. A SEPARATE harsh-critic agent — never the implementer, fresh context,
   evidence + `refs/` only — judges blind per `refs/REFERENCE-BAR.md`.
4. Update `gauntlet/status.json` + `gauntlet/shots/<area>.png` at every
   transition. A stale dashboard is a bug.
5. Verdict not WOWED → the defect list becomes the next iteration's work
   order. Loop until WOWED. No fixed round count.

## Areas

<area-key — one-line charter>
<one per area; each independently judgeable>

## File ownership

<one line per area: the exact paths it owns. Areas sharing files serialize
in the same wave. This map is repeated verbatim in every agent prompt.>
