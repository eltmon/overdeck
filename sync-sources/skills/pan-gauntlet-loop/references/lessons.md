# Gauntlet run-#1 lessons — operational addenda

Generalized from the first full gauntlet (Lexerra, 2026-08-11). Every line
exists because its absence cost an iteration. Fold the applicable lines into
the mission prompt and the per-agent prompts verbatim.

1. **File-ownership map, enforced in every agent prompt.** Concurrent agents
   in one worktree WILL clobber shared files. Each area owns exact paths;
   areas sharing files serialize in one wave, never run in parallel. Agents
   never commit; the orchestrator reviews and commits per area with
   path-scoped `git add` — `git add -A` would scoop another in-flight agent's
   half-done work.
2. **Evidence at presentation quality.** Screenshots at 1920×1080 — run #1's
   1440×900 captures failed the critic on storefront parity alone. Capture
   with realistic data (an in-fiction account name, real content — a test
   username like `map3d_48100411` visible in the shot is a defect). Keep dev
   tooling panels out of captures.
3. **Headless rendering gotchas.** Black frames in headless Chromium are a
   renderer-context issue, not scene code — try default launch flags before
   forcing software rasterization flags. React StrictMode double-mounts:
   canvas/WebGL code must survive a fresh mount. Software-rasterized FPS
   numbers in headless are CPU rasterization — never treat them as the real
   60fps verdict.
4. **Seedable state is load-bearing for critique.** If reaching a state takes
   hours of wall-clock (filled stockpiles, advanced time, specific data), the
   loop can't be photographed. Add the test hook / seed path during setup,
   not mid-loop. Never restart a shared dev server mid-run — hot-reload kills
   other agents' verification sessions.
5. **Critic protocol.** The critic is ALWAYS a separate agent from the
   builder, frontier-tier, sees evidence + refs only (no code access needed).
   It tags each defect with the owning area so cross-area defects merge into
   the right queue (run #1's map critic found 5 UI defects). Verdict JSON
   goes to `gauntlet/notes/critique-<area>-iter<n>.json` and onto the
   dashboard card verbatim.
6. **Dashboard contract.** Update `status.json` at EVERY transition (agent
   launched / landed / awaiting critique / verdict), not just after
   critiques. The page mutates cards in place — a full-DOM rebuild per poll
   makes screenshots flash. Regenerated media needs cache-busting or browsers
   replay stale files.
7. **Test reconciliation is its own queued item.** Big visual/structural
   changes break existing test selectors; don't let the builder burn its run
   fixing them. Wave gates are: build passes, evidence captured, critique
   filed. Broken-suite repair gets its own area or a follow-up.
8. **Cadence artifacts.** Commit critique JSONs and status.json to the branch
   — the pass history is reviewable. Gitignore large third-party reference
   media and regenerable source assets (keep shipped assets committed).

## The four ways the loop silently fails

These are from the pattern's origin notes and every writeup since — restate
them because they are the whole game:

1. **Vague bar** → the critic invents a comparison and approves everything.
   The bar must be named, fetchable, comparable.
2. **Builder judging its own work** → the critic must be a fresh agent with
   zero knowledge of the builder's effort or reasoning trail.
3. **Soft critic** → scores out of 10 drift upward and everything passes.
   Binary verdict + concrete fixes only.
4. **Fixed round count** → "do 3 iterations" ships a prototype. The exit
   condition is WOWED, or the operator stopping the run.
