# Overdeck — The Issues Domain (Effect API tier)

> **Status:** the keystone domain and the proof-of-shape for the other six.
> Grounded in a no-loss mapping of the real current API surface (Part 1), then
> the Effect v4-beta services derived from that mapping (Part 2). Every service
> method traces to a Part-1 row; no column or endpoint is invented.
>
> Companions: [`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md)
> (the verified Effect house style), [`../overdeck-schema.ts`](../overdeck-schema.ts)
> (the locked `issues` / `issue_policy` tables), [`../END-STATE.md`](../END-STATE.md)
> (the `advance()`/`hold()` narrative and ~15 legal moves), and the two evidence
> audits [`../investigations/pipeline-transitions.md`](../investigations/pipeline-transitions.md)
> and [`../investigations/review-state-audit.md`](../investigations/review-state-audit.md).
> Line numbers checked against `main` @ `840117fadc` (2026-06-16).

---

## Glossary

- **Stage** — the single composite pipeline position, replacing today's 8 status
  axes. A `Schema.Literals` union on the `issues.stage` column. Defined in
  [`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md) lines 55-59.
- **Resolver / read door** — the one `Context.Service` allowed to *read* the
  domain's cache. Returns validated `Issue` entities.
- **Writer / write door** — the one `Context.Service` allowed to *mutate* the
  domain's cache. Persists to the source of truth (git `.pan/records` + GitHub)
  first, then the cache, then emits an event.
- **Legal move** — one of the ~15 validated `(from → to)` stage edges in
  [`pipeline-transitions.md` §5](../investigations/pipeline-transitions.md). Any
  other `(from → to)` is an `IllegalTransition`.
- **Outcome** — the durable verdict for a gate: `reviewOutcome` /`testOutcome` /
  `verificationOutcome`, each `pending|passed|failed` (`testOutcome` also
  `skipped`). Stored as columns on `issues`; a **pure function of the edge
  advance() takes** (see §2.4).
- **Side-state** — an orthogonal flag that is *not* a stage: paused, troubled,
  stuck, deacon-ignored, auto-merge, blocked, cancelled. The audit proves these
  live on **different tables / domains** — see the headline finding.
- **Relocate** — a disposition: the current endpoint/verb is **not lost and not
  Issues' to own**; it maps to a *sibling* domain's writer (Agents, Merge,
  Settings). Distinct from DELETE (genuinely dropped).
- **Aggregate read** — a cross-domain read (`/api/show/:id`, `getSnapshot`) that
  **recomposes** from several resolvers at the controller. Not an IssuesResolver
  method, not DELETE.

---

## ⚠️ Headline finding — `hold()` as drafted in END-STATE is architecturally illegal

[`END-STATE.md` line 223](../END-STATE.md) says `IssueWriter.hold()` toggles
"**paused, troubled, stuck, blocked, cancelled, deacon-ignored**." Cross-checked
against the **locked schema** ([`../overdeck-schema.ts`](../overdeck-schema.ts))
and the other domain sections, **five of those six do not live on the `issues`
table**, and a `hold()` that wrote them would break the remodel's central
compile-time guarantee. This is the most valuable finding of the audit: the model
is incoherent at exactly the seam the task flagged.

The door guarantee ([`ARCHITECTURE-CONVENTIONS.md` §0](../ARCHITECTURE-CONVENTIONS.md)):
each writer is *the only mutator of its domain's tables*, enforced because **only
that writer's Layer receives those tables in its `R`**. A `hold()` that set
`paused`/`troubled` (the `agents` table) or `deacon_ignored`/`auto_merge` (the
`issue_policy` table) would have to pull `agents` and `issue_policy` into
`IssueWriter`'s dependency graph — handing Issues a write path into two other
domains. That is precisely the "many writers for one fact" disease the remodel
exists to cure. So `hold()` **cannot** be built as END-STATE describes.

Where each END-STATE `hold` flag actually belongs:

| Flag | Real home (locked schema) | Owning writer | Evidence |
|---|---|---|---|
| **paused** | `agents.paused` / `agents.paused_reason` | **AgentWriter** (`pause`/`unpause`) | schema 67-68; END-STATE Agents §300; transitions §1c |
| **troubled** | `agents.troubled` + failure counters | **AgentWriter** (`markTroubled`/`clearTroubled`) | schema 69-72; END-STATE Agents §300 |
| **deacon-ignored** | `issue_policy.deacon_ignored` | **SettingsWriter** | schema 284; END-STATE Control/Settings §437; review-audit row `deacon_ignored` (NEITHER — operator flag) |
| **auto-merge** | `issue_policy.auto_merge` | **SettingsWriter** | schema 285; review-audit row `auto_merge` (NEITHER — routing policy) |
| **stuck** | *no `issues` column* — ephemeral review-run runtime | **Control/Settings** (review-run runtime) or folded into `blockers` | review-audit classes `stuck` EPHEMERAL REVIEW-RUN; not in locked `issues` table |
| **cancelled** | a **Stage** literal, not a flag | **IssueWriter.advance(id, "cancelled")** | Stage union (CONVENTIONS 55-58); legal move 13 |
| **blocked** | `issues.blockers` (typed array) | **IssueWriter** ✅ | schema 39; review-audit `blocker_reasons` → `blockers` (DURABLE VERDICT) |

**Resolution (decision made in this doc, per the no-loss rule):**

1. `IssueWriter` owns **only** issues-table facts. Its `hold()` therefore reduces
   to toggling **`blocked`** — i.e. set/clear the `blockers` array. To make the
   verb honest about its one real flag, this doc renames it **`setBlockers(id,
   blockers, reason)`** (a clearer name than a one-flag `hold`). `hold` survives
   in spirit as exactly this verb.
2. **`cancelled` is an `advance()` edge**, not a hold — it is already legal move
   13 (`any → cancelled`).
3. **paused / troubled / stuck / deacon-ignored / auto-merge relocate** to
   AgentWriter / Control-Settings-runtime / SettingsWriter. They are CLI/HTTP
   verbs that *take an issue id but write a sibling domain's table* — not lost,
   not Issues'. The Part-1 table marks them **→ relocate**, never DELETE.

This keeps the door guarantee a compile error rather than a guideline, and it
costs nothing: every flag still has exactly one writer; it is simply the right
one.

---

# Part 1 — No-loss mapping (the gate)

Every current surface (HTTP endpoint, `pan` CLI verb, RPC method) that **reads or
writes issue state** — stage, plan, verdicts, lifecycle, merge readiness, PR
identity, and the side-states — with its new home. Disposition is one of four:

- **READ →** an `IssuesResolver` method.
- **WRITE →** an `IssueWriter` verb (`advance` / `setBlockers` / `setPr`).
- **RELOCATE →** a *sibling* domain's writer/resolver (Agents, Merge, Settings).
  Not lost, not Issues' to own.
- **DELETE →** deliberately dropped (redundant read door, dead endpoint, or
  folded into another), with the reason.

Stores legend used in reasons: **RS** = SQLite `review_status` · **REC** = git
`.pan/records` · **GH** = GitHub labels/state · **SPEC** = `.pan/specs` vBRIEF.

## 1A. HTTP endpoints

### Reads (state of an issue) → `IssuesResolver`

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `GET /api/issues` (`issues.ts:635`) | reads | **`IssuesResolver.list(filter)`** | Board list; one resolver over the `issues` cache replaces the read-model assembly. |
| `GET /api/show/:issueId` (`show.ts`; API-SURFACE §A) | reads | **aggregate → recomposed at controller** from `IssuesResolver.get` + `AgentsResolver` + `CostResolver` | God-view spans 3 domains; not a single IssuesResolver method, not DELETE. |
| `GET /api/command-deck/activity/:issueId` (API-SURFACE §A) | reads | **aggregate → recomposed** (Issues + Agents + events) | Activity feed is cross-domain; recompose, don't fold into Issues. |
| `GET /api/issues/:id/planning-state` (`issues.ts:3051`) | reads | **`IssuesResolver.get` (`.stage` + `.planRef`)** | Planning state is now just `stage ∈ {planning,planned}` + the plan pointer; no separate door. |
| `GET /api/review/:issueId/status` (`workspaces.ts:3322`) | reads | **`IssuesResolver.get` (the 3 outcome fields)** | Verdicts are now `reviewOutcome`/`testOutcome`/`verificationOutcome` columns on `issues`; the dedicated `review_status` read collapses into `get`. |
| `GET /api/specialists/:project/:issueId/:type/status` (`specialists.ts:1007`) | reads | **`IssuesResolver.get`** | Legacy per-role status mirror; same three outcomes. Duplicate door → folded. |
| `GET /api/issues/:id/pr` (`issues.ts:3161`) | reads | **`IssuesResolver.get` (`.pr`)** + live GitHub for CI | PR identity is `prUrl/prNumber/prHeadSha` on `issues`; CI/check-runs read live from GitHub at the controller, not stored. |
| `GET /api/issues/:id/pr-diff`, `pr-details`, `check-runs` (`issues.ts:3516`,`3530`,`3544`) | reads | **RELOCATE → Diffs / live GitHub** | Diff bodies + check-runs are GitHub/Diffs concerns, not the issue entity. (API-SURFACE §H lists Diffs as cohesive.) |
| `GET /api/workspaces/:issueId/plan` (`workspaces.ts:1815`) | reads | **`IssuesResolver.getPlan(id)`** | The vBRIEF body lives in git `.pan/specs` via `planRef`; resolver reads the file behind the pointer (cache holds only `planRef`). |
| `GET /api/metrics/summary`, `GET /api/godview/system-health`, `GET /api/system/health` (API-SURFACE §A) | reads | **aggregate → recomposed** (Issues + Agents + Merge) | System-wide rollups; cross-domain by definition. |
| `GET /api/issues/:id/beads` (`issues.ts:2870`) | reads | **RELOCATE → Beads (out of scope)** | Bead list is the workspace's `.beads/`, not the `issues` cache. |
| `GET /api/issues/:id/costs` (`issues.ts:3916`) | reads | **RELOCATE → `CostResolver`** | Cost is its own domain (END-STATE Cost §). |
| `GET /api/issues/:id/discussions` (`issues.ts:3558`) | reads | **RELOCATE → live GitHub** | GitHub comments; not issue-cache state. |
| `GET /api/issues/:id/analyze` (`issues.ts:656`) | reads | **DELETE** | Ad-hoc analysis helper, not canonical state; no pipeline branch reads it. |

### Writes (lifecycle / verdicts) → `IssueWriter.advance` / `setBlockers` / `setPr`

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `POST /api/issues/:id/start-planning` (`issues.ts:820`) | writes | **`advance(id, "planning")`** | Spine move 1. Today: `transitionTo(in_planning)` (GH+EV) — absorbed. |
| `POST /api/issues/:id/complete-planning` (`issues.ts:1239`) | writes | **`advance(id, "planned")`** | Spine move 2. Today also writes `plan.status=proposed` (SPEC) — `advance` records `planRef` + flips SPEC status via the one writer. |
| `POST /api/issues/:issueId/start` (`workspaces.ts:2639`) | writes | **`advance(id, "working")`** (+ AgentWriter.spawn) | Spine move 3. The *stage* flip is `advance`; spawning the work agent is **AgentWriter.spawn** — split, as the lifecycle (stage) and the agent (process) are two domains. |
| `POST /api/issues/:id/generate-tasks` (`issues.ts:3102`) | writes | **`advance(id, "working")`** (fallback path) | Same move 3 via the generate-tasks/start fallback (transitions §2a). Duplicate trigger → one verb. |
| `POST /api/specialists/done` (`specialists.ts:312`) | writes | **`advance()`** (edge per verdict) + **`setPr`** | The review/test verdict handler. `reviewing→passed` ⇒ `advance(in_review→testing)`; `→failed` ⇒ `advance(in_review→working)`; it also stamps `prUrl` → **`setPr`**. The 7-store fan-out (transitions §4b) becomes one ordered writer. |
| `POST /api/review/:issueId/status` (`workspaces.ts:3390`) | writes | **`advance()`** (edge per outcome) | Direct verdict write. Each `setReviewStatusSync` outcome flip is an `advance` edge (the ~70-site collapse, see §2.4). |
| `POST /api/review/:issueId/request` (`workspaces.ts:3885`) | writes | **`advance(id, "in_review")`** | Re-request review = re-enter `in_review`. |
| `POST /api/review/:issueId/trigger` (`workspaces.ts:3602`) | writes | **`advance(id, "in_review")`** | Same move as request; duplicate door → one verb. |
| `POST /api/review/:issueId/reset` (`workspaces.ts:4336`) | writes | **`advance(id, "working")`** (human override) | Reset review cycles = send back to `working`; outcomes reset to `pending` by the edge. |
| `POST /api/review/:issueId/abort` (`workspaces.ts:4519`) | writes | **RELOCATE → AgentWriter.stop** (reviewers) | "Kill running reviewers, leave worker idle" mutates *agents*, not the issue stage. Relocate. |
| `DELETE /api/review/:issueId/pending` (`workspaces.ts:6207`) | writes | **`advance()`** or **DELETE** | Clears the "awaiting merge" pending flag; `ready_for_merge` is **derived** now (review-audit DERIVE), so the explicit clear is unnecessary → DELETE. |
| `POST /api/issues/:issueId/approve` (`workspaces.ts:5920`) | writes | **`advance(id, "merging")`** | Approve = enter merge path. Spine move 7. |
| `POST /api/issues/:issueId/merge` (`workspaces.ts:5676`) | writes | **RELOCATE → MergeWriter** | The actual merge is the Merge domain (END-STATE Merge §). `advance(merging→verifying_on_main)` is fired by `postMergeLifecycle` *after* MergeWriter lands it. |
| `POST /api/issues/:issueId/forge-approve` (`workspaces.ts:5705`) | writes | **RELOCATE → MergeWriter** | Forge-side approve; Merge domain. |
| `POST /api/issues/:issueId/forge-merge` (`workspaces.ts:5809`) | writes | **RELOCATE → MergeWriter** | Forge-side merge; Merge domain. |
| `GET /api/merge-queue` (`workspaces.ts:6297`) | reads | **RELOCATE → MergeResolver** | Merge-queue state; Merge domain. |
| `POST /api/issues/:issueId/sync-main` (`workspaces.ts:4783`) | writes | **RELOCATE → MergeWriter / git op** | Rebase feature branch onto main; a git/merge operation, no issue-stage change. |
| `POST /api/issues/:id/move-status` (`issues.ts:2167`) | writes | **`advance(id, targetStage, reason)`** | The operator's manual move *is literally* `advance` with an operator-chosen target — the cleanest 1:1 mapping. Validated against the legal-move set. |
| `POST /api/issues/:id/abort` (`issues.ts:1558`) | writes | **`advance(id, "todo", "abort")`** | Abort planning/work → back to `todo` (transitions §2a reset). |
| `POST /api/issues/:id/reset` (`issues.ts:1619`) | writes | **`advance(id, "todo", "reset")`** | Reset to todo. Same destination as abort; one verb, distinct reason. |
| `POST /api/issues/:id/cancel` (`issues.ts:1714`) | writes | **`advance(id, "cancelled", reason)`** | Legal move 13 (`any → cancelled`). **NOT a hold flag** (corrects END-STATE). |
| `POST /api/issues/:id/reopen` (`issues.ts:1752`) | writes | **`advance(id, "todo", "reopen")`** | Legal move 14 (`closed/cancelled → todo`). |
| `POST /api/issues/:id/restart-from-plan` (`issues.ts:1932`) | writes | **`advance(id, "planned", "restart-from-plan")`** | Re-enter at `planned` (plan exists, re-start work). |
| `POST /api/issues/:id/close-out` (`issues.ts:2552`) | writes | **`advance(id, "closed", "close-out")`** | Spine move 9. Also writes `plan.status=completed` (SPEC) + closes GH — all via the one writer's source-first step. |
| `POST /api/issues/bulk-close-out` (`issues.ts:2681`) | writes | **`advance()` ×N** | Loop of close-out; same verb per issue. |
| `POST /api/issues/:issueId/close` (`issues.ts:743`) | writes | **`advance(id, "closed")`** | Duplicate close door → one verb. |
| `POST /api/issues/:id/deep-wipe` (`issues.ts:2341`) | writes | **`advance(id, "todo", "wipe")`** (stage part) + **RELOCATE** (workspace/branch teardown) | Legal move 15. The *stage* reset is `advance`; the destructive teardown (tmux, branches, workspace) is **AgentWriter / workspace ops** — Issues only owns the stage flip. |
| `POST /api/issues/:id/cleanup-workspace` (`issues.ts:2258`) | writes | **RELOCATE → workspace ops** | Workspace teardown, no stage change. |
| `POST /api/issues/:id/copy-settings` (`issues.ts:2441`) | writes | **RELOCATE → Settings** | Spawn-config copy; not issue state. |
| `POST /api/issues/:id/beads/:beadId/inspect` (`issues.ts:2990`) | writes | **RELOCATE → Agents (work.inspect)** | Inspect is opt-in WORK-phase, per-bead — **off the merge path** (END-STATE Issues §247). Not an Issues verb. |
| `POST /api/issues/:id/abort-planning` (`issues.ts:1110`) | writes | **`advance(id, "todo", "abort-planning")`** + AgentWriter.stop | Stage back to todo; killing the plan agent is Agents. |
| `POST /api/workspaces/:issueId/unstick` (`workspaces.ts:4572`) | writes | **RELOCATE → Control/Settings (clear stuck)** | `stuck` is ephemeral review-run runtime, not an `issues` column (headline finding). |
| `POST /api/workspaces/:issueId/deacon-ignore` (`workspaces.ts:4700`) | writes | **RELOCATE → SettingsWriter** | `issue_policy.deacon_ignored` (schema 284). |
| `POST /api/workspaces/:issueId/auto-merge` (`workspaces.ts:4746`) | writes | **RELOCATE → SettingsWriter** | `issue_policy.auto_merge` (schema 285). |
| `POST /api/internal/pipeline/notify` (`workspaces.ts:6308`) | writes | **DELETE** | Pipeline-notifier event emit; replaced by the writer's own `bus.emit` (events flow from the write door, not a side channel). |
| webhook → `pr_head_sha` (`webhook-handlers.ts:390`) | writes | **`setPr(id, {url, number, headSha})`** | PR identity from the forge webhook; not a stage, not a boolean (review-audit 65). The one genuine non-`advance` write besides blockers. |
| webhook → `blocker_reasons` (`webhook-handlers.ts:242,252`) | writes | **`setBlockers(id, blockers, reason)`** | Merge-blocker labels → typed `blockers` array (review-audit `blocker_reasons` DURABLE). This **is** what `hold(blocked)` becomes. |

## 1B. CLI verbs (`pan ...`)

| Current verb | r/w | New door | Reason |
|---|---|---|---|
| `pan plan <id>` (`index.ts:371`) | writes | **`advance(id, "planning")`** then `advance(id,"planned")` on finalize | Start/finalize planning = spine moves 1-2. |
| `pan plan finalize <id>` (`plan-finalize.ts:377`) | writes | **`advance(id, "planned")`** | Writes `plan.status=proposed`; absorbed. |
| `pan start <id>` (`index.ts:515`) | writes | **`advance(id, "working")`** (+ AgentWriter.spawn) | Spine move 3; agent spawn relocates to Agents. |
| `pan done <id>` (`index.ts:394`,`472`) | writes | **`advance(id, "in_review")`** + **`setPr`** | Work-complete → `in_review`; stamps `prUrl` (`done.ts:462`) → `setPr`. |
| `pan move-status` / operator move | writes | **`advance(id, targetStage, reason)`** | Same as the HTTP move-status. |
| `pan reopen <id>` (`index.ts:487`) | writes | **`advance(id, "todo", "reopen")`** | Legal move 14. |
| `pan close <id>` (`index.ts:508`) | writes | **`advance(id, "closed", "close-out")`** | Spine move 9. |
| `pan wipe <id>` (`index.ts:494`) | writes | **`advance(id, "todo", "wipe")`** + RELOCATE teardown | Legal move 15; teardown to Agents/workspace ops. |
| `pan approve <id>` (`index.ts:482`) | writes | **`advance(id, "merging")`** | Spine move 7. |
| `pan review pending` (`index.ts:326`) | reads | **`IssuesResolver.list({ readyForMerge })`** | "Awaiting merge" list; `readyForMerge` is the **derived predicate** (review-audit DERIVE), a filter on `list`. |
| `pan review request <id>` (`index.ts:333`) | writes | **`advance(id, "in_review")`** | Re-request review. |
| `pan review reset <id>` (`index.ts:339`) | writes | **`advance(id, "working")`** | Reset cycles → back to working. |
| `pan review abort <id>` (`index.ts:345`) | writes | **RELOCATE → AgentWriter.stop** | Kill reviewer sessions; agents, not stage. |
| `pan review restart <id>` (`index.ts:350`) | writes | **RELOCATE → AgentWriter** (respawn reviewers) | Re-dispatch reviewers; agent lifecycle. |
| `pan review spawn-reviewer <id>` (`index.ts:357`, hidden) | writes | **RELOCATE → AgentWriter.spawn** | Internal convoy sub-role spawn; Agents. |
| `pan pause <id>` (`index.ts:411`) | writes | **RELOCATE → AgentWriter.pause** | `agents.paused` (schema 67). Takes an issue id, writes the **agents** table. |
| `pan unpause <id>` (`index.ts:417`) | writes | **RELOCATE → AgentWriter.unpause** | `agents.paused`. |
| `pan untroubled <id>` (`index.ts:422`) | writes | **RELOCATE → AgentWriter.clearTroubled** | `agents.troubled` + failure counters (schema 69-72). |
| `pan kill <id>` (`index.ts:405`) | writes | **RELOCATE → AgentWriter.stop** | Stop agent, preserve workspace; no stage change. |
| `pan resume <id>` (`index.ts:451`) | writes | **RELOCATE → AgentWriter.resume** | Agent lifecycle. |
| `pan recover [id]` (`index.ts:459`) | writes | **RELOCATE → AgentWriter** (orphan recovery) | Liveness reconcile; Agents. |
| `pan sync-main <id>` (`index.ts:467`) | writes | **RELOCATE → MergeWriter / git op** | Rebase; no stage change. |
| `pan tell <id> <msg>` (`index.ts:400`) | writes | **RELOCATE → AgentWriter / delivery** | Message delivery; not issue state. |
| `pan show <id>` (`index.ts:304`) | reads | **aggregate → recomposed** (Issues + Agents + Cost) | God-view; cross-domain. |
| `pan status` (`index.ts:585`) | reads | **aggregate → recomposed** | System overview; cross-domain. |

## 1C. RPC methods (`packages/contracts/src/rpc.ts`)

| Current RPC method | r/w | New door | Reason |
|---|---|---|---|
| `pan.getSnapshot` (`rpc.ts:44`) | reads | **aggregate → recomposed** from all resolvers | The read-model snapshot spans every domain; the controller composes it from `IssuesResolver` + siblings. Not an IssuesResolver method. |
| `pan.subscribeDomainEvents` (`rpc.ts:35`) | reads (stream) | **`IssuesApi` RPC `issues.subscribe`** (+ sibling streams) | Live event stream; fed by the write door's `bus.emit`. The issue slice maps to the Issues RPC subscription (CONVENTIONS §8). |
| `pan.subscribeIssueEvents` (`rpc.ts:36`) | reads (stream) | **`issues.subscribe`** scoped to one id | Per-issue live stream → the Issues RPC group. |
| `pan.replayEvents` (`rpc.ts:45`) | reads | **RELOCATE → Observability/EventBus** | Gap-fill replay over the `events` transport; not a domain read (END-STATE Observability §). |
| `pan.startPlanning` (`rpc.ts:62`) | writes | **`IssueWriter.advance(id, "planning")`** via RPC | RPC mutation door delegates to the same writer as HTTP (CONVENTIONS §8: HTTP & RPC cannot diverge). |
| `pan.startAgent` (`rpc.ts:63`) | writes | **`advance(id, "working")`** + AgentWriter.spawn | Same split as HTTP `start`. |
| `pan.deepWipe` (`rpc.ts:64`) | writes | **`advance(id, "todo", "wipe")`** + RELOCATE teardown | Same as HTTP deep-wipe. |
| `pan.getWorkspaceDetail` (`rpc.ts:48`) | reads | **aggregate → recomposed** | Batched workspace view; cross-domain. |

## 1D. Rollup of the collapse

| Surface | Current sites touching issue state | New home |
|---|---|---|
| HTTP endpoints enumerated | ~45 (issues + workspaces/review + specialists slices) | **2 resolver reads** (`get`, `list`) + `getPlan` + **3 writer verbs** (`advance`, `setBlockers`, `setPr`); the rest **relocate** to Agents/Merge/Settings or **delete** |
| CLI verbs enumerated | ~24 issue-touching verbs | same small door set; agent/merge/settings verbs **relocate** |
| RPC methods enumerated | 8 issue-touching methods | `issues.get`/`list`/`subscribe` + 3 writer RPCs; aggregates **recompose**; `replayEvents` **relocates** |
| **Write trigger sites (real)** | **~148** (transitions §3) | **3 IssueWriter verbs** — `advance` absorbs the ~70 `setReviewStatusSync` sites, the ~12 `transitionTo` sites, the 8 `transitionIssueTo*` sites, the GH-label ops, and the `updateSpecStatus` calls (transitions §5) |
| **Distinct (from→to) pairs** | **~38** | **~15 legal moves** validated by `advance` |
| Scattered state-read doors (API-SURFACE §A) | **8+** | **1 resolver** (`get`/`list`) for pure issue reads; aggregates recompose at the controller |

**DELETED outright** (4): `GET /api/issues/:id/analyze` (ad-hoc, no branch read),
`DELETE /api/review/:id/pending` (`ready_for_merge` is derived), `POST
/api/internal/pipeline/notify` (events flow from the writer's `bus.emit`), and the
phantom verdict columns `reviewer_verdicts` / `lifetime_auto_requeue_count`
(review-audit "Phantom columns" — never existed as `issues` state).

**Relocated, not lost** (the no-loss integrity column): pause/unpause/untroubled/
kill/resume/recover/tell + review abort/restart/spawn-reviewer → **Agents**;
merge/forge-merge/forge-approve/sync-main/merge-queue → **Merge**; deacon-ignore/
auto-merge/copy-settings → **Settings**; unstick (stuck) → **Control/Settings
runtime**; costs → **Cost**; diffs/discussions/check-runs/beads → their domains.

## 1E. What did NOT fit `advance()` / `hold()` — the genuine residue

After the collapse, the writes on the **`issues` table** that are *not* a stage
move are exactly **two**, plus the headline `hold` correction. Enumerated and
justified:

1. **PR identity** (`prUrl` / `prNumber` / `prHeadSha`). Written by `pan done`
   (`done.ts:462`) and the forge webhook (`webhook-handlers.ts:390`). It is not a
   stage and not a boolean side-state, so it cannot be an `advance` edge or a
   `hold` flag. → a small **`setPr(id, pr)`** verb. (review-audit keeps all three
   PR fields as DURABLE VERDICT, rows 64-66.)
2. **Blockers** (set/clear the typed `blockers` array). Written by the webhook
   merge-blockers (`webhook-handlers.ts:242,252`) and the conflict gate. This **is**
   what END-STATE's `hold(blocked)` collapses to — the only one of the six
   END-STATE hold flags that is genuinely an `issues`-table fact. → **`setBlockers(id,
   blockers, reason)`**.
3. **The `hold()` incoherence itself** (headline finding): five of the six
   END-STATE `hold` flags are *not* issues-table facts and relocate. Surfaced
   loudly above; the model was incomplete at this seam.

Everything else either advances a stage, relocates to a sibling domain, or is
deleted. Nothing real is lost.

---

# Part 2 — The Effect services (derived from the mapping)

Written in the verified v4-beta idiom from
[`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md): `Context.Service`
(never `Effect.Service`), `effect/unstable/*` imports, Drizzle behind the `Db`
service, `Schema.Literals([...])` taking arrays, `Schema.TaggedErrorClass`,
source-first-then-cache writer ordering (§5). Every method below traces to a
Part-1 row.

## 2.1 Entities & errors — `Schema`

```ts
import { Effect, Layer, Context, Schema } from "effect"
import { eq } from "drizzle-orm"
import { issues, issuePolicy } from "../overdeck-schema"   // the locked Drizzle tables
import { Db, Records, EventBus } from "./infra"            // Db = Drizzle handle; Records = git .pan/records writer

// ── Branded id + stage union (CONVENTIONS §2) ──────────────────────────────
export const IssueId = Schema.String.pipe(Schema.brand("IssueId"))
export type  IssueId = typeof IssueId.Type

export const Sha = Schema.String.pipe(Schema.brand("Sha"))

export const Stage = Schema.Literals([
  "todo", "planning", "planned", "working", "in_review",
  "testing", "verifying", "merging", "verifying_on_main",
  "closed", "cancelled",
])
export type Stage = typeof Stage.Type

// outcome columns on `issues` (overdeck-schema 35-37). test also `skipped`.
export const Outcome     = Schema.Literals(["pending", "passed", "failed"])
export const TestOutcome = Schema.Literals(["pending", "passed", "failed", "skipped"])

// typed blockers — replaces blocker_reasons sniffing (overdeck-schema 39)
export const Blocker = Schema.Struct({
  kind:   Schema.Literals(["merge_conflict", "failing_check", "review_block", "other"]),
  detail: Schema.String,
})
export type Blocker = typeof Blocker.Type

// ── The Issue entity — the DB-row decoder AND the API success type ──────────
export const Issue = Schema.Struct({
  id:                  IssueId,
  stage:               Stage,
  reviewOutcome:       Schema.NullOr(Outcome),
  testOutcome:         Schema.NullOr(TestOutcome),
  verificationOutcome: Schema.NullOr(Outcome),
  verdictCommit:       Schema.NullOr(Sha),
  blockers:            Schema.Array(Blocker),
  planRef:             Schema.NullOr(Schema.String),
  pr: Schema.NullOr(Schema.Struct({
    url:     Schema.String,
    number:  Schema.Number,
    headSha: Sha,
  })),
  updatedAt:           Schema.Date,
})
export type Issue = typeof Issue.Type

export const IssueFilter = Schema.Struct({
  stage:          Schema.optional(Stage),
  readyForMerge:  Schema.optional(Schema.Boolean),   // DERIVED predicate (review-audit), not a column
})
export type IssueFilter = typeof IssueFilter.Type

// ── Errors — tagged, in the E channel (CONVENTIONS §3) ─────────────────────
export class IssueNotFound extends Schema.TaggedErrorClass<IssueNotFound>()(
  "IssueNotFound", { id: IssueId },
) {}
export class IllegalTransition extends Schema.TaggedErrorClass<IllegalTransition>()(
  "IllegalTransition", { from: Stage, to: Stage },
) {}
```

## 2.2 The legal-move table — the ~15 edges `advance` validates

Sourced verbatim from [`pipeline-transitions.md` §5](../investigations/pipeline-transitions.md)
(9 spine + 3 failure + 3 terminal). `cancelled` and the two `todo` resets are
edges here, **not** `hold` flags (headline finding).

```ts
// (from → set-of-legal-to). Any pair not present ⇒ IllegalTransition.
const LEGAL: Record<Stage, ReadonlyArray<Stage>> = {
  // ── spine (forward) ──
  todo:              ["planning", "cancelled"],
  planning:          ["planned", "working", "todo", "cancelled"],
  planned:           ["working", "todo", "cancelled"],
  working:           ["in_review", "todo", "cancelled"],
  in_review:         ["testing", "working", "cancelled"],          // pass → testing · fail → working
  testing:           ["verifying", "merging", "working", "cancelled"], // verifying optional per project
  verifying:         ["merging", "working", "cancelled"],
  merging:           ["verifying_on_main", "working", "cancelled"], // conflict/divergence → working
  verifying_on_main: ["closed", "cancelled"],
  // ── terminal / out-of-band ──
  closed:            ["todo"],                                     // reopen
  cancelled:         ["todo"],                                     // reopen
}

const isLegalMove = (from: Stage, to: Stage): boolean =>
  to === "todo"            // wipe/reset/abort: any → todo is always legal (move 15)
  || (LEGAL[from]?.includes(to) ?? false)

// the edge ⇒ outcome function. THIS is why ~70 setReviewStatusSync sites
// collapse: each gate outcome is a PURE FUNCTION of the stage edge (§2.4).
const outcomeForMove = (from: Stage, to: Stage, hint?: "skipped"):
  Partial<Pick<Issue, "reviewOutcome" | "testOutcome" | "verificationOutcome">> => {
  if (from === "in_review" && to === "testing")  return { reviewOutcome: "passed" }
  if (from === "in_review" && to === "working")  return { reviewOutcome: "failed" }
  if (from === "testing"   && to === "verifying") return { testOutcome: hint === "skipped" ? "skipped" : "passed" }
  if (from === "testing"   && to === "merging")   return { testOutcome: hint === "skipped" ? "skipped" : "passed" }
  if (from === "testing"   && to === "working")   return { testOutcome: "failed" }
  if (from === "verifying" && to === "merging")   return { verificationOutcome: "passed" }
  if (from === "verifying" && to === "working")   return { verificationOutcome: "failed" }
  if (to === "working" || to === "todo")          // a send-back / reset clears stale gates
    return { reviewOutcome: "pending", testOutcome: "pending", verificationOutcome: "pending" }
  return {}
}
```

## 2.3 `IssuesResolver` — the read door (`Context.Service`)

Methods trace to Part-1 §1A reads: `get` (the canonical-state read collapsing the
8+ scattered doors), `list` (board + `readyForMerge` filter), `getPlan` (the
vBRIEF body behind `planRef`).

```ts
export class IssuesResolver extends Context.Service<IssuesResolver, {
  readonly get:     (id: IssueId)     => Effect.Effect<Issue, IssueNotFound>
  readonly list:    (f: IssueFilter)  => Effect.Effect<ReadonlyArray<Issue>>
  readonly getPlan: (id: IssueId)     => Effect.Effect<unknown, IssueNotFound>  // vBRIEF JSON from git via planRef
}>()("overdeck/IssuesResolver") {}

export const IssuesResolverLayer = Layer.effect(IssuesResolver, Effect.gen(function* () {
  const { q }   = yield* Db          // Drizzle handle — appears ONLY in resolver/writer Layer R
  const records = yield* Records     // to read the vBRIEF body git-side

  const decode = Schema.decodeUnknown(Issue)

  const get = (id: IssueId) => Effect.gen(function* () {
    const row = yield* Effect.sync(() =>
      q.select().from(issues).where(eq(issues.id, id)).get())
    return row
      ? yield* decode(row)
      : yield* Effect.fail(new IssueNotFound({ id }))
  })

  const list = (f: IssueFilter) => Effect.gen(function* () {
    const rows = yield* Effect.sync(() =>
      f.stage
        ? q.select().from(issues).where(eq(issues.stage, f.stage)).all()
        : q.select().from(issues).all())
    const all = yield* Effect.forEach(rows, decode)
    // readyForMerge is the DERIVED predicate (review-audit DERIVE), not a column:
    return f.readyForMerge === undefined
      ? all
      : all.filter((i) => readyForMerge(i) === f.readyForMerge)
  })

  // the ONE place ready_for_merge is computed — replaces the dropped column +
  // both boot-time repair sweeps (review-audit "ready_for_merge" DERIVE).
  const readyForMerge = (i: Issue): boolean =>
    i.reviewOutcome === "passed"
    && i.testOutcome === "passed"
    && i.verificationOutcome !== "failed"
    && i.stage !== "merging" && i.stage !== "verifying_on_main"
    && i.stage !== "closed"  && i.blockers.length === 0

  const getPlan = (id: IssueId) => Effect.gen(function* () {
    const issue = yield* get(id)                       // 404s if unknown
    if (!issue.planRef) return null                    // no plan yet
    return yield* records.readSpec(issue.planRef)      // reads .pan/specs JSON git-side
  })

  return IssuesResolver.of({ get, list, getPlan })
}))
```

## 2.4 `IssueWriter` — the write door (`Context.Service`)

Three verbs, derived from Part-1 §1E: `advance` (absorbs the ~148 sites),
`setPr`, `setBlockers`. **No separate verb sets a gate outcome** — `advance`
writes it from the edge (`outcomeForMove`), which is the whole collapse proof.

```ts
export class IssueWriter extends Context.Service<IssueWriter, {
  // the only thing that changes `stage`; absorbs ~148 trigger sites.
  readonly advance: (id: IssueId, to: Stage, reason: string, hint?: "skipped") =>
    Effect.Effect<Issue, IssueNotFound | IllegalTransition, IssuesResolver>
  // PR identity (done.ts:462 + webhook 390) — not a stage, not a flag.
  readonly setPr: (id: IssueId, pr: Issue["pr"]) =>
    Effect.Effect<Issue, IssueNotFound, IssuesResolver>
  // the ONLY survivor of END-STATE's hold(): toggles the blockers array.
  readonly setBlockers: (id: IssueId, blockers: ReadonlyArray<Blocker>, reason: string) =>
    Effect.Effect<Issue, IssueNotFound, IssuesResolver>
}>()("overdeck/IssueWriter") {}

export const IssueWriterLayer = Layer.effect(IssueWriter, Effect.gen(function* () {
  const { q }   = yield* Db          // Drizzle handle (issues table only — NOT agents/issue_policy)
  const records = yield* Records     // git .pan/records — the SOURCE OF TRUTH
  const bus     = yield* EventBus
  const now     = () => new Date()

  const advance = (id: IssueId, to: Stage, reason: string, hint?: "skipped") =>
    Effect.gen(function* () {
      const resolver = yield* IssuesResolver
      const issue    = yield* resolver.get(id)                  // 404s if unknown
      if (!isLegalMove(issue.stage, to))
        return yield* Effect.fail(new IllegalTransition({ from: issue.stage, to }))

      const outcomes = outcomeForMove(issue.stage, to, hint)    // edge ⇒ verdict
      const next: Issue = { ...issue, ...outcomes, stage: to, updatedAt: now() }

      // 1. SOURCE OF TRUTH FIRST — the commit point (CONVENTIONS §5 ordering).
      //    Mirrors stage + outcomes to the .pan/records pipeline block; flips
      //    the vBRIEF plan.status and the GitHub label/state in the same step.
      //    This single call replaces transitionTo + setReviewStatusSync's REC
      //    mirror + updateSpecStatus + the raw `gh issue edit` label ops.
      yield* records.writeIssue(next, { reason })

      // 2. THEN the cache — synchronous, failure-checked (never fire-and-forget).
      //    If THIS throws the cache is briefly stale and self-heals on rebuild;
      //    git already holds the truth (CONVENTIONS §5 rule 1).
      yield* Effect.sync(() =>
        q.update(issues).set({
          stage:               to,
          reviewOutcome:       next.reviewOutcome,
          testOutcome:         next.testOutcome,
          verificationOutcome: next.verificationOutcome,
          updatedAt:           next.updatedAt,
        }).where(eq(issues.id, id)).run())

      // 3. ANNOUNCE — the read-model + RPC subscribers update from this.
      yield* bus.emit({ type: "issue.advanced", payload: { id, from: issue.stage, to, reason } })
      return next
    })

  const setPr = (id: IssueId, pr: Issue["pr"]) => Effect.gen(function* () {
    const resolver = yield* IssuesResolver
    const issue    = yield* resolver.get(id)
    const next: Issue = { ...issue, pr, updatedAt: now() }
    yield* records.writeIssue(next, { reason: "pr-identity" })  // GitHub is the source; record mirrors
    yield* Effect.sync(() =>
      q.update(issues).set({
        prUrl:     pr?.url     ?? null,
        prNumber:  pr?.number  ?? null,
        prHeadSha: pr?.headSha ?? null,
        updatedAt: next.updatedAt,
      }).where(eq(issues.id, id)).run())
    yield* bus.emit({ type: "issue.pr_updated", payload: { id, pr } })
    return next
  })

  const setBlockers = (id: IssueId, blockers: ReadonlyArray<Blocker>, reason: string) =>
    Effect.gen(function* () {
      const resolver = yield* IssuesResolver
      const issue    = yield* resolver.get(id)
      const next: Issue = { ...issue, blockers, updatedAt: now() }
      yield* records.writeIssue(next, { reason })
      yield* Effect.sync(() =>
        q.update(issues).set({ blockers: [...blockers], updatedAt: next.updatedAt })
          .where(eq(issues.id, id)).run())
      yield* bus.emit({ type: "issue.blockers_changed", payload: { id, blockers, reason } })
      return next
    })

  return IssueWriter.of({ advance, setPr, setBlockers })
}))
```

> **Why `IssueWriter`'s `R` is clean.** Its dependencies are `Db` (the `issues`
> table only), `Records`, `EventBus`, and `IssuesResolver`. It **never** receives
> `agents` or `issue_policy` — so it physically *cannot* write paused/troubled/
> deacon-ignored. That is the headline finding enforced by the type system, not a
> convention.

## 2.5 `IssuesApi` — the controller (`HttpApiGroup`)

Each endpoint declares request / success / error Schemas and delegates to the two
services; the handler's `R` is `IssuesResolver | IssueWriter`, never `Db`
(CONVENTIONS §7 door enforcement). Endpoints trace to the Part-1 collapse: `get`,
`list`, `getPlan` (reads); `advance`, `setBlockers`, `setPr` (writes).

```ts
import { HttpApi, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder } from "effect/unstable/httpapi"

export const IssuesApi = HttpApiGroup.make("issues")
  // ── reads ──
  .add(HttpApiEndpoint.get("list", "/issues", {
    urlParams: IssueFilter,
    success:   Schema.Array(Issue),
  }))
  .add(HttpApiEndpoint.get("get", "/issues/:id", {
    params:  Schema.Struct({ id: IssueId }),
    success: Issue,
    error:   IssueNotFound,
  }))
  .add(HttpApiEndpoint.get("getPlan", "/issues/:id/plan", {
    params:  Schema.Struct({ id: IssueId }),
    success: Schema.Unknown,           // vBRIEF JSON from git via planRef
    error:   IssueNotFound,
  }))
  // ── writes ──
  .add(HttpApiEndpoint.post("advance", "/issues/:id/advance", {
    params:  Schema.Struct({ id: IssueId }),
    payload: Schema.Struct({
      to:     Stage,
      reason: Schema.String,
      hint:   Schema.optional(Schema.Literals(["skipped"])),
    }),
    success: Issue,
    error:   Schema.Union([IssueNotFound, IllegalTransition]),
  }))
  .add(HttpApiEndpoint.post("setBlockers", "/issues/:id/blockers", {
    params:  Schema.Struct({ id: IssueId }),
    payload: Schema.Struct({ blockers: Schema.Array(Blocker), reason: Schema.String }),
    success: Issue,
    error:   IssueNotFound,
  }))
  .add(HttpApiEndpoint.post("setPr", "/issues/:id/pr", {
    params:  Schema.Struct({ id: IssueId }),
    payload: Schema.Struct({
      url: Schema.String, number: Schema.Number, headSha: Sha,
    }),
    success: Issue,
    error:   IssueNotFound,
  }))

export const OverdeckApi = HttpApi.make("overdeck").add(IssuesApi) /* .add(AgentsApi) … */

// handlers: pure delegation. R = IssuesResolver | IssueWriter — never Db.
export const IssuesApiLive = HttpApiBuilder.group(OverdeckApi, "issues", (h) =>
  h.handle("list",        ({ urlParams })       => IssuesResolver.list(urlParams))
   .handle("get",         ({ path })            => IssuesResolver.get(path.id))
   .handle("getPlan",     ({ path })            => IssuesResolver.getPlan(path.id))
   .handle("advance",     ({ path, payload })   => IssueWriter.advance(path.id, payload.to, payload.reason, payload.hint))
   .handle("setBlockers", ({ path, payload })   => IssueWriter.setBlockers(path.id, payload.blockers, payload.reason))
   .handle("setPr",       ({ path, payload })   => IssueWriter.setPr(path.id, payload)))
```

The dashboard's live RPC surface (CONVENTIONS §8) delegates to the **same**
resolver/writer so HTTP and RPC cannot diverge — `issues.get` / `issues.list`
reuse `IssuesResolver`; `issues.subscribe` streams the writer's `bus.emit`
events; `pan.startPlanning` / `pan.startAgent` / `pan.deepWipe` (Part-1 §1C) map
to `IssueWriter.advance(…)`.

## 2.6 Layer wiring

```ts
const IssuesDomainLayer = Layer.mergeAll(
  IssuesResolverLayer,
  IssueWriterLayer,
).pipe(
  Layer.provide(DbLive),        // the ONLY place the issues table handle is provided
  Layer.provide(RecordsLive),   // git .pan/records source-of-truth writer
  Layer.provide(EventBusLive),
)

const HttpLive = HttpApiBuilder.serve(OverdeckApi).pipe(
  Layer.provide(IssuesApiLive),
  Layer.provide(IssuesDomainLayer),
)
// NodeRuntime.runMain(Layer.launch(HttpLive))  — Node 22 only (dashboard rule)
```

A missing dependency is a **compile error at the merge**, not a runtime failure
(CONVENTIONS §6). Because `IssuesApiLive`'s handler `R` resolves to
`IssuesResolver | IssueWriter` and neither leaks `Db`, no controller can read or
write the cache directly.

---

## Acceptance — every method traces to a Part-1 row

| Service member | Part-1 source rows |
|---|---|
| `IssuesResolver.get` | §1A reads: `/api/issues/:id` family, `/review/:id/status`, `specialists/.../status`, `planning-state`, `/pr` (the 8+-door collapse) |
| `IssuesResolver.list` | §1A `GET /api/issues`; §1B `pan review pending` (`readyForMerge` filter) |
| `IssuesResolver.getPlan` | §1A `GET /api/workspaces/:id/plan` |
| `IssueWriter.advance` | §1A/§1B/§1C every lifecycle + verdict write: start-planning, complete-planning, start, done, move-status, abort, reset, cancel, reopen, restart-from-plan, close-out, deep-wipe (stage), approve, review request/trigger/reset, specialists/done (verdict), review/status |
| `IssueWriter.setPr` | §1E.1: `done.ts:462`, `webhook-handlers.ts:390` |
| `IssueWriter.setBlockers` | §1E.2: `webhook-handlers.ts:242,252` (the surviving `hold(blocked)`) |
| `IssuesApi` endpoints | one-to-one with the resolver/writer members above |
| relocated / deleted | §1D rollup — none map to an Issues member by design |

No method reads or writes a column outside the locked `issues` table; no endpoint
is invented; nothing real from the current surface is lost.
