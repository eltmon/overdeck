# PRD: Fix-All Flywheel

> Companion to [`OPERATION-FIX-ALL.md`](./OPERATION-FIX-ALL.md). That doc is the
> *manual* of the operation. This PRD describes the *flywheel* — the continuous,
> self-improving motion the operation creates when run as standing practice instead
> of a one-time sweep.
>
> **Scope: Panopticon (PAN) issues only.** Other trackers (MIN, AUR, KRUX, …) are
> out of scope unless the user explicitly opts them in for a single run.

## TL;DR

Run `pan-oversee` over **every** issue currently in `In Progress` and `In Review`,
**simultaneously**. Let Panopticon drive each issue all the way through the pipeline
to merge-ready. The only place a human is needed is the merge click — and even
that gets a dedicated **Awaiting Merge** page so it takes seconds. Every bug found
along the way is fixed in the orchestration layer **before** the operation moves on.

This is not a loop. **It is a flywheel.** Each turn fixes the orchestration, which
makes the next turn easier, which surfaces deeper bugs, which fixes more
orchestration, which… The loop's *energy comes from the work it produces*.

## Why a flywheel, not a loop

A loop runs the same task repeatedly with the same inputs.

A flywheel **gets easier and faster every revolution**, because each revolution
*permanently improves the substrate it runs on*. Fix-All targets the orchestration
layer itself: every bug we hit while shepherding issues becomes a code fix in
Panopticon, which means the *next* run hits fewer bugs, which means agents need
less babysitting, which means more issues clear per hour, which means we hit
deeper bugs faster, which means…

The user's only manual interaction — clicking merge — is also the input that
validates the entire pipeline ran end-to-end. Every successful merge is a vote
that the orchestration substrate is healthy. Every failure is a vote for the next
fix.

## Goals

1. **Zero idle issues.** Every issue in `In Progress` or `In Review` must be
   actively flowing through the pipeline at all times. Stalls are bugs.
2. **Human input minimized to the merge gate.** Anywhere else a human is needed
   is a bug to be fixed. The merge gate stays human because humans must own
   what ships.
3. **Self-improving substrate.** Every bug encountered during the operation gets
   fixed in Panopticon code (not worked around). The act of running Fix-All
   produces the upgrades that make the next Fix-All run cheaper.
4. **Visible merge queue.** Users see a single page listing every issue that has
   reached merge-ready, with one-click access to UAT and to merge.
5. **Urgency-first everywhere.** The entire flywheel — inventory, diagnosis,
   substrate fixes, merge queue — operates in priority order:
   P0 hotfixes → P1 core PAN substrate bugs → P2 PAN features → P3 other projects.
   Within each tier, oldest-ready first. Critical Panopticon infrastructure
   issues must never wait behind low-priority enhancements or non-PAN work.

## Non-goals

- Babysitting agents through the pipeline by hand. If an agent is stuck, the
  *substrate* is broken; fix the substrate.
- Working around bugs to "clear the board." A green board built on workarounds
  is a regression, not a release.
- Touching MIN/AUR issues — Fix-All targets PAN issues only. Other projects ride
  the same upgraded substrate as a side benefit.

## The Flywheel Loop

```
            ┌───────────────────────────────────────────┐
            │                                           │
            ▼                                           │
   ┌─────────────────┐   bug found  ┌──────────────────┐│
   │ pan-oversee ALL │─────────────▶│ Fix orchestration││
   │ active issues   │              │ in Panopticon    ││
   └────────┬────────┘              │ code (commit +   ││
            │                       │ rebuild + verify)││
            │ no bugs               └────────┬─────────┘│
            ▼                                │          │
   ┌─────────────────┐                       │          │
   │ Pipeline runs   │◀──────────────────────┘          │
   │ to readyForMerge│                                  │
   └────────┬────────┘                                  │
            │                                           │
            ▼                                           │
   ┌─────────────────┐                                  │
   │ Awaiting Merge  │                                  │
   │ page surfaces   │                                  │
   │ issue           │                                  │
   └────────┬────────┘                                  │
            │                                           │
            ▼                                           │
   ┌─────────────────┐                                  │
   │ Human UATs via  │                                  │
   │ frontend link   │                                  │
   └────────┬────────┘                                  │
            │                                           │
            ▼                                           │
   ┌─────────────────┐    Substrate is now better;      │
   │ Human clicks    │    flywheel spins faster on      │
   │ MERGE           │    the next issue.               │
   └────────┬────────┘                                  │
            │                                           │
            └───────────────────────────────────────────┘
```

## Roles

| Actor          | Responsibility                                                      |
|----------------|----------------------------------------------------------------------|
| Claude (AI)    | Runs `pan-oversee` over all active issues. Investigates and **fixes in code** every bug encountered. Drives Playwright to click merge **only** after the user has UATd. |
| User           | UATs each merge-ready issue via the `Awaiting Merge` page's frontend link, then signals approval. |
| Panopticon     | The orchestration substrate. Spawns work / review / test specialists, runs verification gates, advances issues from `In Progress` → `In Review` → `readyForMerge`. |
| Awaiting Merge | A single dashboard page listing every `readyForMerge` issue with: issue title, frontend URL, merge button. |

## Required Surface: `Awaiting Merge` page

A new top-level dashboard tab. Behavior:

- **Lists** every issue where `reviewStatusByIssueId[id].readyForMerge === true`
  and `mergeStatus !== 'merged'`.
- For each row:
  - Issue identifier and title
  - **Open Frontend** link → the workspace's `frontendUrl` (so the user can UAT)
  - **Merge** button → POSTs to `/api/issues/:id/merge`
  - Last review-status timestamp
- **Empty state**: "Nothing awaiting merge. The flywheel is idling — kick off
  more work or run `/all-up`."
- **No polling** — uses the existing event-sourced Zustand store
  (`reviewStatusByIssueId`).
- **Order**: oldest-ready first (FIFO — don't let issues age in the queue).

## Required Surface: `/all-up` skill

A skill that, when invoked, kicks off the flywheel:

1. Inventories all PAN issues in `In Progress` + `In Review`.
2. For each, runs the `pan-oversee` discipline: monitor, diagnose stalls,
   classify by failure mode (ghost / stuck / pipeline-stalled / wrong-column /
   reverting), per `OPERATION-FIX-ALL.md` Phase 1.
3. **For every infrastructure bug found**, follows the no-bandaid rule: read
   the code, find the root cause, fix in Panopticon source, commit, rebuild,
   restart dashboard, verify the fix in Playwright.
4. Continues until every issue has reached `readyForMerge: true` and shown up
   on the `Awaiting Merge` page.
5. After UAT signal from the user, drives Playwright to click the merge button
   on each row.

## Docs are part of every fix

Every substrate fix in a flywheel revolution must be **bracketed by a docs
sweep**:

- **Before the fix:** scan `docs/INDEX.md` and the documents covering the
  area you're about to change (architecture, the matching PRD, `CLAUDE.md`,
  `.claude/rules/`, route/service docs). Note anything the fix will change,
  invalidate, or extend. If a documented invariant *is* the bug, the doc is
  part of the fix.
- **After the fix:** go back to those same documents and update them to
  describe the new behavior — new flags, new endpoints, removed assumptions,
  changed invariants. If the area had no doc and probably should, add one
  and link it from `docs/INDEX.md`.

Doc updates ship in the same commit as the code fix (or in a paired `docs:`
commit pushed before the revolution ends). Stale documentation is dirt; the
flywheel must leave docs cleaner than it found them, every time.

## Main must always be clean

The flywheel only works if `main` is the boring source of truth. Every revolution
ends with `main` in a known-good state:

- **Working tree clean.** No straggler files, no half-applied edits, no untracked
  artifacts. `git status` says `nothing to commit, working tree clean`.
- **All commits pushed.** `git status` shows `Your branch is up to date with
  'origin/main'`. Local-only commits are dirt.
- **Build is current.** `npm run build` succeeds against the committed tree, and
  the running dashboard reflects the committed code (rebuild + restart after
  every fix, per `CLAUDE.md`).

If `main` keeps going dirty between revolutions, that *itself* is a flywheel
target. Recurring sources of dirt must be diagnosed and fixed at the root, not
swept under the rug each run. Common offenders to watch for:

- Test setup polyfills added ad hoc and never committed → commit them, or fix
  the underlying jsdom/test gap they were patching.
- Local config drift in tracked files → move to a real config layer or
  `.gitignore`.
- Generated artifacts being written into tracked paths → fix the build to write
  to `dist/` or another ignored path.
- Workspace / agent leakage onto `main` (files only an agent should be touching)
  → fix the workspace boundary or the merge flow that should have absorbed them.

When you find a recurring dirt source, **file it as a Panopticon bug and fix it**
during the same revolution. The flywheel must leave `main` cleaner than it found
it, every time.

## Self-Learning: how the flywheel improves itself

Each Fix-All run produces three artifacts that compound across runs:

1. **Code commits** to Panopticon that close root-cause bugs (the substrate
   gets better).
2. **A bug log** appended to `OPERATION-FIX-ALL.md` under "Known Recurring
   Issues" — failure modes that are now fixed *and the fix that closed them*,
   so future runs recognize the family fast.
3. **Reduced human-touch points** — anywhere the AI had to ask the user a
   question that wasn't "can I merge?" becomes a tracked issue to remove that
   touchpoint in code.

After enough revolutions, the flywheel runs itself: the AI starts a session,
sees nothing to fix, and the user only sees issues land on `Awaiting Merge`.
At that point the flywheel's *output* is no longer "fewer Panopticon bugs" —
it's "more shipped features per day, per human-second of attention."

## Acceptance Criteria

- [ ] `Awaiting Merge` page exists, lives in the sidebar, lists every
      `readyForMerge` issue with frontend link + merge button.
- [ ] `/all-up` skill exists at `~/.claude/skills/all-up/SKILL.md` and references
      this PRD + `OPERATION-FIX-ALL.md`.
- [ ] When invoked, `/all-up` follows the flywheel loop above end-to-end without
      bypassing the pipeline.
- [ ] Every bug encountered during a `/all-up` run has a corresponding commit
      in Panopticon.
- [ ] Manual user input is required only for: UAT verification + merge approval.
- [ ] After every revolution, `main` is clean: working tree empty, all commits
      pushed to `origin/main`, build current.

## Exit Criteria for a Single Run

A `/all-up` run is "done" when:

1. Every PAN issue that started in `In Progress`/`In Review` has reached
   `readyForMerge: true` **or** is legitimately blocked with the blocker
   recorded in the issue (not in chat).
2. Every infrastructure bug encountered has been fixed in code and verified.
3. The `Awaiting Merge` page reflects the current ready set, and any
   user-approved rows have been merged.
4. A short flywheel report is appended to `OPERATION-FIX-ALL.md`'s log:
   *issues moved, bugs fixed, friction points eliminated*.
5. `main` is clean and pushed (`git status` reports no changes; HEAD matches
   `origin/main`). If anything is left uncommitted, it's either committed,
   stashed with a tracked reason, or recorded as a known recurring-dirt bug
   to fix on the next revolution.

## Why this matters

Panopticon's whole thesis is autonomous correctness with humans only at
ship-or-don't-ship gates. Fix-All is the discipline that *forces* that thesis
to be true. The flywheel is what makes the discipline cheap enough to run
every day.
