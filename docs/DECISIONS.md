# Resolved Decisions & Tenets — the backlog "spirit gate"

This is the registry of **resolved architectural decisions and standing tenets** that backlog
work must not contradict. It exists for one job:

> The Flywheel's relevance-vet checks every backlog candidate against this list before launching
> it (see `roles/flywheel.md` → "Vet before every launch"). An item that **contradicts a tenet
> here must be marked `objection`** — with a comment citing the tenet ID — and **not picked up**.
> This is how the pipeline stays resilient to stale or contradictory issues that would, if built,
> undo work already resolved.

Each entry is a **one-line summary + a pointer to its canonical source**. The source wins on
detail; this file is the index the vet reads. Add a tenet when a decision is resolved that future
backlog items could plausibly contradict; never restate a source at length here (that drifts).

`vetoed` is the operator's manual version of this gate; `objection` is the Flywheel's. Both halt
pickup via `isAutoPickable` in `src/lib/backlog/pickup.ts`. This registry gives the Flywheel a
*reason* to raise `objection` beyond "is it still sane vs `main`?".

---

## Tenets

- **TENET-1 — Two-door single source of truth.** Exactly one read door (a resolver per domain)
  and one write door (the record writer); no direct SQLite / `.pan/` / `state.json` / GitHub
  access for canonical state. *Reject* items that add a parallel read/write path or dual-store a
  fact. Source: `sync-sources/rules/` single-source-of-truth rule; `docs/API-SURFACE.md`.

- **TENET-2 — Deep modules, behavior-preserving refactors.** Narrow interfaces over hidden
  complexity; every extraction is compiler+test-verified and behavior-IDENTICAL — no semantic
  changes mid-move, no shallow pass-through wrappers. *Reject* a behavior-changing rewrite framed
  as a refactor. Source: `docs/CODEBASE-HEALTH-ROADMAP.md`, `docs/codebase-health/`.

- **TENET-3 — No-loss audit on any surface refactor.** Additive/superset, never silent
  replacement; enumerate the old surface and prove every command/route/status/view/affordance has
  a home; the audit gate blocks until each old item is accounted for. Source:
  `.claude/rules/` refactor-no-loss rule.

- **TENET-4 — Blanket-release auto-pickup model.** `auto_pickup_backlog` ON = a blanket release
  satisfying the per-issue `released` gate for the whole backlog; the single predicate
  `isAutoPickable` (`src/lib/backlog/pickup.ts`) is the source of truth, shared by the dashboard
  forecast and the Flywheel so they can never disagree. *Reject* a second eligibility store or a
  divergent pickup predicate. Source: `vision.mdx` → autonomy model; PAN-2187.

- **TENET-5 — Author/assignee security invariant (always on, no relaxation flag).** Include an
  issue only if `author ∈ {eltmon, panopticon-agent[bot]}` OR `eltmon ∈ assignees` — the only
  safeguard between a malicious third-party issue and an autonomous agent. *Reject* any item that
  relaxes this for convenience. Source: `vision.mdx`; `roles/flywheel.md` → Constraints.

- **TENET-6 — Flywheel soul / metabolism.** Every revolution must permanently improve the
  substrate; "a workaround is a failed tick"; the Flywheel dispatches agents and owns outcomes to
  merged — it never substitutes ranking/reports for acting. *Reject* report-only behavior or
  bandaid fallbacks that mask a broken flow. Source: `roles/flywheel.md`; PAN-2187.

- **TENET-7 — Epic D gating direction (locked).** Blocking-with-operator-override; large/risky
  issues only; the Architect is the *maturation of the existing objection* (NOT a new parallel
  gate); one linear TRACK + orthogonal HOLDS. *Reject* items that bolt on a new gate/hold concept
  or make the Architect non-blocking. Source: `docs/codebase-health/D-architect-and-gating-model.md`.

- **TENET-8 — Don't redesign the gating UX without an interactive mockup.** The gate-ladder
  stepper + Hold chip must be prototyped interactively and operator-approved before any production
  change — the current gating UX is hard-won. *Reject* gating-UX changes shipped straight to
  production. Source: `docs/codebase-health/REMAINING-BACKLOG.md` §4; memory
  `feedback_interactive_mockup_for_ux_redesign`.

- **TENET-9 — Review-synthesis-wedge-first sequencing.** Land deterministic deacon-side review
  synthesis (PAN-1864) before flooding the Flywheel with the refactor backlog — otherwise PRs pass
  review but never merge. Source: PAN-1864; `docs/codebase-health/REMAINING-BACKLOG.md`.

- **TENET-10 — Pipeline-machinery refactors stay on supervised handoff.** A refactor of the code
  the pipeline runs on (deacon, the flywheel loop, `conversations` live-control, merge/review
  routes, agents runtime) can redden `main` and stall every merge. *Reject* autonomous pickup of
  these; route them through supervised `pan handoff`. Safe leaf decompositions flow normally.
  Source: `docs/CODEBASE-HEALTH-ROADMAP.md` red-main incident; this session.

- **TENET-11 — Harness routing.** Never force `--harness claude-code` on a CLIProxy-routed model
  (kimi/gpt-5.5/glm); trust provider defaults (kimi→ohmypi, gpt-5.5→codex, claude-*→claude-code).
  The 200k-window illusion deadlocks long sessions. Source: PAN-1865; `sync-sources/rules/`.

- **TENET-12 — No hardcoded model fallback.** Model resolution comes from explicit settings or
  fails loudly — never a code-literal default. Source: `sync-sources/rules/` model-fallback rule.

- **TENET-13 — No bandaids / fix at root.** Never work around a broken thing; never hand-fix agent
  output — fix the system that allowed it. Zero intentional tech debt. Source: `CLAUDE.md`.

- **TENET-14 — Refactor-execution discipline.** Ratchets before extraction; no new `any`
  (A1 ratchet); the file-size guard is shrink-only — a decomposition must NOT create a new
  >1000-line file; run the FULL test suite before merge (not just typecheck/lint); repoint
  source-introspection tests in the same PR as the decomposition they follow. Source:
  `docs/codebase-health/A1`, `A3`, `CODEBASE-HEALTH-ROADMAP.md` red-main lessons.
