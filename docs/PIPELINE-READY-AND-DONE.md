# Pipeline Definitions — Definition of Ready & Definition of Done

> **Status: DRAFT.** Definition of Ready is **proposed for adoption**. Definition of
> Done is **open for discussion** — the section below is a starting point, not settled.
> Related: PAN-1966 (single membership resolver), PAN-1980 (work order).

## Why these two boundaries exist

The pipeline is an **exception queue**: an issue is "in the pipeline" iff its all-up
state is *not provably a clean terminal state*. Two boundaries define the queue's edges:

- **Definition of Ready (DoR)** — the *entry* boundary. When does a raw backlog issue
  become a deliberate, workable pipeline candidate? Without this, every open tracker
  issue floods the pipeline (observed: **609 "Todo" items** — the entire combined
  backlog across all trackers — drowning ~9 genuinely active issues).
- **Definition of Done (DoD)** — the *exit* boundary. When does an issue *truly* leave
  the pipeline (not just get marked closed)?

The key principle for both: **"open" and "closed" are not enough.** Readiness and
doneness are *deliberate states*, not the mere absence of activity.

---

## Definition of Ready (DoR) — PROPOSED

An issue is **Ready** when the operator has **deliberately signaled it is workable** —
the equivalent of explicitly moving a Linear issue into `Todo`. A freshly-filed `open`
issue is **not** Ready; readiness is an explicit human act ("Definition of Ready").

### The per-tracker signal

| Tracker | "Ready" signal |
| --- | --- |
| **Linear** (MIN-, AUR-) | issue is in the **`Todo`** workflow state (the deliberate "ready to work" column) |
| **GitHub** (PAN-, KRUX-) | issue carries the **`ready`** label *(recommended — see below)* |

### Why a GitHub **label**, not a state

GitHub Issues have only `open`/`closed` — there is **no native workflow sub-state** like
Linear's `Todo`. The options, and the call:

- **`ready` label (recommended).** Lowest-friction explicit signal (one click), trivially
  queryable (`gh issue list --label ready`), and it fits Overdeck's **existing
  label-driven phase model** — `planned`, `in-progress`, `in-review` are already labels,
  so `ready` is consistent with how the pipeline already reads phase.
- **GitHub Projects (v2) Status field** — more "native" (a single-value workflow column:
  Todo / In Progress / Done) and closest to Linear's model, but requires every issue to be
  added to a Project and GraphQL reads of project-item status. Heavier. *Defer as a richer
  v2 option; the `ready` label is v1.*
- **Milestone** — too coarse (release/sprint grouping, not per-issue readiness). Rejected.
- **Issue `state`** — only open/closed; cannot express "ready." Rejected.

**Decision (v1):** Ready = Linear `Todo` state **OR** GitHub `ready` label.

### Effect on the pipeline view

- **Ready** (open, DoR met, no work started yet) → shown in a distinct **Ready** lane:
  "queued and workable," visually separate from active in-flight work.
- **Backlog** (open, DoR *not* met, no work artifacts) → **hidden** from the pipeline.
  This is what removes the 609-item flood.
- An issue that already has work artifacts (branch / PR / running agent / review state) is
  in the active pipeline regardless of the DoR label — DoR governs only the *entry* of
  not-yet-started issues.

---

## Definition of Done (DoD) — DRAFT, FOR DISCUSSION

> Left open per operator. This is a **starting point**, not adopted.

**Proposed:** an issue is **Done** when it **no longer appears in the pipeline**, which
requires a **successful close-out** — *not merely a closed tracker issue*, but the full
teardown of every related resource:

- tracker issue closed,
- feature branch deleted (local **and** remote),
- workspace torn down,
- agent runtime + per-issue records cleared,
- current-phase labels synced/removed,
- review status cleared.

I.e. **Done = closed + close-out-complete + zero lingering resources.** A closed issue
with lingering resources (stale workspace, undeleted branch, drifted label) is **not yet
Done** — it is *close-out drift*, which the pipeline should still surface (an exception).

### Open questions for discussion

1. **Legacy issues** closed before close-out tooling existed — Done, or perpetual drift?
   (Need a grandfather rule, or a one-time backfill of the close-out record.)
2. Should **close-out-incomplete** be a visible pipeline bucket (drift), or a separate
   hygiene surface?
3. Is the **`closed-out` marker** (label / git record) the authoritative Done signal, or
   do we verify resource teardown directly each time?
4. How does Done interact with **epics / multi-PR issues** that legitimately have merged
   PRs *and* ongoing work?
