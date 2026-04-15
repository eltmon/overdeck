---
name: all-up
audience: agent
description: >
  Run the Fix-All flywheel: pan-oversee EVERY PAN issue currently in In Progress
  and In Review simultaneously, drive each through the Panopticon pipeline to
  readyForMerge, fix every infrastructure bug encountered along the way (no
  bandaids), and surface merge-ready issues on the Awaiting Merge page. The user
  only intervenes to UAT and approve merges; you click merge via Playwright after
  the user signs off. Leaves `main` clean and pushed at the end of every run.
triggers:
  - /all-up
  - all up
  - fix all
  - run flywheel
  - oversee everything
  - mass oversee
---

# all-up — the Fix-All Flywheel

## Source documents

Before doing anything else, **read these in order**:

1. `docs/FLYWHEEL-STATE.md` (in `panopticon-cli`) — **the living state file**.
   Contains the current pipeline snapshot, cycling alerts, infrastructure gaps,
   and pattern ledger from the previous run. Read this FIRST — it tells you what
   was stuck last time and which issues were cycling.
2. `docs/FIX-ALL-PRD.md` (in `panopticon-cli`) — the PRD describing the flywheel,
   the goals, the roles, the "main always clean" mandate, and the acceptance
   criteria.
3. `docs/OPERATION-FIX-ALL.md` (in `panopticon-cli`) — the operational manual
   for pan-oversee at scale: phases, classification, bug log template, known
   recurring issues.
4. `CLAUDE.md` (in `panopticon-cli`) — the no-bandaid engineering philosophy.
   Every rule in there applies during this skill.

If any of those have been updated since the last run, the *new* versions win.

## Core principle

**This is a flywheel, not a loop.** Each revolution must permanently improve
the Panopticon orchestration substrate. If you finish a run having only
shepherded issues without committing fixes to Panopticon, the flywheel didn't
turn — it just spun.

## Urgency-first: the priority ladder

**Every decision in the flywheel — which issue to diagnose first, which bug to
fix first, which merge to surface first — is driven by urgency:**

| Tier | Criteria | Typical labels |
|------|----------|----------------|
| **P0 Hotfix** | PAN issue with `P0` label, or title contains "hotfix"/"emergency"/"critical" | `P0`, `critical` |
| **P1 Substrate bug** | PAN issue with `P1` or `bug` label | `P1`, `bug` |
| **P2 PAN feature** | Regular PAN issues (no priority label) | `enhancement` |
| **P3 Other projects** | MIN, AUR, KRUX, etc. | any |

Within each tier: **oldest-ready first** (FIFO).

Apply this ladder everywhere:
- Inventory triage order
- Which stuck agent to attend to first
- Which substrate fix to implement first
- Awaiting Merge sort order (already encoded in the page)
- Which planning agent question to answer first

A P0 hotfix must never wait behind a P2 enhancement or any non-PAN issue.
If a non-PAN issue is stalling the merge queue, fix the substrate that allows
the queue to stall, then let the non-PAN issue flow on its own.

## Hard rules (non-negotiable)

- **PANOPTICON (PAN) ISSUES ONLY.** This skill operates *exclusively* on PAN
  issues unless the user *explicitly* tells you otherwise in the same request.
  Do not touch MIN (Mind Your Now), AUR (Auricle), KRUX, or any other tracker.
  When inventorying, filter the issue list down to issues whose identifier
  starts with `PAN-` (case-insensitive). Other projects benefit from the
  substrate fixes you commit, but their issues are out of scope for the
  flywheel itself. If you find yourself about to oversee a non-PAN issue,
  STOP and re-filter.
- **`main` MUST ALWAYS BE CLEAN.** Every revolution ends with `main` in a
  known-good state: working tree clean, all commits pushed to `origin/main`,
  build current. See the "Main hygiene" section below — this is enforced at
  the start AND end of every run.
- **NEVER manually do agent work.** If an agent left work incomplete, fix the
  *system* that allowed it (review-agent prompt, verification gate, done flow),
  not the workspace files.
- **NEVER work around bugs.** If something is broken, find the root cause and
  fix it in Panopticon source. Commit each fix individually with conventional
  commit messages (`fix(dashboard):`, `fix(deacon):`, …). Rebuild and restart
  the dashboard after every fix. Verify visual fixes in Playwright with a
  screenshot.
- **BLOCKING BUGS MUST BE FIXED IN CODE — FILING IS NOT ENOUGH.** If a
  substrate bug is preventing an issue from progressing (e.g., Docker UAT
  containers not starting, label cleanup failing on closed issues, planning
  sessions restarting for In-Review issues), you MUST fix it in code during
  THIS run. File a PAN issue for tracking/posterity, but **the code fix comes
  first and happens immediately**. "I filed PAN-NNN for this" is NEVER an
  acceptable response to a blocking substrate bug. The flywheel's entire
  purpose is to fix these root causes — not collect them.
- **NEVER call deep-wipe** without explicit user approval.
- **NEVER click merge yourself** until the user has confirmed they have UATd
  the issue via the frontend link on the Awaiting Merge page.
- **Use Panopticon to validate Panopticon.** Don't hand-patch issue branches
  or push to main to "clear the board" — work flows through agents only.
- **Test through code.** Don't manually `gh issue edit` or `curl` API endpoints
  to fix data — fix the data pipeline.
- **Never use `--no-verify`** or skip hooks. If a hook fails, fix the issue.
- **Consult Panopticon docs BEFORE and AFTER every fix.** Before touching code,
  scan `docs/INDEX.md` and the relevant documents (`CLAUDE.md`, the matching
  PRD, architecture docs, the rule files in `.claude/rules/`) to understand
  what's already documented about the area and what the fix will invalidate
  or extend. After the fix lands, go back to those same documents and update
  them so they describe the new behavior — new flags, new endpoints, new
  invariants, removed assumptions, anything the next reader needs. Doc updates
  are part of the fix, not a follow-up; they ship in the same commit (or in a
  paired `docs:` commit pushed before the run ends). Stale docs are dirt.

## The flywheel — one revolution

### 0. Read FLYWHEEL-STATE.md (BEFORE main hygiene)

Open `docs/FLYWHEEL-STATE.md` and absorb:

- **Cycling Alerts**: Any issue listed here was stuck at the same phase with the
  same root cause last run. It is your FIRST diagnosis target this run — the
  previous fix didn't hold or the agent regressed. Treat it as a P1 substrate bug
  immediately, not after inventory.
- **Infrastructure Gaps**: Gaps you've been working around. If any are now
  addressable (a PR landed, a new API exists), fix them this run.
- **Pattern Ledger**: Known recurring signatures. When you see a symptom that
  matches a ledger entry, skip straight to the documented root cause instead of
  re-diagnosing from scratch.
- **Active Pipeline**: Prior snapshot of issue states. Use this to spot
  regressions — an issue that was further along last run and is now further back
  is a state-management bug.

If `docs/FLYWHEEL-STATE.md` does not exist yet, create it at the end of this run
(Step 7.5). Don't skip the file — it is the flywheel's memory.

### 0.1 Main hygiene check (BEFORE anything else)

Run from `panopticon-cli`:

```bash
git status
git log --oneline @{u}..HEAD   # local commits not yet pushed
git fetch origin && git status  # confirm up-to-date with origin/main
```

Required state before starting:

- On branch `main`.
- Working tree clean (`nothing to commit, working tree clean`).
- `Your branch is up to date with 'origin/main'`.

If `main` is dirty, **fix it before the flywheel starts**:

- Untracked files / unstaged edits left from a previous session → triage them
  (commit or stash with a tracked reason). If they look like agent leakage onto
  `main`, that's a substrate bug — file it.
- Local commits not pushed → push them.
- Branch behind origin → `git pull --ff-only`.

If `main` keeps being dirty *between* runs from the same source (e.g., a test
setup polyfill, a generated file in a tracked path, a config drift), **that's
a recurring-dirt bug**: fix it at the root (commit the polyfill, ignore the
generated path, move config to a real config layer) and file the fix in PAN.
Recurring dirt is a flywheel target, not background noise.

### 1. Inventory (priority-sorted)

- Hit the dashboard API for the full picture: agents, issues by canonical
  status, review statuses, tmux sessions, heartbeats.
- For each PAN issue in `In Progress` or `In Review`, classify it per
  `docs/OPERATION-FIX-ALL.md` Phase 1: healthy / ghost / stuck /
  pipeline-stalled / wrong-column / reverting.
- **Sort your work queue by the urgency ladder** (P0 → P1 → P2, oldest-first
  within each tier). Report this sorted list when acknowledging the run.
- Open `https://pan.localhost` in Playwright for visual confirmation of
  columns, badges, and inspector state.

### 2. Diagnose & fix substrate

For every issue NOT in the `healthy` bucket, trace the failure to its root
cause in Panopticon code. Examples (see `docs/OPERATION-FIX-ALL.md` § Known
Recurring Issues):

- Ghost agents → fix `recoverOrphanedAgents` in deacon
- Status reverts → fix race conditions in complete-planning / start-agent
- Specialist not waking → fix dispatch / wake logic
- Wrong column / wrong tag → fix label-sync code, not the labels themselves

**Cycle-detection check** — before diagnosing any bug, compare the issue's current
blocker to `FLYWHEEL-STATE.md` › Active Pipeline. If the issue was blocked at the
exact same phase for the same reason last run:

- That means the previous fix did not hold. Don't re-apply the same fix.
- Dig one level deeper: why did the fix revert? Was it not committed? Was it
  undone by a rebase? Was it the wrong layer?
- Update `FLYWHEEL-STATE.md` › Cycling Alerts immediately — increment Runs Stuck
  and note the regression source.

**Mid-run state review** — after every 3 substrate fixes (or when you feel like
you're going in circles), re-read `FLYWHEEL-STATE.md` and ask:
- Am I fixing the same bug I fixed last run under a different name?
- Is there an infrastructure gap I keep working around instead of closing?
- Have any cycling alerts been resolved (Runs Stuck → 0) or worsened (Runs Stuck
  keeps climbing)?

For each bug:

1. **Docs sweep — BEFORE the fix.** Open `docs/INDEX.md` and find every
   document touching the area you're about to change (architecture, the
   matching PRD, `CLAUDE.md`, `.claude/rules/`, the relevant route or
   service doc). Read them. Note any documented behavior, invariants, or
   rules that the fix will *change, invalidate, or extend*. If the bug
   you're hunting contradicts a documented invariant, the doc is part of
   the bug.
2. Read the relevant code path. Understand the full causal chain.
3. Implement the fix at the root cause.
4. **Docs sweep — AFTER the fix.** Update every document you flagged in
   step 1 so it describes the new behavior. New flags, new endpoints,
   removed assumptions, changed invariants — all of it. If the area had
   *no* doc and probably should, add one and link it from `docs/INDEX.md`.
   Doc updates ship in the same commit as the code fix (or in a paired
   `docs:` commit pushed before the run ends).
5. `npm run build` (rebuilds CLI + server + frontend).
6. Restart the dashboard via Node 22 (NEVER bun): see `CLAUDE.md` "Dashboard
   Server: Node 22 Only".
7. Commit with a conventional commit message. One commit per fix; do not
   batch. Include the doc updates from step 4.
8. **Push immediately** (`git push origin main`). Local-only commits are dirt.
9. Verify visually in Playwright — screenshot proof for any UI fix.
10. Resume any agent that was stuck by the now-fixed bug.
11. Append the bug to `docs/OPERATION-FIX-ALL.md`'s "Known Recurring Issues"
    section with the *fix that closed it* — this is how the flywheel
    self-learns. Commit and push that doc update too.

### 3. Drive each issue to readyForMerge

After substrate fixes, each issue should flow:

```
In Progress → work agent done → verification gate → review specialist →
test specialist → readyForMerge: true → appears on Awaiting Merge page
```

Monitor each issue all the way through. Anything that stalls is another bug to
fix per Step 2.

### 4. Hand off to the user via Awaiting Merge

When an issue reaches `readyForMerge: true`, it shows up on the dashboard
**Awaiting Merge** page (`/awaiting-merge`). For each ready issue, post a
short summary to the user:

- What changed (1 sentence per issue, what shipped).
- The frontend URL (so the user can click and UAT).
- "Ready for your UAT and merge approval."

### 5. Merge — but only after the user signs off

The user will UAT each issue via the Awaiting Merge page's frontend link.

When the user says "merge X" or "approved" for a specific issue:

- Use Playwright to navigate to `https://pan.localhost/awaiting-merge`.
- Click the **Merge** button on that issue's row.
- Verify the merge ran (review status flips to `merged`, issue moves to Done).
- If anything fails, that's another substrate bug — fix it per Step 2.

You do NOT auto-merge. You do NOT preemptively click merge based on
"the agent passed review." Humans own ship-or-don't-ship.

### 6. Repeat until empty

- New PAN issues land in `In Progress`? → flywheel picks them up.
- A merge fails? → that's a bug; fix substrate; resume.
- Substrate is bug-free for a whole revolution? → the flywheel is now
  spinning on its own; the only thing left is the user clicking merge and
  the AI summarizing what's ready.

### 7. Main hygiene check (AFTER everything)

Before you report the run complete, run the same checks as Step 0:

```bash
git status                       # must say: nothing to commit, working tree clean
git log --oneline @{u}..HEAD     # must be empty
git fetch origin && git status   # must say: up to date with 'origin/main'
```

If any of those show dirt, you are NOT done. Either commit + push, or surface
the dirt to the user with the recurring-dirt analysis. Reporting "all-up
complete" with `main` dirty is a violation of this skill.

### 8. Run synthesis (AFTER main hygiene, BEFORE FLYWHEEL-STATE update)

**Skill changes are never inline edits during `/all-up` — always file via synthesis.**

If you notice a skill that needs improvement during a flywheel run, do NOT edit
it directly. The autonomous retro-agent fires after every merge and feeds retro
reports into `docs/flywheel/retros/`. The synthesis step processes those retros
and files `flywheel-change` issues with the proposed diffs. This keeps the skill
improvement loop fully observable and reviewable.

**Retro-agent fires automatically on merge** — do NOT run retros manually during
`/all-up`. If you want to force a synthesis cycle (e.g., many retros have
accumulated), call:
```bash
pan flywheel synthesize
```

**Substrate-bug tiering rule:**
- **Blocker-tier** (a bug currently preventing an issue from progressing): fix it
  inline right now, per Step 2. Don't file a flywheel issue for something that's
  actively blocking the pipeline.
- **Non-blocker improvements** (substrate gaps, skill deficiencies, pattern
  improvements): file a `substrate-improvement` or `flywheel-change` issue and
  let the pipeline handle it. Never touch skill files directly during `/all-up`.

**What synthesis does (for context):**
1. Reads all unarchived retros in `docs/flywheel/retros/`
2. Filters to entries with `surprise: true`
3. Groups by signature (same target skill, same gap, same audience)
4. Above 3-signal threshold → files a `flywheel-change` PAN issue with proposed patch
5. Below threshold → watchlist entry in `docs/FLYWHEEL-REPORT.md`
6. Archives processed retros to `docs/flywheel/retros/archive/run-N/`
7. Appends a new section to `docs/FLYWHEEL-REPORT.md` (the append-only history)

This step runs automatically via the flywheel daemon after every merge event and
every 30 minutes while issues are in flight. You only call it manually if you
need a fresh synthesis mid-run.

### 7.5. Update FLYWHEEL-STATE.md (AFTER main hygiene, BEFORE declaring done)

Overwrite `docs/FLYWHEEL-STATE.md` with a fresh snapshot of current state. This is
the flywheel's memory — a future run will read this before doing anything else.

The file must contain all five sections:

**Active Pipeline** — one row per PAN issue currently in In Progress / In Review /
awaiting-merge. Columns: Issue, Phase, Root Cause/Blocker, Auto-Requeues, Runs Stuck,
Notes. Remove issues that merged/closed this run. Reset Runs Stuck to 0 for issues
that moved forward past their blocker.

**Cycling Alerts** — keep any alert where Runs Stuck ≥ 2. Add new alerts for issues
that were blocked at the same phase/reason as last run. Remove alerts for issues that
broke the cycle. For each alert write: the pattern, why it cycles, the candidate fix,
and current status.

**Infrastructure Gaps** — the accumulated table of missing capabilities. Mark gaps as
`Resolved (RunN)` when a fix lands. Add new gaps discovered this run. Never remove
rows — resolved rows are history.

**Pattern Ledger** — add any new recurring failure signature observed this run (with
root cause and the fix applied). Keep all prior rows. This ledger is a lookup table
for fast diagnosis.

**Skill Gaps** — desired automation or CLI capabilities the flywheel keeps wishing
existed. Add new entries; mark closed entries as resolved.

After writing the file:
```bash
git add docs/FLYWHEEL-STATE.md
git commit -m "docs(flywheel): update state snapshot after run N"
git push origin main
```

This commit must land before you report the run complete. A stale FLYWHEEL-STATE.md
is dirt — the next run will be less effective because of it.

## Done criteria for a single `/all-up` invocation

- Every PAN issue that started the run in `In Progress` / `In Review` is either
  on `Awaiting Merge` or recorded as legitimately blocked (with the blocker
  written *into the issue*, not just stated in chat).
- Every bug encountered during the run has a corresponding Panopticon commit
  that is **pushed to `origin/main`**.
- The Awaiting Merge page is the single source of truth for what's pending the
  user.
- A short flywheel report has been appended to `docs/OPERATION-FIX-ALL.md`:
  *N issues moved, M bugs fixed, K friction points removed*.
- `docs/FLYWHEEL-STATE.md` has been overwritten with a fresh snapshot and committed
  (Step 7.5 complete). A stale state file is a failed run.
- `main` is clean and pushed (Step 7 passes).

## Anti-patterns (do not do these — the user has called these out)

- Brushing past a Panopticon bug to keep moving (`feedback_pan_first_priority`).
- Manually `gh issue edit`-ing labels because the sync is broken
  (`feedback_test_through_code`).
- Telling the user to hard-refresh the browser (`feedback_no_hard_refresh`).
- Directly curling Panopticon APIs instead of using the dashboard / CLI
  (`feedback_no_manual_ops`).
- Auto-merging because "review and test passed" (`feedback_humans_only_merge`).
- Adding error handling / fallbacks that mask the bug instead of fixing it.
- Splitting one substrate fix into multiple issues
  (`feedback_issue_granularity`).
- Leaving `main` dirty "for now" because you'll come back to it.
- **Filing a blocking substrate bug as a PAN issue without also fixing it in
  code during the same run.** Filing is for tracking. Fixing is for unblocking.
  Both must happen. "I opened PAN-NNN" is never a sufficient response to a bug
  that is preventing an issue from progressing through the pipeline.

## Flywheel diagram

The flywheel has a canonical visual diagram saved at
`docs/diagrams/flywheel-diagram.excalidraw` in `panopticon-cli`. When
regenerating or updating the diagram (e.g. after adding new phases or
annotations), follow the Panopticon typography standard defined in
`design/style-guide/STYLE-GUIDE.md`:

| Element | Font | Excalidraw fontFamily |
|---------|------|-----------------------|
| Diagram title (e.g. "The Fix-All Flywheel…") | **Space Grotesk** | `9` (`"space grotesk"`) |
| Node labels, annotation callouts | Virgil (hand-drawn, default) | `1` |
| Code / technical strings | Cascadia | `3` |

**Space Grotesk (fontFamily=9)** is Panopticon's display font (geometric,
technical, tight apertures). It is registered as a custom font in the
`mcp_excalidraw` canvas frontend (`frontend/src/App.tsx` mutates
`FONT_FAMILY['Space Grotesk'] = 9` after import; `frontend/index.html` loads
it from Google Fonts). The `normalizeFontFamily` function in `dist/types.js`
maps the string `"space grotesk"` → `9`.

When creating diagram titles, always specify `fontFamily: 9` (or
`fontFamily: "space grotesk"`) on the title text element.

## When you're ready to start

Acknowledge the run by reporting the Step 0 main-hygiene result, the inventory
you found, and the first 1–3 substrate bugs you'll attack, then go. Keep the
user updated as merge-ready issues land on `/awaiting-merge`. End the run with
the Step 7 main-hygiene result.
