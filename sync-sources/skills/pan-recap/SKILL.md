---
name: pan-recap
description: >
  Executive recap of the most recent day's work (default last 24h) across the
  Overdeck pipeline — what shipped, what's still in flight, what needs the
  operator's attention, and the numbers — PLUS a separate, shareable user-facing
  PR-FAQ of what was released. EVERY issue is described in plain
  language (what it is / what it does), never a bare ID. Use when the user asks
  "what happened overnight / today / while I was away", "catch me up", "daily
  recap", "standup", "what did the flywheel do", or wants an up-leveled summary
  of recent activity.
triggers:
  - /pan-recap
  - what happened overnight
  - what happened today
  - what happened while I was away
  - while I was asleep
  - catch me up
  - daily recap
  - standup
  - recap
  - summary of recent work
  - what did the flywheel do
allowed-tools:
  - Bash
  - Read
---

# pan-recap — Executive Recap of Recent Work

## What this skill does

Produces a short, **executive-style** narrative of what happened across the
Overdeck pipeline over a recent window (default: last 24 hours). It is the
answer to "what happened while I was asleep?" — written for an operator who
wants the story and the decisions, not a log.

The output has two parts: (1) an **operator recap** that groups work by
**outcome** (shipped / in flight / needs attention), explains **every issue in
plain language**, and ends with a one-line scoreboard; and (2) a separate,
copy-pasteable **user-facing PR-FAQ** that announces only the user-visible
releases in benefit language — the thing you'd actually send to users.

## Output style — EXECUTIVE (read this first; it is the whole point)

This skill exists because a raw status dump — "PAN-2059 merged, PAN-2064 closed,
PAN-1919 in review" — is **useless to a human** who doesn't have every issue
number memorized. Up-level it.

**Hard rules:**

1. **No bare issue IDs, ever.** Every single issue reference carries a 5–12 word
   plain-language descriptor of what it *is* or *does*. Write
   "**PAN-2061** — `pan strike` skipped the git-worktree step so agents landed on
   main", never "PAN-2061 closed". If you cannot say what an issue does, look it
   up (`gh issue view`) before writing the line. This rule is non-negotiable; it
   is the reason the skill exists.
2. **Lead with a one-sentence TL;DR** that captures the arc of the window
   ("productive evening, then a 10h stall when the GLM quota ran out").
3. **Group by outcome, not by phase or issue number:** *What shipped* → *In
   flight* → *Needs your attention* → *By the numbers*. Drop empty sections.
4. **Define pipeline jargon inline** the first time it appears (strike, convoy,
   verifying-on-main, readyForMerge). The reader should never need a second doc.
5. **Bold the deliverable, then explain it.** Each bullet leads with the thing
   that happened in bold, followed by the plain-language what/why.
6. **Numbers live in one "By the numbers" line**, not sprinkled through prose.
7. **Link every issue ID as a markdown link** (per the repo issue-reference
   rule) — but the link is *in addition to* the descriptor, never instead of it.
8. **Call out incidents and decisions explicitly.** A stall, a red main, a
   quota exhaustion, an operator gate — these are the headline, not a footnote.

**Anti-pattern (do NOT do this):**
> Last 24h: PAN-2059 merged. PAN-2064, PAN-2061 closed. PAN-1919 in review.
> PAN-2063, PAN-1884, PAN-1084 planning. PAN-1722, PAN-1793, PAN-2045 strikes.

That is a list of IDs with no meaning. Rewrite it as the template below.

### Two audiences — operator recap AND a user-facing PR-FAQ

The executive recap is for the **operator** — it includes internal plumbing,
incidents, and decisions. But every recap ALSO produces a **user-facing
PR-FAQ**: a short, plain-language announcement of what *shipped to users*,
written the way you'd tell a customer — benefit first, no jargon, no internal
issue IDs in the prose.

- **PR-FAQ = "press release + FAQ."** A few sentences announcing the
  user-visible change(s), then 2–4 anticipated questions with answers.
- **Only user-facing work belongs in the PR-FAQ:** new features, UX or behavior
  changes, and bug fixes a user would actually notice. **Internal substrate** —
  pipeline reliability, CI fixes, deacon/orchestrator plumbing, refactors, test
  infra — stays in the operator recap and is **NOT** in the PR-FAQ.
- **If nothing user-facing shipped, say so honestly:** "No user-facing releases
  this window — all internal reliability work." Never dress up plumbing as a
  feature.
- **Voice:** second person, benefit-first ("You can now …"). Lead with what the
  user can do that they couldn't before, then why it matters. Keep issue links
  in a trailing reference line, never in the headline.

## Steps

### 0. Set the window

Default to 24h; honor an explicit window in the user's request ("last 8 hours",
"since Friday"). Compute both an ISO timestamp (for `gh`/JSON filters) and a
human label.

```bash
HOURS="${1:-24}"                      # override if the user names a window
SINCE_ISO="$(date -u -d "$HOURS hours ago" +%Y-%m-%dT%H:%M:%SZ)"
SINCE_DATE="$(date -u -d "$HOURS hours ago" +%Y-%m-%d)"
echo "Window: last $HOURS h  (since $SINCE_ISO)"
```

### 1. What shipped — merged PRs + closed issues in the window

Run from the project root so `gh` infers the repo. PRs are the cleanest "what
shipped" signal; closed issues catch strikes and close-outs that don't open a PR.

```bash
echo "=== merged PRs in window ==="
gh pr list --state merged --limit 50 \
  --json number,title,mergedAt,labels \
  --jq '[.[] | select(.mergedAt >= "'"$SINCE_ISO"'")] | sort_by(.mergedAt)
        | .[] | "\(.number)\t\(.mergedAt)\t\(.title)"'

echo "=== issues closed in window ==="
gh issue list --state closed --search "closed:>=$SINCE_DATE" --limit 50 \
  --json number,title,labels,closedAt \
  --jq 'sort_by(.closedAt) | .[] | "\(.number)\t\(.title)\t[\([.labels[].name]|join(","))]"'
```

Also scan real commits on `main` (drop the bookkeeping noise — `chore(records)`,
`chore(state)`, `chore(beads)` are per-issue state syncs, not work):

```bash
echo "=== substantive commits on origin/main ==="
git fetch -q origin main 2>/dev/null
git log origin/main --since="$HOURS hours ago" --no-merges \
  --pretty='%h %ad %s' --date=format:'%m-%d %H:%M' \
  | grep -vE 'chore\((records|state|beads)\)' | head -40
```

### 2. What's in flight — active agents and in-review work

```bash
echo "=== live agent / planning / strike sessions ==="
tmux -L overdeck list-sessions -F '#{session_name}' 2>/dev/null \
  | grep -E '^(agent|planning|strike)-' | sort

echo "=== in-review issues (need a merge decision) ==="
curl -s http://localhost:3011/api/issues 2>/dev/null | python3 -c "
import json,sys
try: data=json.load(sys.stdin)
except: sys.exit(0)
for i in data:
    st=(i.get('state','') or '').lower().replace(' ','_')
    if st in ('in_review','in_progress'):
        print(i.get('identifier'),'-',i.get('title','')[:70],
              '(readyForMerge)' if i.get('readyForMerge') else '')
" 2>/dev/null
```

### 3. Incidents & the flywheel headline

The headline metrics, plus a check for the two most common silent failures: a
red `main` and a stalled/erroring orchestrator.

```bash
echo "=== latest flywheel run headline ==="
LATEST=$(ls -dt ~/.overdeck/flywheel/runs/*/ 2>/dev/null | head -1)
[ -n "$LATEST" ] && python3 -c "
import json; d=json.load(open('$LATEST/latest.json'))
h=d.get('headline',{}); o=d.get('orchestrator',{})
print('run',d.get('runId'),'| orchestrator',o.get('harness'),o.get('model'),
      '| bugsFixed',h.get('bugsFixed'),'prsMerged',h.get('prsMerged'),
      'awaitingUat',h.get('awaitingUat'))
print('last snapshot age:', d.get('elapsedMs',0)//60000, 'min into run')
" 2>/dev/null

echo "=== main CI conclusion (red main = silent merge-gate killer) ==="
gh run list --branch main --workflow CI --limit 1 \
  --json conclusion,headSha,createdAt --jq '.[] | "\(.conclusion)  \(.headSha[0:9])  \(.createdAt)"'

echo "=== orchestrator alive & progressing? ==="
tmux -L overdeck capture-pane -t flywheel-orchestrator -p -S -15 2>/dev/null \
  | grep -oE 'rate_limit_error|Limit Exhausted|reset at [0-9: -]+|auto_retry_end' | tail -3 \
  || echo "(no orchestrator session)"
```

A frozen "Last tick" older than ~20 min, or repeated `rate_limit_error` /
`Limit Exhausted` in the orchestrator pane, is an **incident** — surface it as
the headline, with the provider/plan and reset time if shown.

### 4. Enrich EVERY issue with plain-language context (MANDATORY)

Collect every issue ID that will appear in the recap. For each one you don't
already understand, fetch its title and write a one-clause descriptor of what it
is / does. Never emit an ID you can't describe.

```bash
for n in <every issue number you will mention>; do
  printf 'PAN-%s\t' "$n"
  gh issue view "$n" --json title,state -q '.title + "  [" + .state + "]"'
done
```

Translate each title into operator English. Examples of the transform:
- `bug(strike): pan strike ... skips git worktree add — agent lands on main` →
  "**PAN-2061** — `pan strike` built a workspace but skipped the git-worktree
  step, so strike agents landed on `main` and self-aborted."
- `[EPIC] Backlog pickup gate — operator Plan→Release row + AI Objection` →
  "**PAN-2059** — lets the operator pull a backlog issue into the pipeline;
  first dashboard slice merged, AI 'objection' state still to come."

### 5. Compose the executive summary

Write it in the template below. Keep it skimmable — a busy operator should get
the whole picture in ~20 seconds. Omit any section that's empty.

### 6. Write the user-facing PR-FAQ

From the "what shipped" set, keep **only** the user-facing items (apply the
classification rule under *Two audiences* above — drop everything that's
internal substrate). For each survivor, write one benefit-first line in plain
user English. Then add a short **FAQ** of 2–4 questions a user would actually
ask ("Do I need to do anything?", "Where do I find it?", "Did the way X works
change?"). If the window shipped nothing user-facing, write the single honest
line and skip the FAQ — do not invent user value out of plumbing.

## Output template

```
## Executive recap — last <window>

**TL;DR:** <one sentence capturing the arc of the window — the win and the catch>

**What shipped (landed on main):**
- **<deliverable in bold>** — <plain-language what/why>. ([PAN-XXXX](url))
- **<reliability/bug fix>** — <what was broken, what it means>. ([PAN-XXXX](url))

**In flight (parked, not lost):**
- **In review:** <descriptor> ([PAN-XXXX](url))
- **Planning:** <descriptor>; <descriptor>; <descriptor>
- **Strikes (direct-to-main fixes):** <descriptor>; <descriptor>

**Needs your attention:**
- <incident / decision / gate, stated as a consequence, with the action implied>

**By the numbers:** <N bugs fixed> · <N merged> · <N in flight> · <cost/uptime/incident facts>. Main is <green/red>.
```

Then, as a separate, copy-pasteable block (an operator can share this verbatim
with users/stakeholders without editing):

```
---

## What's new — shareable (PR-FAQ)

*(when nothing user-facing shipped):*
No user-facing releases this window — the work was all behind-the-scenes reliability.

*(when there are user-facing releases):*
**<Headline: the user-visible capability, stated as a benefit>**

<1–3 sentences: what you can now do that you couldn't before, and why it helps.
Plain language, second person, no issue IDs in the prose.>

- **<Capability / visible fix>** — <benefit-first description>.
- **<Capability / visible fix>** — <benefit-first description>.

**FAQ**
- **<Anticipated question?>** <Answer.>
- **<Anticipated question?>** <Answer.>

*Shipped: [PAN-XXXX](url), [PAN-XXXX](url)*
```

### Example PR-FAQ (illustrative)

> **You can now pull backlog items into the pipeline yourself.**
>
> A new pickup control on each issue lets you move a backlog item straight into
> planning from the dashboard — no CLI, no waiting on the flywheel to choose it.
>
> - **Pi / GLM agent conversations are now viewable** — the conversation panel
>   used to render blank for non-Claude agents; it now shows their transcripts.
> - **Long transcripts no longer get cut off** — conversations over 10 MB used
>   to truncate in the live view; you now see the whole thing.
>
> **FAQ**
> - **Do I need to do anything?** No — it's live on next dashboard load.
> - **Where's the pickup control?** On each issue card and in the issue cockpit.
>
> *Shipped: [PAN-2059](url), [PAN-1827](url), [PAN-1850](url)*

## When to surface this

- "What happened overnight / today / while I was away / asleep?"
- "Catch me up", "give me a recap", "standup", "daily summary"
- "What did the flywheel do?" / start-of-day check-in after autonomous running
- After a long stretch where the operator was offline

## When NOT to use this

- For a *live* "where are we right now" snapshot, use `/pipeline-status` (the
  dense status board) — recap is about the recent *past*, not the current frame.
- For a single issue's deep history, use `pan show <id>` / the issue drawer.

## Notes

- **Read-only.** Gathers from `gh`, git, the dashboard API, flywheel run
  snapshots, and tmux. Changes nothing.
- The `/api/issues` and orchestrator-pane steps need the dashboard up on
  `localhost:3011` and a live `flywheel-orchestrator` session; both degrade
  gracefully (the recap just omits that slice if absent).
- Scope to the current project's tracker. For multi-project recaps, run the
  gather steps per repo and label each section with its project.
