---
title: The Overdeck Flywheel now drives your backlog — and protects it
date: 2026-06-30
audience: Developers running their own projects through Overdeck
status: draft
---

# The Overdeck Flywheel now drives your backlog — and protects it

**Overdeck's autonomous build loop gets a throttle, a sense of priority, and a conscience.**

Today we shipped a set of improvements to the **Flywheel** — the loop that takes your issues
through plan → build → review → test → merge — that let it do far more on its own while building
far less of the wrong thing. Flip one switch and the Flywheel works your backlog in priority order
around the clock, leaving you two jobs: UAT and the merge click. It now puts the health of your
codebase ahead of routine features, and — this is the new part — it **refuses to build backlog
items that contradict decisions you've already made.**

**The problem.** Autonomy used to be all-or-nothing and forgetful. "Auto-pickup" existed but
couldn't actually run your backlog without per-item babysitting; the loop ranked work by raw
priority, so a stack of decompositions that would stabilize the whole system sat behind cosmetic
tickets; and a stale issue written months ago could be picked up and quietly undo work you'd just
finished. The loop also had no instinct for self-preservation — it would happily refactor the very
machinery it runs on and red-line `main` for everyone.

**The solution.** Four changes, all live on `main`:

- **Auto-pickup that actually picks up.** Turn **Auto-pickup ON** and it's a *blanket release*:
  the Flywheel auto-starts your `ready` + planned backlog in sequencer-priority order, up to your
  agent ceiling, and assembles a single batch for you to UAT and ship. Leave it **OFF** (the
  default) and it touches only the work you explicitly *release*, plus emergencies. One toggle,
  two clearly different postures — and the dashboard's forecast always shows exactly what it will
  pick.
- **Substrate-first prioritization.** Work labeled `substrate-improvement`, `architecture`, or
  `v1.0-required` now ranks ahead of routine features of equal impact, and a substrate epic lifts
  its child issues with it. A stable foundation comes before more features — automatically.
- **A spirit gate.** The Flywheel checks every candidate against a registry of resolved decisions
  (`docs/DECISIONS.md`) and raises an **objection** — refusing to start it — on anything that would
  contradict one (e.g. re-introducing a second source of truth, reverting a settled model). Stale
  or off-spec backlog can't silently unwind your architecture.
- **Self-preservation.** Refactors of the pipeline's own guts are flagged `needs-handoff` and kept
  on supervised handoff, so the autonomous loop never breaks itself and stalls everyone's merges.

**Why it matters.** You get to trust autonomy incrementally. Keep the loop conservative and
hand-feed it; or open the throttle and let it grind your backlog overnight — and either way it
ranks the right work first and won't build something that fights a decision you already made.

**Customer quote.** *"I turned Auto-pickup on Friday and came back Monday to a UAT batch of fifteen
merge-ready changes, substrate cleanups first — and an objection on one stale ticket that would've
re-broken our state model. It did the work and caught the thing I'd have missed."*

**Availability.** Live on `main` today. Auto-pickup and UAT-before-merge are per-machine toggles on
the Flywheel page; **both default to the safe setting** (Auto-pickup off, UAT required). The
substrate-first ranking takes effect on your next backlog sequence after updating.

---

## FAQ

**How do I turn on full autonomy?** Flip **Auto-pickup** ON on the Flywheel page. That's the blanket
release: the loop starts `ready`+planned backlog by priority up to your `maxAgents`. To stay
hands-on, leave it off and add the `released` label to the specific issues you want it to run.

**What does "blanket release" mean — do I lose per-issue control?** No. With Auto-pickup OFF,
`released` is your per-issue "go." With it ON, the toggle *is* the go for the whole `ready`
backlog — but `vetoed`, `parked`, an AI `objection`, and the relevance vet still hold individual
items back. It's a master switch over a still-gated backlog.

**What's the "spirit gate," concretely?** Before starting anything, the Flywheel reads
`docs/DECISIONS.md` — a short registry of resolved architectural tenets — and objects to any item
that contradicts one, citing the tenet. It reuses the existing objection mechanism, so an objected
item simply isn't picked up until you override it.

**What is `needs-handoff`?** A marker for refactors of the pipeline's own runtime code. Those get
driven by a human via `pan handoff` instead of the autonomous loop, because a bad autonomous
refactor of that code can red-line `main` and stall every merge. (Today it's an advisory signal
paired with an objection; it can be made a hard gate on request.)

**Will it change my code without me?** It opens PRs and gets them review-green and test-green, then
stops at the merge gate. **A human still UATs and merges** by default (`require_uat_before_merge` is
on). Nothing reaches `main` without your click.

**What stops it from breaking `main`?** Keeping `main` green is its top priority — a red CI result
is treated as a P0 it fixes first. Self-refactors are held for supervised handoff. And it drives
every action to a merged state or a follow-up, rather than leaving half-finished work.

**Does it ever ask me questions?** Only the two that are genuinely yours: UAT, and merge approval.
For everything else it picks a sensible default and keeps moving, surfacing open questions
non-blockingly rather than stalling.

**I don't use the Flywheel — does any of this affect me?** No. With Auto-pickup off (the default) it
only touches work you explicitly release, and it never operates outside the issues you own.
