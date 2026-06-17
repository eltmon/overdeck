# Overdeck — The Agents Domain (Effect API tier)

> **Status:** the second domain after the Issues keystone, built to the same
> shape and rigor. Grounded in a no-loss mapping of the real current API surface
> (Part 1), then the Effect v4-beta services derived from that mapping (Part 2).
> Every service method traces to a Part-1 row; no column or endpoint is invented.
>
> Companions: [`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md)
> (the verified Effect house style), [`./issues.md`](./issues.md) (the proven
> template; the Issues design routes the `paused`/`troubled` side-states **here**),
> [`../overdeck-schema.ts`](../overdeck-schema.ts) (the locked `agents` /
> `health_events` tables), and the evidence audit
> [`../investigations/agents-state-audit.md`](../investigations/agents-state-audit.md)
> (the 44-column → 18-field NEED-set collapse + the `state.json` plane deletion).
> Line numbers checked against `main` @ `840117fadc` (2026-06-16).

---

## Glossary

- **Agent** — a spawned harness process serving one issue in one role
  (`work` / `review` (a convoy lane) / `plan` / merge-specialist). Keyed by
  `agents.id` (the tmux session name). Defined by the `agents` table
  ([`../overdeck-schema.ts`](../overdeck-schema.ts) lines 55-77).
- **Resolver / read door** — the one `Context.Service` allowed to *read* the
  Agents cache (`agents` + `health_events`). Returns validated `Agent` entities.
- **Writer / write door** — the one `Context.Service` allowed to *mutate* the
  Agents cache. Per-verb durability mode (see the **hybrid writer** note below).
- **Liveness oracle** — tmux on socket `-L panopticon`. The ground truth for
  whether an agent process is actually running; `agents.status` is a *cache* of
  it, reconciled every patrol (`reconcileAgentStatus`, agents-state-audit
  surprise #1). There is no operator verb that sets `status` arbitrarily.
- **Lifecycle gate** — the pause/troubled/failure-backoff machinery that
  suppresses or schedules auto-resume (`paused`, `troubled`,
  `consecutive_failures`, `first_failure_in_run_at`, `last_failure_next_retry_at`,
  `stopped_by_user`, `kickoff_delivered`). Pure-cache; no durable source.
- **Record-authoritative mirror** — `harness` / `model` columns are a
  *denormalized cache*; the per-issue git record is the source of truth
  (PAN-1919; agents-state-audit surprise #7). Their writer step is **source-first**.
- **Review-run runtime** — the `review_runs` / `review_run_agents` tables
  ([`../overdeck-schema.ts`](../overdeck-schema.ts) 350-379) holding the convoy's
  ephemeral monitor/recovery state. **Orchestration's, not Agents'** — see the
  headline finding. A reviewer is still an Agent (so spawning one is
  `AgentWriter.spawn(role="review")`), but the *run* metadata is Orchestration's.
- **Relocate** — a disposition: the current endpoint/verb is **not lost and not
  Agents' to own**; it maps to a *sibling* domain (Orchestration, Conversations,
  Cost, Workspace, Issues, agent-permissions). Distinct from DELETE.
- **Residue** — a current surface that is neither a cache read nor a cache write:
  live-process actions (message delivery, Q&A, poke). Enumerated in §1E; it does
  not vanish — it lives behind a thin delivery/process verb, not a door.
- **Issue-keyed vs agent-keyed.** Every `pan` lifecycle verb takes an **issue
  id** and resolves it to the work agent (`agent-<issue-lc>`); the HTTP routes and
  the writer are **agent-keyed**. The mapping notes this resolution step at each
  CLI row, so the collapse reads as no-loss.

---

## ⚠️ Headline finding — the Agents collapse is door-dedup + squatter-eviction, NOT transition-absorption

The Issues keystone collapsed ~148 write sites into **one** `advance(stage)` verb
because issue **stage is a single composite axis** with ~15 legal moves. **Agents
has no such axis.** `agents.status` is a *cache of the tmux oracle* reconciled
every patrol (agents-state-audit surprise #1), not an operator-written field — so
there is no `advance()` analog to manufacture, and AgentWriter is correctly a
**set of genuine lifecycle verbs**, not one mega-verb. Forcing a single verb here
would be cargo-culting the template.

The Agents win is two different shapes, and naming them is the most valuable
output of this audit:

1. **Three parallel control surfaces collapse to one writer.** API-SURFACE §B
   ([`../../API-SURFACE.md`](../../API-SURFACE.md) lines 56-61) proves a "role
   agent" is reachable through **three doors over the same concept**:
   - `agents.ts` (**35** endpoints) — the modern surface
     (`pause/unpause/untroubled/resume/stop/restart/suspend/recover/switch-model/
     delivery-method/message/tell` …).
   - `specialists.ts` (**31** endpoints) — a **legacy** model of the *same*
     role-agents (`wake/reset/init/report-status/done/auto-complete/terminate/
     grace/runs/spawn` …), built on `LegacySpecialistDefinition`
     (`specialists.ts:496`).
   - `remote.ts` (**9** endpoints) — fly.io remote agents
     (`start/stop/agent/start/agent/stop/agent/tell/agent/output`), the *same
     verbs parameterized by host* — exactly the `agents.host_override` column
     ([`../overdeck-schema.ts`](../overdeck-schema.ts) line 64).

   The agent-control verbs across all three become **one `AgentWriter`**.

2. **Nine `review_*`/`inspect_*` columns + the review-run half of `specialists.ts`
   evict to Orchestration.** This is the Agents twin of the Issues `hold()`
   incoherence. The agents-state-audit (Table rows 98-105) traced
   `review_sub_role`, `review_run_id`, `review_synthesis_agent_id`,
   `review_output_path`, `review_deadline_at`, `review_monitor_signaled`,
   `review_retry_attempt`, `inspect_sub_role` (+ `flywheel_run_id`,
   `role_run_head`) as **squatters** — their only consumers are Orchestration's
   review-monitor / recovery loop. They are **already evicted in the locked
   schema**: `review_runs` / `review_run_agents`
   ([`../overdeck-schema.ts`](../overdeck-schema.ts) 350-379) are in the
   **Orchestration** section, not the Agents section. Consequently the review-run
   *routes* on `specialists.ts` (`runs`, `runs/:runId`, `runs/:runId/terminate`,
   `grace/*`, `report-status`, `review/restart`, `reviewer/:role/restart`,
   `:type/spawn` for the convoy run) **RELOCATE → Orchestration**, NOT
   `AgentWriter`. Forcing them into AgentWriter would re-import the exact
   foreign-domain coupling the doors forbid: AgentWriter would need
   `review_runs` in its `R`.

**The boundary rule that follows (decided in this doc, per the no-loss rule):**

> A *reviewer process* is an Agent → spawning/stopping/resuming it is
> `AgentWriter.spawn|stop|resume(role="review")`. The *convoy run* it belongs to
> — its lanes, deadlines, monitor signals, recovery counters, synthesis pointer —
> is the **Orchestration** review-run record. AgentWriter never touches
> `review_runs`/`review_run_agents`; Orchestration never touches `agents`'
> lifecycle gates. Each fact has exactly one writer; the door guarantee stays a
> compile error, not a guideline.

**Domain-specific ownership granted by the Issues design:** `AgentWriter` **owns**
the `paused` / `troubled` side-states that [`./issues.md`](./issues.md) (headline
finding, rows 70-71) routed here — `pause` / `unpause` / `markTroubled` /
`clearTroubled`. These are `agents`-table facts
([`../overdeck-schema.ts`](../overdeck-schema.ts) 70-72), so they are correctly
Agents', not Issues'.

**The hybrid writer (CONVENTIONS §5 — both modes, named per verb).** Agents
straddles the two durability modes the conventions define, because most of the
table is pure-cache lifecycle state but `harness`/`model` are record-authoritative:

| Verb class | Mode (CONVENTIONS §5) | Why |
|---|---|---|
| `spawn`, `switchModel` | **source-first** (rule 1) | they write `harness`/`model`, whose source of truth is the **git record** (PAN-1919). Write the record, then mirror the column. |
| `pause`/`unpause`/`markTroubled`/`clearTroubled`/`recordFailure`/`setStatus`/`stop`/`resume`/`setDeliveryMethod`/`recordHealth` | **pure-cache** (rule 2) | the gate/liveness state has **no durable source** — the cache write *is* the whole write; on DB loss these reset to a clean retry budget (audit "Consequence to name", acceptable by design). |

Consequence: `AgentWriter`'s Layer `R` is `Db + Records + EventBus +
AgentsResolver`, with `Records` present **only** for the harness/model mirror.

---

# Part 1 — No-loss mapping (the gate)

Every current surface (HTTP endpoint across the **three** parallel doors, `pan`
CLI verb, RPC method) that **touches agent lifecycle / runtime / liveness** —
with its new home. Disposition is one of four:

- **READ →** an `AgentsResolver` method.
- **WRITE →** an `AgentWriter` verb.
- **RELOCATE →** a *sibling* domain (Orchestration / Conversations / Cost /
  Workspace / Issues / agent-permissions). Not lost, not Agents'.
- **DELETE →** deliberately dropped (legacy duplicate of a kept verb, or dead),
  with the reason.

Legend used in reasons: **AUDIT** = [`../investigations/agents-state-audit.md`](../investigations/agents-state-audit.md) ·
**§B** = API-SURFACE §B (the three-surface finding) · **a.ts** = `agents.ts` ·
**s.ts** = `specialists.ts` · **r.ts** = `remote.ts`.

## 1A. HTTP — `agents.ts` (35) — the modern surface

### Reads → `AgentsResolver`

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `GET /api/agents` (a.ts:683) | reads | **`AgentsResolver.list(filter)`** | The agent registry list; one resolver over the `agents` cache. |
| `GET /api/agents/:id/runtime` (a.ts:1531) | reads | **`AgentsResolver.getRuntime(id)`** | Live activity/idle/currentTool from the **`runtime.json` plane** behind the pointer — a separate file, read like `IssuesResolver.getPlan` reads `.pan/specs`; NOT a cache column (AUDIT caveat, lines 174-179). |
| `GET /api/agents/:id/health-history` (a.ts:1128) | reads | **`AgentsResolver.getHealthHistory(id)`** | Folds the `health_events` projection ([`../overdeck-schema.ts`](../overdeck-schema.ts) 81-88); one read over the Agent's health rows. |
| `GET /api/agents/:id/cloister-health` (a.ts:2197) | reads | **`AgentsResolver.getHealthHistory(id)`** | Duplicate health door (the deacon's view of the same `health_events`) → folded into the one read. |
| `GET /api/agents/:id/tmux-alive` (a.ts:3593) | reads | **`AgentsResolver.isAlive(id)`** | Liveness oracle probe; the resolver consults tmux `-L panopticon`. |
| `GET /api/agents/:id/has-session` (a.ts:3646) | reads | **`AgentsResolver.isAlive(id)`** | Same liveness probe under a second name → folded. |
| `GET /api/agents/:id/git-info` (a.ts:1555) | reads | **RELOCATE → git/Workspace** | Branch/HEAD of the worktree; a git op, not the agent entity (`branch` is DERIVE, AUDIT row 73). |
| `GET /api/agents/:id/activity` (a.ts:1594) | reads | **RELOCATE → Transcripts / runtime** | Activity feed derived from the JSONL transcript + runtime.json, not an `agents` column. |
| `GET /api/agents/:id/files` (a.ts:1612) | reads | **RELOCATE → Workspace** | Workspace file listing; not agent state. |
| `GET /api/agents/:id/timeline` (a.ts:1648) | reads | **RELOCATE → Observability/events** | Lifecycle-event timeline over the `events` log; recomposed, not an Agents read. |
| `GET /api/agents/:id/output` (a.ts:873) | reads | **RELOCATE → Transcripts (tmux capture)** | Raw pane/transcript bytes; the transcript plane, not the registry. |
| `GET /api/agents/:id/conversation` (a.ts:939) | reads | **RELOCATE → Transcripts** | Parsed transcript view; Transcripts plane. |
| `GET /api/agents/:id/cost` (a.ts:2301) | reads | **RELOCATE → Cost** | `cost_so_far` MOVEs to Cost (AUDIT row 83). |
| `GET /api/agents/:id/handoff/suggestion` (a.ts:2215) | reads | **RELOCATE → Conversations** | Handoff-doc suggestion; Conversations domain. |
| `GET /api/agents/:id/pending-questions` (a.ts:1176) | reads | **RELOCATE → Q&A (AskUserQuestion)** | The in-progress-AUQ read; the Q&A surface, not the agents cache. Residue §1E. |

### Writes → `AgentWriter`

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `POST /api/agents` (start agent) (a.ts:2407) | writes | **`AgentWriter.spawn(...)`** (+ IssueWriter.advance "working") | Spawns the work agent (process + identity row). The **stage** flip is IssueWriter's (issues.md row `start`); spawning the agent is **Agents**' — same split issues.md states. **source-first** (writes harness/model record). |
| `POST /api/agents/:id/stop` (a.ts:1124) | writes | **`AgentWriter.stop(id)`** | Kill session, stamp `stopped_by_user`, preserve workspace (AUDIT row 79). |
| `DELETE /api/agents/:id` (a.ts:1120) | writes | **`AgentWriter.stop(id)`** | The DELETE alias of stop (same handler, a.ts:1113 `method: 'DELETE' \| 'POST'`) → one verb. |
| `POST /api/agents/:id/suspend` (a.ts:1676) | writes | **`AgentWriter.stop(id, { suspend: true })`** | Suspend = stop without the user-stop suppression; a flavor of stop. |
| `POST /api/agents/:id/pause` (a.ts:1722 → `setAgentPaused`) | writes | **`AgentWriter.pause(id, reason)`** | `agents.paused`/`paused_reason`. Sets the gate **and** stops if live; `stopped_by_pause` folds into `paused` (AUDIT surprise #5). Owned here per issues.md. |
| `POST /api/agents/:id/unpause` (a.ts:1790 → `clearAgentPaused`) | writes | **`AgentWriter.unpause(id)`** | Clears the pause gate; clears `stopped_by_user` iff the stop was a pause-stop (AUDIT row 80). |
| `POST /api/agents/:id/untroubled` (a.ts:1837 → `clearAgentTroubled`) | writes | **`AgentWriter.clearTroubled(id)`** | `agents.troubled` + failure counters (AUDIT rows 89-95). |
| `POST /api/agents/:id/resume` (a.ts:1884 → `resumeAgent`) | writes | **`AgentWriter.resume(id, opts)`** | Resume into saved session; stamps `last_resume_at` (AUDIT row 77). |
| `POST /api/agents/:id/recover` (a.ts:1979) | writes | **`AgentWriter.resume(id)`** (orphan path) | Recover crashed/stopped agent = resume after liveness reconcile; same verb, recovery context. |
| `POST /api/agents/:id/restart` (a.ts:2043) | writes | **`AgentWriter.stop(id)` then `AgentWriter.resume(id)`** | Restart = stop+resume; composed from the two verbs, not a third. |
| `POST /api/agents/restart-all` (a.ts:3606) | writes | **`AgentWriter.resume(id)` ×N** | Loop over running agents; same verb per agent. |
| `POST /api/agents/:id/switch-model` (a.ts:3769 → `requireModelOverrideSync`) | writes | **`AgentWriter.switchModel(id, model)`** | Stop + clear session + set `model`. **source-first** (model record authoritative, AUDIT surprise #7). The hand-rolled `state.json`/`session.id` file edits (a.ts:3820-3845) collapse into the one verb. |
| `POST /api/agents/:id/delivery-method` (a.ts:3729 → `setAgentDeliveryMethod`) | writes | **`AgentWriter.setDeliveryMethod(id, method)`** | `agents.delivery_method` (absorbs the two transport booleans, AUDIT rows 106-108). |
| `POST /api/agents/:id/reset-session` (a.ts:3663) | writes | **`AgentWriter.switchModel(id, sameModel)`** (session-clear path) | Clears saved session so the next spawn is fresh — the session-clear half of switch-model with no model change → same verb. |
| `POST /api/agents/:id/heartbeat` (a.ts:1240) | writes | **`AgentWriter.recordHealth(id, event)`** | Typed runtime-event ingestion. Today it emits an `agent.*` DomainEvent into `health_events`; the route delegates to the **one writer** (not a direct DB write) so the health projection has a single mutator. |
| `POST /api/agents/:id/poke` (a.ts:1153) | writes | **RESIDUE → delivery** (§1E) | Nudge keystroke to the live tmux process; a process action, not a cache write. |
| `POST /api/agents/:id/message` (a.ts:1024) | writes | **RESIDUE → delivery** (§1E) | `deliverAgentMessage`; process action. |
| `POST /api/agents/:id/tell` (a.ts:1028) | writes | **RESIDUE → delivery** (§1E) | Same delivery primitive (shared handler with `/message`). |
| `POST /api/agents/:id/answer-question` (a.ts:1190) | writes | **RELOCATE → Q&A (AskUserQuestion)** | Answers an in-flight AUQ; the Q&A surface. Residue §1E. |
| `POST /api/agents/:id/handoff` (a.ts:2265) | writes | **RELOCATE → Conversations** | Spawns a handoff conversation; Conversations domain. |
| `POST /api/agents/:id/work-complete` (registered a.ts:3868) | writes | **RELOCATE → Issues (IssueWriter.advance "in_review")** | Work-complete is the *stage* move to review (issues.md `done` row); not an agents-cache write. |
| `POST /api/agents/:id/stuck` (registered a.ts:3869) | writes | **RELOCATE → Orchestration (review-run `stuck`)** | `stuck` is ephemeral review-run runtime (`review_runs.stuck`, [`../overdeck-schema.ts`](../overdeck-schema.ts) 360), not an agents column. |
| `POST /api/agents/:id/classify-completion` (registered a.ts:3870) | writes | **RELOCATE → Orchestration** | Completion-classification helper feeding the verdict pipeline; Orchestration. |
| `POST /internal/agents/:id/permission-request` (registered a.ts:3871) | writes | **RELOCATE → agent-permissions** | Permission-prompt plumbing; the `agent-permissions` module (API-SURFACE §1, "real surface" list). Residue §1E. |
| `POST /api/agents/:id/permission-response` (registered a.ts:3872) | writes | **RELOCATE → agent-permissions** | Permission decision; same module. |

## 1B. HTTP — `specialists.ts` (31) — the legacy second surface (the key consolidation)

The legacy named-specialist model (`LegacySpecialistDefinition`,
`specialists.ts:496`) of the **same** role-agents. Each route lands in exactly one
of: **AgentWriter** (lifecycle of a reviewer/specialist *process*) ·
**Orchestration** (the review-*run* record) · **Issues** (a verdict — issues.md
already maps these) · **DELETE** (dead duplicate of a kept `agents.ts` verb).

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `GET /api/specialists` (s.ts:233) | reads | **`AgentsResolver.list({ role })`** | Legacy specialist-status list = the agent registry filtered by reviewer roles → the one resolver. |
| `GET /api/specialists/projects` (s.ts:762) | reads | **`AgentsResolver.list({ role })`** | Per-project specialist rollup; same registry read, grouped at the controller. |
| `GET /api/specialists/:project/:issueId/:type/status` (s.ts:1007) | reads | **RELOCATE → Issues (`IssuesResolver.get`)** | Per-role verdict mirror; the three outcomes are now `issues` columns (issues.md row, "legacy per-role status mirror → folded"). |
| `GET /api/specialists/:name/cost` (s.ts:898) | reads | **RELOCATE → Cost** | Specialist spend; Cost domain. |
| `POST /api/specialists/done` (s.ts:312) | writes | **RELOCATE → Issues (`advance` + `setPr`)** | The review/test verdict handler; issues.md maps it to `advance()` per verdict + `setPr`. NOT an agents write. |
| `POST /api/specialists/:name/report-status` (s.ts:821) | writes | **RELOCATE → Issues (`advance`)** | Direct verdict report; Issues' verdict edge. |
| `POST /api/specialists/:project/:issueId/review/restart` (s.ts:1540) | writes | **RELOCATE → Orchestration** (respawn reviewers) | Re-dispatch the convoy = a review-run operation (issues.md "review restart → Agents/Orchestration"); the run is Orchestration's, the reviewer respawn is `AgentWriter.spawn` underneath. |
| `POST /api/specialists/:project/:issueId/reviewer/:role/restart` (s.ts:1613) | writes | **RELOCATE → Orchestration** (+ AgentWriter.spawn) | Restart one convoy lane; the lane is a `review_run_agents` row (Orchestration); spawning the lane's process is `AgentWriter.spawn(role="review")`. |
| `POST /api/specialists/:project/:type/spawn` (s.ts:1079) | writes | **`AgentWriter.spawn(role)`** (via Orchestration for the run) | Spawn a reviewer process → `AgentWriter.spawn`; the convoy run it joins is Orchestration's. |
| `GET /api/specialists/:project/:type/runs` (s.ts:1096) | reads | **RELOCATE → Orchestration** | Review-run list; `review_runs` is Orchestration's table. |
| `GET /api/specialists/:project/:type/runs/:runId` (s.ts:1219) | reads | **RELOCATE → Orchestration** | One review-run; Orchestration. |
| `GET /api/specialists/:project/:type/runs/:runId/stream` (s.ts:1125) | reads (stream) | **RELOCATE → Orchestration** | Run output stream; Orchestration. |
| `POST /api/specialists/:project/:type/runs/:runId/terminate` (s.ts:1243) | writes | **RELOCATE → Orchestration** (+ AgentWriter.stop) | Terminate a run; the run-record close is Orchestration's, stopping the lane processes is `AgentWriter.stop`. |
| `POST /api/specialists/:project/:type/grace/pause` (s.ts:1266) | writes | **RELOCATE → Orchestration** | Convoy grace-window control; review-run runtime. |
| `POST /api/specialists/:project/:type/grace/resume` (s.ts:1297) | writes | **RELOCATE → Orchestration** | Same. |
| `POST /api/specialists/:project/:type/grace/exit` (s.ts:1328) | writes | **RELOCATE → Orchestration** | Same. |
| `GET /api/specialists/:project/:type/grace` (s.ts:1354) | reads | **RELOCATE → Orchestration** | Grace-state read; review-run runtime. |
| `GET /api/specialists/:project/:type/context` (s.ts:1382) | reads | **RELOCATE → Orchestration (review-context)** | Reviewer context bundle; review-run input. |
| `POST /api/specialists/:project/:type/context/regenerate` (s.ts:1404) | writes | **RELOCATE → Orchestration** | Regenerate review context; review-run. |
| `POST /api/specialists/:project/:type/complete` (s.ts:1429) | writes | **RELOCATE → Orchestration** | Mark a run complete; review-run lifecycle. |
| `GET /api/specialists/:project/:type/latest-log` (s.ts:1465) | reads | **RELOCATE → Orchestration / logs** | Reviewer log tail; not the agents registry. |
| `POST /api/specialists/:project/:type/logs/cleanup` (s.ts:1498) | writes | **RELOCATE → Orchestration / logs** | Log housekeeping; not agent state. |
| `POST /api/specialists/logs/cleanup-all` (s.ts:743) | writes | **RELOCATE → Orchestration / logs** | Bulk log housekeeping. |
| `POST /api/specialists/:name/auto-complete` (s.ts:908) | writes | **RELOCATE → Orchestration** | Auto-complete a stalled run; review-run recovery. |
| `POST /api/specialists/:project/:issueId/:type/kill` (s.ts:1041) | writes | **`AgentWriter.stop(id)`** | Kill a specialist *process* → the one stop verb (resolve specialist→agent id). |
| `POST /api/specialists/:name/wake` (s.ts:776) | writes | **DELETE** | Legacy named-specialist wake/queue machinery — **removed** (CLAUDE.md: "Legacy specialist wake/session/queue machinery has been removed. Use `spawnRun()` and lifecycle state transitions"). Dead. |
| `POST /api/specialists/:name/reset` (s.ts:791) | writes | **DELETE** | Same legacy wake/reset machinery; superseded by `AgentWriter.stop` + Orchestration run reset. |
| `POST /api/specialists/reset-all` (s.ts:254) | writes | **DELETE** | Bulk legacy reset; superseded by per-agent stop + per-run Orchestration reset. |
| `POST /api/specialists/:name/init` (s.ts:806) | writes | **DELETE** | Legacy specialist session init; the named-specialist plane no longer exists. |
| `POST /api/specialists/projects/:project/:name/reset-session` (s.ts:1522) | writes | **`AgentWriter.switchModel(id, sameModel)`** (session-clear) | Clear a specialist's saved session → the session-clear path of switchModel (same as `agents/:id/reset-session`). |
| `GET /api/models/resolve` (s.ts:1643) | reads | **RELOCATE → Settings** | Model-resolution helper mis-filed under specialists; Settings domain. |

## 1C. HTTP — `remote.ts` (9) — the third surface (fly.io)

The **same lifecycle verbs parameterized by host/tier** — exactly the
`agents.host_override` column (AUDIT row 82). Not a fourth domain; the resolver
and writer take a host/tier so a remote agent is just an agent with
`host_override` set.

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `GET /api/remote/status` (r.ts:83) | reads | **RELOCATE → Infra/Settings (remote substrate)** | Fly-substrate health, not an agent entity. |
| `GET /api/remote/workspaces` (r.ts:124) | reads | **RELOCATE → Workspace** | Remote workspace list; Workspace domain. |
| `GET /api/remote/workspaces/:issueId` (r.ts:149) | reads | **RELOCATE → Workspace** | One remote workspace; Workspace. |
| `POST /api/remote/workspaces/:issueId/start` (r.ts:186) | writes | **RELOCATE → Workspace** | Bring up the remote workspace (machine); Workspace, not the agent. |
| `POST /api/remote/workspaces/:issueId/stop` (r.ts:217) | writes | **RELOCATE → Workspace** | Tear down the remote workspace. |
| `POST /api/remote/workspaces/:issueId/agent/start` (r.ts:248) | writes | **`AgentWriter.spawn(..., { host: "fly", tier })`** | Spawn the agent on the remote host → the one spawn verb with a host arg (`host_override`). |
| `POST /api/remote/workspaces/:issueId/agent/stop` (r.ts:286) | writes | **`AgentWriter.stop(id)`** | Stop the remote agent → the one stop verb. |
| `GET /api/remote/workspaces/:issueId/agent/output` (r.ts:312) | reads | **RELOCATE → Transcripts** | Remote pane output; Transcripts plane (same as local `/output`). |
| `POST /api/remote/workspaces/:issueId/agent/tell` (r.ts:340) | writes | **RESIDUE → delivery** (§1E) | Message to the remote agent process; the delivery residue, host-aware. |

## 1D. CLI verbs (`pan ...`) — issue-keyed, resolved to the work agent

Each verb takes an **issue id**, resolves it to `agent-<issue-lc>` (the work
agent), and calls the **agent-keyed** writer. The resolution step is the no-loss
bridge between the issue-keyed CLI and the agent-keyed writer.

| Current verb | r/w | New door | Reason |
|---|---|---|---|
| `pan start <id>` (cli/index.ts:515) | writes | **`AgentWriter.spawn(...)`** (+ IssueWriter.advance "working") | Spine move 3; the agent spawn (issues.md splits the stage flip to Issues). |
| `pan kill <id>` (cli/index.ts:405) | writes | **`AgentWriter.stop(id)`** | Stop agent, preserve workspace. |
| `pan pause <id>` (cli/index.ts:411) | writes | **`AgentWriter.pause(id, reason)`** | `agents.paused`; the `--reason` flag → `paused_reason`. |
| `pan unpause <id>` (cli/index.ts:417) | writes | **`AgentWriter.unpause(id)`** | Clear the pause gate. |
| `pan untroubled <id>` (cli/index.ts:422) | writes | **`AgentWriter.clearTroubled(id)`** | Clear the troubled gate + failure counters. |
| `pan resume <id>` (cli/index.ts:451) | writes | **`AgentWriter.resume(id, { host?, compact? })`** | Resume from saved session; `--host` → spawn-on-host (`host_override`), `--compact` → fresh-session reseed. |
| `pan recover [id]` (cli/index.ts:459) | writes | **`AgentWriter.resume(id)`** (orphan path) | Recover crashed/stopped; `--all` loops the verb; `--model` → switchModel-then-resume. |
| `pan restart <id>` (cli/index.ts:350) | writes | **`AgentWriter.stop(id)` then `.resume(id)`** | Composed from the two verbs. |
| `pan tell <id> <msg>` (cli/index.ts:400) | writes | **RESIDUE → delivery** (§1E) | Message delivery to the live process. |
| `pan show <id>` (cli/index.ts:304) | reads | **aggregate → recomposed** (Agents + Issues + Cost) | God-view; cross-domain (matches issues.md `pan show`). |
| `pan status` (cli/index.ts:585) | reads | **aggregate → recomposed** | System overview; cross-domain (matches issues.md `pan status`). |
| `pan switch-model` (operator; HTTP `switch-model`, no top-level CLI verb) | writes | **`AgentWriter.switchModel(id, model)`** | Listed in the task; the operator action is the `switch-model` route — the writer verb is the same. |
| `pan wake` (skill/HTTP "Resume All Halted Agents") | writes | **`AgentWriter.resume(id)` ×N** | "Wake all halted" = resume each gated agent; same verb. (No legacy named-specialist wake — that's DELETE, §1B.) |
| `pan sync-main <id>` (cli/index.ts:467) | writes | **RELOCATE → Merge/git op** | Rebase; no agent-state change (matches issues.md). |

## 1E. RPC methods (`packages/contracts/src/rpc.ts`)

| Current RPC method | r/w | New door | Reason |
|---|---|---|---|
| `pan.startAgent` (rpc.ts:63, `WS_METHODS.startAgent`) | writes | **`AgentWriter.spawn(...)`** (+ IssueWriter.advance "working") | RPC mutation delegates to the same writer as HTTP (CONVENTIONS §8: HTTP & RPC cannot diverge). |
| `pan.deepWipe` (rpc.ts:64) | writes | **`AgentWriter.stop(id)` + teardown** (+ IssueWriter.advance "todo") | The destructive teardown's *process* half (kill tmux, remove agent dir) is Agents'; the stage reset is Issues'; workspace/branch teardown is Workspace (matches issues.md deep-wipe split). |
| `pan.getSnapshot` (rpc.ts:44) | reads | **aggregate → recomposed** from all resolvers | The read-model snapshot spans every domain; the agents slice is `AgentsResolver.list`. |
| `pan.getWorkspaceDetail` (rpc.ts:48) | reads | **aggregate → recomposed** | Batched workspace view; the agents slice is `AgentsResolver.get`/`getRuntime`. |

The live agent slice of `pan.subscribeDomainEvents` (rpc.ts:35) is fed by
`AgentWriter`'s `bus.emit` and exposed as the Agents RPC subscription
(`agents.subscribe`, CONVENTIONS §8).

## 1F. Rollup of the collapse

| Surface | Current sites touching agent runtime | New home |
|---|---|---|
| **HTTP — three parallel doors** | **75** (agents 35 + specialists 31 + remote 9) | **5 resolver reads** + **12 writer verbs**; the rest **relocate** (Orchestration / Conversations / Cost / Workspace / Issues / agent-permissions) or **delete** (5 legacy specialist verbs) |
| CLI verbs enumerated | 14 agent-touching verbs | the same writer set, **issue→agent resolved**; show/status recompose; sync-main relocates |
| RPC methods enumerated | 4 agent-touching methods | `startAgent`/`deepWipe` → writer verbs; snapshot/workspace-detail recompose |
| **Squatter columns evicted** | **9** (`review_*` ×7 + `inspect_sub_role` + the review-run half of specialists.ts) | **Orchestration** (`review_runs`/`review_run_agents`) — already in the locked schema |
| **44 `agents` columns** | the runtime registry | **18-field NEED set** (AUDIT headline: 21 KEEP − 3 MERGE); 10 DROP/DERIVE, 10 MOVE leave the table |
| `state.json` plane | ~48 files read/write/parse | **DELETED** (AUDIT "DELETE THE PLANE"); the table is the sole runtime store |

**Collapse counts (current → new):**

- **75 HTTP endpoints → 17 Agents members** (5 resolver + 12 writer).
- **DELETED outright (5):** `specialists/:name/wake`, `:name/reset`,
  `reset-all`, `:name/init`, and the legacy named-specialist plane they belong to
  (CLAUDE.md: "Legacy specialist wake/session/queue machinery has been removed").
- **RELOCATED, not lost (the no-loss integrity column):** the entire review-run
  half of `specialists.ts` (runs/grace/context/complete/restart/terminate) +
  `agents/:id/stuck` + `classify-completion` → **Orchestration**; `specialists/done`
  + `report-status` + `:type/status` + `work-complete` → **Issues**; remote
  workspace start/stop + `git-info` + `files` → **Workspace**; output/conversation/
  activity → **Transcripts**; cost → **Cost**; handoff(+suggestion) →
  **Conversations**; pending-questions/answer-question + permission-request/response
  → **Q&A / agent-permissions**; remote `status` + `models/resolve` →
  **Infra/Settings**.

The 75 → (17 kept + relocated + 5 deleted) reconciles: nothing real is lost.

## 1G. What did NOT fit the resolver/writer model — the genuine residue

After the collapse, the surfaces that are **neither a cache read nor a cache
write** — they act on the *live tmux process* — are enumerated; they do not vanish,
they live behind a thin delivery/process verb (or a sibling domain), explicitly
**not** an `AgentWriter` cache verb:

1. **Message delivery** (`/message`, `/tell`, `/poke`, remote `/agent/tell`,
   `pan tell`). The single primitive is `deliverAgentMessage(agentId, message,
   caller?)` (CLAUDE.md "PTY supervisor" section: supervisor → channels → tmux).
   It mutates **no cache row** — it pushes bytes into Claude's PTY. This is the
   main residue. It is a **delivery service**, parallel to but outside the read/
   write doors (like the raw `/ws/terminal` WebSocket bypassing Effect RPC).
2. **Q&A (AskUserQuestion)** (`/pending-questions` read, `/answer-question`
   write). The in-flight-AUQ surface (project memory `project_auq_dashboard_pipeline`)
   is its own concern; relocates to the Q&A surface, not the agents cache.
3. **Permission prompts** (`/permission-request`, `/permission-response`).
   Relocate to the `agent-permissions` module — they gate harness tool calls,
   orthogonal to agent identity/lifecycle.
4. **Handoff** (`/handoff`, `/handoff/suggestion`). Spawns a *conversation*;
   relocates to Conversations.
5. **The `runtime.json` plane** is read (not a column). `getRuntime` reads the
   file behind the pointer (AUDIT caveat 174-179); it is modeled as a resolver
   read of a *separate plane*, exactly as `IssuesResolver.getPlan` reads
   `.pan/specs` — never folded into a cache column.

Everything else is a lifecycle write (`AgentWriter`), a registry/health/liveness
read (`AgentsResolver`), a sibling-domain relocation, or a deletion.

---

# Part 2 — The Effect services (derived from the mapping)

Written in the verified v4-beta idiom from
[`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md):
`Context.Service` (never `Effect.Service`), `effect/unstable/*` imports, Drizzle
behind the `Db` service, `Schema.Literals([...])` taking arrays,
`Schema.TaggedErrorClass`, the **hybrid** writer ordering (source-first for
harness/model, pure-cache for the lifecycle gates — §5 rules 1 & 2). Every method
below traces to a Part-1 row.

## 2.1 Entities & errors — `Schema`

Columns are the **18-field NEED set** from the agents-state-audit (44 → 18), on
the locked `agents` table ([`../overdeck-schema.ts`](../overdeck-schema.ts) 55-77).

```ts
import { Effect, Layer, Context, Schema } from "effect"
import { eq, and } from "drizzle-orm"
import { agents, healthEvents } from "../overdeck-schema"   // the locked Drizzle tables
import { IssueId } from "./issues"                          // branded id reused (agents.issue_id → issues.id FK)
import { Db, Records, EventBus, Tmux } from "./infra"       // Db = Drizzle; Records = git .pan/records (harness/model); Tmux = liveness oracle

// ── Branded id + literal unions (CONVENTIONS §2) ──────────────────────────────
export const AgentId = Schema.String.pipe(Schema.brand("AgentId"))
export type  AgentId = typeof AgentId.Type

// role + status are literal unions, not free strings (overdeck-schema 58-59)
export const Role   = Schema.Literals(["work", "review", "plan", "ship"])
export type  Role   = typeof Role.Type
// status is a CACHE of the tmux oracle — reconciled, never operator-set (AUDIT surprise #1)
export const Status = Schema.Literals(["starting", "running", "idle", "stopped", "crashed"])
export type  Status = typeof Status.Type

export const DeliveryMethod = Schema.Literals(["auto", "supervisor", "channels", "tmux"])

// ── The Agent entity — the DB-row decoder AND the API success type ─────────────
// The 18-field NEED set (AUDIT lines 16-26). harness/model are MIRRORS of the git
// record (AUDIT surprise #7). The failure-gate quartet is load-bearing; the four
// display timestamps are DROPped (AUDIT surprise #3).
export const Agent = Schema.Struct({
  id:                     AgentId,
  issueId:                IssueId,                                  // FK → issues.id
  role:                   Role,
  status:                 Status,                                  // cache of tmux oracle
  workspace:              Schema.String,
  sessionId:              Schema.NullOr(Schema.String),            // soft pointer → transcripts
  harness:                Schema.String,                          // MIRROR; git record authoritative
  model:                  Schema.String,                          // MIRROR; git record authoritative
  hostOverride:           Schema.NullOr(Schema.String),           // "fly" → remote (the third surface)
  deliveryMethod:         Schema.NullOr(DeliveryMethod),          // absorbs supervisor/channels booleans
  startedAt:              Schema.NullOr(Schema.Date),
  lastResumeAt:           Schema.NullOr(Schema.Date),
  stoppedByUser:          Schema.NullOr(Schema.Boolean),          // absorbs stopped_by_pause (AUDIT #5)
  kickoffDelivered:       Schema.NullOr(Schema.Boolean),
  // ── lifecycle gates (pure-cache; no durable source) ──
  paused:                 Schema.NullOr(Schema.Boolean),
  pausedReason:           Schema.NullOr(Schema.String),
  troubled:               Schema.NullOr(Schema.Boolean),
  consecutiveFailures:    Schema.Number,
  firstFailureInRunAt:    Schema.NullOr(Schema.Date),
  lastFailureNextRetryAt: Schema.NullOr(Schema.Date),
  updatedAt:              Schema.Date,
})
export type Agent = typeof Agent.Type

export const AgentFilter = Schema.Struct({
  issueId: Schema.optional(IssueId),
  role:    Schema.optional(Role),
  status:  Schema.optional(Status),
})
export type AgentFilter = typeof AgentFilter.Type

// health_events projection (overdeck-schema 81-88) — read by getHealthHistory,
// written by recordHealth (the heartbeat ingestion, the ONE health mutator).
export const HealthState = Schema.Literals([
  "starting", "running", "idle", "waiting", "stopped", "crashed", "dead",
])
export const HealthEvent = Schema.Struct({
  agentId:   Schema.NullOr(AgentId),
  timestamp: Schema.Date,
  state:     HealthState,
  source:    Schema.NullOr(Schema.String),
  metadata:  Schema.NullOr(Schema.Unknown),
})
export type HealthEvent = typeof HealthEvent.Type

// ── Errors — tagged, in the E channel (CONVENTIONS §3) ─────────────────────────
export class AgentNotFound extends Schema.TaggedErrorClass<AgentNotFound>()(
  "AgentNotFound", { id: AgentId },
) {}
export class AgentNotResumable extends Schema.TaggedErrorClass<AgentNotResumable>()(
  "AgentNotResumable", { id: AgentId, reason: Schema.String },   // paused/troubled/workspace-missing gate
) {}
export class InvalidModel extends Schema.TaggedErrorClass<InvalidModel>()(
  "InvalidModel", { model: Schema.String },                      // requireModelOverrideSync failure (a.ts:3788)
) {}
```

## 2.2 `AgentsResolver` — the read door (`Context.Service`)

Five methods, each tracing to Part-1 §1A/§1B/§1C reads: `get`, `list` (the
registry, collapsing `GET /api/agents` + the two `specialists` list reads),
`isAlive` (the liveness oracle, folding `tmux-alive` + `has-session`),
`getRuntime` (the `runtime.json` plane behind the pointer), `getHealthHistory`
(the `health_events` projection, folding `health-history` + `cloister-health`).

```ts
export class AgentsResolver extends Context.Service<AgentsResolver, {
  readonly get:              (id: AgentId)     => Effect.Effect<Agent, AgentNotFound>
  readonly list:             (f: AgentFilter)  => Effect.Effect<ReadonlyArray<Agent>>
  readonly isAlive:          (id: AgentId)     => Effect.Effect<boolean>                    // tmux oracle
  readonly getRuntime:       (id: AgentId)     => Effect.Effect<unknown, AgentNotFound>     // runtime.json plane
  readonly getHealthHistory: (id: AgentId)     => Effect.Effect<ReadonlyArray<HealthEvent>>
}>()("overdeck/AgentsResolver") {}

export const AgentsResolverLayer = Layer.effect(AgentsResolver, Effect.gen(function* () {
  const { q } = yield* Db        // Drizzle handle — appears ONLY in resolver/writer Layer R
  const tmux  = yield* Tmux      // liveness oracle (-L panopticon)

  const decode       = Schema.decodeUnknown(Agent)
  const decodeHealth = Schema.decodeUnknown(HealthEvent)

  const get = (id: AgentId) => Effect.gen(function* () {
    const row = yield* Effect.sync(() =>
      q.select().from(agents).where(eq(agents.id, id)).get())
    return row
      ? yield* decode(row)
      : yield* Effect.fail(new AgentNotFound({ id }))
  })

  const list = (f: AgentFilter) => Effect.gen(function* () {
    const where = [
      f.issueId ? eq(agents.issueId, f.issueId) : undefined,
      f.role    ? eq(agents.role,    f.role)    : undefined,
      f.status  ? eq(agents.status,  f.status)  : undefined,
    ].filter(Boolean)
    const rows = yield* Effect.sync(() =>
      where.length ? q.select().from(agents).where(and(...where)).all()
                   : q.select().from(agents).all())
    return yield* Effect.forEach(rows, decode)
  })

  // liveness oracle — folds /tmux-alive + /has-session (Part-1 §1A). tmux, not a column.
  const isAlive = (id: AgentId) =>
    Effect.sync(() => tmux.hasSession(id))      // session name == agent id

  // the runtime.json plane (a separate file, like getPlan reads .pan/specs).
  const getRuntime = (id: AgentId) => Effect.gen(function* () {
    yield* get(id)                              // 404s if unknown
    return yield* tmux.readRuntimeJson(id)      // live activity/idle/currentTool
  })

  // the health_events projection — folds /health-history + /cloister-health.
  const getHealthHistory = (id: AgentId) => Effect.gen(function* () {
    const rows = yield* Effect.sync(() =>
      q.select().from(healthEvents)
        .where(eq(healthEvents.agentId, id))
        .orderBy(healthEvents.timestamp).all())
    return yield* Effect.forEach(rows, decodeHealth)
  })

  return AgentsResolver.of({ get, list, isAlive, getRuntime, getHealthHistory })
}))
```

## 2.3 `AgentWriter` — the write door (`Context.Service`)

Twelve verbs, derived from Part-1 §1A/§1B/§1C/§1D writes. **No `advance()`** — the
collapse is door-dedup, not transition-absorption (headline finding). The
durability mode is named per verb (§5 rules 1 & 2).

```ts
export class AgentWriter extends Context.Service<AgentWriter, {
  // ── IDENTITY/SPAWN-CONFIG — source-first (writes the harness/model git record) ──
  readonly spawn:       (opts: SpawnOpts) => Effect.Effect<Agent, InvalidModel>             // start / startAgent / remote agent/start / specialists spawn
  readonly switchModel: (id: AgentId, model: string) =>
    Effect.Effect<Agent, AgentNotFound | InvalidModel>                                      // switch-model / reset-session / reset-session(specialist)
  // ── LIVENESS — pure-cache (the cache write IS the whole write) ──
  readonly stop:        (id: AgentId, opts?: { suspend?: boolean }) =>
    Effect.Effect<Agent, AgentNotFound>                                                     // stop / DELETE / suspend / kill / remote stop / specialist kill
  readonly resume:      (id: AgentId, opts?: ResumeOpts) =>
    Effect.Effect<Agent, AgentNotFound | AgentNotResumable>                                 // resume / recover / restart(2nd half) / wake / restart-all
  readonly setStatus:   (id: AgentId, status: Status) => Effect.Effect<Agent, AgentNotFound> // tmux-reconcile write (deacon patrol) — the ONLY status mutator
  readonly setDeliveryMethod: (id: AgentId, method: DeliveryMethod) =>
    Effect.Effect<Agent, AgentNotFound>                                                     // delivery-method
  // ── LIFECYCLE-GATE — pure-cache; OWNED here per issues.md headline finding ──
  readonly pause:         (id: AgentId, reason?: string) => Effect.Effect<Agent, AgentNotFound> // pause (sets gate + stops; folds stopped_by_pause)
  readonly unpause:       (id: AgentId) => Effect.Effect<Agent, AgentNotFound>                   // unpause (clears gate + restores resumability)
  readonly markTroubled:  (id: AgentId) => Effect.Effect<Agent, AgentNotFound>                   // failure machinery (deacon)
  readonly clearTroubled: (id: AgentId) => Effect.Effect<Agent, AgentNotFound>                   // untroubled
  readonly recordFailure: (id: AgentId, reason: string) => Effect.Effect<Agent, AgentNotFound>   // applyAgentFailure: counter + backoff + troubled threshold
  // ── HEALTH PROJECTION — pure-cache; the ONE health_events mutator ──
  readonly recordHealth:  (id: AgentId, ev: HealthEvent) => Effect.Effect<void>                  // heartbeat ingestion
}>()("overdeck/AgentWriter") {}

export const AgentWriterLayer = Layer.effect(AgentWriter, Effect.gen(function* () {
  const { q }   = yield* Db              // Drizzle handle (agents + health_events ONLY — NOT review_runs)
  const records = yield* Records         // git .pan/records — SOURCE OF TRUTH for harness/model ONLY
  const bus     = yield* EventBus
  const now     = () => new Date()

  // ── SOURCE-FIRST verbs (§5 rule 1) — harness/model record is authoritative ──
  const spawn = (opts: SpawnOpts) => Effect.gen(function* () {
    const model = yield* validateModel(opts.model)               // requireModelOverrideSync → InvalidModel
    // 1. SOURCE OF TRUTH FIRST: mirror harness/model into the per-issue git record (PAN-1919).
    yield* records.writeAgentIdentity(opts.issueId, { harness: opts.harness, model })
    // 2. THEN spawn the process + insert the cache row (failure-checked, never fire-and-forget).
    const agent = yield* spawnProcessAndRow(opts, model)         // tmux session + agents-row upsert
    yield* bus.emit({ type: "agent.spawned", payload: { id: agent.id, issueId: opts.issueId } })
    return agent
  })

  const switchModel = (id: AgentId, model: string) => Effect.gen(function* () {
    const resolver = yield* AgentsResolver
    const agent    = yield* resolver.get(id)                     // 404s if unknown
    const valid    = yield* validateModel(model)                 // InvalidModel
    // 1. SOURCE FIRST: rewrite the model in the git record.
    yield* records.writeAgentIdentity(agent.issueId, { harness: agent.harness, model: valid })
    // 2. THEN stop + clear session + mirror the column (the hand-rolled file edits collapse here).
    yield* stopProcessAndClearSession(id)
    const next: Agent = { ...agent, model: valid, sessionId: null, status: "stopped", updatedAt: now() }
    yield* Effect.sync(() =>
      q.update(agents).set({ model: valid, sessionId: null, status: "stopped", updatedAt: next.updatedAt })
        .where(eq(agents.id, id)).run())
    yield* bus.emit({ type: "agent.model_switched", payload: { id, model: valid } })
    return next
  })

  // ── PURE-CACHE verbs (§5 rule 2) — no durable source; the cache write is the write ──
  const pause = (id: AgentId, reason?: string) => Effect.gen(function* () {
    const resolver = yield* AgentsResolver
    const agent    = yield* resolver.get(id)
    const wasLive  = yield* resolver.isAlive(id)
    if (wasLive) yield* stopProcess(id)                          // pause stops if running
    // stopped_by_pause folds into paused (AUDIT #5): stamp stoppedByUser only when the stop was a pause-stop.
    const next: Agent = {
      ...agent, paused: true, pausedReason: reason ?? null,
      stoppedByUser: wasLive ? true : agent.stoppedByUser,
      status: wasLive ? "stopped" : agent.status, updatedAt: now(),
    }
    yield* Effect.sync(() =>
      q.update(agents).set({
        paused: true, pausedReason: reason ?? null,
        stoppedByUser: next.stoppedByUser, status: next.status, updatedAt: next.updatedAt,
      }).where(eq(agents.id, id)).run())
    yield* bus.emit({ type: "agent.paused", payload: { id, reason } })
    return next
  })

  const unpause = (id: AgentId) => Effect.gen(function* () {
    const resolver = yield* AgentsResolver
    const agent    = yield* resolver.get(id)
    // clear the gate; restore resumability iff the stop was a pause-stop (AUDIT row 80).
    const next: Agent = { ...agent, paused: false, pausedReason: null, stoppedByUser: false, updatedAt: now() }
    yield* Effect.sync(() =>
      q.update(agents).set({ paused: false, pausedReason: null, stoppedByUser: false, updatedAt: next.updatedAt })
        .where(eq(agents.id, id)).run())
    yield* bus.emit({ type: "agent.unpaused", payload: { id } })
    return next
  })

  const clearTroubled = (id: AgentId) => Effect.gen(function* () {
    const resolver = yield* AgentsResolver
    const agent    = yield* resolver.get(id)
    const next: Agent = {
      ...agent, troubled: false, consecutiveFailures: 0,
      firstFailureInRunAt: null, lastFailureNextRetryAt: null, updatedAt: now(),
    }
    yield* Effect.sync(() =>
      q.update(agents).set({
        troubled: false, consecutiveFailures: 0,
        firstFailureInRunAt: null, lastFailureNextRetryAt: null, updatedAt: next.updatedAt,
      }).where(eq(agents.id, id)).run())
    yield* bus.emit({ type: "agent.untroubled", payload: { id } })
    return next
  })

  // stop / resume / setStatus / setDeliveryMethod / markTroubled / recordFailure /
  // recordHealth follow the same pure-cache shape (resolve → mutate the agents/
  // health_events row → emit). recordFailure applies the rolling-window + backoff +
  // troubled-threshold logic from applyAgentFailure (AUDIT rows 91-95). recordHealth
  // inserts a health_events row — the ONE mutator of that projection. Omitted for length.

  return AgentWriter.of({
    spawn, switchModel, stop, resume, setStatus, setDeliveryMethod,
    pause, unpause, markTroubled, clearTroubled, recordFailure, recordHealth,
  })
}))
```

> **Why `AgentWriter`'s `R` is clean.** Its dependencies are `Db` (the `agents` +
> `health_events` tables only), `Records` (for the harness/model mirror **only**),
> `EventBus`, and `AgentsResolver`. It **never** receives `review_runs` /
> `review_run_agents` (Orchestration) or `issues` (Issues) — so it physically
> *cannot* write review-run runtime or flip a stage. That is the headline finding
> enforced by the type system, not a convention.

## 2.4 `AgentsApi` — the controller (`HttpApiGroup`)

Each endpoint declares request / success / error Schemas and delegates to the two
services; the handler's `R` is `AgentsResolver | AgentWriter`, never `Db`
(CONVENTIONS §7 door enforcement). The delivery residue (§1G) is **not** here — it
stays a separate delivery service, like the raw `/ws/terminal` WebSocket bypassing
Effect RPC.

```ts
import { HttpApi, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder } from "effect/unstable/httpapi"

export const AgentsApi = HttpApiGroup.make("agents")
  // ── reads ──
  .add(HttpApiEndpoint.get("list", "/agents", { urlParams: AgentFilter, success: Schema.Array(Agent) }))
  .add(HttpApiEndpoint.get("get", "/agents/:id", {
    params: Schema.Struct({ id: AgentId }), success: Agent, error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.get("isAlive", "/agents/:id/alive", {
    params: Schema.Struct({ id: AgentId }), success: Schema.Boolean,
  }))
  .add(HttpApiEndpoint.get("runtime", "/agents/:id/runtime", {
    params: Schema.Struct({ id: AgentId }), success: Schema.Unknown, error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.get("health", "/agents/:id/health-history", {
    params: Schema.Struct({ id: AgentId }), success: Schema.Array(HealthEvent),
  }))
  // ── writes ──
  .add(HttpApiEndpoint.post("spawn", "/agents", { payload: SpawnOpts, success: Agent, error: InvalidModel }))
  .add(HttpApiEndpoint.post("stop", "/agents/:id/stop", {
    params: Schema.Struct({ id: AgentId }),
    payload: Schema.Struct({ suspend: Schema.optional(Schema.Boolean) }),
    success: Agent, error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.post("resume", "/agents/:id/resume", {
    params: Schema.Struct({ id: AgentId }), payload: ResumeOpts,
    success: Agent, error: Schema.Union([AgentNotFound, AgentNotResumable]),
  }))
  .add(HttpApiEndpoint.post("pause", "/agents/:id/pause", {
    params: Schema.Struct({ id: AgentId }),
    payload: Schema.Struct({ reason: Schema.optional(Schema.String) }),
    success: Agent, error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.post("unpause", "/agents/:id/unpause", {
    params: Schema.Struct({ id: AgentId }), success: Agent, error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.post("untroubled", "/agents/:id/untroubled", {
    params: Schema.Struct({ id: AgentId }), success: Agent, error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.post("switchModel", "/agents/:id/switch-model", {
    params: Schema.Struct({ id: AgentId }), payload: Schema.Struct({ model: Schema.String }),
    success: Agent, error: Schema.Union([AgentNotFound, InvalidModel]),
  }))
  .add(HttpApiEndpoint.post("deliveryMethod", "/agents/:id/delivery-method", {
    params: Schema.Struct({ id: AgentId }), payload: Schema.Struct({ deliveryMethod: DeliveryMethod }),
    success: Agent, error: AgentNotFound,
  }))
  .add(HttpApiEndpoint.post("heartbeat", "/agents/:id/heartbeat", {
    params: Schema.Struct({ id: AgentId }), payload: HealthEvent, success: Schema.Void,
  }))

export const OverdeckApi = HttpApi.make("overdeck").add(IssuesApi).add(AgentsApi) /* … */

// handlers: pure delegation. R = AgentsResolver | AgentWriter — never Db.
export const AgentsApiLive = HttpApiBuilder.group(OverdeckApi, "agents", (h) =>
  h.handle("list",           ({ urlParams })     => AgentsResolver.list(urlParams))
   .handle("get",            ({ path })           => AgentsResolver.get(path.id))
   .handle("isAlive",        ({ path })           => AgentsResolver.isAlive(path.id))
   .handle("runtime",        ({ path })           => AgentsResolver.getRuntime(path.id))
   .handle("health",         ({ path })           => AgentsResolver.getHealthHistory(path.id))
   .handle("spawn",          ({ payload })        => AgentWriter.spawn(payload))
   .handle("stop",           ({ path, payload })  => AgentWriter.stop(path.id, payload))
   .handle("resume",         ({ path, payload })  => AgentWriter.resume(path.id, payload))
   .handle("pause",          ({ path, payload })  => AgentWriter.pause(path.id, payload.reason))
   .handle("unpause",        ({ path })           => AgentWriter.unpause(path.id))
   .handle("untroubled",     ({ path })           => AgentWriter.clearTroubled(path.id))
   .handle("switchModel",    ({ path, payload })  => AgentWriter.switchModel(path.id, payload.model))
   .handle("deliveryMethod", ({ path, payload })  => AgentWriter.setDeliveryMethod(path.id, payload.deliveryMethod))
   .handle("heartbeat",      ({ path, payload })  => AgentWriter.recordHealth(path.id, payload)))
```

The dashboard's live RPC surface (CONVENTIONS §8) delegates to the **same**
resolver/writer so HTTP and RPC cannot diverge — `agents.get` / `agents.list`
reuse `AgentsResolver`; `agents.subscribe` streams the writer's `bus.emit`
events; `pan.startAgent` / `pan.deepWipe` (Part-1 §1E) map to `AgentWriter.spawn`
/ `AgentWriter.stop` (with the stage flip / teardown owned by Issues / Workspace).

## 2.5 Layer wiring

```ts
const AgentsDomainLayer = Layer.mergeAll(
  AgentsResolverLayer,
  AgentWriterLayer,
).pipe(
  Layer.provide(DbLive),        // the ONLY place the agents/health_events handles are provided
  Layer.provide(RecordsLive),   // git .pan/records — harness/model mirror ONLY
  Layer.provide(EventBusLive),
  Layer.provide(TmuxLive),      // liveness oracle (-L panopticon)
)

const HttpLive = HttpApiBuilder.serve(OverdeckApi).pipe(
  Layer.provide(AgentsApiLive),
  Layer.provide(AgentsDomainLayer),
)
// NodeRuntime.runMain(Layer.launch(HttpLive))  — Node 22 only (dashboard rule)
```

A missing dependency is a **compile error at the merge**, not a runtime failure
(CONVENTIONS §6). Because `AgentsApiLive`'s handler `R` resolves to
`AgentsResolver | AgentWriter` and neither leaks `Db`, no controller can read or
write the cache directly; and because `AgentWriter`'s `R` never contains
`review_runs`, it cannot reach into Orchestration.

---

## Acceptance — every method traces to a Part-1 row

| Service member | Part-1 source rows |
|---|---|
| `AgentsResolver.get` | §1A `GET /api/agents` (by id); §1E `getWorkspaceDetail` slice |
| `AgentsResolver.list` | §1A `GET /api/agents`; §1B `GET /api/specialists`, `/specialists/projects`; §1E `getSnapshot` slice |
| `AgentsResolver.isAlive` | §1A `GET /api/agents/:id/tmux-alive`, `/has-session` |
| `AgentsResolver.getRuntime` | §1A `GET /api/agents/:id/runtime` (the runtime.json plane) |
| `AgentsResolver.getHealthHistory` | §1A `GET /api/agents/:id/health-history`, `/cloister-health` |
| `AgentWriter.spawn` | §1A `POST /api/agents`; §1B `/specialists/:type/spawn`; §1C remote `agent/start`; §1D `pan start`; §1E `pan.startAgent` |
| `AgentWriter.switchModel` | §1A `/switch-model`, `/reset-session`; §1B `/projects/:project/:name/reset-session` |
| `AgentWriter.stop` | §1A `/stop`, `DELETE`, `/suspend`; §1B `/:type/kill`; §1C remote `agent/stop`; §1D `pan kill`; §1E `pan.deepWipe` (process half) |
| `AgentWriter.resume` | §1A `/resume`, `/recover`, `/restart-all`; §1D `pan resume`, `pan recover`, `pan wake`; §1A `/restart` (2nd half) |
| `AgentWriter.pause` / `unpause` | §1A `/pause`, `/unpause`; §1D `pan pause`, `pan unpause` (the issues.md-routed side-state) |
| `AgentWriter.clearTroubled` | §1A `/untroubled`; §1D `pan untroubled` |
| `AgentWriter.markTroubled` / `recordFailure` / `setStatus` | the deacon failure/liveness reconcile machinery (AUDIT rows 89-95, surprise #1) feeding the same lifecycle gates |
| `AgentWriter.setDeliveryMethod` | §1A `/delivery-method` |
| `AgentWriter.recordHealth` | §1A `/heartbeat` (the health_events projection) |
| relocated / deleted / residue | §1F rollup + §1G — none map to an Agents member by design |

No method reads or writes a column outside the locked `agents` / `health_events`
tables; no `review_*` column survives on the Agent entity; no endpoint is
invented; nothing real from the three current surfaces is lost.
