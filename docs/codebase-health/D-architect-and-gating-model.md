# Epic D — The Architect role + a unified, obvious gating model

> Supersedes the `D-process-gates.md` stub. Design pass requested 2026-06-29.
> Decision locked: the Architect gate is **blocking-with-operator-override**, **large/risky issues only**.
> Goal: don't bolt a 7th gate onto a system that's already hard to read — **unify** it and make the
> mental model *obvious*, with the Architect as a natural part of the whole.

## 1. What we have today (and why it's powerful)

The autonomous backlog → pipeline machinery is genuinely advanced, and worth keeping:
- A **sequencer** AI ranks the backlog (`sequence.md`: importance/impact/size/depends-on → order + rationale).
- The **Flywheel** auto-picks the top eligible issue and drives plan → work → review → test → merge.
- Operators can steer per issue, and the planning AI can **object** to bad work.

The whole pickup decision is one function — `isAutoPickable(s)` in `src/lib/backlog/pickup.ts`:
> `ready ∧ planned ∧ released ∧ ¬parked ∧ ¬vetoed ∧ ¬objection ∧ ¬inPipeline ∧ ¬epic`
> (plus `isUnblockEligible()` for the `blocks-main` emergency bypass).

## 2. Why it's hard to wrap your head around

There are **8+ distinct gate/hold concepts**, several overlapping, across **two stores**:

| Concept | Owner | Store | Overlaps with… |
| --- | --- | --- | --- |
| Ready | operator | label | Parked, Vetoed (all 3 = "won't pick") |
| Planned | derived | spec+beads on disk | — |
| Released | operator | label | Planned (release *is* the post-plan checkpoint) |
| Parked | operator | label | Objection (both = "halted pending a decision") |
| Vetoed | operator | label **and** sequence.md `gate` | Ready-off, Parked |
| Objection | AI (planning) | label + comment | Parked |
| Pickup gate (auto/promote/vetoed) | operator | sequence.md | Vetoed label (dual-stored!) |
| In-pipeline | derived | workspace + review_status | — |

Three problems fall out of that table:
1. **Three different "won't pick" mechanisms** (Ready-off / Parked / Vetoed) you must mentally diff.
2. **Dual storage** — `vetoed` lives in *both* a label and the sequence.md `gate` field. That's exactly the single-source-of-truth violation the campaign's two-door tenet exists to kill.
3. **No single "where is this issue and why isn't it moving?" answer** — you reconstruct it from 6 scattered control groups (the screenshot).

## 3. The key insight — the Architect is not a new gate

**The planning AI already does design judgment** — it can raise an *AI Objection* ("doesn't make
sense / would worsen the product / superseded"). That informal objection *is* an embryonic design
gate, today buried as a side-effect of planning (a label + a comment).

So the Architect isn't a 7th gate — it's the **maturation of the objection into a first-class role**:
the planning agent goes back to *just planning*, and a dedicated **Architect** reviews the plan and
emits a structured verdict (APPROVE / BLOCK-with-reasons). The existing `objection` state becomes
**the Architect's BLOCK output** — same hold, now with a clear owner, its own model, and a written
rationale every time. We *remove* a fuzzy concept and *add* a clear one in its place.

## 4. The unified model — one track, a few holds

Make every issue answerable in one sentence: **"It's at <rung>, owned by <who>, next: <action> — hold: <none|parked|vetoed>."**

**THE TRACK** (linear; each rung has exactly one owner):
```
Backlog → Sequenced → Ready → Planned → Designed → Released → [build → review → test → merged]
  (AI)      (AI rank)  (op)    (AI plan) (AI:Architect) (op release)   (AI pipeline)
```
- **Designed** is the new rung: the Architect reviewed the plan and approved. It sits exactly where
  it should — **after Planned** (there's a concrete design to review) and **before Released** (the
  operator's final go), so bad designs are caught before any work spawns.

**HOLDS** (orthogonal; can sit on any rung; each with ONE distinct meaning — no more overlap):
- **Parked** — a human paused it, reversible ("let's discuss"). 
- **Vetoed** — killed, hard no, survives resequencing (policy / out-of-scope).
- **In-pipeline** — already moving (safety; auto-derived; never operator-set).
- **Promote** / **Blocks-main** — not holds but *modifiers*: jump the queue / emergency-strike past Ready+Released to fix red main.

`isAutoPickable` is unchanged in spirit — it just reads as "issue is at **Released** with no **hold**,"
which is far easier to reason about than the 8-term boolean.

## 5. The Architect role (spec)

- New pipeline role `architect` alongside plan/work/review/test; `roles/architect.md`.
- **Its own model + harness setting** in Settings (new picker row) — route it to the strongest model.
- **Position:** post-Planned, pre-Released. Reviews the vBRIEF/PRD: assumptions, alternatives
  considered, blast radius, rollback, and alignment with our tenets (deep modules, two-door state).
- **Verdict:** APPROVE → issue becomes **Designed** (eligible for operator Release). BLOCK → sets the
  hold (the artifact formerly known as "objection") with written reasons; operator can **Override →
  Release anyway** or **Accept & park**. (This is the blocking-with-override you locked.)
- **Scope:** large/risky issues only (size/importance threshold; trivial issues skip the rung).

## 6. Make it obvious (the UI win)

Replace the screenshot's ~6 control groups with **three** things:
1. **A gate-ladder stepper** — a vertical Sequenced→Ready→Planned→Designed→Released→… track with
   ✓ passed / ● current / ○ ahead, each step labeled with its **owner** and, where the operator owns
   it, an inline toggle/button (Ready, Release). One glance = "where is it, what's next, who acts."
2. **A single Hold chip** — `none | Parked | Vetoed | In-pipeline` (+ Promote / Blocks-main badges).
   Replaces the three separate "won't pick" toggles with one status that explains itself.
3. **The sequence rationale** (kept as-is — the "why this rank" from sequence.md).

## 7. Single-source-of-truth cleanup (do this with the Architect work)
- **Labels are canonical** per-issue state (tracker-portable). Collapse the dual-stored `gate` so
  `vetoed`/`promote` live in exactly one place; `sequence.md` holds **ordering/rationale only**, not a
  second eligibility store. This is the two-door tenet applied to the gating system.

## 8. Phased plan (your "both, phased")
- **Phase 1 — mechanical gates (cheap, independent):** large/refactor PR must link a PRD/issue;
  promote the no-loss-audit into CI. (Objective backstops; ship first.)
- **Phase 2 — Architect + unification:** the `architect` role + model setting + the post-plan gate
  that *absorbs* the objection; collapse the dual-storage; ship the gate-ladder UI. This is where the
  clarity win lands — it's a real feature, so it gets a full PRD and is itself a good first candidate
  to run *through* the Architect gate.

## 9. Open questions for you
1. The gate-ladder UI — happy with the vertical stepper + single Hold chip as the consolidation?
2. Should the Architect's BLOCK fully **replace** the planning-agent objection (planning stops
   objecting; Architect owns design verdicts), or run **in addition** during a transition?
3. "Large/risky" threshold — by est. size (M+/L), by impact score, by touched-file count, or operator-set per issue?
4. Do the Phase-1 mechanical gates earn their keep, or skip straight to the Architect (Phase 2)?
