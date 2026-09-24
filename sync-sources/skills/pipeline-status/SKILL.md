---
name: pipeline-status
description: >
  Cross-room visual status board for every active issue moving through the
  Overdeck pipeline. One row per issue, one column per phase
  (agent → state → needs → PR review → checks → mergeable), with a checkmark
  or X in each cell. Designed to be readable from across the room while agents work
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

Produces a single dense table for every issue returned by the authoritative
pipeline-membership read door (plus active planning sessions), with one column
per workflow phase. This includes exception-queue drift such as `zombie_pr`
and `post_merge_limbo`, even when the tracker lags the PR.

This is the **first thing** to show when the user asks for status. Anything
more detailed (`pan status`, `agent-status`) goes underneath.

## Output format

```
ISSUE      BUCKET              TITLE                                      MODEL              AGENT  STATE               NEEDS       PR-REVIEW           CHECKS   MERGEABLE
────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
PAN-1028   in_flight           TTS: first speech utterance gets clipped   kimi-k2.6          ✓      working             ·           ·                   ·        ·
PAN-945    post_merge_limbo    Planning artifact path mismatch            gpt-5.4            ·      merged              ·           ·                   ·        ·
PAN-1024   zombie_pr           Lazy-load per-turn diff summaries          gpt-5.4            ·      changes-requested   needs-you   changes-requested   ✗        ·

PLANNING (Opus drafting xBRIEFs)
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

## Columns

| Column | Source | Meaning |
|--------|--------|---------|
| ISSUE | `/api/pipeline/membership` `issueId` | PAN-NNNN; the membership endpoint defines the row universe |
| BUCKET | `/api/pipeline/membership` `bucket` | `in_flight`, `zombie_pr`, `post_merge_limbo`, or `planned_backlog` |
| TITLE | `/api/issues` `title` | truncated to ~52 chars |
| MODEL | `~/.overdeck/agents/agent-pan-NNN/state.json` `.model` | Which model the work agent is using |
| AGENT | tmux + `state.json` `.status` | `✓` if agent tmux session is alive AND `status: running` |
| STATE | `/api/issues/resource-allocated` `.state` | derived pipeline state: `backlog`, `parked`, `planned`, `working`, `in-review`, `changes-requested`, `ready`, `merged`, `closed`, or `·` if unknown |
| NEEDS | `pan show <id> --json` `.attention` (fetched only when STATE is `in-review`, `changes-requested`, or `ready`) | `needs-you`, `stuck`, `api-error`, or `·` |
| PR-REVIEW | `pan show <id> --json` `.pr.reviewState` (same fetch as NEEDS) | `approved`, `changes-requested`, `review-requested`, `commented`, `none`, or `·` if there's no PR |
| CHECKS | `pan show <id> --json` `.pr.checks` (same fetch) | `✓` green, `✗` red, `◐` pending, `·` no PR |
| MERGEABLE | `pan show <id> --json` `.pr.mergeable` (same fetch) | `✓` true, `✗` false, `·` unknown or no PR |

Always sort by priority: P0 hotfix → P1 bug → P2 enhancement → others. Within
each tier, sort by issue ID descending (newest first).

Show a separate **PLANNING** section beneath the in-flight table for any
`planning-pan-NNN` tmux session — those are not yet on the kanban so they
don't appear via `/api/issues` filtering.

## Steps

### 1. Generate the table

Run this script. It gets the row universe from `GET /api/pipeline/membership`,
then joins issue titles, derived state, tmux, and agent state as annotations. A
bare array is a successful answer. An HTTP 200 object with
`status: "unavailable"` is a typed blind spot; show its `projectKey`, `reason`,
and `message`, then stop instead of deriving membership from another source.
HTTP 503 means the first snapshot is still loading and may be retried later.

```bash
python3 - <<'PY'
import json, subprocess
from pathlib import Path

AGENTS = Path.home() / ".overdeck" / "agents"
PR_STATES = {'in-review', 'changes-requested', 'ready'}

issues_data = json.loads(subprocess.check_output(['curl','-s','http://localhost:3011/api/issues']))
membership = json.loads(subprocess.check_output([
    'curl','-s','http://localhost:3011/api/pipeline/membership?project=overdeck'
]))
if isinstance(membership, dict) and membership.get('status') == 'unavailable':
    raise SystemExit(
        'PIPELINE MEMBERSHIP UNAVAILABLE: '
        f"{membership.get('projectKey')} — {membership.get('reason')}: {membership.get('message')}"
    )
resource = json.loads(subprocess.check_output(['curl','-s','http://localhost:3011/api/issues/resource-allocated']))
state_by_id = {(r.get('issueId') or '').upper(): r.get('state') for r in resource}

issues_by_id = {(i.get('identifier') or '').upper(): i for i in issues_data}
panissues = []
for member in membership:
    if not member.get('inPipeline'): continue
    issue = dict(issues_by_id.get(member['issueId'].upper(), {
        'identifier': member['issueId'], 'title': '(missing tracker issue)', 'labels': []
    }))
    issue['pipelineBucket'] = member['bucket']
    panissues.append(issue)

def state_json(name):
    p = AGENTS / name / "state.json"
    if not p.exists(): return None
    try: return json.loads(p.read_text())
    except: return None

def has_session(name):
    try:
        subprocess.check_output(['tmux','-L','overdeck','has-session','-t',name],
                                stderr=subprocess.DEVNULL)
        return True
    except: return False

def derived(issue_id):
    try:
        out = subprocess.check_output(['pan','show',issue_id,'--json'],
                                       stderr=subprocess.DEVNULL, timeout=60)
        return json.loads(out)
    except Exception:
        return None

def checks_cell(pr):
    c = pr.get('checks')
    if c == 'green': return '✓'
    if c == 'red': return '✗'
    if c == 'pending': return '◐'
    return '·'

def mergeable_cell(pr):
    m = pr.get('mergeable')
    if m is True: return '✓'
    if m is False: return '✗'
    return '·'

def tier(i):
    L = ','.join(i.get('labels',[])).lower()
    if 'p0' in L.split(','): return 0
    if 'bug' in L.split(',') or 'p1' in L.split(','): return 1
    return 2

panissues.sort(key=lambda i: (tier(i), -int(''.join(c for c in i['identifier'] if c.isdigit()) or 0)))

W = {'id':10,'bucket':18,'title':44,'model':22,'agent':6,'state':18,'needs':10,'review':18,'checks':7,'mergeable':10}
print()
print(f"{'ISSUE':<{W['id']}}  {'BUCKET':<{W['bucket']}}  {'TITLE':<{W['title']}}  {'MODEL':<{W['model']}}  {'AGENT':<{W['agent']}}  {'STATE':<{W['state']}}  {'NEEDS':<{W['needs']}}  {'PR-REVIEW':<{W['review']}}  {'CHECKS':<{W['checks']}}  {'MERGEABLE'}")
print('─' * 150)
for i in panissues:
    iid = i['identifier']
    state = state_by_id.get(iid)
    d = derived(iid) if state in PR_STATES else None
    pr = (d.get('pr') or {}) if d else {}
    attention = (d.get('attention') if d else None) or '·'
    agent_alive = has_session(f"agent-{iid.lower()}")
    sj = state_json(f"agent-{iid.lower()}")
    astatus = (sj or {}).get('status','-')
    amodel = (sj or {}).get('model','-')
    title = i['title']
    if len(title) > W['title']: title = title[:W['title']-1] + '…'
    if len(amodel) > W['model']: amodel = amodel[:W['model']-1] + '…'
    agent_cell = '✓' if agent_alive and astatus=='running' else ('◐' if astatus=='running' else '·')
    review_cell = pr.get('reviewState') or '·'
    print(f"{iid:<{W['id']}}  {i['pipelineBucket']:<{W['bucket']}}  {title:<{W['title']}}  {amodel:<{W['model']}}  "
          f"{agent_cell:<{W['agent']}}  {(state or '·'):<{W['state']}}  {attention:<{W['needs']}}  "
          f"{review_cell:<{W['review']}}  {checks_cell(pr):<{W['checks']}}  {mergeable_cell(pr)}")

print()
print("PLANNING SESSIONS (Opus drafting xBRIEFs)")
print('─' * 150)
sessions = subprocess.check_output(['tmux','-L','overdeck','list-sessions','-F','#{session_name}']).decode().split('\n')
for ps in sorted(s for s in sessions if s.startswith('planning-pan-')):
    iid = 'PAN-' + ps.replace('planning-pan-','').upper()
    sj = state_json(ps)
    model = (sj or {}).get('model','?')
    title = next((i['title'] for i in issues_data if (i.get('identifier','') or '').upper()==iid), '(unknown)')
    if len(title) > W['title']: title = title[:W['title']-1] + '…'
    print(f"{iid:<{W['id']}}  {title:<{W['title']}}  {model:<{W['model']}}  ◐ planning")

print()
print("✓ done/passing  ◐ in-progress  ✗ failed/blocked  · pending/n-a")
print("Columns: AGENT (work agent alive) → STATE → NEEDS → PR-REVIEW → CHECKS → MERGEABLE (ready for merge)")
PY
```

### 2. Add an Awaiting Merge summary line

After the main table, count and list canonical pipeline members whose derived
`state` is `ready`:

```bash
python3 -c "
import json, subprocess
resource = json.loads(subprocess.check_output(['curl','-s','http://localhost:3011/api/issues/resource-allocated']))
membership = json.loads(subprocess.check_output([
    'curl','-s','http://localhost:3011/api/pipeline/membership?project=overdeck'
]))
member_ids = {m['issueId'].upper() for m in membership if m.get('inPipeline') is True}
ready = [r for r in resource
         if (r.get('issueId') or '').upper() in member_ids
         and r.get('state') == 'ready']
print(f'\\nAwaiting Merge: {len(ready)} issue(s) ready for human approval')
for r in ready:
    print(f'  → {r[\"issueId\"]}  {r[\"title\"][:80]}')
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
  Overdeck-specific. Other trackers have their own dashboards.

## Notes

- The table's issue universe comes only from `/api/pipeline/membership`; it uses
  `/api/issues`, derived state, tmux, and agent files only to annotate those
  members. If the dashboard is down, fall back to `pan status` text.
- This skill is **read-only**. It does not change agent state, merge anything,
  or write to the DB. Pure observation.
