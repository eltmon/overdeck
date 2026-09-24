---
name: pipeline-list
description: >
  List the issues in the Overdeck pipeline, grouped by phase
  (Ship · Review · Work · Plan) with their TITLES — the on-demand text form of
  what the dashboard shows. Two views: the default "resource" view mirrors the
  Command Deck project tree (issues with a live workspace/branch/agent/PR right
  now); `--phase` gives the "lifecycle" view that mirrors the Pipeline page
  (every issue by phase, including planned-but-not-started work). Use when the
  user asks "what's in the pipeline", "list the pipeline", "what are we working
  on", or wants the active issues by phase with names. For the dense per-issue
  status matrix use /pipeline-status; this is the grouped, titled list.
triggers:
  - /pipeline-list
  - what's in the pipeline
  - whats in the pipeline
  - list the pipeline
  - pipeline issues
  - pipeline by phase
  - active pipeline
  - what are we working on
allowed-tools:
  - Bash
  - Read
---

# pipeline-list — Pipeline issues grouped by phase, with titles

Two views of "the pipeline", because they answer different questions:

| View | Flag | Source | Answers |
|------|------|--------|---------|
| **Resource** (default) | *(none)* | `/api/issues/resource-allocated` | "What has a live **workspace / branch / agent / PR** right now?" — the operational set. Mirrors the **Command Deck project tree**. Detects ready-to-merge from the derived `state: ready`. |
| **Lifecycle** | `--phase` | `/api/issues` + derived `state` + `getPipelineIssuePhase` rule | "What is moving through the **lifecycle**, including **planned-but-not-started** work?" — the forward queue. Mirrors the **Pipeline page** (`/pipeline`). |

Both group by **Ship · Review · Work · Plan** and print `ISSUE-ID — title`.
The default (resource) view is usually what you want ("what's actually in
flight"); use `--phase` for planning/triage (it also surfaces the planned
backlog that has no workspace yet). `--all` additionally lists the
`Verifying` close-out queue (merged, awaiting human close-out — NOT active
work). Neither view includes the Todo backlog or closed/cancelled issues.

## Why the API, not the DOM

The dashboard Pipeline list is **virtualized** — a Playwright/DOM scrape sees
only the rows in the viewport (slow + silently incomplete), and titles
cross-reference other issue IDs ("deferred from PAN-1229"), polluting naive ID
extraction. Don't scrape. This skill makes **read-only HTTP calls** to the
dashboard read model (the same data those surfaces render).

## Run it

Dashboard must be up (normally `:3011`, falls back to `:3010`). This script IS
the skill:

```bash
python3 - "$@" <<'PY'
import json, sys, urllib.request
args = sys.argv[1:]
MODE_PHASE = "--phase" in args
SHOW_ALL = "--all" in args

def fetch(path):
    for port in (3011, 3010):
        try:
            with urllib.request.urlopen(f"http://localhost:{port}{path}", timeout=6) as r:
                return json.load(r)
        except Exception:
            continue
    return None

PHASES = [("ship", "🚢 Ship"), ("review", "👀 Review"), ("work", "🔨 Work"), ("plan", "📋 Plan")]
if SHOW_ALL:
    PHASES.append(("verifying", "✅ Verifying (awaiting close-out — NOT active pipeline)"))
buckets = {k: [] for k, _ in PHASES}

# Derived issue state → lane (PHASE_BY_DERIVED_STATE in
# src/dashboard/frontend/src/lib/pipeline-state.ts). backlog/parked are Todo.
LANE = {"planned": "plan", "working": "work", "in-review": "review",
        "changes-requested": "review", "ready": "ship", "merged": "ship", "closed": "ship"}
TODO_STATES = ("backlog", "parked")

if MODE_PHASE:
    # ── Lifecycle view: phase over ALL issues (mirrors the Pipeline page) ──
    issues = fetch("/api/issues")
    if issues is None:
        sys.exit("Dashboard API not reachable on :3011/:3010 — is `pan up` running?")
    # /api/issues carries no derived state; join it from the resource view.
    derived = {(r.get("issueId") or "").upper(): r.get("state")
               for r in (fetch("/api/issues/resource-allocated") or [])}
    def phase(it):
        cs = it.get("canonicalStatus") or it.get("state") or it.get("status")
        if cs in ("done", "closed", "completed", "cancelled", "canceled"):
            return None
        if cs == "verifying_on_main":
            return "verifying"
        pm = it.get("pipelineMembership") or {}
        if pm.get("available") is True and pm.get("bucket") == "post_merge_limbo":
            return "ship"
        st = derived.get((it.get("identifier") or "").upper())
        if st in LANE:
            return LANE[st]
        if st in TODO_STATES:
            return None
        if cs == "in_review":
            return "review"
        if cs == "in_progress":
            return "work"
        if it.get("hasPlan") is True or it.get("planningComplete") is True:
            return "plan"
        return None  # todo backlog
    for it in issues:
        p = phase(it)
        if p in buckets:
            buckets[p].append((it.get("identifier") or it.get("id") or "?", (it.get("title") or "").strip()))
    header = "Pipeline (lifecycle view — mirrors /pipeline)"
else:
    # ── Resource view (default): issues with live resources (mirrors the tree) ──
    ra = fetch("/api/issues/resource-allocated")
    if ra is None:
        sys.exit("Dashboard API not reachable on :3011/:3010 — is `pan up` running?")
    def phase(it):
        st = it.get("state")
        if st in LANE:
            return LANE[st]
        if st in TODO_STATES:
            return None
        # state is null (derivation failed): fall back to the display label.
        sl = (it.get("stateLabel") or "").lower()
        if "review" in sl:
            return "review"
        if "progress" in sl:
            return "work"
        if it.get("hasPlanning") or it.get("hasState"):
            return "plan"
        return "work"  # has resources, state unclear
    for it in ra:
        p = phase(it)
        if p in buckets:
            buckets[p].append((it.get("issueId") or "?", (it.get("title") or "").strip()))
    header = "Pipeline (resource view — mirrors the Command Deck tree)"

print(header)
total = 0
for key, label in PHASES:
    rows = sorted(buckets[key], key=lambda r: r[0])
    print(f"\n{label} ({len(rows)})")
    for ident, title in rows:
        print(f"  {ident} — {title[:90]}")
    if key != "verifying":
        total += len(rows)
active = " · ".join(f"{label.split(' ', 1)[1]} {len(buckets[k])}" for k, label in PHASES if k != "verifying")
print(f"\n———\n{total} issues in the pipeline ({active})")
PY
```

## Notes

- **Resource view** is backed by the resource-discovery service
  (`src/dashboard/server/services/resource-discovery.ts`), which includes an
  issue when it has ≥1 `resourceSource` (workspace, branch, tmux, docker, pr,
  xBRIEF plan, task state, or active tracker state) and carries the derived
  `state` (PAN-3917 FR-6: computed from the tracker, the PR, checks, the branch,
  and the terminal backend) plus `stateLabel`. Same data the Command Deck
  `fetchProjects()` consumes. Lanes follow `PHASE_BY_DERIVED_STATE`; the
  `stateLabel` heuristics apply only when `state` is `null`.
- **Lifecycle view** ports `getPipelineIssuePhase`
  (`src/dashboard/frontend/src/lib/pipeline-state.ts`). `/api/issues` carries no
  derived state, so the script joins `state` from `/api/issues/resource-allocated`;
  issues with no resources fall back to tracker state and planning flags.
  Post-merge limbo (`pipelineMembership.bucket`) goes to Ship first, as on the
  Pipeline page.
- **Long-term:** the clean fix is a first-class pipeline CLI verb / a
  `/api/issues/pipeline` endpoint that returns the derived state for every issue
  so the dashboard, CLI, and this skill share one implementation. Point this
  skill at it when it exists.
- If `getPipelineIssuePhase` or the resource-discovery fields change, update
  this skill in the same commit (no automated cross-check, unlike `pan-<verb>`
  wrappers).
- Dashboard down? The script exits with a clear message — fall back to
  `pan status` / `pan issues`.
```
