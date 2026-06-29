# Epic D — Process Gates (design doc / decision pending)

> Status: **not started — design pass.** Epics A–C and E Tier 1 are done; E Tier 2 in flight.
> This doc exists so we can decide D deliberately rather than auto-implement it.

## What Epic D is for

Epics A–C fixed the codebase at the **code** level (ratchets, deep modules, evals, a
single-source-of-truth state model). Epic D is the **workflow/process** layer: keep the debt
from coming back by gating *how* changes are made, not just *what* the code looks like.

The campaign's own history is the motivation: the most expensive incidents were not bad lines
of code but **process** failures — concurrent/half-applied state migrations causing
"half-files/half-DB" drift, and large changes built from unchallenged designs that then needed
rework (the fix-work-dominates-feature-work pattern this whole effort set out to fix).

Two components, from the original roadmap:

1. **One-migration-at-a-time.** Only one schema/state migration may be in flight at once.
   Prevents two migrations racing and leaving state half-applied.
2. **Design-review gate ("grilling").** A required, lightweight design challenge — surface
   assumptions, list alternatives, name the blast radius — *before* a large/risky change is
   implemented. Bad work usually originates in a design nobody pushed back on.

## Design options

### Option A — Mechanical gates only (cheap, verifiable)
Add concrete CI/lint checks and stop there:
- "large/refactor PR must link a PRD" check
- a guard that flags **two unrelated migrations in one diff**
- promote the existing no-loss-audit convention into a CI check
- (we already have: no-`any` ratchet, file-size guard, two-door boundary guard)

*Pros:* fully automated, objective, low effort. *Cons:* doesn't touch the highest-leverage
problem (unchallenged designs); mostly reinforces what the campaign already added.

### Option B — Design-review gate (highest leverage)
Make a short design step a required precondition before work is spawned for a large/risky
issue — e.g. the planning role must produce a "grilled" design (assumptions, alternatives,
blast radius, rollback) that a reviewer (human or a dedicated agent) signs off before
implementation. A pipeline/prompt change, not just CI.

*Pros:* attacks the actual source of rework — designs no one challenged. *Cons:* softer to
"enforce" mechanically; needs a judgment call on how heavy the gate is; risk of becoming
ceremony if over-scoped.

### Option C — Both, phased (A then B)
Ship the cheap mechanical gates first, then the design gate.

## Recommendation

**A scoped Option B**: implement exactly **one** lightweight pre-implementation design gate
(not a broad process overhaul), because the mechanical side is largely covered by the
ratchets + two-door guard the campaign already shipped. Keep it cheap: a required
design-summary section (assumptions / alternatives considered / blast radius / rollback) on
large issues, reviewed once before work spawns. Add the single "large PR links a PRD"
mechanical check from Option A if we want one objective backstop.

**Also: D is the lowest-ROI of what remains** — E Tier 2 (storage-agnostic core) delivers
more concrete value, so do D last and small.

## Open decisions (for the deliberate pass)

1. How heavy is the design gate — a checklist field on the issue, or an agent that actively
   "grills" the design and can block?
2. Is one-migration-at-a-time worth a *mechanical* guard, or a documented convention given
   the two-door state model already reduces drift?
3. Who/what signs off the design — the operator, or a dedicated review agent?
4. Do we want any of the Option-A mechanical checks, or is the design gate enough?
