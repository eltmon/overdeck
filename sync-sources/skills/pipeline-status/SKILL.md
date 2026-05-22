---
name: pipeline-status
description: >
  Cross-room visual status board for every active issue moving through the
  Panopticon pipeline. One row per issue, one column per phase
  (agent → review → test → verify → merge → ready), with a checkmark or X in
  each cell. Designed to be readable from across the room while agents work
  autonomously. Surface this BEFORE the verbose pan-status / agent-status
  output whenever the user asks "where are we?" or wants a status overview.
triggers:
  - /pipeline-status
  - pipeline status
  - status board
  - issue status
  - kanban status
  - cross-room status
  - status snapshot
  - where are we
  - what's the pipeline doing
allowed-tools:
  - Bash
  - Read
---

# pipeline-status — Cross-Room Visual Status Board

## What this skill does

Produces a single dense table that shows every PAN issue currently in
`In Progress` or `In Review` (plus any active planning sessions), with one
column per workflow phase. The format is optimized for being readable across
a room: short rows, one-glyph cells, no fluff.

This is the **first thing** to show when the user asks for status. Anything
more detailed (`pan status`, `agent-status`) goes underneath.

## Output format

```
ISSUE      TITLE                                                  MODEL              AGENT  REVIEW  TEST  VERIFY  MERGE  READY
──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
PAN-1028   TTS: first speech utterance gets clipped (PipeWire)    kimi-k2.6          ✓      ·       ·     -       ·      ·
PAN-945    Planning artifact path mismatch                        gpt-5.4            ✓      ◐       ◐     ◐       ✓*     ·
PAN-1024   Lazy-load per-turn diff summaries (484 MB fix)         gpt-5.4            ✓      ·       ·     -       ·      ·

PLANNING (Opus drafting vBRIEFs)
PAN-1015   Remove claudish routing in favor of CLIProxy           claude-sonnet-4-6  ◐ planning

✓ done/passing  ◐ in-progress  ✗ failed/blocked  · pending/n-a
```

## Cell semantics

| Glyph | Meaning |
|-------|---------|
| `✓`   | done / passing / running healthily |
| `◐`   | in progress (reviewing, testing, queued, merging, verifying, pending) |
| `✗`   | failed / blocked |
| `·`   | pending or not applicable for this issue's current phase |
| `*`   | flag a stale value (e.g. `mergeStatus=merged` while DB drift exists, see PAN-1027) |

## Columns

| Column | Source | Meaning |
|--------|--------|---------|
| ISSUE | `/api/issues` `identifier` | PAN-NNNN |
| TITLE | `/api/issues` `title` | truncated to ~52 chars |
| MODEL | `~/.panopticon/agents/agent-pan-NNN/state.json` `.model` | Which model the work agent is using |
| AGENT | tmux + `state.json` `.status` | `✓` if agent tmux session is alive AND `status: running` |
| REVIEW | review-status DB `.review_status` | `passed`, `reviewing`, `failed`, `blocked`, `null` |
| TEST | review-status DB `.test_status` | `passed`, `testing`, `failed`, `null` |
| VERIFY | review-status DB `.verification_status` (lazy — only show if review passed) | `passed`, `running`, `failed`, `null` |
| MERGE | review-status DB `.merge_status` | `merged`, `merging`, `verifying`, `failed`, `null` |
| READY | review-status DB `.ready_for_merge` | `✓` if `readyForMerge=true`, else `·` |

Always sort by priority: P0 hotfix → P1 bug → P2 enhancement → others. Within
each tier, sort by issue ID descending (newest first).

Show a separate **PLANNING** section beneath the in-flight table for any
`planning-pan-NNN` tmux session — those are not yet on the kanban so they
don't appear via `/api/issues` filtering.

## Steps

### 1. Generate the table

Run this script. It hits the local dashboard API, the SQLite review-status DB,
and tmux + agent state files. No manual curl, no manual gh — single source
of truth is the dashboard's existing API surface.

```bash
python3 - <<'PY'
import json, subprocess, sqlite3, os
from pathlib import Path

PANO_DB = Path.home() / ".panopticon" / "panopticon.db"
AGENTS = Path.home() / ".panopticon" / "agents"

issues_data = json.loads(subprocess.check_output(['curl','-s','http://localhost:3011/api/issues']))
panissues = [i for i in issues_data
             if i.get('source')=='github' and i.get('sourceRepo')=='eltmon/panopticon-cli'
             and ((i.get('state','') or '').lower().replace(' ','_') in ('in_progress','in_review'))]

db = sqlite3.connect(PANO_DB)

def review_row(issue_id):
    r = db.execute(
        "SELECT review_status, test_status, verification_status, merge_status, ready_for_merge "
        "FROM review_status WHERE issue_id=?", (issue_id.upper(),)
    ).fetchone()
    return r if r else (None,)*5

def state_json(name):
    p = AGENTS / name / "state.json"
    if not p.exists(): return None
    try: return json.loads(p.read_text())
    except: return None

def has_session(name):
    try:
        subprocess.check_output(['tmux','-L','panopticon','has-session','-t',name],
                                stderr=subprocess.DEVNULL)
        return True
    except: return False

def cell(value):
    if value is None or value == '': return '·'
    v = str(value).lower()
    if v in ('passed','merged','running','done','true','1'): return '✓'
    if v in ('failed','blocked','error'): return '✗'
    if v in ('reviewing','testing','queued','merging','verifying','pending'): return '◐'
    return v[:3]

def tier(i):
    L = ','.join(i.get('labels',[])).lower()
    if 'p0' in L.split(','): return 0
    if 'bug' in L.split(',') or 'p1' in L.split(','): return 1
    return 2

panissues.sort(key=lambda i: (tier(i), -int(''.join(c for c in i['identifier'] if c.isdigit()) or 0)))

W = {'id':10,'title':52,'model':22,'agent':6,'review':7,'tests':6,'verify':7,'merge':7}
print()
print(f"{'ISSUE':<{W['id']}}  {'TITLE':<{W['title']}}  {'MODEL':<{W['model']}}  {'AGENT':<{W['agent']}}  {'REVIEW':<{W['review']}}  {'TEST':<{W['tests']}}  {'VERIFY':<{W['verify']}}  {'MERGE':<{W['merge']}}  {'READY'}")
print('─' * 130)
for i in panissues:
    iid = i['identifier']
    review,test,verify,merge,ready = review_row(iid)
    agent_alive = has_session(f"agent-{iid.lower()}")
    sj = state_json(f"agent-{iid.lower()}")
    astatus = (sj or {}).get('status','-')
    amodel = (sj or {}).get('model','-')
    title = i['title']
    if len(title) > W['title']: title = title[:W['title']-1] + '…'
    if len(amodel) > W['model']: amodel = amodel[:W['model']-1] + '…'
    agent_cell = '✓' if agent_alive and astatus=='running' else ('◐' if astatus=='running' else '·')
    verify_cell = '·' if (review != 'passed' and not merge) else cell(verify)
    print(f"{iid:<{W['id']}}  {title:<{W['title']}}  {amodel:<{W['model']}}  "
          f"{agent_cell:<{W['agent']}}  {cell(review):<{W['review']}}  {cell(test):<{W['tests']}}  "
          f"{verify_cell:<{W['verify']}}  {cell(merge):<{W['merge']}}  "
          f"{'✓' if ready else '·'}")

print()
print("PLANNING SESSIONS (Opus drafting vBRIEFs)")
print('─' * 130)
sessions = subprocess.check_output(['tmux','-L','panopticon','list-sessions','-F','#{session_name}']).decode().split('\n')
for ps in sorted(s for s in sessions if s.startswith('planning-pan-')):
    iid = 'PAN-' + ps.replace('planning-pan-','').upper()
    sj = state_json(ps)
    model = (sj or {}).get('model','?')
    title = next((i['title'] for i in issues_data if (i.get('identifier','') or '').upper()==iid), '(unknown)')
    if len(title) > W['title']: title = title[:W['title']-1] + '…'
    print(f"{iid:<{W['id']}}  {title:<{W['title']}}  {model:<{W['model']}}  ◐ planning")

print()
print("✓ done/passing  ◐ in-progress  ✗ failed/blocked  · pending/n-a")
print("Stages: AGENT (work agent alive) → REVIEW → TEST → VERIFY → MERGE → READY (Awaiting Merge)")
PY
```

### 2. Add an Awaiting Merge summary line

After the main table, count and list anything with `readyForMerge=true`:

```bash
curl -s http://localhost:3011/api/issues | python3 -c "
import json, sys
data = json.load(sys.stdin)
ready = [i for i in data
         if i.get('source')=='github' and i.get('sourceRepo')=='eltmon/panopticon-cli'
         and i.get('readyForMerge') is True
         and (i.get('mergeStatus') or '').lower() != 'merged']
print(f'\\nAwaiting Merge: {len(ready)} issue(s) ready for human approval')
for i in ready:
    print(f'  → {i[\"identifier\"]}  {i[\"title\"][:80]}')
"
```

### 3. (Optional) Defer to other status skills if user wants more detail

If the user wants MORE than the table — system health, RAM, CPU per agent,
specialist trees, etc. — invoke `pan-status` next. The pipeline-status table
is the headline; everything else is the appendix.

```
For deeper detail beyond the pipeline view:
  • pan status         — running agents overview + system health
  • pan resources      — RAM/swap by agent
  • agent-status       — per-tmux-session capture of recent output
```

## When to surface this

- User asks "what's running?", "where are we?", "show status", "status snapshot"
- After invoking `/pan-flywheel` to checkpoint progress
- After spawning new agents
- Before reporting completion of a flywheel run
- Whenever the user says "give me a visual" or "snapshot"

## When NOT to use this

- During an active long-running operation (e.g. mid-merge, mid-build) — the
  table reflects steady state and will mislead during transitions.
- For Mind Your Now (MIN-*), Auricle (AUR-*), Krux (KRUX-*) — this skill is
  Panopticon-specific. Other trackers have their own dashboards.

## Notes

- The table reads from `/api/issues` — works only when the dashboard is up on
  `localhost:3011`. If the dashboard is down, fall back to `pan status` text.
- A `*` after a value flags a known data-drift case (e.g. `mergeStatus=merged`
  surviving a PR revert per PAN-1027). Document the underlying issue inline so
  the reader knows why the cell can't be trusted.
- This skill is **read-only**. It does not change agent state, merge anything,
  or write to the DB. Pure observation.
