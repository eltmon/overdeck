# Overdeck — The Control/Settings Domain + the Config Resolver (Effect API tier)

> **Status:** the runtime-control domain. Grounded in a no-loss mapping of the
> real current API/CLI/RPC surface (Part 1), then the Effect v4-beta services
> derived from that mapping (Part 2). Every service member traces to a Part-1
> row; no column, flag, or endpoint is invented.
>
> Companions: [`issues.md`](issues.md) (the proof-of-shape template this follows
> EXACTLY in structure and rigor), [`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md)
> (the verified Effect house style), [`../overdeck-schema.ts`](../overdeck-schema.ts)
> (the locked `app_settings` / `issue_policy` tables), and the evidence audit
> [`../investigations/orchestration-config-audit.md`](../investigations/orchestration-config-audit.md)
> (the SOURCE-OF-TRUTH-in-DB finding, the "two-domains-not-three" call, and the
> "already at target shape" conclusion this builds on).
> Line numbers checked against `main` @ `840117fadc` (2026-06-16).

---

## Glossary

- **Control/Settings (the data domain)** — the **two tiny tables**
  `app_settings` (a key/value flag store) and `issue_policy` (per-issue operator
  flags). That is the entire data footprint. Defined in
  [`../overdeck-schema.ts`](../overdeck-schema.ts) lines 321-332.
- **`app_settings`** — the global runtime control flags: `deacon.globally_paused`,
  `flywheel.globally_paused`, `flywheel.active_run_id`,
  `flywheel.auto_pickup_backlog`, `flywheel.require_uat_before_merge`,
  `merge_train_enabled`, `restart_announcer.last_announced_ts`. A KV table —
  `value` is JSON. The single typed accessor today is `src/lib/database/app-settings.ts`.
- **`issue_policy`** — per-issue operator flags `deacon_ignored` and `auto_merge`,
  keyed by `issueId`. These are the **side-states the Issues design routed here**
  ([`issues.md` headline finding rows](issues.md), schema 284-285) — operator/
  routing policy, NOT review verdicts. Today they squat in `review_status`
  (`src/lib/database/review-status-db.ts:529,569`); the remodel evicts them to
  this dedicated table.
- **Runtime subsystem (Deacon / Flywheel)** — an *in-process* control loop that
  **consumes** Control/Settings flags but owns **no distinct data store**
  ([audit §3](../investigations/orchestration-config-audit.md)). Deacon is the
  lifecycle watchdog; Flywheel is the singleton orchestrator. Their "state" is
  the `app_settings` flags above. They are NOT data domains. The verbs that drive
  them (freeze/unfreeze/brake/emergency-stop, start/pause/resume/abort) are
  **runtime-control verbs** — `SettingsWriter` owns them because the only durable
  fact each persists is an `app_settings` flag.
- **Config (the read-only domain)** — project definitions in the **`projects.yaml`
  file** (`~/.panopticon/projects.yaml`, `src/lib/projects.ts:18`). The resolver
  is the mtime-cached parse `loadProjectsConfigSync` (`projects.ts:198`). **There
  is no Config DB table and no Config DB writer** — edits are file edits
  ([audit §4](../investigations/orchestration-config-audit.md)). `ConfigResolver`
  is read-only by construction.
- **Resolver / read door** — the one `Context.Service` allowed to *read* the
  domain's store. Returns validated entities.
- **Writer / write door** — the one `Context.Service` allowed to *mutate* the
  domain's store.
- **Relocate** — a disposition: the current endpoint/verb is **not lost and not
  this domain's to own**; it maps to a *sibling* domain's door (Merge, Agents) or
  to a sibling **file** domain. Distinct from DELETE (genuinely dropped).
- **File-config relocate** — a special relocate: the endpoint reads/writes a
  *file other than `projects.yaml`* (`config.yaml`, `cloister.toml`,
  `ui-theme.json`) or external provider auth. It is preserved as a thin
  file-backed door, but it is **not** an `app_settings`/`issue_policy` fact and
  therefore **not** a Control/Settings or Config resolver method. The remodel's
  data-domain doors do not absorb it.

---

## ⚠️ Headline finding — this domain is **runtime-control-heavy, not data-heavy**, and that shape is deliberate

Issues was one rich table behind three verbs that absorbed ~148 sites. **This
domain is the opposite shape, on purpose.** Its entire durable data footprint is
two tiny tables — a 3-column KV (`app_settings`) and a 3-column per-issue flag
row (`issue_policy`). "Follow the template EXACTLY in structure and rigor" means
the same *sections, grounding, and acceptance discipline* — **not** force-fitting
a 3-verb data-only shape onto a domain whose real work is driving two in-process
runtime subsystems. The audit already proved both data domains are *"already at
the target shape"* ([audit Surprise 3](../investigations/orchestration-config-audit.md));
the remodel **consolidates and relocates**, it does not cut 148→3.

Two consequences shape Part 2, and neither is handed to us by the Issues
template:

**1. Source-of-truth INVERSION — `app_settings`/`issue_policy` have no git mirror.**
`IssueWriter` persists git `.pan/records` *first* (the commit point), then the
cache. **`SettingsWriter` does the opposite ordering's premise away entirely:**
these tables are **SOURCE-OF-TRUTH-in-DB** — the explicit counterexample to "the
DB is a disposable cache" ([audit §6, Surprise 5](../investigations/orchestration-config-audit.md);
schema comment 316-320). Nothing rebuilds `deacon.globally_paused` or
`flywheel.active_run_id`. So the **DB write IS the commit point**; there is no
`Records` step and `SettingsWriter`'s `R` contains **no `Records`**. The cutover
posture is a conscious **acceptable-to-reset** decision: a fresh `overdeck.db`
boots deacon **unpaused**, with **no active flywheel run**, and **all per-issue
policy cleared** — not silent data loss, a stated default (audit §6). Likewise
`ConfigResolver` has **no `Db`** at all — it is file-backed.

**2. The agent-killing residue — `SettingsWriter` must never write the `agents` table.**
The most dangerous verbs in this domain do two things at once. `pan cloister
brake` / `emergency-stop` set no flag but **kill agents**
(`cloister.ts:82-137`); `flywheel start`/`pause`/`resume`/`abort` write an
`app_settings` flag **and spawn/stop the orchestrator agent**
(`flywheel-actions.ts:215,225-226,251-252,266-267,286,297` —
`spawnFlywheelAgent` / `stopAgent(FLYWHEEL_ORCHESTRATOR_AGENT_ID)`). Per the
Issues design, agent lifecycle is **AgentWriter**'s alone. So:

> **`SettingsWriter` owns only the flag write. The agent-lifecycle half of every
> runtime-control verb routes through `AgentWriter` / the runtime service.**
> `SettingsWriter`'s `R` may *depend on* `AgentWriter` for these verbs; it must
> **never** receive the `agents` table in its own `R`.

This is this domain's analog of the Issues headline: the door guarantee
([CONVENTIONS §0](../ARCHITECTURE-CONVENTIONS.md)) is enforced because only the
`agents`-owning writer's Layer receives that table. A `SettingsWriter` that wrote
`agents` would hand Control a write path into Agents — the exact coupling the
remodel cures. Enumerated as the genuine residue in §1E.

---

# Part 1 — No-loss mapping (the gate)

Every current surface (HTTP endpoint, `pan` CLI verb, RPC method) touching
settings, deacon control, flywheel lifecycle, per-issue policy, or project
config — with its new home. Disposition is one of five:

- **READ →** a `SettingsResolver` or `ConfigResolver` method.
- **WRITE →** a `SettingsWriter` verb.
- **RELOCATE →** a *sibling data domain* (Merge, Agents). Not lost, not ours.
- **FILE-CONFIG →** a thin file-backed door over a file *other than the
  app_settings/issue_policy DB* (`config.yaml`, `cloister.toml`, `ui-theme.json`,
  provider auth). Preserved, but not a data-domain resolver method.
- **DELETE →** deliberately dropped, with the reason.

Stores legend: **AS** = `app_settings` · **IP** = `issue_policy` (today
`review_status`) · **YAML** = `projects.yaml` · **CFG** = `config.yaml` · **TOML**
= `cloister.toml` · **PROC** = in-process Cloister/Flywheel service · **GH/AUTH**
= GitHub / external provider auth.

## 1A. HTTP endpoints — `settings.ts` (20 route objects; 16 API-SURFACE-counted)

The single most important Part-1 fact: **only `ui-theme` even *touches* a
settings file**, and **none of the 16 touch `app_settings`/`issue_policy`**.
`GET/PUT /api/settings` is the `config.yaml` editor (`loadSettingsApi`/
`saveSettingsApi` → `loadConfigSync`, `settings-api.ts:588-589`), and the rest
are provider-auth / model-catalog / openrouter / conversation-search helpers. So
the whole module **FILE-CONFIG-relocates or relocates** — it is not the
Control/Settings *data* domain.

| Current endpoint (file:line) | r/w | New home | Reason / backing store |
|---|---|---|---|
| `GET /api/settings` (`settings.ts:152`) | reads | **FILE-CONFIG** (config.yaml door) | `loadSettingsApi` → `loadConfigSync` (`settings-api.ts:589`) = `~/.panopticon/config.yaml` (CFG), **not** AS. Preserved as a file door; not a resolver method. |
| `PUT /api/settings` (`settings.ts:869`) | writes | **FILE-CONFIG** | `saveSettingsApi` writes CFG. Not an AS write. |
| `PUT /api/settings/ui-theme` (`settings.ts:903`) | writes | **FILE-CONFIG** (`ui-theme.json`) | `setUiTheme` → `~/.panopticon/ui-theme.json` (`ui-theme.ts:31`). A file, not AS. |
| `GET /api/settings/available-models` (`settings.ts:163`) | reads | **FILE-CONFIG / catalog** | Model catalog from config + providers. Not AS. |
| `GET /api/settings/optimal-defaults` (`settings.ts:174`) | reads | **FILE-CONFIG / catalog** | Derived defaults. Not AS. |
| `GET /api/settings/minimax-defaults` (`settings.ts:185`) | reads | **FILE-CONFIG / catalog** | Derived defaults. Not AS. |
| `GET /api/settings/claude-auth` (`settings.ts:196`) | reads | **RELOCATE → provider-auth (GH/AUTH)** | `getClaudeAuthStatus`; external OAuth state, no DB. |
| `GET /api/settings/openai-auth` (`settings.ts:207`) | reads | **RELOCATE → provider-auth** | `getOpenAIAuthStatus`; external OAuth. |
| `POST /api/settings/test-api-key` (`settings.ts:218`) | writes | **RELOCATE → provider-auth** | Live provider probe; no domain store. |
| `POST /api/settings/validate-api-key` (`settings.ts:517`) | writes | **RELOCATE → provider-auth** | Live provider probe. |
| `GET /api/settings/provider-env-conflicts` (`settings.ts:1054`) | reads | **RELOCATE → provider-auth** | `detectProviderEnvConflicts`; env inspection. |
| `GET /api/settings/harness-policy` (`settings.ts:1011`) | reads | **RELOCATE → provider-auth / harness-policy** | `canUseHarnessSync`; ToS gate, no store. |
| `GET /api/settings/openrouter/models` (`settings.ts:922`) | reads | **RELOCATE → OpenRouter service** | `OpenRouterService`; external catalog. |
| `PUT /api/settings/openrouter/favorites` (`settings.ts:935`) | writes | **FILE-CONFIG** | `saveOpenRouterFavorites` → CFG. |
| `PUT /api/settings/openrouter/api-key` (`settings.ts:960`) | writes | **RELOCATE → provider-auth** | Provider key write. |
| `POST /api/settings/openrouter/test-key` (`settings.ts:988`) | writes | **RELOCATE → provider-auth** | Live key probe. |
| `GET /api/settings/conversation-search/status` (`settings.ts:729`) | reads | **RELOCATE → Conversations / search** | Conversation-search index state; Conversations domain. |
| `GET /api/settings/conversation-search/reindex-estimate` (`settings.ts:780`) | reads | **RELOCATE → Conversations / search** | Cost estimate; search domain. |
| `POST /api/settings/conversation-search/reindex` (`settings.ts:806`) | writes | **RELOCATE → Conversations / search** | Reindex trigger; search domain. |
| `GET /api/settings/conversation-search/reindex-progress` (`settings.ts:859`) | reads | **RELOCATE → Conversations / search** | Progress poll; search domain. |

> **Net for `settings.ts`:** 0 of 16 are Control/Settings *data*-domain methods.
> All preserved (no-loss) as FILE-CONFIG file doors or relocated to provider-auth
> / OpenRouter / Conversations-search siblings. (`settings.ts` lists 20 route
> objects above; API-SURFACE counts the module as "16" — the surplus are the
> conversation-search and openrouter sub-routes folded under the same module.)

## 1B. HTTP endpoints — deacon control (`misc.ts`) → `SettingsResolver` / `SettingsWriter`

| Current endpoint (file:line) | r/w | New home | Reason / backing store |
|---|---|---|---|
| `GET /api/deacon/pause` (`misc.ts:780`) | reads | **`SettingsResolver.isDeaconPaused()`** | `isDeaconGloballyPaused()` reads `deacon.globally_paused` (AS). |
| `POST /api/deacon/pause` (`misc.ts:798`) | writes | **`SettingsWriter.setDeaconPaused(paused)`** | `setDeaconGloballyPaused(body.paused)` (AS). The one direct AS toggle on the HTTP surface. |

## 1C. HTTP endpoints — `cloister.ts` (10) → split: flag-write vs runtime-PROC vs relocate

The Cloister routes operate the **in-process watchdog service** (`getCloisterService()`).
Two write a durable AS flag *or kill agents*; the rest are pure PROC service
operations with no durable store, plus a `cloister.toml` editor and an
Agents-health read.

| Current endpoint (file:line) | r/w | New home | Reason / backing store |
|---|---|---|---|
| `GET /api/cloister/status` (`cloister.ts:40`) | reads | **`CloisterRuntime.getStatus()`** (recomposed at controller) | `service.getStatus()` — live runtime status, not a stored fact. Controller recomposes from `CloisterRuntime.getStatus()` + the AS pause flag. |
| `POST /api/cloister/start` (`cloister.ts:54`) | writes | **RESIDUE → `CloisterRuntime.start()`** (§1J item 2) | `service.start()` — starts the in-process watchdog loop; no durable store mutated. A runtime op, not an AS write. |
| `POST /api/cloister/stop` (`cloister.ts:68`) | writes | **RESIDUE → `CloisterRuntime.stop()`** (§1J item 2) | `service.stop()` — stops the loop; no store. |
| `POST /api/cloister/emergency-stop` (`cloister.ts:82`) | writes | **`SettingsWriter.emergencyStop()` → delegates AgentWriter.stop ×N** | Kills ALL agents (`getCloisterService().emergencyStop()` + per-agent `agent.stopped` events, 82-105). **Agent lifecycle = AgentWriter**; SettingsWriter only orchestrates the call. No AS flag. (Headline residue.) |
| `POST /api/cloister/brake` (`cloister.ts:113`) | writes | **`SettingsWriter.brake()` → delegates AgentWriter.stop ×N** | Trims work agents to the cap (`emergencyBrake()` + per-agent `agent.stopped`, 113-137). Agent lifecycle = AgentWriter. No AS flag. (Headline residue.) |
| `POST /api/cloister/resume-spawns` (`cloister.ts:141`) | writes | **RESIDUE → `CloisterRuntime.resumeSpawns()`** (§1J item 2) | `service.resumeSpawns()` — in-memory spawn-pause toggle on the live service; no durable store. |
| `GET /api/cloister/spawn-status` (`cloister.ts:155`) | reads | **RESIDUE → `CloisterRuntime.isSpawnPaused()`** (§1J item 2) | `service.isSpawnPaused()` — in-memory flag read. |
| `GET /api/cloister/config` (`cloister.ts:169`) | reads | **FILE-CONFIG** (`cloister.toml`) | `loadCloisterConfigSync()` → `~/.panopticon/cloister.toml` (`cloister/config.ts:15,450`). A file, not AS. |
| `PUT /api/cloister/config` (`cloister.ts:180`) | writes | **FILE-CONFIG** | `saveCloisterConfigSync(updates)` + `service.reloadConfig()` (TOML). Not AS. |
| `GET /api/cloister/agents/health` (`cloister.ts:198`) | reads | **RELOCATE → Agents (health)** | `service.getAllAgentHealth()` — per-agent health (API-SURFACE §G Agents/health). |

> **Where the deacon *freeze flag* lives.** Note that `pan cloister freeze`/
> `unfreeze` (§1F) write the AS flag, but the **HTTP** freeze toggle is the
> `/api/deacon/pause` pair in `misc.ts` (§1B), NOT `cloister.ts`. `cloister
> start/stop` operate the runtime loop; `deacon/pause` persists the flag. Both
> preserved, distinct homes.

## 1D. HTTP endpoints — `flywheel.ts` → split: lifecycle/flags here, Merge relocates

Flywheel's lifecycle + config flags are Control/Settings; its **auto-merge /
merge-queue / UAT** surfaces are the **Merge** domain
([audit §2,§5](../investigations/orchestration-config-audit.md) — those tables are
`merge_*`/`pending_auto_merges`/`uat_generations`), and its run-history/report/
brief reads are flywheel telemetry (recompose/relocate, not a data-domain read).

### Lifecycle & flags → `SettingsWriter` / `SettingsResolver`

| Current endpoint (file:line) | r/w | New home | Reason / backing store |
|---|---|---|---|
| `GET /api/flywheel/config` (`flywheel.ts:542`) | reads | **`SettingsResolver.getFlywheelConfig()`** | `getFlywheelConfigPayload()` reads `auto_pickup_backlog`/`require_uat_before_merge`/`merge_train_enabled` (AS, `flywheel.ts:222-228`). |
| `POST /api/flywheel/config` (`flywheel.ts:550`) | writes | **`SettingsWriter.setFlywheelConfig(patch)`** | `postFlywheelConfigPayload` → `setFlywheelAutoPickupBacklog`/`setFlywheelRequireUatBeforeMerge`/`setMergeTrainEnabled` (AS, `flywheel.ts:246-248`). |
| `POST /api/flywheel/start` (`flywheel.ts:713`) | writes | **`SettingsWriter.startFlywheel(brief)` → flag + AgentWriter.spawn** | Sets `flywheel.active_run_id` + `flywheel.globally_paused=false` (`flywheel-actions.ts:225-226`) **and** `spawnFlywheelAgent` (215). Flag = AS write; orchestrator spawn = AgentWriter. (Headline residue.) |
| `POST /api/flywheel/pause` (`flywheel.ts:733`) | writes | **`SettingsWriter.pauseFlywheel()` → flag + AgentWriter.stop** | `setPaused(true)` (AS) + `stopAgent(FLYWHEEL_ORCHESTRATOR_AGENT_ID)` (`flywheel-actions.ts:251-252`). |
| `POST /api/flywheel/resume` (`flywheel.ts:750`) | writes | **`SettingsWriter.resumeFlywheel()` → flag + AgentWriter.spawn** | `setPaused(false)` (AS) + `spawnFlywheelAgent` (`flywheel-actions.ts:286,297`). |
| `POST /api/flywheel/abort` (`flywheel.ts:767`) | writes | **`SettingsWriter.abortFlywheel()` → flag + AgentWriter.stop** | `abortFlywheelRun` clears `active_run_id` + `globally_paused` (`flywheel-run-state.ts:298-299`) + `stopAgent` (`flywheel-actions.ts:266-267`). |
| `POST /api/flywheel/status` (`flywheel.ts:697`) | writes | **RELOCATE → flywheel run-state telemetry** | `postFlywheelStatusPayload` writes the latest **run-status snapshot** (a per-run telemetry artifact, not an AS flag). Telemetry, not data-domain. |
| `GET /api/flywheel/current` (`flywheel.ts:520`) | reads | **aggregate → recomposed** (run-state telemetry) | Live current-run payload; recompose from run-state + AS flags. |
| `GET /api/flywheel/state` (`flywheel.ts:978`) | reads | **aggregate → recomposed** | Gate snapshot = AS flags + live run-state; recompose. |
| `GET /api/flywheel/stats` (`flywheel.ts:528`) | reads | **RELOCATE → flywheel telemetry** | Success-metrics window report. |

### Reporting / brief / run-history → telemetry (relocate, not data-domain)

| Current endpoint (file:line) | r/w | New home | Reason |
|---|---|---|---|
| `GET /api/flywheel/runs` (`flywheel.ts:485`) | reads | **RELOCATE → flywheel telemetry / run-history** | Run-history list; not AS. |
| `GET /api/flywheel/runs/:id` (`flywheel.ts:498`) | reads | **RELOCATE → flywheel telemetry** | One run record. |
| `GET /api/flywheel/conversation` (`flywheel.ts:512`) | reads | **RELOCATE → Conversations** | Orchestrator conversation pointer. |
| `POST /api/flywheel/report` (`flywheel.ts:784`) | writes | **RELOCATE → flywheel telemetry** | Generates a run report file; not AS. |
| `POST /api/flywheel/report/open` (`flywheel.ts:801`) | writes | **RELOCATE → flywheel telemetry** | Opens a report; not AS. |
| `GET /api/flywheel/brief` (`flywheel.ts:821`) | reads | **FILE-CONFIG** (brief file) | Reads the brief file; not AS. |
| `POST /api/flywheel/brief` (`flywheel.ts:853`) | writes | **FILE-CONFIG** (brief file) | Writes the brief file; not AS. |

### Auto-merge / merge-queue / UAT → **Merge domain** (audit §2,§5)

| Current endpoint (file:line) | r/w | New home | Reason |
|---|---|---|---|
| `GET /api/flywheel/auto-merge/pending` (`flywheel.ts:566`) | reads | **RELOCATE → MergeResolver** | `pending_auto_merges` (Merge). |
| `GET /api/flywheel/auto-merge/problems` (`flywheel.ts:574`) | reads | **RELOCATE → MergeResolver** | Auto-merge scheduling problems (Merge). |
| `GET /api/flywheel/merge-blockers` (`flywheel.ts:608`) | reads | **RELOCATE → MergeResolver / IssuesResolver** | Blocked-PR list derived from review verdicts + GH; Merge/Issues. |
| `POST /api/flywheel/auto-merge/schedule` (`flywheel.ts:653`) | writes | **RELOCATE → MergeWriter** | `scheduleAutoMergeWithResult` → `pending_auto_merges` (Merge). |
| `DELETE /api/flywheel/auto-merge/:id` (`flywheel.ts:683`) | writes | **RELOCATE → MergeWriter** | Cancel a scheduled auto-merge (Merge). |
| `POST /api/flywheel/merge-next` (`flywheel.ts:669`) | writes | **RELOCATE → MergeWriter** | Advance the merge queue (Merge). |
| `GET /api/flywheel/merge-queue` (`flywheel.ts:886`) | reads | **RELOCATE → MergeResolver** | `merge_queue` (Merge). |
| `GET /api/flywheel/uat-generations` (`flywheel.ts:914`) | reads | **RELOCATE → MergeResolver** | `uat_generations` (Merge, audit §5). |
| `POST /api/flywheel/uat-generations/:name/stack` (`flywheel.ts:924`) | writes | **RELOCATE → MergeWriter** | UAT batch stack (Merge). |
| `POST /api/flywheel/uat-generations/:name/promote` (`flywheel.ts:940`) | writes | **RELOCATE → MergeWriter** | UAT batch promote (Merge). |
| `POST /api/flywheel/assemble-uat` (`flywheel.ts:965`) | writes | **RELOCATE → MergeWriter** | Assemble a UAT batch (Merge). |

## 1E. HTTP endpoints — per-issue policy (`workspaces.ts`) → `SettingsWriter` (the `issue_policy` table)

These are the side-states the Issues design routed here
([`issues.md` headline rows 72-73](issues.md)). Today they write `review_status`
(`review-status-db.ts:529,569`); the new home is the dedicated `issue_policy`
table (schema 327-332) — **a column relocation that preserves the verb**.

| Current endpoint (file:line) | r/w | New home | Reason / store move |
|---|---|---|---|
| `POST /api/workspaces/:issueId/deacon-ignore` (`workspaces.ts:4710`) | writes | **`SettingsWriter.setDeaconIgnored(id, ignored, reason)`** | `setDeaconIgnored(issueId, ignored, reason)` — today `review_status.deacon_ignored*`; new home `issue_policy.deacon_ignored` (IP). |
| `POST /api/workspaces/:issueId/auto-merge` (`workspaces.ts:4755`) | writes | **`SettingsWriter.setAutoMerge(id, autoMerge)`** | `setAutoMerge(issueId, autoMerge\|null)` — today `review_status.auto_merge`; new home `issue_policy.auto_merge` (IP). `null` clears to project default. |
| `POST /api/workspaces/:issueId/unstick` (`workspaces.ts:4670`) | writes | **RELOCATE → Control/Settings *runtime* (clear `stuck`) — `review_runs`** | `stuck`/`stuckReason` are **ephemeral review-run runtime** (`review_runs`, schema 360-361 — Orchestration runtime table), NOT `app_settings`/`issue_policy`. Same disposition `issues.md` gave it. Preserved as a runtime clear, not a Control/Settings *data*-domain verb. |
| `GET /api/review/:issueId/status` → `deaconIgnored`/`autoMerge` fields (`workspaces.ts:3322`) | reads | **`SettingsResolver.getPolicy(id)`** (recomposed into the review-status read) | The two policy fields on the legacy review-status read come from `issue_policy` now; the verdict fields are IssuesResolver. |

## 1F. CLI verbs (`pan ...`)

| Current verb (file:line) | r/w | New home | Reason / backing store |
|---|---|---|---|
| `pan admin cloister freeze` (`cli/commands/cloister/freeze.ts:19`) | writes | **`SettingsWriter.setDeaconPaused(true)`** | `setDeaconGloballyPaused(true)` (AS). |
| `pan admin cloister unfreeze` (`cli/commands/cloister/freeze.ts:29`) | writes | **`SettingsWriter.setDeaconPaused(false)`** | `setDeaconGloballyPaused(false)` (AS). |
| `pan admin cloister status` (`cloister/index.ts:21`) | reads | **`CloisterRuntime.getStatus()`** (recomposed) | Live watchdog status + AS pause flag. |
| `pan admin cloister start` (`cloister/index.ts:28`) | writes | **RESIDUE → `CloisterRuntime.start()`** (§1J item 2) | Starts the loop; no durable store. |
| `pan admin cloister stop` (`cloister/index.ts:34`) | writes | **RESIDUE → `CloisterRuntime.stop()`** (§1J item 2) | Stops the loop. |
| `pan admin cloister emergency-stop` (`cloister/index.ts:40`) | writes | **`SettingsWriter.emergencyStop()` → AgentWriter.stop ×N** | `stopCommand({emergency:true})` kills agents. Agent lifecycle = AgentWriter. |
| `pan admin cloister brake` (`cloister/index.ts:46`) | writes | **`SettingsWriter.brake()` → AgentWriter.stop ×N** | `brakeCommand` trims agents. Agent lifecycle = AgentWriter. |
| `pan flywheel start` (`cli/commands/flywheel.ts:940`) | writes | **`SettingsWriter.startFlywheel(brief)` → flag + AgentWriter.spawn** | AS flag + orchestrator spawn. |
| `pan flywheel pause` (`flywheel.ts:972`) | writes | **`SettingsWriter.pauseFlywheel()`** | AS flag + AgentWriter.stop. |
| `pan flywheel resume` (`flywheel.ts:977`) | writes | **`SettingsWriter.resumeFlywheel()`** | AS flag + AgentWriter.spawn. |
| `pan flywheel stop` / `abort` (`flywheel.ts:988,993`) | writes | **`SettingsWriter.abortFlywheel()`** | Clears AS flags + AgentWriter.stop. |
| `pan flywheel config` (`flywheel.ts:952`) | r/w | **`SettingsResolver.getFlywheelConfig` / `SettingsWriter.setFlywheelConfig`** | The 3 AS flywheel flags. |
| `pan flywheel status` (`flywheel.ts:959`) | reads | **aggregate → recomposed** | AS flags + run-state telemetry. |
| `pan flywheel stats` (`flywheel.ts:965`) | reads | **RELOCATE → flywheel telemetry** | Metrics window. |
| `pan flywheel emit-status` (`flywheel.ts:946`) | writes | **RELOCATE → flywheel run-state telemetry** | Writes a run-status snapshot, not an AS flag. |
| `pan flywheel report` (`flywheel.ts:982`) | writes | **RELOCATE → flywheel telemetry** | Generates a report. |
| `pan project add/remove/...` (`cli/index.ts:1307`) | writes | **FILE-CONFIG** (`projects.yaml`) | Edits the YAML; the one Config mutation path. No DB writer (audit §4). |

## 1G. HTTP endpoints — Config (`projects.ts`) → `ConfigResolver` (read) + FILE-CONFIG (write)

The per-project **auto-merge default** is distinct from the per-issue
`issue_policy.auto_merge`: it is a *project* setting in `projects.yaml`. Both are
preserved; do not conflate them.

| Current endpoint (file:line) | r/w | New home | Reason / backing store |
|---|---|---|---|
| `GET /api/projects/:projectKey/auto-merge-default` (`projects.ts:577`) | reads | **`ConfigResolver.getProject(key)` (`.autoMergeDefault`)** | `getProjectSync(key).auto_merge_default` — parsed from `projects.yaml` (YAML). |
| `POST /api/projects/:projectKey/auto-merge-default` (`projects.ts:590`) | writes | **FILE-CONFIG** (`projects.yaml`) | `setProjectAutoMergeDefaultSync(key, 'auto'\|'hold'\|null)` (`projects.ts:257`) — a **YAML file edit**, the one Config mutation. No Config DB writer. |
| `GET /api/projects/:projectKey/session-tree` (`projects.ts:401`) | reads | **aggregate → recomposed** (Config + Agents + Conversations) | Session tree spans domains; recompose at controller. Config supplies the project definition only. |
| `GET /api/session-trees` (`projects.ts:526`) | reads | **aggregate → recomposed** | All-projects session tree; cross-domain. |

> **`ConfigResolver` is read-only.** Every `resolveProjectFromIssue*`,
> `getProjectPath`, repo resolution, test config, and close-out config reads the
> YAML through `loadProjectsConfigSync` ([audit §4](../investigations/orchestration-config-audit.md)).
> There is no Config DB table and no Config DB writer; project edits are
> FILE-CONFIG writes to `projects.yaml`. This domain survives any DB wipe
> untouched.

## 1H. RPC methods

| Current RPC method (file:line) | r/w | New home | Reason |
|---|---|---|---|
| `pan.subscribeFlywheelStatus` (`contracts/rpc.ts:401`; `ws-rpc.ts:592`) | reads (stream) | **`SettingsApi` RPC `flywheel.subscribeStatus`** (+ recomposed run-state) | Streams the latest flywheel status. The AS slice — `flywheel.active_run_id` (`ws-rpc.ts:596`) + `flywheel.globally_paused` — maps to **`SettingsResolver.getFlywheelRuntime()`** (§2.2); the per-run snapshot `readCurrentLatestFlywheelStatus` recomposes from run-state telemetry at the controller. HTTP & RPC cannot diverge ([CONVENTIONS §8](../ARCHITECTURE-CONVENTIONS.md)). |

> **Why `getFlywheelRuntime` is a distinct resolver read, not "just recompose."**
> The `flywheel current`/`state` reads (§1D) and this RPC subscription branch-read
> `flywheel.active_run_id` + `flywheel.globally_paused` from `app_settings`
> (`flywheel-run-state.ts:204`). "Recompose at the controller" still has to pull
> the AS slice from *some* door — the controller never touches `Db`. So that slice
> is `SettingsResolver.getFlywheelRuntime()`; the run-state snapshot (telemetry) is
> the only part that recomposes.

## 1I. Rollup of the collapse

| Surface | Current sites | New home |
|---|---|---|
| `settings.ts` HTTP (16) | 16 | **0 data-domain methods** — all FILE-CONFIG (config.yaml/ui-theme.json/openrouter-favorites) or RELOCATE (provider-auth, OpenRouter, Conversations-search). No loss. |
| `cloister.ts` HTTP (10) | 10 | **2 SettingsWriter verbs** (`emergencyStop`, `brake` — both delegating AgentWriter) + 4 `CloisterRuntime` PROC residue (`start`/`stop`/`resumeSpawns`/`isSpawnPaused`) + 2 FILE-CONFIG (cloister.toml) + 1 Agents-health relocate + 1 recomposed status |
| `misc.ts` deacon (2) | 2 | **1 resolver read (`isDeaconPaused`) + 1 writer verb (`setDeaconPaused`)** |
| `flywheel.ts` HTTP (~30 routes) | ~30 | **2 resolver reads (`getFlywheelConfig`, `getFlywheelRuntime`) + 5 writer verbs** (config + start/pause/resume/abort) ; the rest **RELOCATE to Merge** (11 auto-merge/queue/UAT) or **flywheel telemetry** (runs/report/brief/stats/status) |
| per-issue policy HTTP (`workspaces.ts`, 3) | 3 | **2 SettingsWriter verbs** (`setDeaconIgnored`, `setAutoMerge`) + 1 runtime relocate (`unstick` → `review_runs`) |
| `projects.ts` Config HTTP (4) | 4 | **1 ConfigResolver read field + 1 FILE-CONFIG write** + 2 recomposed session-trees |
| CLI verbs | ~17 control/settings/config verbs | **~8 SettingsWriter verbs + 2 resolver reads** ; `CloisterRuntime` PROC residue (cloister start/stop) + telemetry (stats/report/emit) relocate ; `pan project` = FILE-CONFIG |
| RPC | 1 (`subscribeFlywheelStatus`) | `flywheel.subscribeStatus` (Settings RPC) + recomposed run-state |

**The honest collapse count.** This is **consolidation + relocation, not a
148→3 cut.** The data-domain surface is small by nature
([audit Surprise 3](../investigations/orchestration-config-audit.md) — "already at
target shape"):

- **`SettingsResolver`: 4 read members** (`isDeaconPaused`, `getFlywheelConfig`,
  `getFlywheelRuntime`, `getPolicy`) — collapsing the deacon-pause read, the
  flywheel-config read, the flywheel runtime flags (`active_run_id` +
  `globally_paused`, §1H), and the per-issue policy fields scattered across
  `misc.ts` + `flywheel.ts` + `review_status`.
- **`SettingsWriter`: 10 write verbs** — `setDeaconPaused`, `setFlywheelConfig`,
  `setDeaconIgnored`, `setAutoMerge` (the latter two on `issue_policy`),
  `startFlywheel`, `pauseFlywheel`, `resumeFlywheel`, `abortFlywheel`,
  `emergencyStop`, `brake` (the four flywheel-lifecycle + the two cloister-agent
  verbs each also delegate to AgentWriter — see §2.4).
- **`ConfigResolver`: 1 read member** (`getProject` / `listProjects`) over
  `projects.yaml`, no writer.

**DELETED outright** (0 endpoints). Unlike Issues, no surface here is a redundant
read door or dead endpoint that drops — every endpoint/verb becomes a door,
relocates to a sibling data domain, becomes a file door, or recomposes. Functional
parity is the operator goal. The **one durable field** that does not survive is
`deaconIgnoredReason` (the locked `issue_policy` table has no reason column) —
named as an explicit accept-loss in §1J item 5, not a silent drop.

## 1J. What did NOT fit a clean Control/Settings *data*-domain door — the genuine residue

After the collapse, the surfaces that touch this domain but are **not** a clean
`app_settings`/`issue_policy`/`projects.yaml` read-or-write:

1. **The agent-lifecycle half of every runtime-control verb** (headline finding).
   `emergencyStop`/`brake` write **no** durable flag at all — their whole effect
   is killing agents (`cloister.ts:82-137`). `start`/`pause`/`resume`/`abort`
   write an AS flag **and** spawn/stop the orchestrator agent
   (`flywheel-actions.ts:215,251,266,286`). The agent-lifecycle effect **routes
   through AgentWriter**; `SettingsWriter` never writes the `agents` table. Its
   `R` may include `AgentWriter` but not the `agents` Drizzle handle.
2. **In-process PROC operations with no durable store** — `cloister start/stop/
   resume-spawns`, `spawn-status`, `cloister status`, `flywheel current/state/
   status`. These mutate or read the **live runtime service**, not a table. They
   are modeled as the **`CloisterRuntime`** non-data process service (CONVENTIONS
   §8.5) — `start`/`stop`/`resumeSpawns`/`isSpawnPaused`/`getStatus` over the live
   watchdog — which the controller depends on instead of reaching for
   `getCloisterService()` directly; status endpoints recompose at the controller
   from `CloisterRuntime.getStatus()` + the AS pause flag. They are not
   resolver/writer members because there is nothing in `overdeck.db` for them to
   read or write.
3. **File-backed config that is not `projects.yaml`** — `config.yaml`
   (`settings.ts` GET/PUT), `cloister.toml` (`cloister/config.ts`),
   `ui-theme.json`, the flywheel brief file. Preserved as thin file doors
   (FILE-CONFIG); not data-domain methods because no `overdeck.db` table backs
   them.
4. **`stuck`/`unstick`** — ephemeral review-run runtime (`review_runs`, schema
   360-361), not `app_settings`/`issue_policy`. Same disposition `issues.md` gave
   it; lands in the Orchestration/review-run runtime, not here.
5. **`deaconIgnoredReason` — the one genuine accept-loss.** Today
   `deacon-ignore`'s `reason` is *persisted* (`review_status.deaconIgnoredReason`,
   returned at `workspaces.ts:4741`). The **locked `issue_policy` table** (schema
   327-332) has **no reason column**, so `setDeaconIgnored` carries `reason` only
   into the `settings.policy_changed` **event**, not durable storage. This is a
   small, deliberate parity loss — the durable reason field is dropped; the toggle
   itself and its event-side reason are preserved. Named here so the no-loss audit
   is honest rather than silently lossy. (If the reason must stay durable, add a
   `deacon_ignored_reason` column to `issue_policy` — a schema change, flagged for
   the schema owner, not assumed here.)
6. **`restart_announcer.last_announced_ts`** — an `app_settings` key with **no
   HTTP/CLI/RPC surface**: it is written internally by the restart announcer via
   the same `setFlag` primitive and read internally; no operator-facing door
   exists or is needed. Listed for completeness; not a resolver/writer member.

Everything else is a clean AS / IP / YAML read or write. The single durable
parity loss (`deaconIgnoredReason`, item 5) is named above, not silent.

---

# Part 2 — The Effect services (derived from the mapping)

Written in the verified v4-beta idiom from
[`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md):
`Context.Service` (never `Effect.Service`), `effect/unstable/*` imports, Drizzle
behind the `Db` service, `Schema.Literals([...])` taking arrays,
`Schema.TaggedErrorClass`. **The two writer divergences from the Issues template
(no `Records` mirror; `AgentWriter` delegation) are made explicit below.** Every
member traces to a Part-1 row.

## 2.1 Entities & errors — `Schema`

```ts
import { Effect, Layer, Context, Schema } from "effect"
import { eq } from "drizzle-orm"
import { appSettings, issuePolicy } from "../overdeck-schema"   // the locked Drizzle tables
import { Db, EventBus } from "./infra"                          // Db = Drizzle handle; NO Records here (see §2.4)
import { AgentWriter } from "./agents"                          // for the agent-lifecycle half of runtime-control verbs
import { IssueId } from "./issues"                              // the branded issue id

// ── Flywheel config — the 3 app_settings flags (flywheel.ts:222-228) ─────────
export const FlywheelConfig = Schema.Struct({
  autoPickupBacklog:    Schema.Boolean,   // flywheel.auto_pickup_backlog
  requireUatBeforeMerge: Schema.Boolean,  // flywheel.require_uat_before_merge
  mergeTrainEnabled:    Schema.Boolean,   // merge_train_enabled
})
export type FlywheelConfig = typeof FlywheelConfig.Type

// patch form for setFlywheelConfig (each flag optional — postFlywheelConfigPayload:246-248)
export const FlywheelConfigPatch = Schema.Struct({
  autoPickupBacklog:     Schema.optional(Schema.Boolean),
  requireUatBeforeMerge: Schema.optional(Schema.Boolean),
  mergeTrainEnabled:     Schema.optional(Schema.Boolean),
})
export type FlywheelConfigPatch = typeof FlywheelConfigPatch.Type

// ── Flywheel RUNTIME flags — distinct from config (app_settings, §1H) ─────────
// active_run_id: the live run id (ws-rpc.ts:596) · paused: flywheel.globally_paused
export const FlywheelRuntime = Schema.Struct({
  activeRunId: Schema.NullOr(Schema.String),
  paused:      Schema.Boolean,
})
export type FlywheelRuntime = typeof FlywheelRuntime.Type

// ── Per-issue policy — the issue_policy row (schema 327-332) ──────────────────
// autoMerge: true=fast lane · false=hold for UAT · null=clear to project default
export const IssuePolicy = Schema.Struct({
  issueId:       IssueId,
  deaconIgnored: Schema.Boolean,
  autoMerge:     Schema.NullOr(Schema.Boolean),
})
export type IssuePolicy = typeof IssuePolicy.Type

// ── Config — a project definition read from projects.yaml (read-only) ─────────
export const ProjectKey = Schema.String.pipe(Schema.brand("ProjectKey"))
export type  ProjectKey = typeof ProjectKey.Type

export const ProjectConfig = Schema.Struct({
  key:              ProjectKey,
  path:             Schema.String,
  // per-project auto-merge default ('auto' | 'hold' | null) — projects.ts:584,599
  autoMergeDefault: Schema.NullOr(Schema.Literals(["auto", "hold"])),
  // (further fields — repos, test config, close_out — modeled as the resolver grows)
})
export type ProjectConfig = typeof ProjectConfig.Type

// ── Errors — tagged, in the E channel (CONVENTIONS §3) ───────────────────────
export class ProjectNotFound extends Schema.TaggedErrorClass<ProjectNotFound>()(
  "ProjectNotFound", { key: ProjectKey },
) {}
export class FlywheelAlreadyActive extends Schema.TaggedErrorClass<FlywheelAlreadyActive>()(
  "FlywheelAlreadyActive", { runId: Schema.String },   // flywheel-actions.ts:200-202
) {}
export class NoActiveFlywheelRun extends Schema.TaggedErrorClass<NoActiveFlywheelRun>()(
  "NoActiveFlywheelRun", {},                            // flywheel-actions.ts:277
) {}
```

## 2.2 `SettingsResolver` — the read door (`Context.Service`)

Three read members, tracing to Part-1: `isDeaconPaused` (§1B), `getFlywheelConfig`
(§1D), `getPolicy` (§1E). All read `app_settings` / `issue_policy` via `Db` — and
**only** those two tables.

```ts
export class SettingsResolver extends Context.Service<SettingsResolver, {
  readonly isDeaconPaused:    () => Effect.Effect<boolean>
  readonly getFlywheelConfig: () => Effect.Effect<FlywheelConfig>
  readonly getFlywheelRuntime: () => Effect.Effect<FlywheelRuntime>   // active_run_id + paused (§1H)
  readonly getPolicy:         (id: IssueId) => Effect.Effect<IssuePolicy>   // defaults if no row
}>()("overdeck/SettingsResolver") {}

export const SettingsResolverLayer = Layer.effect(SettingsResolver, Effect.gen(function* () {
  const { q } = yield* Db   // Drizzle handle — appears ONLY in resolver/writer Layer R

  // app_settings is a KV table; a flag read is a keyed select with a JSON value.
  // The default mirrors today's accessor (app-settings.ts), NOT a blanket false:
  //   deacon.globally_paused           → false   (app-settings.ts:61-71)
  //   flywheel.auto_pickup_backlog     → false   (app-settings.ts:110)
  //   flywheel.require_uat_before_merge→ TRUE    (app-settings.ts:123,126 — v !== 'false')
  //   merge_train_enabled              → false   (app-settings.ts:142)
  const flag = (key: string, dflt: boolean) => Effect.sync(() => {
    const row = q.select().from(appSettings).where(eq(appSettings.key, key)).get()
    return row?.value === undefined || row.value === null ? dflt : Boolean(row.value)
  })

  const isDeaconPaused = () => flag("deacon.globally_paused", false)   // misc.ts:784

  const getFlywheelConfig = () => Effect.gen(function* () {
    const autoPickupBacklog     = yield* flag("flywheel.auto_pickup_backlog", false)
    const requireUatBeforeMerge = yield* flag("flywheel.require_uat_before_merge", true)  // default TRUE
    const mergeTrainEnabled     = yield* flag("merge_train_enabled", false)
    return { autoPickupBacklog, requireUatBeforeMerge, mergeTrainEnabled }   // flywheel.ts:222-228
  })

  // The flywheel RUNTIME flags — distinct from the 3-flag config contract above.
  // active_run_id is read by the RPC subscription (ws-rpc.ts:596) and by
  // flywheel current/state; globally_paused is branch-read in flywheel-run-state.ts:204.
  const getFlywheelRuntime = () => Effect.gen(function* () {
    const paused = yield* flag("flywheel.globally_paused", false)
    const activeRunId = yield* Effect.sync(() => {
      const row = q.select().from(appSettings).where(eq(appSettings.key, "flywheel.active_run_id")).get()
      return (row?.value as string | null | undefined) ?? null
    })
    return { activeRunId, paused }
  })

  const getPolicy = (id: IssueId) => Effect.sync(() => {
    const row = q.select().from(issuePolicy).where(eq(issuePolicy.issueId, id)).get()
    // no row ⇒ the cutover/default posture: not ignored, no per-issue override.
    return { issueId: id, deaconIgnored: Boolean(row?.deaconIgnored), autoMerge: row?.autoMerge ?? null }
  })

  return SettingsResolver.of({ isDeaconPaused, getFlywheelConfig, getFlywheelRuntime, getPolicy })
}))
```

## 2.3 `ConfigResolver` — the read-only file door (`Context.Service`)

The one resolver with **no `Db`** and **no writer**. It reads `projects.yaml`
through the mtime cache and decodes to `ProjectConfig`. Traces to Part-1 §1G.

```ts
export class ConfigResolver extends Context.Service<ConfigResolver, {
  readonly getProject:   (key: ProjectKey) => Effect.Effect<ProjectConfig, ProjectNotFound>
  readonly listProjects: () => Effect.Effect<ReadonlyArray<ProjectConfig>>
}>()("overdeck/ConfigResolver") {}

export const ConfigResolverLayer = Layer.effect(ConfigResolver, Effect.gen(function* () {
  const projects = yield* ProjectsFile   // thin wrapper over loadProjectsConfigSync (projects.ts:198), mtime-cached

  const decode = Schema.decodeUnknown(ProjectConfig)

  const getProject = (key: ProjectKey) => Effect.gen(function* () {
    const raw = yield* Effect.sync(() => projects.get(key))   // getProjectSync (projects.ts)
    return raw
      ? yield* decode(raw)
      : yield* Effect.fail(new ProjectNotFound({ key }))
  })

  const listProjects = () => Effect.gen(function* () {
    const all = yield* Effect.sync(() => projects.all())      // loadProjectsConfigSync().projects
    return yield* Effect.forEach(all, decode)
  })

  return ConfigResolver.of({ getProject, listProjects })
}))
```

> **No `ConfigWriter`.** Project edits are FILE-CONFIG writes to `projects.yaml`
> (`setProjectAutoMergeDefaultSync` `projects.ts:257`, `pan project`). The remodel
> keeps the file as the single source; the resolver is the single read door. This
> domain is trivially correct for the remodel and survives any DB wipe
> ([audit §4](../investigations/orchestration-config-audit.md)).

## 2.4 `SettingsWriter` — the write door (`Context.Service`)

The write door for `app_settings` + `issue_policy`, **and** the orchestrator of
the runtime-control verbs. **Two deliberate divergences from `IssueWriter`:**

- **No `Records` step.** `app_settings`/`issue_policy` are SOURCE-OF-TRUTH-in-DB
  (audit §6) — the DB write **is** the commit point. `SettingsWriter`'s `R` has
  `Db`, `EventBus`, and `AgentWriter` — **never `Records`**.
- **`AgentWriter` delegation.** The agent-lifecycle half of `startFlywheel`/
  `pause`/`resume`/`abort`/`emergencyStop`/`brake` routes through `AgentWriter`.
  `SettingsWriter` writes only the flag (or nothing, for brake/emergency-stop).
  It **never receives the `agents` table** — the headline guarantee, enforced by
  the type system.

```ts
export class SettingsWriter extends Context.Service<SettingsWriter, {
  // ── pure app_settings flag writes ──
  readonly setDeaconPaused:   (paused: boolean) => Effect.Effect<void>                          // misc.ts:806
  readonly setFlywheelConfig: (patch: FlywheelConfigPatch) => Effect.Effect<FlywheelConfig>     // flywheel.ts:246-248
  // ── per-issue policy (issue_policy) ──
  readonly setDeaconIgnored:  (id: IssueId, ignored: boolean, reason?: string) => Effect.Effect<IssuePolicy>  // workspaces.ts:4734
  readonly setAutoMerge:      (id: IssueId, autoMerge: boolean | null) => Effect.Effect<IssuePolicy>          // workspaces.ts:4773
  // ── runtime-control: flag write + AgentWriter delegation (headline residue) ──
  readonly startFlywheel:  (brief?: string) => Effect.Effect<{ runId: string }, FlywheelAlreadyActive, AgentWriter>
  readonly pauseFlywheel:  () => Effect.Effect<{ changed: boolean }, never, AgentWriter>
  readonly resumeFlywheel: () => Effect.Effect<{ changed: boolean }, NoActiveFlywheelRun, AgentWriter>
  readonly abortFlywheel:  () => Effect.Effect<{ aborted: string | null }, never, AgentWriter>
  // ── runtime-control: NO flag, pure AgentWriter delegation (cloister.ts:82-137) ──
  readonly emergencyStop:  () => Effect.Effect<{ killedAgents: ReadonlyArray<string> }, never, AgentWriter>
  readonly brake:          () => Effect.Effect<{ before: number; remaining: number }, never, AgentWriter>
}>()("overdeck/SettingsWriter") {}

export const SettingsWriterLayer = Layer.effect(SettingsWriter, Effect.gen(function* () {
  const { q } = yield* Db          // app_settings + issue_policy ONLY — NOT agents
  const bus   = yield* EventBus
  const now   = () => new Date()

  // KV write — the COMMIT POINT (no Records mirror; the DB is the source of truth).
  const setFlag = (key: string, value: unknown) => Effect.sync(() =>
    q.insert(appSettings).values({ key, value, updatedAt: now() })
      .onConflictDoUpdate({ target: appSettings.key, set: { value, updatedAt: now() } }).run())

  const setDeaconPaused = (paused: boolean) => Effect.gen(function* () {
    yield* setFlag("deacon.globally_paused", paused)                       // misc.ts:806
    yield* bus.emit({ type: "settings.deacon_paused", payload: { paused } })
  })

  const setFlywheelConfig = (patch: FlywheelConfigPatch) => Effect.gen(function* () {
    if (patch.autoPickupBacklog     !== undefined) yield* setFlag("flywheel.auto_pickup_backlog", patch.autoPickupBacklog)
    if (patch.requireUatBeforeMerge !== undefined) yield* setFlag("flywheel.require_uat_before_merge", patch.requireUatBeforeMerge)
    if (patch.mergeTrainEnabled     !== undefined) yield* setFlag("merge_train_enabled", patch.mergeTrainEnabled)
    const next = yield* (yield* SettingsResolver).getFlywheelConfig()      // read-back, like flywheel.ts:250
    yield* bus.emit({ type: "settings.flywheel_config", payload: next })
    return next
  })

  // per-issue policy — issue_policy upsert (today review_status; new home schema 327-332)
  const setDeaconIgnored = (id: IssueId, ignored: boolean, reason?: string) => Effect.gen(function* () {
    yield* Effect.sync(() =>
      q.insert(issuePolicy).values({ issueId: id, deaconIgnored: ignored, autoMerge: null, updatedAt: now() })
        .onConflictDoUpdate({ target: issuePolicy.issueId, set: { deaconIgnored: ignored, updatedAt: now() } }).run())
    yield* bus.emit({ type: "settings.policy_changed", payload: { id, deaconIgnored: ignored, reason } })
    return yield* (yield* SettingsResolver).getPolicy(id)
  })

  const setAutoMerge = (id: IssueId, autoMerge: boolean | null) => Effect.gen(function* () {
    yield* Effect.sync(() =>
      q.insert(issuePolicy).values({ issueId: id, deaconIgnored: false, autoMerge, updatedAt: now() })
        .onConflictDoUpdate({ target: issuePolicy.issueId, set: { autoMerge, updatedAt: now() } }).run())
    yield* bus.emit({ type: "settings.policy_changed", payload: { id, autoMerge } })
    return yield* (yield* SettingsResolver).getPolicy(id)
  })

  // ── runtime-control: the flag write is OURS; the agent half is AgentWriter's ──
  const startFlywheel = (brief?: string) => Effect.gen(function* () {
    const agents = yield* AgentWriter
    // (live-active guard → FlywheelAlreadyActive, flywheel-actions.ts:200-202)
    const runId  = yield* nextRunId
    yield* agents.spawnFlywheelOrchestrator(runId, brief)   // spawnFlywheelAgent — AGENTS owns this
    yield* setFlag("flywheel.active_run_id", runId)         // AS flag — flywheel-actions.ts:225
    yield* setFlag("flywheel.globally_paused", false)       // AS flag — flywheel-actions.ts:226
    yield* bus.emit({ type: "settings.flywheel_started", payload: { runId } })
    return { runId }
  })

  const pauseFlywheel = () => Effect.gen(function* () {
    const agents = yield* AgentWriter
    yield* setFlag("flywheel.globally_paused", true)                       // AS — flywheel-actions.ts:251
    yield* agents.stopFlywheelOrchestrator()                              // stopAgent — AGENTS owns this (252)
    yield* bus.emit({ type: "settings.flywheel_paused", payload: {} })
    return { changed: true }
  })

  const resumeFlywheel = () => Effect.gen(function* () {
    const agents = yield* AgentWriter
    // (NoActiveFlywheelRun if no active_run_id — flywheel-actions.ts:277)
    yield* agents.spawnFlywheelOrchestrator(/* resume */)                 // AGENTS (286)
    yield* setFlag("flywheel.globally_paused", false)                     // AS — flywheel-actions.ts:297
    yield* bus.emit({ type: "settings.flywheel_resumed", payload: {} })
    return { changed: true }
  })

  const abortFlywheel = () => Effect.gen(function* () {
    const agents = yield* AgentWriter
    yield* agents.stopFlywheelOrchestrator()                             // AGENTS (266-267)
    yield* setFlag("flywheel.active_run_id", null)                        // AS — flywheel-run-state.ts:298
    yield* setFlag("flywheel.globally_paused", false)                     // AS — flywheel-run-state.ts:299
    yield* bus.emit({ type: "settings.flywheel_aborted", payload: {} })
    return { aborted: /* prior runId */ null }
  })

  // brake / emergencyStop write NO flag — pure agent lifecycle, delegated whole.
  const emergencyStop = () => Effect.gen(function* () {
    const agents = yield* AgentWriter
    const killedAgents = yield* agents.stopAll()                          // cloister.ts:82-105 → AgentWriter
    return { killedAgents }
  })

  const brake = () => Effect.gen(function* () {
    const agents = yield* AgentWriter
    const result = yield* agents.trimToCap()                             // cloister.ts:113-137 → AgentWriter
    return { before: result.before, remaining: result.remaining }
  })

  return SettingsWriter.of({
    setDeaconPaused, setFlywheelConfig, setDeaconIgnored, setAutoMerge,
    startFlywheel, pauseFlywheel, resumeFlywheel, abortFlywheel, emergencyStop, brake,
  })
}))
```

> **Why `SettingsWriter`'s `R` is honest.** Its dependencies are `Db` (the
> `app_settings` + `issue_policy` tables only), `EventBus`, `SettingsResolver`,
> and `AgentWriter`. It **never** receives the `agents` Drizzle handle — so it
> physically *cannot* write the agents table. Every agent kill/spawn flows through
> `AgentWriter`'s door. That is the headline finding enforced by the type system,
> not a convention. And it has **no `Records`** — the DB write is the commit point
> for these SOURCE-OF-TRUTH-in-DB flags (audit §6).

## 2.5 `SettingsApi` — the controller (`HttpApiGroup`)

Each endpoint declares request / success / error Schemas and delegates to the
services; the handler's `R` is `SettingsResolver | SettingsWriter | ConfigResolver`,
never `Db`. Endpoints trace to the Part-1 §1B/§1D/§1E/§1G data-domain rows. The
FILE-CONFIG and relocated routes are **not** in this group — they live on their
sibling controllers (provider-auth, OpenRouter, Conversations-search, Merge,
Agents) and the thin file/runtime doors.

```ts
import { HttpApi, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder } from "effect/unstable/httpapi"

export const SettingsApi = HttpApiGroup.make("settings")
  // ── reads ──
  .add(HttpApiEndpoint.get("getDeaconPause", "/deacon/pause", {
    success: Schema.Struct({ paused: Schema.Boolean }),
  }))
  .add(HttpApiEndpoint.get("getFlywheelConfig", "/flywheel/config", {
    success: FlywheelConfig,
  }))
  .add(HttpApiEndpoint.get("getFlywheelRuntime", "/flywheel/state", {
    success: FlywheelRuntime,   // the AS slice of flywheel current/state + the RPC subscription
  }))
  .add(HttpApiEndpoint.get("getPolicy", "/issues/:id/policy", {
    params:  Schema.Struct({ id: IssueId }),
    success: IssuePolicy,
  }))
  // ── flag writes ──
  .add(HttpApiEndpoint.post("setDeaconPause", "/deacon/pause", {
    payload: Schema.Struct({ paused: Schema.Boolean }),
    success: Schema.Struct({ paused: Schema.Boolean }),
  }))
  .add(HttpApiEndpoint.post("setFlywheelConfig", "/flywheel/config", {
    payload: FlywheelConfigPatch,
    success: FlywheelConfig,
  }))
  // ── per-issue policy (issue_policy) ──
  .add(HttpApiEndpoint.post("setDeaconIgnored", "/workspaces/:id/deacon-ignore", {
    params:  Schema.Struct({ id: IssueId }),
    payload: Schema.Struct({ ignored: Schema.Boolean, reason: Schema.optional(Schema.String) }),
    success: IssuePolicy,
  }))
  .add(HttpApiEndpoint.post("setAutoMerge", "/workspaces/:id/auto-merge", {
    params:  Schema.Struct({ id: IssueId }),
    payload: Schema.Struct({ autoMerge: Schema.NullOr(Schema.Boolean) }),
    success: IssuePolicy,
  }))
  // ── runtime-control (flag + AgentWriter delegation) ──
  .add(HttpApiEndpoint.post("startFlywheel", "/flywheel/start", {
    payload: Schema.Struct({ brief: Schema.optional(Schema.String) }),
    success: Schema.Struct({ runId: Schema.String }),
    error:   FlywheelAlreadyActive,
  }))
  .add(HttpApiEndpoint.post("pauseFlywheel", "/flywheel/pause", { success: Schema.Struct({ changed: Schema.Boolean }) }))
  .add(HttpApiEndpoint.post("resumeFlywheel", "/flywheel/resume", {
    success: Schema.Struct({ changed: Schema.Boolean }), error: NoActiveFlywheelRun,
  }))
  .add(HttpApiEndpoint.post("abortFlywheel", "/flywheel/abort", { success: Schema.Struct({ aborted: Schema.NullOr(Schema.String) }) }))
  .add(HttpApiEndpoint.post("emergencyStop", "/cloister/emergency-stop", { success: Schema.Struct({ killedAgents: Schema.Array(Schema.String) }) }))
  .add(HttpApiEndpoint.post("brake", "/cloister/brake", { success: Schema.Struct({ before: Schema.Number, remaining: Schema.Number }) }))

// Config is read-only — its own group, no writer.
export const ConfigApi = HttpApiGroup.make("config")
  .add(HttpApiEndpoint.get("getProject", "/projects/:key", {
    params:  Schema.Struct({ key: ProjectKey }),
    success: ProjectConfig,
    error:   ProjectNotFound,
  }))
  .add(HttpApiEndpoint.get("listProjects", "/projects", { success: Schema.Array(ProjectConfig) }))

export const OverdeckApi = HttpApi.make("overdeck")
  .add(SettingsApi).add(ConfigApi) /* .add(IssuesApi).add(AgentsApi).add(MergeApi) … */

// handlers: pure delegation. R = SettingsResolver | SettingsWriter | ConfigResolver — never Db.
export const SettingsApiLive = HttpApiBuilder.group(OverdeckApi, "settings", (h) =>
  h.handle("getDeaconPause",   ()             => SettingsResolver.isDeaconPaused().pipe(Effect.map((paused) => ({ paused }))))
   .handle("getFlywheelConfig", ()            => SettingsResolver.getFlywheelConfig())
   .handle("getFlywheelRuntime", ()           => SettingsResolver.getFlywheelRuntime())
   .handle("getPolicy",        ({ path })     => SettingsResolver.getPolicy(path.id))
   .handle("setDeaconPause",   ({ payload })  => SettingsWriter.setDeaconPaused(payload.paused).pipe(Effect.as({ paused: payload.paused })))
   .handle("setFlywheelConfig",({ payload })  => SettingsWriter.setFlywheelConfig(payload))
   .handle("setDeaconIgnored", ({ path, payload }) => SettingsWriter.setDeaconIgnored(path.id, payload.ignored, payload.reason))
   .handle("setAutoMerge",     ({ path, payload }) => SettingsWriter.setAutoMerge(path.id, payload.autoMerge))
   .handle("startFlywheel",    ({ payload })  => SettingsWriter.startFlywheel(payload.brief))
   .handle("pauseFlywheel",    ()             => SettingsWriter.pauseFlywheel())
   .handle("resumeFlywheel",   ()             => SettingsWriter.resumeFlywheel())
   .handle("abortFlywheel",    ()             => SettingsWriter.abortFlywheel())
   .handle("emergencyStop",    ()             => SettingsWriter.emergencyStop())
   .handle("brake",            ()             => SettingsWriter.brake()))

export const ConfigApiLive = HttpApiBuilder.group(OverdeckApi, "config", (h) =>
  h.handle("getProject",   ({ path }) => ConfigResolver.getProject(path.key))
   .handle("listProjects", ()         => ConfigResolver.listProjects()))
```

The dashboard's live RPC surface ([CONVENTIONS §8](../ARCHITECTURE-CONVENTIONS.md))
delegates to the **same** resolver/writer so HTTP and RPC cannot diverge:
`flywheel.subscribeStatus` (Part-1 §1H, today `pan.subscribeFlywheelStatus`)
streams `flywheel.active_run_id` (read via `SettingsResolver`) + the recomposed
run-state snapshot via the writer's `bus.emit`.

## 2.6 Layer wiring

```ts
const ControlSettingsDomainLayer = Layer.mergeAll(
  SettingsResolverLayer,
  SettingsWriterLayer,
  ConfigResolverLayer,
).pipe(
  Layer.provide(DbLive),          // the ONLY place the app_settings/issue_policy handle is provided
  Layer.provide(EventBusLive),
  Layer.provide(AgentWriterLayer),// the agent-lifecycle half of runtime-control verbs
  Layer.provide(ProjectsFileLive),// the projects.yaml mtime-cache (Config — file, NOT Db)
  // NB: NO Layer.provide(RecordsLive) here — these flags are SOURCE-OF-TRUTH-in-DB (audit §6).
)

const HttpLive = HttpApiBuilder.serve(OverdeckApi).pipe(
  Layer.provide(SettingsApiLive),
  Layer.provide(ConfigApiLive),
  Layer.provide(ControlSettingsDomainLayer),
)
// NodeRuntime.runMain(Layer.launch(HttpLive))  — Node 22 only (dashboard rule)
```

A missing dependency is a **compile error at the merge** ([CONVENTIONS §6](../ARCHITECTURE-CONVENTIONS.md)).
Because `SettingsWriterLayer`'s `R` resolves to `Db | EventBus | SettingsResolver
| AgentWriter` and **never leaks the `agents` table nor `Records`**, no
Control/Settings code can write the agents table directly or pretend to mirror
git for these flags.

---

## Acceptance — every method traces to a Part-1 row

| Service member | Part-1 source rows |
|---|---|
| `SettingsResolver.isDeaconPaused` | §1B `GET /api/deacon/pause` (`misc.ts:780`) |
| `SettingsResolver.getFlywheelConfig` | §1D `GET /api/flywheel/config` (`flywheel.ts:542`) |
| `SettingsResolver.getFlywheelRuntime` | §1D `GET /api/flywheel/current`/`state` (`flywheel.ts:520,978`); §1H `pan.subscribeFlywheelStatus` AS slice (`ws-rpc.ts:596`) |
| `SettingsResolver.getPolicy` | §1E `GET /api/review/:id/status` policy fields; §1F `getPolicy` recompose |
| `ConfigResolver.getProject` / `listProjects` | §1G `GET /api/projects/:key/auto-merge-default` (`projects.ts:577`); audit §4 (loadProjectsConfigSync) |
| `SettingsWriter.setDeaconPaused` | §1B `POST /api/deacon/pause` (`misc.ts:798`); §1F `pan admin cloister freeze`/`unfreeze` (`freeze.ts:19,29`) |
| `SettingsWriter.setFlywheelConfig` | §1D `POST /api/flywheel/config` (`flywheel.ts:550`); §1F `pan flywheel config` |
| `SettingsWriter.setDeaconIgnored` | §1E `POST /api/workspaces/:id/deacon-ignore` (`workspaces.ts:4710`) |
| `SettingsWriter.setAutoMerge` | §1E `POST /api/workspaces/:id/auto-merge` (`workspaces.ts:4755`) |
| `SettingsWriter.startFlywheel` | §1D `POST /api/flywheel/start` (`flywheel.ts:713`); §1F `pan flywheel start` |
| `SettingsWriter.pauseFlywheel` | §1D `POST /api/flywheel/pause` (`flywheel.ts:733`); §1F `pan flywheel pause` |
| `SettingsWriter.resumeFlywheel` | §1D `POST /api/flywheel/resume` (`flywheel.ts:750`); §1F `pan flywheel resume` |
| `SettingsWriter.abortFlywheel` | §1D `POST /api/flywheel/abort` (`flywheel.ts:767`); §1F `pan flywheel stop`/`abort` |
| `SettingsWriter.emergencyStop` | §1C `POST /api/cloister/emergency-stop` (`cloister.ts:82`); §1F `pan admin cloister emergency-stop` |
| `SettingsWriter.brake` | §1C `POST /api/cloister/brake` (`cloister.ts:113`); §1F `pan admin cloister brake` |
| `SettingsApi` / `ConfigApi` endpoints | one-to-one with the resolver/writer members above |
| relocated / file-config / recomposed | §1I rollup — none map to a Control/Settings/Config data-domain member by design (no loss) |

No method reads or writes a column outside the locked `app_settings` /
`issue_policy` tables (or the read-only `projects.yaml`); no endpoint is invented;
the agents table is never reached from this domain; and nothing real from the
current settings/deacon/flywheel/policy/project-config surface is lost — every
item lands in a door, a sibling data domain, a file door, or a recompose.
