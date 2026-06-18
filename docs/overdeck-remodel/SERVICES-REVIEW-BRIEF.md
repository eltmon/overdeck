# Review request — Overdeck **service-level API tier**

You previously reviewed the Overdeck schema and end-state (your notes are in
`docs/overdeck-remodel/FEEDBACK-gpt5.5.md`, and we incorporated them). This is a
**second, narrower review**: the **service-level API tier** — the resolver (read
door), writer (write door), and HttpApi/RPC controller designed for each domain.

## Context recap (and one important recalibration)

Overdeck collapses Overdeck's drift-prone data layer into **one resolver + one
writer per domain**, with controllers delegating to them and nothing else touching
a store. **The bar is functional parity:** keep every piece of functionality the
system has today, minus the redundant/wrong ways it currently does each thing. The
"disposable cache / four homes" language is a *mental model*, not a contract —
**do not re-litigate cache-purity or rebuild gates** (we already deflated that).
The only genuinely permanent things are the code and the conversation JSONL files;
everything else is pipeline-management working state, and git records are
lightweight coordination.

## Read

- `docs/overdeck-remodel/ARCHITECTURE-CONVENTIONS.md` — the verified Effect v4-beta
  house style (Context.Service, HttpApiGroup, source-first writer, the no-`hold()`
  rule: side-states are written by their OWNING domain's writer).
- `docs/overdeck-remodel/services/*.md` — the tier to review: `issues`, `agents`,
  `conversations`, `cost`, `merge`, `control-settings`, `memory`, `observability`.
  Each has a Part-1 no-loss mapping and Part-2 Effect services.
- `docs/overdeck-remodel/overdeck-schema.ts` — the locked tables the writers mutate.

## How to review — verify against the real code, don't trust the docs

Each service doc claims a **no-loss mapping** (every current HTTP endpoint / CLI
verb / RPC method → a new door, or a deliberate DELETE/RELOCATE). Your job is to
falsify that where you can, grounded in:
- `src/dashboard/server/routes/*.ts`, `src/dashboard/server/ws-rpc.ts`,
  `packages/contracts/src/rpc.ts`, and the `pan` CLI (`src/cli*`/`src/commands*`).
- the real `src/lib/**` functions each writer claims to absorb.

## Evaluate (file:line evidence for every claim)

1. **No-loss, per domain.** Is any current endpoint / CLI verb / RPC method
   genuinely lost — mapped to nothing, or mapped to a door that can't actually do
   what the original did? (We expect RELOCATE and DELETE; flag *silent* drops.)
2. **Door-boundary integrity.** Does any writer's method actually need a table that
   belongs to another domain (the failure the Issues `hold()` finding caught)? E.g.
   does `MergeWriter` reach `issue_policy`, or `SettingsWriter` reach `agents`?
   Each doc claims it doesn't — verify.
3. **Resolver/writer shape.** Are the verbs the right grain (not a god-method, not
   fragmented)? Is `advance()`-style edge-derivation sound for Issues? Are the
   "didn't fit" residues (message delivery, terminal streaming, permission prompts,
   the conversation backing-file writes) correctly handled rather than ignored?
4. **Effect v4 + door enforcement.** Do the `Context.Service` / `HttpApiGroup` /
   `Layer` shapes match the conventions and the installed v4-beta API? Is a
   handler's `R` really only `Resolver | Writer`, never `Db`?
5. **The cross-domain seams.** Side-states route Issues→Agents (paused/troubled) and
   Issues→Settings (deacon-ignored/auto-merge); the auto-merge *flag* (Settings) vs
   *schedule* (Merge); the review-run runtime (Agents spawn vs Orchestration run).
   Are these seams consistent *across* the docs, or do two docs disagree?
6. **Strongest objection** to the tier as a whole.

## Output

Write your review to **`docs/overdeck-remodel/FEEDBACK-gpt5.5-services.md`**:
executive summary; prioritized findings (P0 = lost functionality / broken door
boundary, P1 = design concerns, P2 = polish), each with claim + file:line evidence
+ fix; and a "what's good / keep" section. Prefer specific, verifiable critiques.

When done, **`pan tell 2996 "<short status>"`** so the Overdeck author knows your
review is ready to incorporate.
