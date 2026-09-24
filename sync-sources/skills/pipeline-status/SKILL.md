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
| MODEL | `/api/agents` `.model` for `agent-pan-NNN` | Which model the work agent is using |
| AGENT | `/api/agents` `.hasLiveTmuxSession` + `.paneState` | `✓` live pane that is `working`, `◐` live pane that is idle/blocked/done, `·` no live pane |
| STATE | `/api/issues/resource-allocated` `.state` | derived pipeline state: `backlog`, `parked`, `planned`, `working`, `in-review`, `changes-requested`, `ready`, `merged`, `closed`, or `·` if unknown |
| NEEDS | `pan show <id> --json` `.attention` (fetched only when STATE is `in-review`, `changes-requested`, or `ready`) | `needs-you`, `stuck`, `api-error`, or `·` |
| PR-REVIEW | `pan show <id> --json` `.pr.reviewState` (same fetch as NEEDS) | `approved`, `changes-requested`, `review-requested`, `commented`, `none`, or `·` if there's no PR |
| CHECKS | `pan show <id> --json` `.pr.checks` (same fetch) | `✓` green, `✗` red, `◐` pending, `·` no PR |
| MERGEABLE | `pan show <id> --json` `.pr.mergeable` (same fetch) | `✓` true, `✗` false, `·` unknown or no PR |

Always sort by priority: P0 hotfix → P1 bug → P2 enhancement → others. Within
each tier, sort by issue ID descending (newest first).

Show a separate **PLANNING** section beneath the in-flight table for any live
`planning-pan-NNN` agent — those are not yet on the kanban so they don't
appear via `/api/issues` filtering.

Agent liveness comes from `GET /api/agents`, which reads the host's terminal
backend (Herdr by default, tmux only under `terminal.backend: tmux`). Never
probe `tmux -L overdeck` directly: on a Herdr host it sees no agents. Despite
its name, `hasLiveTmuxSession` is true for any live pane on either backend.

The membership endpoint takes the **registered project key**, which is not
always the repo name (this repo is registered as `panopticon-cli`). The script
resolves it by matching the current git repository against
`pan project list --json` (by path, then by `github_repo`); it never
hardcodes a key.

## Steps

### 1. Generate the table

Run this script. It gets the row universe from `GET /api/pipeline/membership`,
then joins issue titles, derived state, and live agents as annotations. A
bare array is a successful answer. An HTTP 200 object with
`status: "unavailable"` is a typed blind spot; show its `projectKey`, `reason`,
and `message`, then stop instead of deriving membership from another source.
HTTP 503 means the first snapshot is still loading and may be retried later.

```bash
python3 - <<'PY'
import json, os, subprocess
from urllib.parse import quote

PR_STATES = {'in-review', 'changes-requested', 'ready'}

def git(*args):
    try:
        return subprocess.check_output(['git', *args], stderr=subprocess.DEVNULL).decode().strip()
    except Exception:
        return ''

def project_key():
    # The registered key, not the repo name. Match this repo (worktrees resolve
    # to their main checkout) against the registry, then fall back to origin.
    projects = json.loads(subprocess.check_output(['pan','project','list','--json']))
    common = git('rev-parse','--path-format=absolute','--git-common-dir')
    repo = os.path.realpath(os.path.dirname(common)) if common else ''
    for key, p in projects.items():
        if repo and os.path.realpath(os.path.expanduser(p.get('path',''))) == repo: return key
    origin = git('remote','get-url','origin').removesuffix('.git')
    for key, p in projects.items():
        if origin and p.get('github_repo') and origin.endswith('/' + p['github_repo']): return key
    raise SystemExit(f"No registered project matches {repo or os.getcwd()}; known keys: {', '.join(projects)}")

PROJECT = project_key()
print(f"project: {PROJECT}")
issues_data = json.loads(subprocess.check_output(['curl','-s','http://localhost:3011/api/issues']))
membership = json.loads(subprocess.check_output([
    'curl','-s',f'http://localhost:3011/api/pipeline/membership?project={quote(PROJECT)}'
]))
if isinstance(membership, dict) and 'error' in membership:
    raise SystemExit(f"PIPELINE MEMBERSHIP ERROR for project {PROJECT}: {membership['error']}")
if isinstance(membership, dict) and membership.get('status') == 'unavailable':
    raise SystemExit(
        'PIPELINE MEMBERSHIP UNAVAILABLE: '
        f"{membership.get('projectKey')} — {membership.get('reason')}: {membership.get('message')}"
    )
resource = json.loads(subprocess.check_output(['curl','-s','http://localhost:3011/api/issues/resource-allocated']))
state_by_id = {(r.get('issueId') or '').upper(): r.get('state') for r in resource}
# Backend-agnostic agent inventory (Herdr or tmux, whichever the host runs).
agents = {a['id']: a for a in json.loads(subprocess.check_output(['curl','-s','http://localhost:3011/api/agents']))}

issues_by_id = {(i.get('identifier') or '').upper(): i for i in issues_data}
panissues = []
for member in membership:
    if not member.get('inPipeline'): continue
    issue = dict(issues_by_id.get(member['issueId'].upper(), {
        'identifier': member['issueId'], 'title': '(missing tracker issue)', 'labels': []
    }))
    issue['pipelineBucket'] = member['bucket']
    panissues.append(issue)

def agent_cell(a):
    if not a or not a.get('hasLiveTmuxSession'): return '·'
    return '✓' if a.get('paneState') == 'working' else '◐'

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
    agent = agents.get(f"agent-{iid.lower()}")
    amodel = (agent or {}).get('model') or '-'
    title = i['title']
    if len(title) > W['title']: title = title[:W['title']-1] + '…'
    if len(amodel) > W['model']: amodel = amodel[:W['model']-1] + '…'
    review_cell = pr.get('reviewState') or '·'
    print(f"{iid:<{W['id']}}  {i['pipelineBucket']:<{W['bucket']}}  {title:<{W['title']}}  {amodel:<{W['model']}}  "
          f"{agent_cell(agent):<{W['agent']}}  {(state or '·'):<{W['state']}}  {attention:<{W['needs']}}  "
          f"{review_cell:<{W['review']}}  {checks_cell(pr):<{W['checks']}}  {mergeable_cell(pr)}")

print()
print("PLANNING SESSIONS (Opus drafting xBRIEFs)")
print('─' * 150)
for ps in sorted(n for n, a in agents.items() if n.startswith('planning-pan-') and a.get('hasLiveTmuxSession')):
    iid = 'PAN-' + ps.replace('planning-pan-','').upper()
    model = agents[ps].get('model') or '?'
    title = next((i['title'] for i in issues_data if (i.get('identifier','') or '').upper()==iid), '(unknown)')
    if len(title) > W['title']: title = title[:W['title']-1] + '…'
    print(f"{iid:<{W['id']}}  {title:<{W['title']}}  {model:<{W['model']}}  ◐ planning")

member_ids = {m['issueId'].upper() for m in membership if m.get('inPipeline') is True}
ready = [r for r in resource
         if (r.get('issueId') or '').upper() in member_ids and r.get('state') == 'ready']
print(f"\nAwaiting Merge: {len(ready)} issue(s) ready for human approval")
for r in ready:
    print(f"  → {r['issueId']}  {(r.get('title') or '')[:80]}")

print()
print("✓ done/passing  ◐ in-progress  ✗ failed/blocked  · pending/n-a")
print("Columns: AGENT (work agent alive) → STATE → NEEDS → PR-REVIEW → CHECKS → MERGEABLE (ready for merge)")
PY
```

### 2. Read the Awaiting Merge summary line

The step 1 script also prints an **Awaiting Merge** line: the count and list of
canonical pipeline members whose derived `state` is `ready`. Surface it
directly under the table.

### 3. (Optional) Defer to other status skills if user wants more detail

If the user wants MORE than the table — system health, RAM, CPU per agent,
specialist trees, etc. — invoke `pan-status` next. The pipeline-status table
is the headline; everything else is the appendix.

```
For deeper detail beyond the pipeline view:
  • pan status         — running agents overview + system health
  • pan resources      — RAM/swap by agent
  • pan-agent-activity — read each live agent's recent output
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
  `/api/issues`, derived state, and `/api/agents` only to annotate those
  members. If the dashboard is down, fall back to `pan status` text.
- This skill is **read-only**. It does not change agent state, merge anything,
  or write to the DB. Pure observation.
