# Overdeck — The Merge Domain (Effect API tier)

> **Status:** the orchestration-plane keystone. Grounded in a no-loss mapping of
> the real current merge / UAT / auto-merge surface (Part 1), then the Effect
> v4-beta services derived from that mapping (Part 2). Every service method
> traces to a Part-1 row; no column or endpoint is invented.
>
> Goal is **functional parity** — preserve the merge train, the UAT batch
> trains, and the auto-merge cooldown queue; drop only the redundant/wrong ways
> in. NOT cache-purity: the `uat_generations` / `_members` / `_resolutions`
> tables are PERSISTED auditable pipeline history, kept as-is.
>
> Companions: [`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md)
> (the verified Effect house style), [`../overdeck-schema.ts`](../overdeck-schema.ts)
> (the locked `merge_sets` / `merge_set_repos` / `merge_queue` /
> `pending_auto_merges` / `uat_generations` / `uat_generation_members` /
> `uat_generation_resolutions` tables), [`issues.md`](issues.md) (the
> proof-of-shape template), and the evidence audit
> [`../investigations/orchestration-config-audit.md`](../investigations/orchestration-config-audit.md).
> Line numbers checked against `main` @ `840117fadc` (2026-06-16).

---

## Glossary

- **Merge set** — the per-issue merge-coordination record: one row in `merge_sets`
  plus one `merge_set_repos` row per repo (polyrepo issues have >1). Holds the
  per-repo gate statuses, merge order, and artifact pointers. Resolver/writer
  today is `src/lib/merge-set.ts` over `merge-set-db.ts`.
- **Merge queue** — the per-project **sequential merge lock**: at most one
  in-flight merge per project (PAN-632). Rows in `merge_queue`; module
  `src/lib/database/merge-queue-db.ts`. Empty at rest; a merge enqueues only
  when another is already `processing`.
- **Auto-merge cooldown queue** — the flywheel's scheduled-merge buffer
  (PAN-1486). Rows in `pending_auto_merges`; module
  `src/lib/database/pending-auto-merges-db.ts`. Each entry carries a
  `scheduledMergeAt` wall-clock deadline that survives process sleep; the
  executor (`auto-merge-executor.ts`) fires due entries every 30 s. The operator
  can **cancel** during the cooldown window (`cancelledAt` / `cancelledBy`
  preserved).
- **UAT batch train / generation** — an assembled `uat/<codename>-<mmdd>` branch
  that bundles several reviewed features for batched UAT before a single merge to
  main (PAN-1737). Rows in `uat_generations` (the batch), with members + held-out
  in `uat_generation_members` and cross-feature conflict fixes in
  `uat_generation_resolutions`. Writer is `uat-train.ts` + `uat-assemble.ts` +
  `uat-generations-db.ts`. **PERSISTED auditable history — never re-derived.**
- **Resolver / read door** — the one `Context.Service` allowed to *read* the
  merge domain's tables. Returns validated entities.
- **Writer / write door** — the one `Context.Service` allowed to *mutate* the
  merge domain's tables. For the merge engine the source of truth is the **forge**
  (GitHub/GitLab) + `projects.yaml`; the DB is a rebuildable cache. For
  `uat_generations` the DB *is* the durable record (the exception flagged above),
  so its writes have no separate "source-first" step — the cache write is the
  whole write (CONVENTIONS §5 rule 2, "pure-cache domains").
- **Forge** — the code host adapter (`getForgeAdapter(repo.forge)`,
  `src/lib/forge.ts`): GitHub or GitLab. The merge writer drives the forge per
  repo; the artifact (PR/MR) URL is mirrored back onto the merge-set repo.
- **Relocate** — a disposition: the current endpoint/verb is **not lost and not
  Merge's to own**; it maps to a *sibling* domain (Issues, Settings, Agents).
  Distinct from DELETE.

---

## ⚠️ Boundary finding — the `auto_merge` per-issue policy FLAG is NOT Merge's

The merge domain owns the *queues and the act of merging*. It does **not** own
the per-issue **`auto_merge` policy flag** — the operator/routing toggle that
says "this issue is eligible to be auto-merged by the flywheel." That flag lives
on `issue_policy.auto_merge` ([`../overdeck-schema.ts`](../overdeck-schema.ts)
line 330) and is written by **SettingsWriter**, exactly as the Issues audit
routed it ([`issues.md`](issues.md) headline-finding row `auto-merge`).

Two different things share the word "auto-merge", and the remodel keeps them in
two domains:

| Thing | What it is | Table | Owning writer |
|---|---|---|---|
| **auto-merge POLICY** | per-issue eligibility toggle (`POST /api/workspaces/:id/auto-merge`) | `issue_policy.auto_merge` | **SettingsWriter** (RELOCATE, not Merge) |
| **auto-merge SCHEDULE** | a concrete queued merge with a cooldown deadline | `pending_auto_merges` | **MergeWriter** (`scheduleAutoMerge` / `cancelAutoMerge`) |

So `POST /api/workspaces/:issueId/auto-merge` **relocates to Settings** (it flips
the policy flag), while `POST /api/flywheel/auto-merge/schedule` and `DELETE
/api/flywheel/auto-merge/:id` are **MergeWriter** verbs (they create/cancel a row
in the cooldown queue). The audit
([`../investigations/orchestration-config-audit.md`](../investigations/orchestration-config-audit.md)
final table, rows `pending_auto_merges` vs the `auto_merge` review-status column)
makes the same split. This is the one seam where naming hides a domain boundary;
the doors keep it honest, because `MergeWriter`'s `R` never contains
`issue_policy`.

---

# Part 1 — No-loss mapping (the gate)

Every current surface (HTTP endpoint, `pan` CLI verb, RPC method) that **reads or
writes merge / UAT / auto-merge state** — the merge queue, per-repo polyrepo
merge, the UAT batch train, and the auto-merge cooldown queue — with its new
home. Disposition is one of four:

- **READ →** a `MergeResolver` method.
- **WRITE →** a `MergeWriter` verb.
- **RELOCATE →** a *sibling* domain (Issues, Settings, Agents). Not lost, not
  Merge's to own.
- **DELETE →** deliberately dropped (redundant door, dead endpoint, folded), with
  the reason.

Stores legend: **MS** = `merge_sets` / `merge_set_repos` · **MQ** = `merge_queue`
· **PAM** = `pending_auto_merges` · **UAT** = `uat_generations` /
`_members` / `_resolutions` · **FORGE** = live GitHub/GitLab · **YAML** =
`projects.yaml`.

## 1A. HTTP endpoints

### Merge engine + merge queue (`workspaces.ts`)

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `POST /api/issues/:issueId/merge` (`workspaces.ts:5678`) | writes | **`MergeWriter.merge(id)`** | The merge entry point. `triggerMerge` (`workspaces.ts:4892`) checks readiness, then **serializes via the per-project queue** (`getCurrentMerge`/`enqueueMerge`, `workspaces.ts:4958,4961`) before doing the per-repo merge. The whole readiness-gate + enqueue + per-repo merge becomes one writer verb. (Issues' `advance(merging→verifying_on_main)` is fired by `postMergeLifecycle` *after* this lands — [`issues.md` §1A `merge` row](issues.md).) |
| `POST /api/issues/:issueId/forge-merge` (`workspaces.ts:5814`) | writes | **`MergeWriter.merge(id)`** (per-repo path) | This **is** the per-repo polyrepo merge: it loads the merge set, iterates `mergeSet.repos`, skips already-`merged`/`skipped` repos, calls `getForgeAdapter(repo.forge)` per repo, discovers/mirrors the artifact URL (`withRepoArtifactUrlSync`), and stamps `withRepoStateSync` (`workspaces.ts:5828-5860`). Duplicate door onto the same act → one verb (the verb iterates repos internally). |
| `POST /api/issues/:issueId/forge-approve` (`workspaces.ts:5710`) | writes | **`MergeWriter.approveForge(id)`** | "Clicks Approve on the forge" — submits an approving review/MR-approval per repo (handler comment `workspaces.ts:5705-5709`). Distinct from Issues' `/approve` (which enters the merge *stage*); this drives the forge. A genuine Merge verb. |
| `GET /api/merge-queue` (`workspaces.ts:6299`) | reads | **`MergeResolver.listQueues()`** | `getAllActiveQueues()` — every project's current + queued merges. One resolver read over MQ. |
| `POST /api/issues/:issueId/approve` (`workspaces.ts:5922`) | writes | **RELOCATE → Issues `advance(id, "merging")`** | Approve = enter the merge *stage*; a lifecycle move, owned by IssueWriter ([`issues.md` §1A `approve` row](issues.md)). Not a Merge-table write. |
| `POST /api/issues/:issueId/sync-main` (`workspaces.ts:4785`) | writes | **`MergeWriter.rebaseOntoMain(id)`** | Rebase the feature branch onto main (`rebaseFeatureBranch`). No issue-stage change; a git/merge prep operation. Issues' audit already RELOCATEs it here ([`issues.md` §1A `sync-main` row](issues.md)) — this doc gives it a home. |
| `POST /api/workspaces/:issueId/unstick` (`workspaces.ts:4670`) | writes | **RELOCATE → Control/Settings (review-run runtime)** | `stuck` is ephemeral review-run runtime (`review_runs.stuck`, schema 360), not a merge-table fact. Clearing it is Control/Settings, not Merge. (Issues' audit routes it the same way.) |
| `POST /api/workspaces/:issueId/deacon-ignore` (`workspaces.ts:4710`) | writes | **RELOCATE → SettingsWriter** | `issue_policy.deacon_ignored` (schema 329). Operator policy, not merge state. |
| `POST /api/workspaces/:issueId/auto-merge` (`workspaces.ts:4755`) | writes | **RELOCATE → SettingsWriter** | `issue_policy.auto_merge` POLICY flag (schema 330) — the boundary finding above. NOT the cooldown SCHEDULE. |

### Auto-merge cooldown + UAT batch train (`flywheel.ts`)

| Current endpoint | r/w | New door | Reason |
|---|---|---|---|
| `POST /api/flywheel/auto-merge/schedule` (`flywheel.ts:653`) | writes | **`MergeWriter.scheduleAutoMerge(input)`** | `scheduleAutoMergeWithResult` (PAM, `pending-auto-merges-db.ts:109`) — buffers a merge with a cooldown deadline. Idempotent per active issue (the `pending_auto_merges_active_issue_idx` unique partial index, schema 267). |
| `DELETE /api/flywheel/auto-merge/:id` (`flywheel.ts:683`) | writes | **`MergeWriter.cancelAutoMerge(issueId, by)`** | Operator cancel during cooldown. The path slot `:id` is the **issue id** (the `pan merge cancel <id>` CLI encodes the uppercased issue id there, `merge.ts:28`). Cancels the active PAM entry, preserving `cancelledAt` / `cancelledBy` (`cancelPending`, `pending-auto-merges-db.ts:233`). |
| `GET /api/flywheel/auto-merge/pending` (`flywheel.ts:566`) | reads | **`MergeResolver.listAutoMerges({ active })`** | `listActiveAutoMerges` over PAM. One resolver read. |
| `GET /api/flywheel/auto-merge/problems` (`flywheel.ts:574`) | reads | **`MergeResolver.listAutoMerges({ problems })`** | `listProblemAutoMerges` (blocked/failed) over PAM. Same resolver, filter variant. |
| `GET /api/flywheel/merge-blockers` (`flywheel.ts:608`) | reads | **`MergeResolver.listBlockers()`** | Aggregates per-issue merge-blocker reasons from PAM/forge state for the flywheel panel. A merge-domain read. (Distinct from Issues' `issues.blockers` array — this is the *queue's* live view of why scheduled merges are stalled.) |
| `GET /api/flywheel/merge-queue` (`flywheel.ts:886`) | reads | **`MergeResolver.listQueues()`** | Same data as `GET /api/merge-queue` rendered for the flywheel view. Duplicate read door → one resolver method. |
| `POST /api/flywheel/merge-next` (`flywheel.ts:669`) | writes | **`MergeWriter.mergeNext(projectKey?)`** | Advance the queue: dequeue the head and merge it (`dequeueMerge` + trigger). The sequential-lock step made explicit. |
| `GET /api/flywheel/uat-generations` (`flywheel.ts:914`) | reads | **`MergeResolver.listUatGenerations(filter)`** | `getUatGenerationsPayload` over UAT. One resolver read across batch generations + members. |
| `POST /api/flywheel/assemble-uat` (`flywheel.ts:965`) | writes | **`MergeWriter.assembleUat(opts)`** | `runUatTrainReconcile({ force: true })` — assembles the `uat/<codename>-<mmdd>` generation, adds members/held-out, records resolutions (the train's core write). |
| `POST /api/flywheel/uat-generations/:name/stack` (`flywheel.ts:924`) | writes | **`MergeWriter.startUatStack(name)`** | Bring up a live stack for a `ready`/`superseded` generation (`postUatGenerationStackPayload`, `uat-train.ts:274`). Stamps `uat_generations.stackStartedAt`. |
| `POST /api/flywheel/uat-generations/:name/promote` (`flywheel.ts:940`) | writes | **`MergeWriter.promoteUat(name)`** | Promote the tested batch to main (`postUatGenerationPromotePayload`, `uat-train.ts:287`). Flips `status=promoted`; fires `postMergeLifecycle` per member. |

## 1B. CLI verbs (`pan ...`)

| Current verb | r/w | New door | Reason |
|---|---|---|---|
| `pan merge cancel <id>` (`merge.ts:23,53`) | writes | **`MergeWriter.cancelAutoMerge(id, "cli")`** | Wraps `DELETE /api/flywheel/auto-merge/:id` — cancel a pending auto-merge in its cooldown window. The only CLI verb in the merge domain. |
| `pan sync-main <id>` (`index.ts:467`) | writes | **`MergeWriter.rebaseOntoMain(id)`** | Rebase; Issues' audit RELOCATEs it to Merge ([`issues.md` §1B `sync-main` row](issues.md)). Same writer as the HTTP route. |
| `pan approve <id>` (`index.ts:482`) | writes | **RELOCATE → Issues `advance(id, "merging")`** | Stage move, not a merge-table write (matches Issues §1B). Listed here only to confirm it is NOT a Merge verb. |

## 1C. RPC methods (`packages/contracts/src/rpc.ts`)

**There are no merge/UAT/auto-merge RPC methods.** A grep of
`packages/contracts/src/rpc.ts` and `ws-rpc.ts` for `merge`/`uat`/`autoMerge`/
`forge`/`approve` returns only unrelated hits (a `Stream.merge` combinator, a
review-verdict literal). The entire merge surface is **HTTP-only** today; the
live RPC read surface reaches merge state only through the cross-domain
`pan.getSnapshot` aggregate ([`issues.md` §1C](issues.md)), which recomposes from
`MergeResolver` at the controller. So the Merge domain ships **no RPC group of
its own** — its reads feed the snapshot aggregate; its writes are HTTP. (If a
live merge-queue stream is later wanted, it is a new `merge.subscribe` Rpc fed by
the writer's `bus.emit`, per CONVENTIONS §8 — not a current-surface item, so not
added here.)

## 1D. Rollup of the collapse

| Surface | Current sites | New home |
|---|---|---|
| HTTP endpoints enumerated | **21** (9 in `workspaces.ts`, 12 in `flywheel.ts`) | **5 resolver reads** + **9 writer verbs**; **4 relocate** to Issues/Settings/Control |
| CLI verbs enumerated | **3** | 1 Merge verb (`pan merge cancel`); `sync-main` → Merge; `approve` relocates to Issues |
| RPC methods enumerated | **0** | none; merge reads feed the `getSnapshot` aggregate |
| DB modules consolidated | **6** (`merge-set.ts`, `merge-set-db.ts`, `merge-queue-db.ts`, `pending-auto-merges-db.ts`, `uat-generations-db.ts`, `uat-train.ts` service) | **1 MergeResolver + 1 MergeWriter** over the 7 locked tables |

**MergeResolver methods (5):** `getMergeSet`, `listQueues`, `listAutoMerges`,
`listBlockers`, `listUatGenerations`.

**MergeWriter verbs (9):** `merge`, `approveForge`, `rebaseOntoMain`, `mergeNext`,
`scheduleAutoMerge`, `cancelAutoMerge`, `assembleUat`, `startUatStack`,
`promoteUat`.

**RELOCATED, not lost** (4): `approve` → **Issues** (`advance(merging)`);
`auto-merge` POLICY flag + `deacon-ignore` → **Settings**; `unstick` →
**Control/Settings** (review-run runtime). Each takes an issue id but writes a
sibling domain's table.

**DELETED outright:** none. Functional parity is the goal — every merge / UAT /
auto-merge capability has a home. The only collapses are *duplicate read doors*
onto the same data (`GET /api/merge-queue` and `GET /api/flywheel/merge-queue` →
one `listQueues`; `auto-merge/pending` and `auto-merge/problems` → one
`listAutoMerges` with a filter) and *duplicate write doors* onto the same act
(`/merge` and `/forge-merge` → one `merge` verb).

## 1E. What did NOT fit cleanly — the genuine residue

1. **`approveForge` is a real second write verb, not a stage move.** Submitting an
   approving review on the forge (`forge-approve`) is neither `merge` nor a
   lifecycle advance — it is its own forge mutation. Kept as a distinct verb
   rather than folded into `merge`, because the operator can approve a forge PR
   without merging it.
2. **`listBlockers` is a Merge read, but it overlaps Issues' `blockers`.** They
   are *different views*: `issues.blockers` is the durable typed array on the
   issue ([`issues.md` §2.1](issues.md)); `MergeResolver.listBlockers` is the
   *queue's* live aggregate of why scheduled/queued merges are currently stalled
   (derived from PAM `failureReason` + forge state). Kept in Merge because its
   readers are the flywheel merge panel, not the issue card.
3. **The merge engine is CACHE; the UAT tables are SOURCE-OF-TRUTH.** This is the
   one domain that is *mixed*. `merge_sets` / `merge_set_repos` / `merge_queue` /
   `pending_auto_merges` rebuild from `projects.yaml` + forge (audit §2); the
   writer follows source-first ordering for them. `uat_generations` /
   `_members` / `_resolutions` are append-only auditable history (audit §5 row
   `uat_generations`) — the cache write is the whole write. The MergeWriter
   carries both disciplines, dispatched per verb (§2.4 note).

---

# Part 2 — The Effect services (derived from the mapping)

Written in the verified v4-beta idiom from
[`../ARCHITECTURE-CONVENTIONS.md`](../ARCHITECTURE-CONVENTIONS.md):
`Context.Service` (never `Effect.Service`), `effect/unstable/*` imports, Drizzle
behind the `Db` service, `Schema.Literals([...])` taking arrays,
`Schema.TaggedErrorClass`, source-first-then-cache writer ordering for the cache
tables (§5). Every method below traces to a Part-1 row. Column names and literal
unions are the real ones from
[`../overdeck-schema.ts`](../overdeck-schema.ts) and the live type definitions
(`merge-set.ts:12-43`, `pending-auto-merges-db.ts:5-24`,
`uat-generations-db.ts:26-83`).

## 2.1 Entities & errors — `Schema`

```ts
import { Effect, Layer, Context, Schema } from "effect"
import { eq, and, inArray } from "drizzle-orm"
import {
  mergeSets, mergeSetRepos, mergeQueue, pendingAutoMerges,
  uatGenerations, uatGenerationMembers, uatGenerationResolutions,
} from "../overdeck-schema"                                   // the locked Drizzle tables
import { Db, Records, EventBus, Forge, Projects } from "./infra"
// Forge   = getForgeAdapter wrapper (src/lib/forge.ts) — drives GitHub/GitLab merges/approvals
// Projects= projects.yaml resolver — rebuilds merge-set structure (audit §2.1)

// ── Branded ids ────────────────────────────────────────────────────────────
export const IssueId    = Schema.String.pipe(Schema.brand("IssueId"))   // shared with Issues domain
export const ProjectKey = Schema.String.pipe(Schema.brand("ProjectKey"))
export const RepoKey    = Schema.String.pipe(Schema.brand("RepoKey"))
export const UatName    = Schema.String.pipe(Schema.brand("UatName"))    // "uat/<codename>-<mmdd>"
export type  IssueId    = typeof IssueId.Type
export type  UatName    = typeof UatName.Type

// ── State literal unions — verbatim from the live types ─────────────────────
// MergeSet (merge-set.ts:12-15)
export const MergeSetStatus = Schema.Literals(
  ["draft", "reviewing", "ready", "merging", "merged", "failed"])
export const GateStatus = Schema.Literals(
  ["pending", "running", "passed", "failed", "blocked", "skipped"])
export const RebaseStatus = Schema.Literals(
  ["pending", "requested", "running", "passed", "failed", "blocked", "skipped"])
export const RepoMergeStatus = Schema.Literals(
  ["pending", "ready", "merging", "merged", "failed", "blocked", "skipped"])
export const WorkspaceType = Schema.Literals(["monorepo", "polyrepo"])

// MergeQueue (merge-queue-db.ts:24)
export const QueueEntryStatus = Schema.Literals(
  ["queued", "processing", "completed", "failed"])

// PendingAutoMerge (pending-auto-merges-db.ts:5)
export const AutoMergeStatus = Schema.Literals(
  ["pending", "merging", "blocked", "failed", "merged", "cancelled"])

// UatGeneration (uat-generations-db.ts:26-32)
export const UatStatus = Schema.Literals(
  ["assembling", "ready", "superseded", "invalidated", "promoted", "failed"])
export const UatMemberRole = Schema.Literals(["member", "held_out"])  // schema 293

// ── Entities — DB-row decoders AND API success types ────────────────────────

// one repo's row in a merge set (merge_set_repos)
export const MergeSetRepo = Schema.Struct({
  repoKey:            RepoKey,
  repoPath:           Schema.String,
  forge:              Schema.String,
  sourceBranch:       Schema.String,
  targetBranch:       Schema.String,
  artifactUrl:        Schema.NullOr(Schema.String),
  artifactId:         Schema.NullOr(Schema.String),
  reviewStatus:       GateStatus,
  testStatus:         GateStatus,
  rebaseStatus:       RebaseStatus,
  verificationStatus: GateStatus,
  mergeStatus:        RepoMergeStatus,
  mergeOrder:         Schema.Number,
  required:           Schema.Boolean,
})

export const MergeSet = Schema.Struct({
  issueId:       IssueId,
  projectKey:    ProjectKey,
  projectPath:   Schema.String,
  workspaceType: WorkspaceType,
  status:        MergeSetStatus,
  repos:         Schema.Array(MergeSetRepo),
  createdAt:     Schema.Date,
  updatedAt:     Schema.Date,
})
export type MergeSet = typeof MergeSet.Type

// one project's sequential-lock view (rebuilt from merge_queue)
export const QueueView = Schema.Struct({
  projectKey:  ProjectKey,
  current:     Schema.NullOr(IssueId),               // the 'processing' head
  queue:       Schema.Array(IssueId),                // the 'queued' tail, in position order
  queueLength: Schema.Number,
})
export type QueueView = typeof QueueView.Type

// one cooldown-queue entry (pending_auto_merges)
export const AutoMerge = Schema.Struct({
  id:               Schema.Number,
  issueId:          IssueId,
  prUrl:            Schema.String,
  prNumber:         Schema.NullOr(Schema.Number),
  projectKey:       ProjectKey,
  forge:            Schema.String,
  status:           AutoMergeStatus,
  scheduledMergeAt: Schema.Date,                     // wall-clock deadline; survives sleep
  scheduledAt:      Schema.Date,
  mergedAt:         Schema.NullOr(Schema.Date),
  failureReason:    Schema.NullOr(Schema.String),
  cancelledAt:      Schema.NullOr(Schema.Date),      // preserved (schema 261)
  cancelledBy:      Schema.NullOr(Schema.String),    // preserved (schema 262)
})
export type AutoMerge = typeof AutoMerge.Type

// a UAT batch member or held-out feature (uat_generation_members)
export const UatMember = Schema.Struct({
  issueId:    IssueId,
  role:       UatMemberRole,
  title:      Schema.NullOr(Schema.String),          // member only
  branch:     Schema.NullOr(Schema.String),          // member: required · held_out: optional
  headSha:    Schema.NullOr(Schema.String),          // staleness key
  mergeOrder: Schema.NullOr(Schema.Number),          // member only — 1-based
  pr:         Schema.NullOr(Schema.Number),          // member only
  prUrl:      Schema.NullOr(Schema.String),          // member only
  reason:     Schema.NullOr(Schema.String),          // held_out only
})

// a cross-feature conflict resolution (uat_generation_resolutions)
export const UatResolution = Schema.Struct({
  id:        Schema.Number,
  issueIds:  Schema.Array(IssueId),                  // the colliding issues (>1)
  files:     Schema.Array(Schema.String),
  commitSha: Schema.String,
})

export const UatGeneration = Schema.Struct({
  name:           UatName,                           // "uat/<codename>-<mmdd>" (PK)
  worktreePath:   Schema.String,
  projectRoot:    Schema.String,
  baseSha:        Schema.String,
  status:         UatStatus,
  members:        Schema.Array(UatMember),           // role='member'
  heldOut:        Schema.Array(UatMember),           // role='held_out'
  resolutions:    Schema.Array(UatResolution),
  stackStartedAt: Schema.NullOr(Schema.Date),
  cleanedAt:      Schema.NullOr(Schema.Date),
  createdAt:      Schema.Date,
  updatedAt:      Schema.Date,
})
export type UatGeneration = typeof UatGeneration.Type

// ── Filters for the resolver list reads ─────────────────────────────────────
export const AutoMergeFilter = Schema.Struct({
  active:   Schema.optional(Schema.Boolean),         // pending|merging   (listActiveAutoMerges)
  problems: Schema.optional(Schema.Boolean),         // blocked|failed    (listProblemAutoMerges)
})
export const UatGenerationFilter = Schema.Struct({
  projectRoot: Schema.optional(Schema.String),
  statuses:    Schema.optional(Schema.Array(UatStatus)),
})

// ── Errors — tagged, in the E channel (CONVENTIONS §3) ─────────────────────
export class MergeSetNotFound extends Schema.TaggedErrorClass<MergeSetNotFound>()(
  "MergeSetNotFound", { issueId: IssueId },
) {}
export class NotReadyForMerge extends Schema.TaggedErrorClass<NotReadyForMerge>()(
  "NotReadyForMerge", { issueId: IssueId, reviewStatus: GateStatus, testStatus: GateStatus },
) {}
export class MergeInProgress extends Schema.TaggedErrorClass<MergeInProgress>()(
  "MergeInProgress", { issueId: IssueId },             // another merge holds the per-project lock
) {}
export class AutoMergeNotFound extends Schema.TaggedErrorClass<AutoMergeNotFound>()(
  "AutoMergeNotFound", { issueId: IssueId },
) {}
export class UatGenerationNotFound extends Schema.TaggedErrorClass<UatGenerationNotFound>()(
  "UatGenerationNotFound", { name: UatName },
) {}
export class UatNotPromotable extends Schema.TaggedErrorClass<UatNotPromotable>()(
  "UatNotPromotable", { name: UatName, status: UatStatus },  // only ready/superseded can stack/promote
) {}
export class ForgeMergeFailed extends Schema.TaggedErrorClass<ForgeMergeFailed>()(
  "ForgeMergeFailed", { issueId: IssueId, repoKey: RepoKey, detail: Schema.String },
) {}
```

## 2.2 `MergeResolver` — the read door (`Context.Service`)

Five methods, tracing to Part-1 §1A reads: `getMergeSet` (per-issue merge state),
`listQueues` (the two duplicate merge-queue read doors → one), `listAutoMerges`
(the pending+problems cooldown reads → one filtered method), `listBlockers` (the
flywheel merge-blocker panel), `listUatGenerations` (the UAT batch list).

```ts
export class MergeResolver extends Context.Service<MergeResolver, {
  readonly getMergeSet:         (id: IssueId)               => Effect.Effect<MergeSet, MergeSetNotFound>
  readonly listQueues:          ()                          => Effect.Effect<ReadonlyArray<QueueView>>
  readonly listAutoMerges:      (f: AutoMergeFilter)        => Effect.Effect<ReadonlyArray<AutoMerge>>
  readonly listBlockers:        ()                          => Effect.Effect<ReadonlyArray<AutoMerge>>  // stalled subset
  readonly listUatGenerations:  (f: UatGenerationFilter)    => Effect.Effect<ReadonlyArray<UatGeneration>>
}>()("overdeck/MergeResolver") {}

export const MergeResolverLayer = Layer.effect(MergeResolver, Effect.gen(function* () {
  const { q } = yield* Db                  // Drizzle handle — appears ONLY in resolver/writer Layer R

  const decodeMergeSet = Schema.decodeUnknown(MergeSet)
  const decodeAutoMerge = Schema.decodeUnknown(AutoMerge)
  const decodeUat = Schema.decodeUnknown(UatGeneration)

  // getMergeSet — joins merge_sets + its merge_set_repos (rowToMergeSet, merge-set-db.ts:167)
  const getMergeSet = (id: IssueId) => Effect.gen(function* () {
    const set = yield* Effect.sync(() =>
      q.select().from(mergeSets).where(eq(mergeSets.issueId, id)).get())
    if (!set) return yield* Effect.fail(new MergeSetNotFound({ issueId: id }))
    const repos = yield* Effect.sync(() =>
      q.select().from(mergeSetRepos).where(eq(mergeSetRepos.issueId, id)).all())
    return yield* decodeMergeSet({ ...set, repos })
  })

  // listQueues — reduce active merge_queue rows into per-project QueueView
  //   (getAllActiveQueues, merge-queue-db.ts:133). One method for BOTH
  //   GET /api/merge-queue and GET /api/flywheel/merge-queue.
  const listQueues = () => Effect.gen(function* () {
    const rows = yield* Effect.sync(() =>
      q.select().from(mergeQueue)
        .where(inArray(mergeQueue.status, ["queued", "processing"]))
        .orderBy(mergeQueue.projectKey, mergeQueue.position).all())
    return reduceQueues(rows)   // pure reduce → QueueView[]
  })

  // listAutoMerges — one method, filter selects the active vs problem slice
  //   (listActiveAutoMerges / listProblemAutoMerges, pending-auto-merges-db.ts:152,161)
  const listAutoMerges = (f: AutoMergeFilter) => Effect.gen(function* () {
    const want = f.problems
      ? ["blocked", "failed"]
      : ["pending", "merging"]                       // default = active
    const rows = yield* Effect.sync(() =>
      q.select().from(pendingAutoMerges)
        .where(inArray(pendingAutoMerges.status, want))
        .orderBy(pendingAutoMerges.scheduledMergeAt).all())
    return yield* Effect.forEach(rows, decodeAutoMerge)
  })

  // listBlockers — the flywheel merge-blocker panel: the stalled cooldown subset
  //   (blocked/failed with a failureReason). GET /api/flywheel/merge-blockers.
  const listBlockers = () => listAutoMerges({ problems: true })

  // listUatGenerations — generations + normalized members/held_out/resolutions
  //   (getUatGenerationsPayload, uat-train.ts:236)
  const listUatGenerations = (f: UatGenerationFilter) => Effect.gen(function* () {
    const gens = yield* Effect.sync(() =>
      q.select().from(uatGenerations)
        .where(f.statuses ? inArray(uatGenerations.status, [...f.statuses]) : undefined)
        .all())
    return yield* Effect.forEach(gens, (g) => Effect.gen(function* () {
      const members = yield* Effect.sync(() =>
        q.select().from(uatGenerationMembers)
          .where(eq(uatGenerationMembers.uatName, g.name)).all())
      const resolutions = yield* Effect.sync(() =>
        q.select().from(uatGenerationResolutions)
          .where(eq(uatGenerationResolutions.uatName, g.name)).all())
      return yield* decodeUat({
        ...g,
        members:     members.filter((m) => m.role === "member"),
        heldOut:     members.filter((m) => m.role === "held_out"),
        resolutions,
      })
    }))
  })

  return MergeResolver.of({
    getMergeSet, listQueues, listAutoMerges, listBlockers, listUatGenerations,
  })
}))
```

## 2.3 `MergeWriter` — the write door (`Context.Service`)

Nine verbs, derived from Part-1 §1A/§1B writes. Three concerns:

- **Merge engine:** `merge` (the readiness-gated, queue-serialized, per-repo
  polyrepo merge — absorbs `/merge` + `/forge-merge`), `approveForge` (the forge
  approve), `rebaseOntoMain` (sync-main), `mergeNext` (advance the sequential
  lock).
- **Auto-merge cooldown:** `scheduleAutoMerge`, `cancelAutoMerge` (preserving
  `cancelledAt`/`cancelledBy`).
- **UAT batch train:** `assembleUat`, `startUatStack`, `promoteUat`.

```ts
export class MergeWriter extends Context.Service<MergeWriter, {
  // ── merge engine ──
  readonly merge:          (id: IssueId) =>
    Effect.Effect<MergeSet, MergeSetNotFound | NotReadyForMerge | MergeInProgress | ForgeMergeFailed, MergeResolver>
  readonly approveForge:   (id: IssueId) =>
    Effect.Effect<MergeSet, MergeSetNotFound | ForgeMergeFailed, MergeResolver>
  readonly rebaseOntoMain: (id: IssueId) =>
    Effect.Effect<MergeSet, MergeSetNotFound, MergeResolver>
  readonly mergeNext:      (projectKey: ProjectKey) =>
    Effect.Effect<MergeSet | null, ForgeMergeFailed, MergeResolver>
  // ── auto-merge cooldown queue (pending_auto_merges) ──
  readonly scheduleAutoMerge: (input: {
    issueId: IssueId; prUrl: string; prNumber?: number;
    projectKey: ProjectKey; forge?: string; scheduledMergeAt: Date;
  }) => Effect.Effect<AutoMerge>
  readonly cancelAutoMerge: (id: IssueId, cancelledBy: string) =>
    Effect.Effect<AutoMerge, AutoMergeNotFound>
  // ── UAT batch train (uat_generations / _members / _resolutions) ──
  readonly assembleUat:    (opts: { force?: boolean }) =>
    Effect.Effect<ReadonlyArray<UatGeneration>>
  readonly startUatStack:  (name: UatName) =>
    Effect.Effect<UatGeneration, UatGenerationNotFound | UatNotPromotable>
  readonly promoteUat:     (name: UatName) =>
    Effect.Effect<UatGeneration, UatGenerationNotFound | UatNotPromotable>
}>()("overdeck/MergeWriter") {}

export const MergeWriterLayer = Layer.effect(MergeWriter, Effect.gen(function* () {
  const { q }   = yield* Db          // Drizzle (merge_* / pending_auto_merges / uat_* ONLY — NOT issue_policy)
  const forge   = yield* Forge       // getForgeAdapter wrapper — the SOURCE OF TRUTH for the merge act
  const records = yield* Records     // git .pan/records — mirrors the durable artifact URLs (records.ts:135)
  const bus     = yield* EventBus
  const now     = () => new Date()

  // ── merge: readiness gate → per-project sequential lock → per-repo merge ──
  //   absorbs triggerMerge (workspaces.ts:4892) + the forge-merge per-repo loop
  //   (workspaces.ts:5828-5860). The merge_queue lock is INTERNAL to this verb.
  const merge = (id: IssueId) => Effect.gen(function* () {
    const resolver = yield* MergeResolver
    const set      = yield* resolver.getMergeSet(id)              // 404s if no merge set

    // 1. readiness gate (the issue's review/test outcomes; read cross-domain at
    //    the controller and passed in, OR re-derived here from set.repos gate cols).
    if (!repoGatesReady(set))
      return yield* Effect.fail(new NotReadyForMerge({
        issueId: id, reviewStatus: worstGate(set, "review"), testStatus: worstGate(set, "test") }))

    // 2. per-project sequential lock (merge_queue): if another issue is the
    //    current 'processing' head, enqueue and bail (MergeInProgress).
    const current = yield* Effect.sync(() =>
      q.select({ issueId: mergeQueue.issueId }).from(mergeQueue)
        .where(and(eq(mergeQueue.projectKey, set.projectKey),
                   eq(mergeQueue.status, "processing"))).get())
    if (current && current.issueId !== id) {
      yield* Effect.sync(() => enqueue(q, set.projectKey, id))    // INSERT queued row
      return yield* Effect.fail(new MergeInProgress({ issueId: id }))
    }
    yield* Effect.sync(() => markProcessing(q, set.projectKey, id))

    // 3. per-repo merge — drive the forge for each non-merged/non-skipped repo.
    //    SOURCE OF TRUTH FIRST: the forge merge is the commit point.
    let next = set
    for (const repo of set.repos) {
      if (repo.mergeStatus === "merged" || repo.mergeStatus === "skipped") continue
      const res = yield* forge.merge(repo).pipe(
        Effect.mapError((e) => new ForgeMergeFailed({ issueId: id, repoKey: repo.repoKey, detail: String(e) })))
      next = withRepoState(next, repo.repoKey, { mergeStatus: "merged", artifactUrl: res.artifactUrl })
    }
    next = { ...next, status: "merged", updatedAt: now() }

    // 4. mirror the durable artifact URLs to the git record (records.ts:135-137),
    //    then the cache (merge_sets + merge_set_repos), then advance the queue.
    yield* records.writeProjectMerges(next)                      // durable: only artifactUrl persists
    yield* Effect.sync(() => upsertMergeSetRows(q, next))        // cache (delete+reinsert repos)
    yield* Effect.sync(() => dequeue(q, set.projectKey, id))     // release the lock
    yield* bus.emit({ type: "merge.completed", payload: { issueId: id, projectKey: set.projectKey } })
    return next
  })

  // ── approveForge: submit an approving review per repo (forge-approve) ──
  const approveForge = (id: IssueId) => Effect.gen(function* () {
    const resolver = yield* MergeResolver
    const set      = yield* resolver.getMergeSet(id)
    for (const repo of set.repos)
      yield* forge.approve(repo).pipe(
        Effect.mapError((e) => new ForgeMergeFailed({ issueId: id, repoKey: repo.repoKey, detail: String(e) })))
    yield* bus.emit({ type: "merge.forge_approved", payload: { issueId: id } })
    return set
  })

  // ── rebaseOntoMain: sync-main — rebase feature branch onto main per repo ──
  const rebaseOntoMain = (id: IssueId) => Effect.gen(function* () {
    const resolver = yield* MergeResolver
    const set      = yield* resolver.getMergeSet(id)
    let next = set
    for (const repo of set.repos)
      next = withRepoState(next, repo.repoKey, { rebaseStatus: "running" })
    yield* Effect.sync(() => upsertMergeSetRows(q, next))
    yield* forge.rebase(set)                                     // the git op (rebaseFeatureBranch)
    next = applyRebaseResult(next)
    yield* Effect.sync(() => upsertMergeSetRows(q, next))
    yield* bus.emit({ type: "merge.rebased", payload: { issueId: id } })
    return next
  })

  // ── mergeNext: advance the per-project sequential lock to the queue head ──
  const mergeNext = (projectKey: ProjectKey) => Effect.gen(function* () {
    const head = yield* Effect.sync(() => peekQueueHead(q, projectKey))
    if (!head) return null
    return yield* merge(head as IssueId)
  })

  // ── scheduleAutoMerge: cooldown queue insert (idempotent per active issue) ──
  //    PURE CACHE write (pending_auto_merges has no git source). The unique
  //    partial index (schema 267) makes a second active schedule a no-op.
  const scheduleAutoMerge = (input: {
    issueId: IssueId; prUrl: string; prNumber?: number;
    projectKey: ProjectKey; forge?: string; scheduledMergeAt: Date;
  }) => Effect.gen(function* () {
    const existing = yield* Effect.sync(() => selectActiveAutoMerge(q, input.issueId))
    if (existing) return yield* Schema.decodeUnknown(AutoMerge)(existing)   // created:false
    const row = yield* Effect.sync(() => insertAutoMerge(q, { ...input, scheduledAt: now() }))
    yield* bus.emit({ type: "merge.auto_scheduled", payload: { issueId: input.issueId } })
    return yield* Schema.decodeUnknown(AutoMerge)(row)
  })

  // ── cancelAutoMerge: operator cancel in the cooldown window ──
  //    cancelPending (pending-auto-merges-db.ts:233) — preserves cancelledAt/By.
  const cancelAutoMerge = (id: IssueId, cancelledBy: string) => Effect.gen(function* () {
    const row = yield* Effect.sync(() => selectActiveAutoMerge(q, id))
    if (!row) return yield* Effect.fail(new AutoMergeNotFound({ issueId: id }))
    const updated = yield* Effect.sync(() =>
      q.update(pendingAutoMerges)
        .set({ status: "cancelled", cancelledAt: now(), cancelledBy })
        .where(eq(pendingAutoMerges.id, row.id)).returning().get())
    yield* bus.emit({ type: "merge.auto_cancelled", payload: { issueId: id, cancelledBy } })
    return yield* Schema.decodeUnknown(AutoMerge)(updated)
  })

  // ── assembleUat: assemble the uat/<codename>-<mmdd> batch generation ──
  //    runUatTrainReconcile (uat-train.ts:122). Append-only SOURCE-OF-TRUTH:
  //    members/held_out/resolutions are the auditable record — the cache write
  //    IS the write (CONVENTIONS §5 rule 2). No records.write step.
  const assembleUat = (opts: { force?: boolean }) => Effect.gen(function* () {
    const generations = yield* reconcileUatTrain(q, forge, opts)  // build branch, normalize rows
    yield* bus.emit({ type: "merge.uat_assembled", payload: { count: generations.length } })
    return generations
  })

  // ── startUatStack: bring up a live stack for a ready/superseded generation ──
  const startUatStack = (name: UatName) => Effect.gen(function* () {
    const gen = yield* Effect.sync(() => selectUat(q, name))
    if (!gen) return yield* Effect.fail(new UatGenerationNotFound({ name }))
    if (gen.status !== "ready" && gen.status !== "superseded")
      return yield* Effect.fail(new UatNotPromotable({ name, status: gen.status }))
    yield* startStack(gen)                                        // ensureUatStack (uat-train.ts:281)
    const updated = yield* Effect.sync(() =>
      q.update(uatGenerations).set({ stackStartedAt: now(), updatedAt: now() })
        .where(eq(uatGenerations.name, name)).returning().get())
    yield* bus.emit({ type: "merge.uat_stack_started", payload: { name } })
    return yield* Schema.decodeUnknown(UatGeneration)(updated)
  })

  // ── promoteUat: promote the tested batch to main; fires postMergeLifecycle ──
  const promoteUat = (name: UatName) => Effect.gen(function* () {
    const gen = yield* Effect.sync(() => selectUat(q, name))
    if (!gen) return yield* Effect.fail(new UatGenerationNotFound({ name }))
    if (gen.status !== "ready" && gen.status !== "superseded")
      return yield* Effect.fail(new UatNotPromotable({ name, status: gen.status }))
    yield* promoteGeneration(q, forge, name)                     // promoteUatGeneration (uat-train.ts:287)
    const updated = yield* Effect.sync(() =>
      q.update(uatGenerations).set({ status: "promoted", updatedAt: now() })
        .where(eq(uatGenerations.name, name)).returning().get())
    yield* bus.emit({ type: "merge.uat_promoted", payload: { name } })
    return yield* Schema.decodeUnknown(UatGeneration)(updated)
  })

  return MergeWriter.of({
    merge, approveForge, rebaseOntoMain, mergeNext,
    scheduleAutoMerge, cancelAutoMerge,
    assembleUat, startUatStack, promoteUat,
  })
}))
```

> **Why `MergeWriter`'s `R` is clean.** Its dependencies are `Db` (the `merge_*` /
> `pending_auto_merges` / `uat_*` tables only), `Forge`, `Records`, `EventBus`,
> and `MergeResolver`. It **never** receives `issue_policy` — so it physically
> *cannot* write the per-issue `auto_merge` POLICY flag (that is SettingsWriter,
> the boundary finding). And it never receives the `issues` table — so it cannot
> advance a stage; `advance(merging→verifying_on_main)` stays IssueWriter's,
> fired by `postMergeLifecycle` after `merge` emits `merge.completed`.

> **Two durability disciplines in one writer (§1E.3).** The merge-engine and
> cooldown verbs follow source-first ordering — the **forge** is the commit point
> for `merge`/`approveForge`/`rebaseOntoMain`, and `records.writeProjectMerges`
> mirrors the durable `artifactUrl`. The `pending_auto_merges` verbs are pure
> cache (no git source). The `uat_*` verbs are append-only **source-of-truth in
> the DB** (the audited exception) — their cache write is the whole write. Each
> verb declares which discipline it uses inline.

## 2.4 `MergeApi` — the controller (`HttpApiGroup`)

Each endpoint declares request / success / error Schemas and delegates to the two
services; the handler's `R` is `MergeResolver | MergeWriter`, never `Db`
(CONVENTIONS §7 door enforcement). Endpoints trace to the Part-1 collapse.

```ts
import { HttpApi, HttpApiGroup, HttpApiEndpoint, HttpApiBuilder } from "effect/unstable/httpapi"

export const MergeApi = HttpApiGroup.make("merge")
  // ── reads ──
  .add(HttpApiEndpoint.get("getMergeSet", "/issues/:id/merge-set", {
    params: Schema.Struct({ id: IssueId }), success: MergeSet, error: MergeSetNotFound,
  }))
  .add(HttpApiEndpoint.get("listQueues", "/merge-queue", {
    success: Schema.Array(QueueView),                  // GET /api/merge-queue + /flywheel/merge-queue
  }))
  .add(HttpApiEndpoint.get("listAutoMerges", "/flywheel/auto-merge", {
    urlParams: AutoMergeFilter, success: Schema.Array(AutoMerge),  // pending + problems
  }))
  .add(HttpApiEndpoint.get("listBlockers", "/flywheel/merge-blockers", {
    success: Schema.Array(AutoMerge),
  }))
  .add(HttpApiEndpoint.get("listUatGenerations", "/flywheel/uat-generations", {
    urlParams: UatGenerationFilter, success: Schema.Array(UatGeneration),
  }))
  // ── writes: merge engine ──
  .add(HttpApiEndpoint.post("merge", "/issues/:id/merge", {
    params: Schema.Struct({ id: IssueId }), success: MergeSet,
    error: Schema.Union([MergeSetNotFound, NotReadyForMerge, MergeInProgress, ForgeMergeFailed]),
  }))
  .add(HttpApiEndpoint.post("approveForge", "/issues/:id/forge-approve", {
    params: Schema.Struct({ id: IssueId }), success: MergeSet,
    error: Schema.Union([MergeSetNotFound, ForgeMergeFailed]),
  }))
  .add(HttpApiEndpoint.post("rebaseOntoMain", "/issues/:id/sync-main", {
    params: Schema.Struct({ id: IssueId }), success: MergeSet, error: MergeSetNotFound,
  }))
  .add(HttpApiEndpoint.post("mergeNext", "/flywheel/merge-next", {
    payload: Schema.Struct({ projectKey: ProjectKey }),
    success: Schema.NullOr(MergeSet), error: ForgeMergeFailed,
  }))
  // ── writes: auto-merge cooldown ──
  .add(HttpApiEndpoint.post("scheduleAutoMerge", "/flywheel/auto-merge/schedule", {
    payload: Schema.Struct({
      issueId: IssueId, prUrl: Schema.String, prNumber: Schema.optional(Schema.Number),
      projectKey: ProjectKey, forge: Schema.optional(Schema.String),
      scheduledMergeAt: Schema.Date,
    }),
    success: AutoMerge,
  }))
  .add(HttpApiEndpoint.del("cancelAutoMerge", "/flywheel/auto-merge/:id", {
    params: Schema.Struct({ id: IssueId }),            // :id is the ISSUE id (CLI + handler)
    payload: Schema.Struct({ cancelledBy: Schema.String }),
    success: AutoMerge, error: AutoMergeNotFound,
  }))
  // ── writes: UAT batch train ──
  .add(HttpApiEndpoint.post("assembleUat", "/flywheel/assemble-uat", {
    success: Schema.Array(UatGeneration),
  }))
  .add(HttpApiEndpoint.post("startUatStack", "/flywheel/uat-generations/:name/stack", {
    params: Schema.Struct({ name: UatName }), success: UatGeneration,
    error: Schema.Union([UatGenerationNotFound, UatNotPromotable]),
  }))
  .add(HttpApiEndpoint.post("promoteUat", "/flywheel/uat-generations/:name/promote", {
    params: Schema.Struct({ name: UatName }), success: UatGeneration,
    error: Schema.Union([UatGenerationNotFound, UatNotPromotable]),
  }))

export const OverdeckApi = HttpApi.make("overdeck").add(IssuesApi).add(MergeApi) /* … */

// handlers: pure delegation. R = MergeResolver | MergeWriter — never Db.
export const MergeApiLive = HttpApiBuilder.group(OverdeckApi, "merge", (h) =>
  h.handle("getMergeSet",        ({ path })          => MergeResolver.getMergeSet(path.id))
   .handle("listQueues",         ()                  => MergeResolver.listQueues())
   .handle("listAutoMerges",     ({ urlParams })     => MergeResolver.listAutoMerges(urlParams))
   .handle("listBlockers",       ()                  => MergeResolver.listBlockers())
   .handle("listUatGenerations", ({ urlParams })     => MergeResolver.listUatGenerations(urlParams))
   .handle("merge",              ({ path })          => MergeWriter.merge(path.id))
   .handle("approveForge",       ({ path })          => MergeWriter.approveForge(path.id))
   .handle("rebaseOntoMain",     ({ path })          => MergeWriter.rebaseOntoMain(path.id))
   .handle("mergeNext",          ({ payload })       => MergeWriter.mergeNext(payload.projectKey))
   .handle("scheduleAutoMerge",  ({ payload })       => MergeWriter.scheduleAutoMerge(payload))
   .handle("cancelAutoMerge",    ({ path, payload }) => MergeWriter.cancelAutoMerge(path.id, payload.cancelledBy))
   .handle("assembleUat",        ()                  => MergeWriter.assembleUat({ force: true }))
   .handle("startUatStack",      ({ path })          => MergeWriter.startUatStack(path.name))
   .handle("promoteUat",         ({ path })          => MergeWriter.promoteUat(path.name)))
```

The Merge domain ships **no RPC group** (Part-1 §1C): its reads feed the
cross-domain `pan.getSnapshot` aggregate, which recomposes from `MergeResolver`
at the controller. A future live merge-queue stream would be a new `merge.subscribe`
Rpc fed by the writer's `bus.emit` events — not a current-surface item.

## 2.5 Layer wiring

```ts
const MergeDomainLayer = Layer.mergeAll(
  MergeResolverLayer,
  MergeWriterLayer,
).pipe(
  Layer.provide(DbLive),         // the ONLY place the merge_* / pending_auto_merges / uat_* handles are provided
  Layer.provide(ForgeLive),      // getForgeAdapter wrapper — GitHub/GitLab
  Layer.provide(RecordsLive),    // git .pan/records (durable artifact URLs)
  Layer.provide(EventBusLive),
)

const HttpLive = HttpApiBuilder.serve(OverdeckApi).pipe(
  Layer.provide(MergeApiLive),
  Layer.provide(MergeDomainLayer),
  // … IssuesApiLive / IssuesDomainLayer / SettingsApiLive …
)
// NodeRuntime.runMain(Layer.launch(HttpLive))  — Node 22 only (dashboard rule)
```

A missing dependency is a **compile error at the merge**, not a runtime failure
(CONVENTIONS §6). Because `MergeApiLive`'s handler `R` resolves to
`MergeResolver | MergeWriter` and neither leaks `Db`, no controller can read or
write the merge cache directly. Because `MergeWriter`'s `R` never contains
`issue_policy`, it cannot write the `auto_merge` POLICY flag — the boundary
finding enforced by the type system, not a convention.

---

## Acceptance — every method traces to a Part-1 row

| Service member | Part-1 source rows |
|---|---|
| `MergeResolver.getMergeSet` | §1A `forge-merge` (loads the merge set); the per-issue MS read |
| `MergeResolver.listQueues` | §1A `GET /api/merge-queue` (`workspaces.ts:6299`) + `GET /api/flywheel/merge-queue` (`flywheel.ts:886`) — the two duplicate read doors |
| `MergeResolver.listAutoMerges` | §1A `GET /api/flywheel/auto-merge/pending` (`flywheel.ts:566`) + `/problems` (`flywheel.ts:574`) |
| `MergeResolver.listBlockers` | §1A `GET /api/flywheel/merge-blockers` (`flywheel.ts:608`) |
| `MergeResolver.listUatGenerations` | §1A `GET /api/flywheel/uat-generations` (`flywheel.ts:914`) |
| `MergeWriter.merge` | §1A `POST /api/issues/:id/merge` (`workspaces.ts:5678`, `triggerMerge`) + `POST /api/issues/:id/forge-merge` (`workspaces.ts:5814`, per-repo loop) |
| `MergeWriter.approveForge` | §1A `POST /api/issues/:id/forge-approve` (`workspaces.ts:5710`) |
| `MergeWriter.rebaseOntoMain` | §1A `POST /api/issues/:id/sync-main` (`workspaces.ts:4785`) + §1B `pan sync-main` (`index.ts:467`) |
| `MergeWriter.mergeNext` | §1A `POST /api/flywheel/merge-next` (`flywheel.ts:669`) |
| `MergeWriter.scheduleAutoMerge` | §1A `POST /api/flywheel/auto-merge/schedule` (`flywheel.ts:653`) |
| `MergeWriter.cancelAutoMerge` | §1A `DELETE /api/flywheel/auto-merge/:id` (`flywheel.ts:683`) + §1B `pan merge cancel` (`merge.ts:23`) |
| `MergeWriter.assembleUat` | §1A `POST /api/flywheel/assemble-uat` (`flywheel.ts:965`) |
| `MergeWriter.startUatStack` | §1A `POST /api/flywheel/uat-generations/:name/stack` (`flywheel.ts:924`) |
| `MergeWriter.promoteUat` | §1A `POST /api/flywheel/uat-generations/:name/promote` (`flywheel.ts:940`) |
| `MergeApi` endpoints | one-to-one with the resolver/writer members above |
| relocated | §1A `approve` → Issues; `auto-merge` POLICY + `deacon-ignore` → Settings; `unstick` → Control/Settings |

No method reads or writes a column outside the locked merge tables (`merge_sets`,
`merge_set_repos`, `merge_queue`, `pending_auto_merges`, `uat_generations`,
`uat_generation_members`, `uat_generation_resolutions`); no endpoint is invented;
nothing real from the current merge / UAT / auto-merge surface is lost.
</content>
</invoke>
