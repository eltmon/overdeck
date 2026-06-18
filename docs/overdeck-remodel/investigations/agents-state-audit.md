# Overdeck Remodel — Agents Runtime-State Field Audit

**Goal:** radical complexity reduction on a fresh empty DB. Keep only the fields
the agent-runtime registry genuinely NEEDS ("NEED, not nice-to-have"). For each
of the 44 `agents`-table columns: where it is written, where it is read, whether
a read actually BRANCHES on it, a verdict (`KEEP` / `DROP` / `MERGE-INTO` /
`DERIVE` / `MOVE`), and a class for each KEEP (IDENTITY/SPAWN-CONFIG ·
LIVENESS/RUNTIME-STATUS · LIFECYCLE-GATE · BELONGS-TO-ANOTHER-DOMAIN).

Method: every column traced through its camelCase accessor across `src/`
(non-test). The discriminator is **does any read drive control flow** (an
`if`/`filter`/comparison/gate), not whether the field is "touched". Display reads
(serialized to the frontend / activity feed / log lines) and pass-throughs
(copied into another snapshot verbatim) are called out as such.

**Headline counts (verdict-column tally):** 44 columns audited →
**21 KEEP · 3 MERGE · 10 DROP/DERIVE · 10 MOVE** (= 44). Of the 21 KEEP:
**9 IDENTITY/SPAWN-CONFIG, 10 LIFECYCLE-GATE, 2 LIVENESS**.

**Post-collapse NEED set = 18 fields.** Apply the three MERGEs (the two transport
booleans fold into `delivery_method`; `stopped_by_pause` folds into `paused`):
`21 KEEP − 3 MERGE = 18`. The other 20 columns (10 DROP/DERIVE + 10 MOVE) leave
the table entirely. ~160 read+write matches across ~14 non-test files touch the
agents-table set, and **48 files** touch `state.json` — that is the complexity
surface the collapse shrinks. **`state.json` carries nothing reconstructable-only
from itself and should be deleted as a plane.**

## Glossary

- **Branch-read** — a read that feeds an `if`/`filter`/`switch`/comparison that
  changes what the runtime does. Opposite: **display read** (value only
  serialized to the frontend / activity feed / log line) or **pass-through**
  (copied into another snapshot verbatim).
- **Single write path** — almost every agents-table column is written through one
  function: `upsertAgent` → `agentToParams` (`src/lib/database/agents-db.ts:132,242`),
  fed by `saveAgentStateSync` / `saveAgentState` (`src/lib/agents.ts:1135,1166`)
  and read back through `rowToAgent` (`agents-db.ts:65`). "Written-at" below names
  the *semantic* writer (the helper that sets the field on `AgentState`), not this
  plumbing. The backfill path `backfillAgentsFromStateJsonSync`
  (`src/lib/database/agent-backfill.ts:166`) is a second writer used only by the
  v54→v55 migration and `pan admin db rebuild-agents`.
- **The three planes (PAN-1908, `docs/AGENT-STATE-PLANES.md`):**
  1. **git record** — `.pan/<recordsPath>/<issue>.json`, permanent, per-issue.
     Holds `harness`/`model` (PAN-1919), the pipeline verdict block, owner lease.
  2. **SQLite `agents` table** — the authoritative runtime registry (this audit).
  3. **tmux `-L overdeck`** — liveness oracle.
  Plus two *file* planes that are NOT the agents table and NOT in scope as columns
  but matter for derivability: **`state.json`** (`~/.overdeck/agents/<id>/state.json`,
  "rollback/rebuild source only") and **`runtime.json`** (`AgentRuntimeState`,
  live activity/idle/tool — `src/lib/agents.ts:2303`).
- **IDENTITY/SPAWN-CONFIG** — defines the agent and is needed to (re)spawn or
  resume it.
- **LIVENESS/RUNTIME-STATUS** — derivable from tmux and/or the JSONL transcript;
  pure cache when stored.
- **LIFECYCLE-GATE** — the pause/troubled/failure machinery that suppresses or
  schedules auto-resume.
- **BELONGS-TO-ANOTHER-DOMAIN** — squatter columns whose only consumers are
  Orchestration's review-run / inspect-run / flywheel machinery, or Cost.

---

## Table — `agents` table (44 columns)

| Field | Written-at (semantic) | Branch-read-at | What it drives | Verdict | Class |
| --- | --- | --- | --- | --- | --- |
| `id` | spawn (`saveAgentStateSync`) | PK; every `getAgent`/`getAgentWithDb` keys on it; tmux session name == id | Agent identity; liveness oracle key | **KEEP** | IDENTITY/SPAWN-CONFIG |
| `issue_id` | spawn | resolve project/record, review-status lookup (`getReviewStatusSync(state.issueId)` deacon 6680), `isIssueClosed` (6717) | Which issue the agent serves; ties to permanent record | **KEEP** | IDENTITY/SPAWN-CONFIG |
| `role` | spawn | `if (state.role !== 'work')` resume gate (deacon.ts:6632); `role === 'work'` filters everywhere; launcher frontmatter (`launchRole`, agents.ts:2942) | Resume eligibility, launcher role, every role filter | **KEEP** | IDENTITY/SPAWN-CONFIG |
| `status` | spawn / stop / orphan recovery | `status !== 'running' && !== 'starting'` (deacon.ts:5670); `reconcileAgentStatus` (backfill 238); `listAgentsByStatusRole` | Gates patrols; reconciled against tmux | **KEEP** | LIVENESS/RUNTIME-STATUS (but see surprise #1 — reconciled from tmux every patrol) |
| `workspace` | spawn | `!existsSync(state.workspace)` resume gate (deacon.ts:6638); cwd for every git/launcher op | Where the agent runs; resume refuses if missing | **KEEP** | IDENTITY/SPAWN-CONFIG |
| `harness` | spawn; **mirrored to git record** (PAN-1919) | launcher path selection (`opts.harness === 'pi'/'codex'`, agents.ts:2948); session-drift (`sessionResumeDriftReasons` 2337) | Which harness to launch/resume under | **KEEP** | IDENTITY/SPAWN-CONFIG — **but authoritative copy is the git record** (`getAgentStateSync` merges it back in at agents.ts:1102). Column is a denormalized cache. |
| `model` | spawn; **mirrored to git record** (PAN-1919) | `requireModelOverrideSync(opts.model)` (agents.ts:2914); session-drift (2334) | Which model to launch/resume under | **KEEP** | IDENTITY/SPAWN-CONFIG — same note as `harness`: git record is authoritative. |
| `branch` | spawn | **none found** — workspaces.ts:6010 `branch === 'main'` reads a git-op result object, not the agent column | Nothing branches on it; derivable as `feature/<issue-id-lc>` | **DERIVE** | — |
| `session_id` | spawn / fresh-respawn | resume: `resumeSessionId`, `--resume <id>` (agents.ts:4875,3028); redeliver warn (1757) | Claude Code session to resume into | **KEEP** | IDENTITY/SPAWN-CONFIG |
| `started_at` | spawn | startup-grace comparisons: reviewer grace (deacon.ts:5696), `isStartingWithinGrace`; `idleSince`/age math | Distinguishes "still booting" from "orphaned" | **KEEP** | LIFECYCLE-GATE (startup grace) |
| `last_activity` | heartbeat save | tiebreaker only: `emergencyBrake` stalest-first sort (concurrency.ts:200) — primary idle decision uses `runtime.json` (`getAgentRuntimeStateSync`, concurrency.ts:197) | Weak ordering tiebreaker; live activity lives in runtime.json | **DROP** (DERIVE from runtime.json/tmux; the brake sort can read runtime.json) | — |
| `last_resume_at` | `resumeAgent` (agents.ts:4973) | `isRapidPostResumeDeath` (deacon.ts:5648) → whether to reset failure counter; `hasLandedUserRecordSinceResume` (6424); nudge gate `!state.lastResumeAt` (6467) | Rapid-death detection; stalled-resume nudge window | **KEEP** | LIFECYCLE-GATE |
| `stopped_at` | `prepareAgentStateForSave` / orphan recovery (deacon.ts:5731) | visibility cutoff `now - stoppedAt > 1h` (routes/agents.ts:735); set-if-missing (agent-projection.ts:34) | Hide long-stopped agents from UI | **DROP** (DERIVE — UI visibility, not control flow; reconstruct from tmux death time) | — |
| `stopped_by_user` | `stopAgentSync` (stamps true) | resume skip unless pending feedback (deacon.ts:6728); orphan-failure skip (5736); cleared by brake (concurrency.ts:212) & unpause (agents.ts:1296) | Distinguishes deliberate stop from crash → suppresses auto-resume | **KEEP** | LIFECYCLE-GATE |
| `stopped_by_pause` | `applyAgentPaused(…, stoppedByPause=true)` (agents.ts:1252) | unpause clears `stoppedByUser` iff `stoppedByPause===true` (agents.ts:1295); `applyAgentUnpaused` | Restores resumability when a pause-stop is lifted | **MERGE-INTO `paused`** — it is "the stop was caused by a pause"; derivable from `paused` + the stop event. Narrow; one consumer. | LIFECYCLE-GATE |
| `kickoff_delivered` | spawn (false), delivery confirm (true) | `state.kickoffDelivered === false` → resend initial prompt vs continue msg (deacon.ts:6447); nudge skip (6452) | Stalled-resume nudge: which prompt to resend | **KEEP** | LIFECYCLE-GATE |
| `host_override` | start-agent route (operator confirm) | `allowHost`: spawn/resume on host despite unhealthy docker stack (agents.ts:4457,4739,5045,5213; handoff.ts:144; review-agent.ts:439); stack-health gate skip (routes/agents.ts:2786) | Lets an agent run on the host bypassing the docker-stack gate | **KEEP** | IDENTITY/SPAWN-CONFIG (spawn policy) |
| `cost_so_far` | cost reconciler | handoff-context display (handoff-context.ts:226); frontend spend display (DrawerActiveAgent.tsx:87, ZoneB.tsx:197) | Spend display + handoff context; no runtime branch | **MOVE → Cost domain** | BELONGS-TO-ANOTHER-DOMAIN (Cost) |
| `phase` | start-agent (legacy) | **none** — `'workType','phase','agentType'` enumerated as `legacyFields` (routes/agents.ts:2433); enum `exploration\|implementation\|…` unread. (`StartAgentPhase` telemetry at agents.ts:144 is an unrelated event type.) | Nothing; legacy work-type routing removed | **DROP** (dead) | — |
| `work_type` | start-agent (legacy) | **none** — same `legacyFields` set; agents-table column has zero branch reads (the `workType` model-override config is a different object, settings-api.ts/config-yaml.ts) | Nothing; legacy | **DROP** (dead) | — |
| `paused` | `applyAgentPaused` (pan pause, governor slot, merge-agent post-merge) | resume skip (deacon.ts:6643,6466,4140); reconciler skip (orphan-proposed-reconciler.ts:235,416); `anyGated` (1678); stuck-remediation skip (84) | The manual/operator pause gate — suppresses auto-resume | **KEEP** | LIFECYCLE-GATE |
| `paused_reason` | `applyAgentPaused` | `isGovernorSlotPauseReason` prefix check (agents.ts:1241 → clears troubled); `isVerifyPausedAgentState`; log text | Distinguishes governor-slot/verify pauses from manual → troubled-clear behavior | **KEEP** | LIFECYCLE-GATE |
| `paused_at` | `applyAgentPaused` | display only; `isAgentPauseClear` checks `=== undefined` (presence, not value) | Timestamp | **DROP** (DERIVE/fold) | — |
| `troubled` | `applyAgentFailure`/`markAgentTroubled` (agents.ts:1409,1339) | resume skip (deacon.ts:6649,6466); reconciler skip (235,416); `anyGated` (1678); stuck-remediation (84) | The repeated-failure gate — suppresses auto-resume until `pan untroubled` | **KEEP** | LIFECYCLE-GATE |
| `troubled_at` | `markAgentTroubled` (1337) | display/log only (deacon.ts:6651 log; `isAgentTroubledClear` presence check) | Timestamp | **DROP** (DERIVE/fold) | — |
| `consecutive_failures` | `applyAgentFailure` (agents.ts:1387,1390) | troubled threshold `>= maxConsecutiveFailures` (1401); backoff-schedule index (1394) | Counts failures in the rolling window → drives troubled + backoff length | **KEEP** | LIFECYCLE-GATE |
| `first_failure_in_run_at` | `applyAgentFailure` (1388) | rolling-window comparison `now - first > troubledWindowMs` (1383,1400-1403) | Defines the failure-counting window (resets the counter when stale) | **KEEP** | LIFECYCLE-GATE |
| `last_failure_at` | `applyAgentFailure` (1396) | display/log only; `isAgentTroubledClear` presence check | Timestamp | **DROP** (DERIVE/fold) | — |
| `last_failure_reason` | `applyAgentFailure` (1397) | display/log only | Free-text reason | **DROP** (fold into one notes field if any) | — |
| `last_failure_next_retry_at` | `applyAgentFailure` (1398) | backoff gate `nextRetry > now → skip resume` (deacon.ts:6667) | Exponential-backoff hold before next auto-resume | **KEEP** | LIFECYCLE-GATE |
| `flywheel_run_id` | spawn env (agents.ts:3293) | governor exempt-operator filter (concurrency.ts:191); slot accounting | Marks flywheel-spawned work for governor reaping/slot accounting | **MOVE → Orchestration** (flywheel run) | BELONGS-TO-ANOTHER-DOMAIN — agent-runtime-adjacent but its semantics are the flywheel run, not the agent. Consumer must still read it wherever it lands. |
| `role_run_head` | spawnRun (agents.ts:3547) | stamped-HEAD vs workspace-HEAD staleness (`activeRoleRunExists`, service.ts:232) | Detects a stale/zombie role run vs new commits | **MOVE → Orchestration** (role-run) | BELONGS-TO-ANOTHER-DOMAIN — role-run staleness, not agent identity. Derivable as a property of the role-run record. |
| `review_sub_role` | review convoy spawn | sub-role routing for synthesis/signal (deacon.ts:5684,5983,6031,6158,6268) | Which convoy lane this reviewer is | **MOVE → Orchestration** (review-run) | BELONGS-TO-ANOTHER-DOMAIN — prior audit Table 2 |
| `review_run_id` | review-agent.ts:275 | locates `.pan/review/<runId>/`, dedup key, staleness (deacon.ts:5983,5995,6041,6074,2764) | Which review run's reports to synthesize | **MOVE → Orchestration** (review-run) | BELONGS-TO-ANOTHER-DOMAIN — prior audit Table 2 |
| `review_synthesis_agent_id` | review-agent.ts:270,277; agents.ts:3455 | who to signal/nudge/kill for synthesis (deacon.ts:5999,6158) | Identifies the synthesis agent | **MOVE → Orchestration** (review-run) | BELONGS-TO-ANOTHER-DOMAIN — prior audit Table 2 |
| `review_output_path` | review-agent (per-sub-role) | where the reviewer wrote its report (deacon.ts:5973,6176) | Path the monitor reads the verdict from | **MOVE → Orchestration** (review-run) | BELONGS-TO-ANOTHER-DOMAIN — prior audit Table 2 |
| `review_deadline_at` | review-agent.ts:278 | past-deadline timeout (deacon.ts:6186,6248,6257) | Reviewer timeout / wedge detection | **MOVE → Orchestration** (review-run) | BELONGS-TO-ANOTHER-DOMAIN — prior audit Table 2 |
| `review_monitor_signaled` | deacon.ts:6276 | once-only dedup `if (reviewMonitorSignaled) continue` (6159) | Stops re-signaling a completed reviewer | **MOVE → Orchestration** (review-run) | BELONGS-TO-ANOTHER-DOMAIN — prior audit Table 2 |
| `review_retry_attempt` | deacon.ts:6013 | idle-reviewer single-retry gate `if (attempt < 1)` (6237) | Respawn idle reviewer once | **MOVE → Orchestration** (review-run) | BELONGS-TO-ANOTHER-DOMAIN — prior audit Table 2 |
| `inspect_sub_role` | inspect-agent.ts:253 | cost attribution / spawn tag — no live decision branch (DERIVE from agent-dir regex, reconciler.ts:140) | None load-bearing | **DROP** (derivable; prior audit Table 2 also marked DROP) | BELONGS-TO-ANOTHER-DOMAIN — inspect-run |
| `delivery_method` | `setAgentDeliveryMethod` (agents.ts:1462); spawn | delivery transport selection (`resolvedMethod ??= state?.deliveryMethod ?? 'auto'`, agents.ts:1608); threaded into every `deliverAgentMessage` | Which transport tier (supervisor/channels/tmux) to use | **KEEP** (absorbs the two booleans below) | IDENTITY/SPAWN-CONFIG (transport policy) |
| `supervisor_enabled` | spawn (after eligibility) | `if (state.supervisorEnabled !== true)` skip supervisor socket (agents.ts:2017) | Whether to attempt the PTY-supervisor socket | **MERGE-INTO `delivery_method`** (`'supervisor'` ⇒ enabled) | — |
| `channels_enabled` | spawn (after eligibility) | `if (!channelsEnabled)` skip bridge (agents.ts:1656,1914) | Whether to attempt the legacy Channels bridge | **MERGE-INTO `delivery_method`** (`'channels'` ⇒ enabled; legacy fallback) | — |
| `updated_at` | every upsert | `ORDER BY`/staleness only — the deacon `status.updatedAt` reads (deacon.ts:3262,4224 etc.) are on **`review_status`**, not this column | Row ordering | **KEEP** | LIVENESS/RUNTIME-STATUS (bookkeeping) |

---

## state.json verdict — **DELETE THE PLANE**

**Call: `~/.overdeck/agents/<id>/state.json` should not survive Overdeck.** It
carries nothing that is reconstructable-only from itself, given an empty DB and
the PAN-1908/PAN-1919 architecture.

Field-by-field, why nothing is state.json-only:

1. **Written in lockstep with SQLite.** `saveAgentStateSync` (agents.ts:1144-1145)
   calls `upsertAgent(agentStateToDbAgent(state))` *and* `writeAgentStateJsonSync(state)`
   in the same function. `cleanAgentState` (agents.ts:971) is a strict subset of the
   `Agent` columns. So at every write, the agents table already holds everything
   state.json holds. There is no field that lands only in state.json.

2. **Read path already prefers SQLite.** `getAgentStateSync` (agents.ts:1086)
   reads the DB *first* and only falls through to `readFileSync(state.json)` "while
   pre-migration directories have not been backfilled." On a fresh empty DB there is
   no pre-migration directory — the fallback branch is unreachable by premise.

3. **The one portable pair already left.** PAN-1919 moved `harness`/`model` OUT of
   state.json into the per-issue git record; `getAgentStateSync` now *merges them back
   from the record* (agents.ts:1098-1104), explicitly ignoring whatever state.json
   says. So state.json has no cross-machine value either — it is host-local and
   strictly redundant.

4. **The rebuild source becomes the table itself.** Today `rebuild-agents` /
   `backfillAgentsFromStateJsonSync` (agent-backfill.ts:166) reconstruct the table
   *from* state.json + tmux. In Overdeck that dependency inverts: the agents table is
   authoritative, and a rebuild reconstructs the *runtime* columns from
   **tmux liveness** (`status`, the `reconcileAgentStatus` logic at backfill.ts:234
   already does running→stopped purely from `liveSessions`) plus the **git record**
   (`harness`/`model`/identity) plus the **JSONL transcript** (`session_id`,
   activity). No column needs a state.json read to be reconstructed.

**Direct (non-`getAgentStateSync`) state.json readers checked.** The other
`readFileSync(state.json)` sites are: `parseAgentStateJson` in the backfill
(migration-only, goes away with the plane), the routes/projects.ts:205 inline parse
(reads `model/status/deliveryMethod/paused*` for *display* — re-point at the table),
and the orphan/recovery diagnostics. None reconstruct a value that the table +
tmux + git record + JSONL cannot supply. Deleting the plane removes ~50 files'
worth of read/write/parse surface (`writeAgentStateJsonSync`, `parseAgentState`,
`cleanAgentState`, the backfill, the projects.ts inline parse, the
`dropLegacyAgentStatesMissingRole` sweeps, etc.).

**Consequence to name (not a rescue, but be honest about it):** once state.json is
gone, the agents table becomes the *sole* store of the ephemeral LIFECYCLE-GATE
fields (`consecutive_failures`, `troubled`, `last_failure_next_retry_at`,
`first_failure_in_run_at`, `stopped_by_user`). Those are **not** reconstructable
from {tmux + git record + JSONL} — so a DB loss has no rebuild fallback for them.
This is **acceptable by design**: they are ephemeral retry/backoff state, and a
clean slate on DB loss just hands every agent a fresh retry budget (harmless, not a
correctness loss). Under the task's reconstruction framing — which *includes* the
agents table — state.json is still pure redundancy and the verdict holds; this note
just prevents "rebuild from tmux+git+jsonl" from implying those columns are covered.

**File count:** 48 non-test files reference `state.json` today
(`rg -l "state\.json" src --type ts -g '!*.test.ts'`). Deleting the plane retires
that surface (the writer `writeAgentStateJsonSync`, `parseAgentState`,
`cleanAgentState`, the backfill, the projects.ts inline parse, the legacy-state
sweeps, and the diagnostic readers).

**Caveat (not a rescue):** `runtime.json` (`AgentRuntimeState`,
activity/idle/currentTool/`sessionModel`/`sessionHarness`) is a **different file**
and a different question — it holds live activity that the brake/idle/nudge logic
reads. That plane is out of scope here (it is not the `agents` table and not
`state.json`), but note it is the real home of "live activity," which is why the
agents-table `last_activity` column is a droppable stale copy.

## agents-table ↔ state.json duplication & divergence

- **Authoritative today:** the **agents table** for reads (`getAgentStateSync`
  reads DB first), *except* `harness`/`model` where the **git record** wins
  (re-merged over whatever the table/state.json holds).
- **Where they diverge:** because both are written in the same `saveAgentStateSync`
  call, they only diverge when one write half fails (e.g. `writeAgentStateJsonSync`
  throws after `upsertAgent` succeeded, or vice-versa) or when an external process
  edits state.json directly. The reconcilers paper over this: `reconcileAgentStatus`
  (backfill.ts:234) forces `status='stopped'` when tmux has no session, and
  `handleAgentStoppedEvent`/`handleAgentHeartbeatDeadEvent` re-derive `status` from
  the tmux oracle every patrol. So `status` is the one column with a genuine
  divergence risk, and it is already resolved by treating **tmux as the tiebreaker**.
  Every other column is single-sourced at write time. In Overdeck, dropping
  state.json removes the divergence class entirely for non-`status` fields, and
  `status` continues to be reconciled from tmux.

---

## Surprises

1. **`status` is the only runtime column with real divergence risk, and tmux already
   wins.** `reconcileAgentStatus` (backfill.ts:238) and the two deacon stopped/dead
   handlers re-derive `status` from `-L overdeck` liveness every patrol. The stored
   `status` is a cache of the tmux oracle. KEEP it (cheap, indexed, gates patrols) but
   recognize it as LIVENESS, not durable truth.

2. **`branch`, `phase`, `work_type`, `last_activity`, `stopped_at` are dead or
   derivable on the agents table.** `branch` has zero agent-column decision reads
   (derivable as `feature/<issue-id-lc>`). `phase`/`work_type` are explicitly
   enumerated as `legacyFields` to be rejected (routes/agents.ts:2433) — leftover from
   the removed PAN-118 work-type routing. `last_activity` is a stale copy of
   `runtime.json`'s live activity (the brake even prefers `getAgentRuntimeStateSync`
   for the real idle decision). `stopped_at` only powers a 1-hour UI visibility cutoff.

3. **The failure machinery splits cleanly into 4 gates + 4 display fields.** Load-
   bearing: `consecutive_failures` (troubled threshold + backoff index),
   `first_failure_in_run_at` (rolling-window reset), `last_failure_next_retry_at`
   (backoff hold), `troubled`/`paused` (resume gates). Display-only:
   `troubled_at`, `paused_at`, `last_failure_at`, `last_failure_reason` — every one is
   either a log-line argument or a presence check (`=== undefined`) that a real
   timestamp value never feeds. Mirror the prior audit's clean timestamp split.
   *Executor note:* dropping `paused_at`/`troubled_at`/`last_failure_at` means
   simplifying `isAgentPauseClear` (agents.ts:1304) and `isAgentTroubledClear`
   (agents.ts:1344), which currently presence-check those timestamps — replace with a
   check on the boolean gate alone (`!paused` / `!troubled`).

4. **The three transport flags are one decision wearing three columns — collapsed
   to one in this audit.** `delivery_method` already defaults to `'auto'`, and
   `'auto'` tries supervisor → channels → tmux in order. `supervisor_enabled`/
   `channels_enabled` are per-launch eligibility booleans that gate the *same* socket
   attempts, so the table MERGEs both into `delivery_method` (`'supervisor'`/
   `'channels'` ⇒ that tier enabled). `channels_enabled` specifically guards the
   *legacy/experimental* Channels bridge (CLAUDE.md flags it as legacy fallback), which
   strengthens the case for not giving it its own column.

5. **`stopped_by_pause` is a one-consumer derivative of `paused`.** Its sole job is to
   tell `applyAgentUnpaused` (agents.ts:1295) to clear `stopped_by_user` when the stop
   was a pause-stop. That relationship is derivable from `paused` + the stop cause;
   the column is a convenience flag, not independent state.

6. **The whole `review_*` / `inspect_*` cluster (9 columns) plus `flywheel_run_id`
   and `role_run_head` are Orchestration squatters in the agents table.** The prior
   review-state audit (Table 2) already traced all of `review_run_id`,
   `review_synthesis_agent_id`, `review_output_path`, `review_deadline_at`,
   `review_monitor_signaled`, `review_retry_attempt`, `review_sub_role`,
   `inspect_sub_role`. They are EPHEMERAL REVIEW-RUN state that the deacon's review
   monitor reads during a live run — they belong on an Orchestration review-run record,
   not the agent-identity row. **I differ from the task's framing on two:** the task
   lumps `flywheel_run_id` and `role_run_head` into the same squatter cluster, but the
   prior audit kept them as "general agent-runtime, NOT review-run" (flywheel_run_id →
   concurrency.ts:191 slot accounting; role_run_head → service.ts:232 staleness). I
   side with **MOVE to Orchestration** for both anyway — their *semantics* are the
   flywheel run and the role run respectively, not the agent's identity — while noting
   the consuming code (concurrency governor, reactive scheduler) must still read the
   value wherever it lands. This is a placement call, not a load-bearingness dispute.

7. **`harness`/`model` are denormalized caches, not source of truth.** PAN-1919 made
   the per-issue git record authoritative; `getAgentStateSync` re-merges them over the
   table. They stay as columns for query convenience, but the remodel should treat the
   git record as the writer and the column as a derived mirror — otherwise the same
   "config says X but the row says Y" divergence the prior audit warns about reappears.

8. **No phantom columns this time, but a duplicated schema block.** Both `CREATE TABLE
   agents` definitions (`schema.ts:433` fresh-schema path and `:1543` migration path)
   are byte-identical — no drift — but they are a maintenance hazard: a future column
   added to one and not the other would diverge silently. Overdeck should collapse them
   to one definition.
