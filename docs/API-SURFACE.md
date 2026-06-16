# Panopticon API Surface — Map & Overlap Audit

**Authored 2026-06-16.** First-ever inventory of the API surface, organized by **activity** (not by
route module) to expose where the *same thing is reachable through multiple doors*. This is the
evidence base for the **source-of-truth API** consolidation (see the companion design issue, wired into
the state-model epic #1919).

> **Why this exists:** there was no API reference anywhere in the repo (`api-reference/` is empty, no
> `docs/API*.md`). The 280+ endpoints existed only as inline `// ─── Route: ───` comment headers. An AI
> or the dashboard asking "what's the state of issue X?" can hit **five different endpoints**, each
> reading from a different store (SQLite / filesystem / GitHub) with no shared resolver. That is the
> multi-place-for-one-thing problem, baked into the HTTP surface.

## Three surfaces

1. **HTTP REST `/api/*`** — **280** endpoints (Route: convention) across **21** modules; ~18 more route
   modules add endpoints via other patterns (`terminals`, `webhooks`, `hooks`, `tts`, `voice`,
   `flywheel`, `discovered-sessions`, `artifacts`, `context`, `feature-registry`, `reviewer-tree`,
   `agent-permissions`, `dashboard-auth`, `origin-validation`, `palette`, `autopreso`, `jsonl-resolver`,
   `http-handler`). **Real surface > 300.**
2. **RPC over WebSocket `/ws/rpc`** (`PanRpcGroup`) — `getSnapshot`, `subscribeDomainEvents`,
   `subscribeIssueEvents`, `replayEvents`, `getWorkspaceDetail`, `readWorkspaceFile`, terminal\* — the
   dashboard frontend's real-time read/stream surface.
3. **CLI `pan <verb>`** — a third door performing many of the same operations (`pan start`, `pan show`,
   `pan plan`, `pan pause`, …).

## Per-module endpoint counts (HTTP, Route: convention)

| Module | # | Module | # | Module | # |
|---|---|---|---|---|---|
| agents | 35 | misc | 35 | specialists | 31 |
| workspaces | 31 | conversations | 27 | issues | 24 |
| settings | 16 | costs | 13 | resources | 11 |
| cloister | 10 | remote | 9 | metrics | 8 |
| command-deck | 7 | diffs | 5 | projects | 4 |
| codex-auth | 3 | prereqs | 3 | show | 3 |
| events | 2 | palette | 2 | admin | 1 |

---

## Organized by ACTIVITY — and where it's duplicated

### 🔴 A. "What is the state of issue X?" — **the canonical-state read, scattered across 8+ doors**
This is the core problem. All of these answer "state of an issue," each assembling from a different store:
- `GET /api/issues` (board list — DB read-model)
- `GET /api/show/:issueId` (god-view aggregate)
- `GET /api/command-deck/activity/:issueId`
- `GET /api/issues/:id/planning-state`
- `GET /api/review/:issueId/status` (verdicts — `review_status` table)
- `GET /api/specialists/:project/:issueId/:type/status` (per-role status — legacy)
- `GET /api/metrics/summary`, `GET /api/godview/system-health`, `GET /api/system/health`
- RPC `getSnapshot`, `subscribeIssueEvents`

**No single resolver.** Each reads DB / filesystem (`.pan/`) / GitHub independently → they can disagree.

### 🔴 B. Agent state & control — **THREE parallel surfaces**
- `agents.ts` (35) — modern: `pause/resume/stop/restart/suspend/switch-model/message/tell/runtime/output/recover/untroubled` …
- `specialists.ts` (31) — **legacy** model of the same role-agents: `wake/reset/init/report-status/done/spawn/complete/grace/runs/terminate` …
- `remote.ts` (9) — fly.io remote agents: `start/stop/tell/output` …

A "role agent" is represented in **both** `agents` and `specialists`. Three doors, overlapping concepts.

### 🔴 C. Review & verdicts — **split across `workspaces` and `specialists`**
- `workspaces.ts`: `GET/POST /api/review/:id/status`, `/request`, `/trigger`, `/abort`, `/reset`, `DELETE /pending`
- `specialists.ts`: `POST /done`, `/report-status`, `/review/restart`, `/reviewer/:role/restart`

Verdicts (the one piece of state with no durable home — see #1922) are written **and** read through two unrelated modules.

### 🔴 D. Issue lifecycle (mutations) — **split between `issues` and `workspaces`**
- `issues.ts`: `start-planning, complete-planning, abort, reset, cancel, reopen, move-status, close-out, deep-wipe, restart-from-plan, generate-tasks`
- `workspaces.ts`: **`start`** (!), `approve, merge, forge-approve, forge-merge, sync-main, unstick`

"Start an issue" lives in `workspaces.ts`; "close it" lives in `issues.ts`. The lifecycle verbs are split across two modules by accident of history.

### 🔴 E. Planning — **three modules**
- `issues.ts`: `start-planning, complete-planning, abort-planning, planning-state`
- `command-deck.ts`: `planning/:id`, `/init`, `/status-review`, `/upload`, `/sync-discussions`
- `misc.ts`: `DELETE /api/planning/:id`, `/api/planning/:id/status`, `/api/planning/:id/message`

### 🔴 F. Cost — **five modules**
`costs.ts` (13) · `GET /api/agents/:id/cost` · `GET /api/metrics/costs` · `GET /api/issues/:id/costs` · `GET /api/specialists/:name/cost`. (And see PAN-1935 — pi/kimi spend isn't even captured.)

### 🟡 G. Health/liveness — `misc` (`/api/health/agents`, `/api/system/health`, `/api/godview/system-health`), `show` (`/:id/health`), `agents` (`health-history`, `cloister-health`, `tmux-alive`, `has-session`), `cloister` (`agents/health`), `metrics` (`stuck`).

### 🟢 H. Cohesive (single-home, fine as-is)
- **Conversations** — `conversations.ts` (27)
- **Diffs** — `diffs.ts` (5) + `conversations/:name/diffs*`
- **Orchestrator control** — `cloister.ts` (10) + `misc` deacon endpoints
- **Infra/Docker** — `resources.ts` (11)
- **Settings/auth** — `settings.ts` (16), `codex-auth.ts` (3), `prereqs.ts` (3)
- **Merge/ship** — `workspaces` (`merge`, `forge-merge`, `auto-merge`, `merge-queue`)

---

## The pattern

Modules are organized by **historical accident**, not by activity. The high-traffic activities an
orchestrating AI cares about — *read canonical state, control an agent, read/write a verdict, advance an
issue* — are each smeared across 2–5 modules, and the **reads have no shared resolver**, so they pull
from DB / `.pan/` / GitHub inconsistently. This is the API-layer twin of the in-DB and filesystem-vs-DB
duplication.

## The write side — even worse than reads

Reads are scattered; writes are **uncontrolled**. Approximate write-path call-site counts (`git grep`):

| Canonical state | Written from | Store |
|---|---|---|
| Verdicts (`review_status`) | **21 sites** | DB |
| Event log (`events`) | **27 sites** | DB |
| GitHub issue status / labels — written **directly** | **19 sites** | GitHub |
| Agent runtime (`agents` table) | 5 sites | DB |
| `state.json` (harness/model/status) | ~50 files touch it | filesystem |
| `.pan/` (continue / record / spec / statusOverrides) | ~36 files touch it | git/filesystem |

There is **no single writer**. The same fact is written from dozens of call sites, to multiple stores,
with nothing enforcing consistency — so the stores drift, race, and corrupt. This is the root cause of
the recurring state/pipeline bugs: stale state, agents disagreeing, the "half-files/half-DB" problem,
recovery breaking. (#1921 is meant to be the single write surface; it is not built yet.)

## End state — the target architecture (the whole point)

```
        SOURCES OF TRUTH   (durable · travel with the repo · survive a DB wipe)
  GitHub (issue/PR status) · git .pan/records (plans, decisions, verdicts) · JSONL · tmux
                          │  ▲
                  ONE sync layer   (reconstruction #1920 hydrates ▼ ;  writer mirrors ▲ to git)
                          ▼  │
              ┌─────────────────────────────────┐
              │   SQLite DB  —  the ONE surface   │    (a cache; rebuildable from sources)
              └─────────────────────────────────┘
                   ▲                         ▲
            ONE read door             ONE write door
       state-resolver /api/state    record writer / write-surface
              (#1936)                       (#1921)
                   ▲                         ▲
      ┌────────────┴───────────┬─────────────┴────────────┐
    AIs / agents        dashboard frontend             the CLI
       └──── all go through the two doors; NOTHING touches DB/fs/GitHub directly ────┘
```

**The five rules that make it true:**
1. Durable truth lives **only** in the sources (GitHub, git `.pan/records`, JSONL, tmux). They travel.
2. **One sync layer**: reconstruction (#1920) rebuilds the DB from sources; the writer mirrors writes back
   to git for durability/travel.
3. The **DB is the one surface** running code uses — a cache, never the truth.
4. **One read door** (#1936) + **one write door** (#1921). Reads go through the resolver; writes go
   through the single writer.
5. A **CI guard** makes direct DB / filesystem / GitHub access *outside the two doors* fail the build — so
   nobody can ever add a 9th read path or a 22nd verdict-writer again.

**How every open state-model issue maps to this end state:**

| Issue | Its role in the end state |
|---|---|
| #1920 ✅ | the sync layer (sources → DB) |
| #1919 | the unified per-issue **record** — durable truth in git |
| #1921 | the **one write door** |
| #1936 | the **one read door** |
| #1922 | verdicts become a durable source of truth, not DB-only |
| #1929 / #1931 / #1932 | fix the sync/write path that today corrupts the record |

When these land and the CI guard is in place, there is exactly **one way in and one way out** for every
piece of state. That is the end state — and the reason the recurring bugs stop is that drift becomes
*structurally impossible*, not just discouraged.
