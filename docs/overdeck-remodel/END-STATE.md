# Overdeck — End-State Architecture

> **Status:** complete first-draft narrative for review. All six current-state
> audits are folded in, the schema is locked, and the Effect v4-beta idioms are
> verified. Companion docs: [`ARCHITECTURE-CONVENTIONS.md`](ARCHITECTURE-CONVENTIONS.md)
> (the Effect house style), [`overdeck-schema.ts`](overdeck-schema.ts) (the locked
> cache schema), and [`investigations/`](investigations/) (the evidence base).
>
> **What remains are four open decisions for the operator, not gaps.** They are
> summarized in the last section: which gates the pipeline keeps; the
> conversation-compaction read-only fix; the backup surface for the on-disk
> sacred files; and confirmation that Memory's observation files belong in that
> backup surface (Memory itself is now decided **in** as a domain).

## The disease, and the cure

Every recurring state and pipeline bug in Panopticon traces to one disease: a
single fact gets written from many places, and no one owns it. When a dozen call
sites can each set an issue's status, they drift. One path forgets to emit an
event; another fires a mirror-write and never checks whether it landed; a third
tries to do three things at once and does two. The symptom is a status that
disagrees with itself. The root cause is shared ownership of a fact that should
have exactly one writer.

Overdeck cures this structurally, not by asking everyone to be more careful.
The design rests on a few terms; define them once and the rest follows.

- A **resolver** is the **read door** for a domain — the one piece of code
  allowed to read that domain's data. Nothing else queries the store directly.
- A **writer** is the **write door** — the one piece of code allowed to change
  that domain's data. It validates the change, records it where the truth lives,
  then updates the cache.
- The **cache** is the local database, `overdeck.db`. Running code reads only
  from it, and it holds no original truth. Delete it and rebuild it from the
  sources below, and nothing is lost.
- A **gate** is a pass/fail checkpoint that blocks an issue from advancing toward
  merge — review, test, and verification are gates. A status that is merely
  displayed is not a gate.

The phrase you will see throughout is **the four homes**. Every durable fact in
the system lives in exactly one of four places, and the cache mirrors all of
them:

1. **git** holds the code and the per-issue records under `.pan/records`. Each
   record carries the pipeline verdicts, the plan, the decisions and hazards, the
   ownership lease, and the `closeOut` block — a cost-total snapshot plus the
   per-phase durations. These records travel with the repo and survive any wipe.
2. **The sacred files on disk** hold two things: the session transcripts (every
   message of every conversation and agent) and the Memory observation files.
   They are never committed to git, never altered, never overwritten, never
   deleted. The system only ever reads them and writes new ones beside them.
3. **GitHub** holds each issue's and PR's open/closed/merged status and its
   labels.
4. **The database**, `overdeck.db`, is a disposable cache for everything else,
   rebuilt from the first three.

A fifth source sits beside the four homes but is not a home, because it stores
nothing durable: **tmux**, on the `panopticon` socket, is the **liveness
oracle** — the ground truth for whether a process is actually running right now.
The cache mirrors what tmux reports; it never originates it.

That is the whole thesis. One read door and one write door per domain; a cache
that owns nothing; four homes that own everything. The remodel makes the
two-door rule a fact of the type system rather than a guideline you can
violate — a request handler never receives the database handle in its
dependencies, only its domain's resolver and writer, so reaching past a door is a
compile error.

### The deletion scoreboard

The remodel is a complexity amputation. We keep a fact only when it drives a
concrete decision; everything else is deleted. The headline reductions:

| Area | Before | After |
|---|---|---|
| Issue stage | 8 status axes, ~148 write sites | 1 stage, one `advance()` |
| Issue transitions | ~148 trigger sites | ~15 legal moves |
| Review/merge state | 49 fields (36 nominally "kept") | ~5–8 durable verdict fields on the issue; the rest become Merge or Orchestration runtime, or are deleted |
| Agent state | 44-column table plus a `state.json` plane of 48 files | 18 fields, no `state.json` |
| `ready_for_merge` | a stored column plus 2 boot-time repair sweeps | derived; the sweeps are deleted |
| Conversations/Transcripts | 30-column table plus 9 satellite tables | 14 durable fields plus favorites; the transcript subsystem becomes 100% cache; cost stored 3× becomes 1× |
| Cost | 396k rows across 4 stores (3 redundant), 1.4 GB | 14 of 20 columns; one resolver; 3 stores deleted; ~90-day retention |
| Observability | 624k unbounded `events` rows; 2 modules for `health_events` | infrastructure, not a domain — a thin EventBus, tiered retention, `health_events` folded into Agents |
| Orchestration/Config | 16 tables (6 dead) | 6 tables deleted; Orchestration splits into Merge plus Control/Settings; Config is `projects.yaml`, a file |

The database itself shrinks from 35 tables to about 14, every one of them a
disposable mirror, with foreign keys actually enforced for the first time.

### Why the big-bang is low-risk

The new `overdeck.db` starts **empty**, and the old `panopticon.db` is kept
untouched as a backup. We rebuild the empty cache from the four homes. If the
rebuild is wrong, the old database is still there, and nothing durable ever lived
only in the cache. That is what makes a single-cutover rebuild safe rather than
dangerous.

## The two doors, in one picture

```
   THE FOUR HOMES        git .pan/records · sacred files on disk · GitHub
   (+ tmux liveness)     · the DB is NOT a home — it caches the other three
          │  ▲
   reconstruction        rebuild the cache from the homes
          ▼  │           the writer mirrors durable state back to its home
   ┌──────────────────────────────────────────────┐
   │   overdeck.db   (Drizzle + better-sqlite3)    │   ← a CACHE. starts empty. disposable.
   └──────────────────────────────────────────────┘
        ▲                              ▲
   READ DOOR                      WRITE DOOR
   <Domain>Resolver               <Domain>Writer            (one each, per domain)
        ▲                              ▲
   ┌────┴───────────┬──────────────────┴─────────┐
  HttpApiGroup    RpcGroup (dashboard)         the CLI
   per domain     subscribeDomainEvents
        └──── every caller goes through a door; nothing touches the DB directly ────┘
```

The **resolver** is the only reader of its domain's cache. It takes the database
handle and whatever source clients it needs, and it returns validated entities.
The **writer** is the only mutator. It validates the operation, records it in the
source of truth first, then updates the cache and announces the change as a
domain event. The **controllers** — one HTTP group per domain, plus the
dashboard's RPC group for live reads — both delegate to the same resolver and
writer, so the HTTP and RPC surfaces cannot drift apart. The **guard** is the
type system: because a handler's dependencies only ever name a resolver or
writer, never the raw database, a direct database read is a compile error. A CI
check covers the non-Effect code (CLI scripts and hooks) the type system can't
reach.

One point deserves emphasis because the old design got it wrong. The cache layer
is **Drizzle ORM on top of `better-sqlite3`**, wrapped behind a single Effect
`Db` service. It is deliberately **not** `@effect/sql`: that library's only
SQLite adapter is Bun-only, and the dashboard is Node-22-only, so `@effect/sql`
cannot run here. The Drizzle schema in
[`overdeck-schema.ts`](overdeck-schema.ts) *is* the locked database schema. This
was once listed as an open risk; it is now a settled decision.

## The domain map

After the audits, the original eight domains distill to six: Transcripts turned
out to be a shared internal service rather than a domain, Observability turned
out to be infrastructure, and the old Orchestration domain split into Merge and
Control/Settings. The audit also surfaced a domain that was never in the original
eight — Memory — and it stays in scope. That leaves **seven database-cache
domains** (the six, plus Memory) **and Config**, which is file-backed rather than
cached. Memory is the smallest: its entire database footprint is a single cache
table, with its real records living as files on disk.

| # | Domain | Read door | Write door | Source(s) of truth | Cache tables |
|---|---|---|---|---|---|
| 1 | **Issues** | `IssuesResolver` | `IssueWriter` | GitHub + git `.pan/records` | `issues` |
| 2 | **Agents** | `AgentsResolver` | `AgentWriter` | tmux + git `.pan/records` | `agents`, `health_events` |
| 3 | **Conversations** | `ConversationsResolver` | `ConversationWriter` | the DB itself (the one exception) + the sacred session files | `conversations`, `conversation_files`, `favorites` |
| 4 | **Cost** | `CostResolver` | `CostWriter` | sacred transcripts + `~/.panopticon` cost archives | `cost_events` |
| 5 | **Merge** | `MergeResolver` | `MergeWriter` | GitHub PR state + `projects.yaml` | `merge_sets`, `merge_set_repos`, `merge_queue`, `pending_auto_merges`, `uat_generations` |
| 6 | **Control/Settings** | `SettingsResolver` | `SettingsWriter` | DB flags (reset at cutover) | `app_settings`, `issue_policy` |
| 7 | **Memory** | memory service | memory service | observation files on disk | `transcript_checkpoints` |

Config is a domain with no cache table at all: `projects.yaml` is the source of
truth, read through `loadProjectsConfig` and cached by file modification time. It
survives any database wipe because it is a file, and it has no database writer —
editing it means editing the file.

Two pieces look like domains but are not, because neither owns a navigable
surface:

- **Transcripts** is a shared internal index over the sacred session files. It is
  100% cache, rebuilt by a read-only scan, and it has no resolver and no pane. It
  is the single point where Conversation data and Agent data converge on the same
  transcript to compute derived facts — message counts, models, token totals —
  exactly once per file. That single convergence point is what lets us delete the
  duplicated derived fields everywhere else.
- **Observability** is a thin EventBus that carries the dashboard's live stream,
  plus a small health side-log. The `events` table is disposable pub/sub
  transport, not an event-sourced ledger.

One cross-cutting reminder, because it is the tenet the whole map enforces:
**"state" is not a domain.** Every entity *has* a status; there is no `/api/state`
and no state resolver. State lives on the entity that owns it.

The rest of this document walks each domain: what it is, where its truth lives,
what we keep and delete and why, and its read door, write door, and controller.

## Issues — the keystone

Evidence: [`pipeline-transitions.md`](investigations/pipeline-transitions.md),
[`review-state-audit.md`](investigations/review-state-audit.md),
[`gates-minimum.md`](investigations/gates-minimum.md).

An issue's "stage" is not stored today. It is a composite that the code reads
across **eight independent status axes**, each with its own enum, store, and
writer, mutated from about 148 sites. That is the single largest source of drift
in the system. Overdeck replaces all of it with one `stage` field, advanced
through one write door across a small set of validated legal moves.

The truth for an issue lives in two homes. GitHub owns the open/closed/merged
status, the PR identity, and the labels. The git `.pan/records` record owns the
durable pipeline block: the stage, the gate verdicts, the commit a verdict
applies to, and the blockers. The `issues` cache table mirrors that record:

| Field | Holds |
|---|---|
| `id` | the issue id, e.g. `PAN-1938` |
| `stage` | the single composite stage, replacing 8 axes |
| `reviewOutcome`, `testOutcome`, `verificationOutcome` | the durable verdict for each kept gate |
| `verdictCommit` | the commit a passing verdict applies to (collapses the old `reviewed_at_commit` and `last_verified_commit`) |
| `blockers` | typed blockers — merge conflicts and the like, replacing the old practice of sniffing a JSON `blocker_reasons` string |
| `planRef` | a pointer to the vBRIEF spec in git `.pan/specs` |
| `prUrl`, `prNumber`, `prHeadSha` | the PR identity, read live from GitHub |

GitHub's CI status, mergeable state, and blocker labels are read live, never
stored as columns; their effect lands in `blockers`. Everything else from the old
`review_status` and `issue_state` tables is either review-run runtime (which
moves to Orchestration) or simply deleted: `ready_for_merge` becomes derived, the
display-only timestamps go, the dead `inspect_bead_id` goes, and the phantom
`reviewer_verdicts` and `lifetime_auto_requeue_count` go.

The write door, `IssueWriter`, is built around one dominant verb.
**`advance(id, toStage, reason)`** checks that the move is one of the legal edges,
records the new stage and verdicts to the git record, updates the cache, and emits
`issue.advanced`. By deriving each gate outcome from the edge it takes, it absorbs
all ~148 transition sites — it is the only caller of what used to be `transitionTo`,
`setReviewStatus`, `updateSpecStatus`, and the GitHub-label operations. Beyond
`advance`, only two writes are genuinely facts about the issue itself: **`setPr`**
(the PR identity) and **`setBlockers`** (the merge-conflict blockers).

Designing this domain caught a real flaw in an earlier draft, and it is worth
stating because it is the disease the remodel cures. An earlier `hold(flag)` verb
was meant to toggle the issue's "side-states" — paused, troubled, stuck, blocked,
cancelled, deacon-ignored. But five of those six are not issue facts:
`paused`/`troubled` belong to the **Agent** writer, `deacon-ignored`/`auto-merge`
to the **Settings** writer, `stuck` to the ephemeral review-run runtime, and
`cancelled` is simply a stage that `advance` reaches. Only `blocked` is an issue
fact, and it is `setBlockers`. A `hold()` that wrote the others would have to pull
the `agents` and `issue_policy` tables into the Issues writer's dependencies — the
exact cross-domain reach the two-door rule forbids. So there is no `hold()`: each
side-state is written by the one domain that owns it.

There are about fifteen legal moves. The spine is a nine-step line:

```
todo → planning → planned → working → in_review → testing
     → verifying → merging → verifying_on_main → closed
```

Three failure edges send work back: `in_review → working`, `testing → working`,
and `merging → working`. Three out-of-band edges cover the rest: `any →
cancelled`, `closed → todo` (reopen), and `any → todo` (wipe). One function
writes a stage. It records the source first, then the cache, synchronously and
with the result checked. That kills the drift class outright: no GitHub-only path
that forgets the event, no fire-and-forget mirror, no single function trying to
do three transitions at once.

**The one open product decision that sizes this domain is which gates the
pipeline keeps.** The minimum-gate audit settled the answer the schema now
encodes: **review, test, and verification** all stay on the merge path, and each
is one outcome column on the issue. **Inspect leaves the merge path** — it
becomes an opt-in check during the work phase, scoped per bead, never a merge
blocker. The old `uat_status` field is dropped, because it was never actually
persisted. The human UAT batch-train is a different thing entirely and **stays**;
it lives in the Merge domain, not here.

The controller is `IssuesApi`:

- `GET /issues` lists issues by filter.
- `GET /issues/:id` gets one, or returns `IssueNotFound`.
- `GET /issues/:id/plan` returns the vBRIEF plan.
- `POST /issues/:id/advance` advances the stage, or returns `IllegalTransition`.
- `POST /issues/:id/blockers` sets the merge-conflict blockers.
- `POST /issues/:id/pr` sets the PR identity.

The full Effect form — entity, errors, resolver, writer, controller — is the
worked example in [`ARCHITECTURE-CONVENTIONS.md`](ARCHITECTURE-CONVENTIONS.md).

## Agents

Evidence: [`agents-state-audit.md`](investigations/agents-state-audit.md).

The 44-column `agents` table is a dumping ground, and beside it sits a second
plane: 48 `state.json` files on disk, one per agent. The audit found that the
real need is **18 fields**, and that nothing lives only in `state.json` — the
entire file plane is deleted. Three planes collapse to two: a database cache and
the tmux liveness oracle, both rebuildable from the git record.

The cache table groups its 18 fields into three kinds. The first is identity and
spawn configuration — id, issue, role, workspace, harness, model, session id,
host override, delivery method. Two of these, **harness and model, are
authoritative in the git record, not in the row**. The row is only a mirror. This
matters: the PAN-1847 / PAN-1927 incidents came from trusting a stale row's model
over the configured one, and making the record authoritative is the fix. The
second kind is the lifecycle gates — started-at, last-resume-at, stopped-by-user,
kickoff-delivered, paused with its reason, troubled, and the three failure
counters that drive retry backoff. These are pure cache with no rebuild fallback,
which is fine: a wiped database simply hands each agent a fresh retry budget. The
third kind is liveness — `status`, reconciled from tmux on every patrol, and
`updatedAt`.

A cluster of fields leaves the domain. `cost_so_far` moves to Cost. The whole
review-run cluster — run id, synthesis agent, output path, deadline,
monitor-signaled flag, retry attempt, sub-role — moves to Orchestration runtime,
along with `flywheel_run_id` and `role_run_head`. And several fields are deleted
outright: `phase` and `work_type` (dead PAN-118 routing); `branch`, which is
always `feature/<id>` and can be read live from git; `last_activity` and
`stopped_at`, both derivable; and three transport booleans that fold into the
single `deliveryMethod`. The old schema even defined `CREATE TABLE agents`
twice, byte-for-byte; the new schema has one.

The `health_events` table folds in here from Observability as an optional Agent
projection, with its `previous_state` column dropped because the adjacent ordered
row already holds it.

The read door, `AgentsResolver`, enumerates and gets agents from the cache,
reconciled against tmux. The write door, `AgentWriter`, exposes spawn, stop,
pause, unpause, resume, mark-troubled, and clear-troubled; liveness columns
rebuild from tmux, identity from the git record. The controller, `AgentsApi`,
lists and gets agents, runs each writer verb behind a POST, and serves an agent's
health history as a projection.

## Conversations

Evidence:
[`conversations-transcripts-audit.md`](investigations/conversations-transcripts-audit.md),
[`conversation-backing-files.md`](investigations/conversation-backing-files.md).

Conversations are the one exception to "the database owns nothing." A
conversation's durable data is pure metadata plus a set of pointers to its sacred
backing files — and that metadata is the only irreplaceable data the database
holds. It is preserved across a wipe by an **export** (PAN-1937, which is **not
yet built**), not by git. This is the deliberate DB-as-truth exception, not an
open question.

The reason the metadata is irreplaceable comes down to one field. A conversation
records the locator of its backing session file, but the file never names the
conversation back — the link runs one way only. After a wipe, with the pointer
gone, nothing can reconstruct which file belonged to which conversation. So the
durable fields must be exported.

The durable set is small: a conversation's name, working directory, issue id,
creation time, title and title source, model, effort, harness, archive time, and
the lineage edges that record handoffs and clears. Two satellites complete the
irreplaceable set. The `favorites` table holds the operator's stars. And the
`conversation_files` table holds the pointers to the backing files — because **a
single conversation can span more than one file** when the operator switches
harness mid-conversation. Each row names a harness and a harness-specific
locator: a Claude session UUID, a pi agent-directory locator, or a codex thread
id. The resolved filesystem path is always derived from the locator, never
stored. Old files are always kept; the write door adds pointer rows and creates
new files, and it **never mutates an existing backing file**.

Everything else on the old 30-column table is derived cache and gets dropped:
the tmux session, the live status, the ended-at and last-attached-at timestamps,
the cost and token totals, every `fork*` provisioning field, the delivery method
and spawn-error fields. All of it rebuilds from the transcripts, from tmux, or
from Cost. The message count, models, and token totals were never even stored
here — they came from a join against the transcript index.

This domain carries the one read-only violation the remodel must fix.
`conversation-compaction.ts` today appends compacted content directly into the
live Claude JSONL — it writes a sacred file in place, which the four-homes rule
forbids. The fix is to convert it to the **fork pattern**: write a new file and
point at it, so the entire Transcript layer is strictly read-only and no code
ever mutates a backing file.

Cost was stored three times across the old design — on the conversation, on the
transcript row, and as the sum of cost events — and the code already cross-checks
them. The two conversation copies are deleted; Cost derives the number once.

The controller, `ConversationsApi`, lists and gets conversations, archives and
favorites them through the writer, records handoff lineage edges, and serves the
transcript body through the Transcript service, keyed by the backing file.

## Transcripts — a shared service, not a domain

Evidence:
[`conversations-transcripts-audit.md`](investigations/conversations-transcripts-audit.md).

The transcript subsystem — the index, its full-text search satellite, and its
tag and tool side-tables — is 100% disposable cache, rebuilt entirely by a
read-only scan of the sacred session files across the Claude, pi, and codex file
shapes. It is not a navigable domain: no resolver, no pane. It is the internal
index where Conversation and Agent converge on the same transcript to compute the
derived facts — counts, models, tokens — once per file. The locked schema keys
this table on the **backing file path**, not on a session id, precisely because
pi and codex transcripts have no Claude session UUID; the file path is the one
universal key.

Two details from the audit shape the cleanup. There are two live search systems
today — a session-level full-text index and a separate chunk-level store with its
own embeddings database — and consolidating them is the prime follow-up. And the
enrichment fields (summaries, tags, enrichment level) are a search nicety that no
pipeline or deacon gate reads; they are regenerable and cost API dollars, so they
are optional, not load-bearing.

## Cost

Evidence: [`cost-audit.md`](investigations/cost-audit.md).

Cost is pure cache, and **14 of its 20 columns are needed**; the other six are
zero-populated `tldr_*` and `caveman_variant` fields, deleted. What makes Cost
unusual is that it rebuilds from a **union of three durable artifacts**, not one:
the reconciled `~/.claude` transcripts, the replayed
`~/.panopticon/costs/events.jsonl`, and the imported per-project write-ahead
logs, deduplicated on request id.

Today there are four parallel cost stores and three are redundant. Overdeck keeps
the SQLite aggregations behind one `CostResolver` and deletes the rest: the
`aggregator.ts` cache file, the `cost-monitor.ts` data file (whose writer
`recordCostSync` has zero callers — the cost-limit breaker has been silently dead
for some time), the `/api/agents/:id/cost` re-parse, and the
`/api/specialists/:name/cost` hardcoded-zero stub.

Two facts about correctness carry forward. The durable per-issue **total** lives
in the git record's `closeOut`, correctly a snapshot rather than a live second
source, and it stays. And the stored USD figure has a confirmed legacy bug — late
-2025 values are inflated roughly 110× and capped at exactly $50 — so the rebuild
**recomputes cost from token counts** rather than trusting the stored dollars.

Two gaps remain. The pi/kimi capture gap (PAN-1935) is narrower than it looks:
kimi is already captured under Claude Code; the real gap is harness-native pi and
codex, because both ingest paths are hardcoded to `~/.claude/projects/`. The
parsers exist but feed only the live display, so the fix is to extend the one
reconciler to sweep the pi and codex directories too. And there is no retention
today — no `DELETE FROM cost_events` exists anywhere — so closed-issue rows
accumulate forever; Overdeck bounds the database to about 90 days, since
`closeOut.usage` keeps the durable total and the JSONL and git logs are the
unbounded archive.

## Merge

Evidence:
[`orchestration-config-audit.md`](investigations/orchestration-config-audit.md).

The old Orchestration domain splits in two; this half is Merge. Its tables —
`merge_sets`, `merge_set_repos`, `merge_queue`, `pending_auto_merges`, and
`uat_generations` — are all cache. The structure rebuilds from `projects.yaml`,
and the gate outcomes rebuild from live GitHub PR state; the only durable datum a
merge set carries is its artifact URL, which is mirrored to the git record. The
existing `merge-set.ts` already satisfies the one-resolver, one-writer shape.

The human UAT batch-train lives here, not in Issues: `uat_generations` is written
by the merge-train, so it belongs to Merge. The deacon and the flywheel are not
separate data domains — they persist only as flags, which live in
Control/Settings.

## Control/Settings

Evidence:
[`orchestration-config-audit.md`](investigations/orchestration-config-audit.md).

This is the other half of the old Orchestration domain. The `app_settings` table
holds the `deacon.*` and `flywheel.*` runtime flags, and `issue_policy` holds the
per-issue policy that used to squat inside `review_status`: `deaconIgnored` and
`autoMerge`. The single accessor `app-settings.ts` is already at the target
shape. One caveat shapes the cutover: these flags are source-of-truth-in-database
that nothing rebuilds, so a fresh database starts with the deacon unpaused and no
active run. That reset is acceptable, but it must be a conscious decision rather
than an accident.

The review-run runtime evicted from Agents and `review_status` — the run id,
synthesis agent, output path, deadline, monitor-signaled flag, retry attempt, and
sub-role, plus the retry counters and breakers — lands here as ephemeral
orchestration runtime. It is pure cache and dies with the run. How much of it
survives at all depends on how simple we make the review engine.

## Memory

Evidence: [`memory-audit.md`](investigations/memory-audit.md).

Memory is a domain, and the decision is that it stays in scope. Its entire
database footprint is a **single pure-cache table**, `transcript_checkpoints` — a
byte-offset cursor, a claim-lease, and the rate-limit state per session. The
audit kept 11 of its 14 columns and dropped 3 (one never-read field and two
timestamps that branch nothing). Every column is cache.

Memory's real records are not in any database. They are **observation files on
disk** under `~/.panopticon/memory/` — append-only JSONL records, their human
mirrors, status rollups, reset markers — about 170 MB of them. These are the
sacred files: irreplaceable, never altered. Because they are already files
outside the database-wipe scope, Memory needs **no export target**, unlike
Conversations. That is the key difference between the two domains and the reason
Memory is simpler than its importance suggests.

Two gaps the audit found, and they are real. First, those observation files must
be inside the backup surface — they are the irreplaceable artifact, and
confirming their coverage is one of the open decisions below. Second, the
per-project full-text search index (`memory-search.db`) is 100% cache but has **no
rebuilder**: delete it and nothing today can reconstruct it from the JSONL it
indexes. Memory is also per-machine and non-portable, which the eventual
first-class treatment will have to address.

## Config

Evidence:
[`orchestration-config-audit.md`](investigations/orchestration-config-audit.md).

Config is a domain with no database table. `projects.yaml` is the source of
truth, read through `loadProjectsConfig` and cached by file modification time. It
survives any wipe untouched because it is a file, and there is no database
writer — editing the config means editing the file. The runtime control flags are
a separate concern and live in Control/Settings, above.

## Observability — infrastructure, not a domain

Evidence:
[`observability-audit.md`](investigations/observability-audit.md).

The `events` table is disposable pub/sub, not an event-sourced source of truth.
Four primary-source proofs settle this: the read-model rebuild (PAN-1920) draws
from the real sources rather than the log; the replay only gap-fills between a
snapshot and now; the log is routinely truncated; and it emits events that are
never persisted. It can start empty.

So `events` — four columns: sequence, type, timestamp, payload — is a thin
EventBus carrying the dashboard's live stream, with no resolver and no domain
surface. Its retention today runs only at startup, which means it is effectively
unbounded between restarts; the fix is periodic, tiered retention, since three
live-stream-only types account for 79% of the rows and need only hours, while the
lifecycle, review, and cost types deserve an analytics floor. The `health_events`
table folds into Agents, as described above; its cleanup has never run (zero
callers), so the 7-day purge gets wired into the periodic job, and the dead
duplicate module that also managed it is deleted.

One caveat is cutover-critical and reappears below: the pipeline phase-duration
metrics — the flywheel's scorecard — are the one non-disposable thing currently
trapped in `events`. They must move to the per-issue `closeOut` record before
`events` can be aggressively bounded.

## The cache schema

The physical projection of the domains is about 14 tables, down from 35: the dead
tables deleted, the duplicate-entity tables collapsed. Foreign keys are enforced
for the first time, and every table is a disposable mirror of a home.

```
issues(id PK)                                          — mirror of the .pan/records pipeline block
  ├─< agents(id PK, issue_id → issues)
  │      └─< health_events(id PK, agent_id → agents)   — folded in from Observability
  ├─< conversations(id PK, issue_id → issues, nullable) — DB-as-truth metadata (exported, PAN-1937)
  │      ├─< conversation_files(conversation_id → conversations)  — pointers to sacred backing files
  │      ├─< favorites(conversation_id → conversations)
  │      └── handoff_target_conv_id / cleared_to_conv_id → conversations (self-edges)
  ├─< cost_events(id PK, issue_id → issues?, agent_id → agents?)
  ├─< merge_sets(id PK, issue_id → issues)
  │      ├─< merge_set_repos(merge_set_id → merge_sets)
  │      └── (merge_queue, pending_auto_merges → issues)
  ├─< uat_generations(id PK, issue_id → issues)
  └─< issue_policy(issue_id PK → issues)               — per-issue deacon/auto-merge policy

transcripts(backing_file_path PK)                      — 100% cache from the sacred files; pi/codex have no session UUID
  └── transcripts_fts (FTS5 satellite)                 — referenced softly by conversation_files.locator and agents.session_id

transcript_checkpoints(session_id PK)                  — Memory's one cache table (dedup cursor + claim-lease)
app_settings(key PK, value)                            — Control/Settings: deacon.*/flywheel.* flags
events(sequence PK, type, timestamp, payload)          — Observability EventBus (tiered retention)
```

The tables deleted outright — some must be removed from the schema source or a
fresh `overdeck.db` recreates them — are `issue_state` (an abandoned shadow-state
prototype); `api_cache` and `rate_limits` (orphans whose real tables live in a
separate `cache.db`); `auto_merge`, `label_sync_audit`, and `outbox` (legacy or
phantom, with zero references); `git_operations`; `status_history` (derivable from
`events`); `session_embeddings` and the enrichment satellites (optional search
niceties); the `discovered_session_*` satellites (collapsed into `transcripts`);
`processed_sessions`; `flywheel_substrate_bugs` (dropped unless flywheel success
metrics turn out to be a need); and the duplicate `CREATE TABLE agents` block.

A few stores stay outside `overdeck.db` entirely, because they live in their own
homes: the sacred session files on disk, the Memory observation files under
`~/.panopticon/memory`, the separate `cache.db` and `memory-search.db`, the cost
`events.jsonl` archive, and the git `.pan/records`.

## Cutover-critical findings

The "database is pure cache" claim holds only after three things get a durable
home or a conscious reset. They are the only items the audits found that do not
otherwise rebuild:

| Item | Trapped today in | Fix before cutover |
|---|---|---|
| Conversation metadata (14 fields + favorites + file pointers) | `conversations` / `conversation_files` / `favorites` rows | export to a durable artifact so it travels — the PAN-1937 export, **not yet built** |
| Pipeline per-phase durations (the flywheel scorecard) | derived only from `events`; vanish on wipe | write the final phase timings into the per-issue `closeOut` record |
| Control flags (`deacon.globally_paused`, `flywheel.active_run_id`) | `app_settings`; nothing rebuilds them | acceptable to reset at cutover — a fresh database means deacon unpaused, no active run — but make it a conscious choice |

Everything else is genuinely rebuildable or deletable.

Two gates stand before building or approving, per the standing no-loss rule.
First, **compile one vertical slice before scaling.** The conventions are
verified against the installed type definitions and the codebase's in-use
patterns, but nothing has been run through `tsc` yet. Build one slice end to end —
entity, resolver, writer, one endpoint — through the real toolchain. If it
compiles, the conventions are proven and copy-pasteable. Second, run the
**surface-level no-loss audit.** The column-level need/drop audits are done, but
the 280-plus HTTP endpoints, CLI verbs, and RPC methods collapse to about 20
controllers with no enumerated "every old affordance maps to a new home, or is
deliberately dropped because X" mapping yet. That mapping is the gate before
approving the controller collapse, and it is the next investigation to run.

## The four open decisions

These are decisions for the operator, not gaps in the design:

1. **Which gates the pipeline keeps.** The recommendation, encoded in the schema,
   is review + test + verification on the merge path, with inspect off it
   (opt-in, work-phase, per-bead) and the UAT batch-train retained in Merge.
   Confirm before finalizing the Issues entity.
2. **The conversation-compaction read-only fix.** Convert
   `conversation-compaction.ts` from appending into the live Claude JSONL to the
   fork pattern, so the Transcript layer is strictly read-only.
3. **The backup surface for the on-disk sacred files.** Confirm that the session
   transcripts and the Memory observation files under `~/.panopticon/memory` are
   covered by the backup surface — they are irreplaceable and live outside git.
4. **Memory's scope.** Decided **in**: Memory is a domain with one cache table,
   its truth in the observation files, and no export needed. What remains is
   item 3 — confirming those files are backed up — and building the missing FTS
   rebuilder.

## Cross-cutting conventions

For the full Effect house style every domain follows, see
[`ARCHITECTURE-CONVENTIONS.md`](ARCHITECTURE-CONVENTIONS.md). In brief: entities
are Effect Schemas with branded ids and literal-union states; every store access
is a service method returning an Effect, and the database handle is given only to
resolver and writer layers; domain failures are tagged errors that controllers
map to HTTP status; writes emit domain events on a stream that feeds the
dashboard's read-model. And the durability rule that runs through all of it: the
writer persists to the source of truth first, then updates the cache,
synchronously and with the result checked — never fire-and-forget. This is
**ordering, not atomicity**. A git write inside a SQL transaction is not atomic;
a source-first write followed by a cache that self-heals on the next rebuild is
the correct and achievable guarantee, and it strictly beats today's silent
divergence.
