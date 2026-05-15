# Swarm — Per-Item DAG Dispatch

**Reference for Panopticon's parallel-dispatch system: per-item DAG readiness, synthesis agents at convergence points, file-overlap serialization, and slot-merge auto-advance.**

PAN-970 shipped wave-based swarm v1. PAN-977 evolves the dispatcher to per-item readiness and moves runtime state out of the `~/.panopticon/swarms/*.json` sidecar into the continue vBRIEF.

---

## Mental Model

A vBRIEF plan's `plan.items[]` form a DAG via `blocks` edges. The swarm runtime dispatches **one work agent per item** ("slot") on its own git worktree and branch, in parallel where the DAG allows.

| Surface | Single-agent (default) | Swarm slot |
|---|---|---|
| Branch | `feature/<issue>` | `feature/<issue>/slot-<N>` |
| Worktree | `workspaces/feature-<issue>/` | per-slot worktree under `workspaces/` |
| tmux session | `agent-<issue>` | per-slot session, recorded in `SwarmSlotRuntime.sessionName` |
| Plan visibility | Full plan | Active-slice (bounded) prompt |

An item is **dispatchable** when every parent in its `blocks` edges is either merged into the feature branch or has plan status `completed` / `cancelled`. An item with **>1 unresolved blocking parents** is a DAG convergence point and gets a **synthesis agent** before the work agent. Two ready items whose `files_scope` patterns overlap are **serialized**, not parallelized.

When a slot branch merges into the feature branch, the merge-agent fires a loopback `POST /api/swarm/slot-merged` and dispatchable items re-evaluate.

---

## CLI

All swarm operations go through `pan swarm <id>`. Mutating operations forward to the dashboard's `POST /api/swarm` endpoint over the internal-token authenticated path; read-only and task-mutation operations resolve the workspace directly.

### Dispatch

```bash
pan swarm <id>                       # Spawn dispatchable items now
pan swarm <id> --dry-run             # Print dispatch plan; no spawns
pan swarm <id> --wave <n>            # Restrict dispatch to wave N (visualization)
pan swarm <id> --max-slots <n>       # Cap concurrency
pan swarm <id> --model <model>       # Override slot-agent model (default kimi-k2.6)
pan swarm <id> --auto-advance        # Auto-dispatch newly-ready items as slots merge
pan swarm <id> --no-auto-advance     # Manual mode; explicit `pan swarm <id>` per wave
```

### Task operations (vBRIEF item state)

The plan document is the **single mutation authority** for item status. Every task mutation bumps `plan.sequence` (CAS); the swarm runtime and Beads mirror state but do not own it.

```bash
pan swarm <id> --task next                        # List dispatchable items
pan swarm <id> --task show   --item <itemId>      # Show one item
pan swarm <id> --task claim  --item <itemId> [--sequence <n>]
pan swarm <id> --task done   --item <itemId> [--sequence <n>]
pan swarm <id> --task block  --item <itemId> --reason "<text>" [--sequence <n>]
pan swarm <id> --task unblock --item <itemId> [--sequence <n>]
pan swarm <id> --task cancel --item <itemId> [--sequence <n>]
```

`--sequence` is optional; supply the last-seen `plan.sequence` value to enforce compare-and-set. A mismatch raises `vBRIEF sequence conflict: expected X, found Y` and the write is rejected.

Operation → status mapping (`statusForOperation` in `dag.ts`):

| `--task` | Resulting `item.status` | Subitem behavior |
|---|---|---|
| `claim` | `running` | unchanged |
| `done` | `completed` | all subItems set to `completed` unless `subItemIds` provided |
| `block` | `blocked` | unchanged; `--reason` recorded in `metadata.statusReason` |
| `unblock` | `pending` | unchanged |
| `cancel` | `cancelled` | unchanged |

`next` and `show` read the canonical merged view (main spec + workspace continue `statusOverrides`). Mutations write to the canonical spec on main and mirror to the workspace continue file.

---

## HTTP Routes

All three routes live in `src/dashboard/server/routes/swarm.ts`.

### `POST /api/swarm`

Dispatch one or more slots for an issue. Privileged.

- **Auth:** `INTERNAL_TOKEN_HEADER` (CLI callers) **or** same-origin (dashboard callers). Other requests are rejected before any side effect.
- **Body:** `{ issueId, wave?, model?, maxSlots?, autoAdvance? }`
- **Response (200):** `{ success, wavePlan?, dispatched, autoAdvance, slots: [{ slot, itemId, sessionName }] }`
- **Side effects:** Mutates plan item status to `running` (CAS), creates per-slot worktrees and branches, spawns slot agents, writes `SwarmRuntime` into the issue's continue vBRIEF.

### `POST /api/swarm/slot-merged`

Loopback signal that a slot branch has merged into its parent feature branch.

- **Auth:** `INTERNAL_TOKEN_HEADER` only (no same-origin alternative).
- **Caller:** `postMergeLifecycle` in `src/lib/cloister/merge-agent.ts`, when it parses a merged source branch matching `^feature/<parent>/slot-(\d+)$`.
- **Body:** `{ issueId, slot, synthesisOutput? }` (the route resolves the canonical `itemId` from runtime state by matching slot number; `synthesisOutput` is size-capped).
- **Side effects:** Updates the slot's `SwarmSlotRuntime.status` to `merged`, re-evaluates `getDispatchableItems`, dispatches any newly-ready items (respecting capacity + overlap rules), and persists `SynthesisOutput` records.

### `GET /api/swarm/:issueId`

Read-only swarm runtime state for the dashboard's swarm view.

- **Response:** `SwarmRuntime` (slots, currentWave, totalWaves, synthesisOutputs, deferred items, timestamps) or 404 if no runtime exists for the issue.

---

## vBRIEF Item Metadata (Plan)

`VBriefItem.metadata` (in `src/lib/vbrief/types.ts`) gained two PAN-977 fields. Both are planner-authored and survive on the canonical spec on `main`.

| Field | Type | Meaning |
|---|---|---|
| `files_scope` | `string[]` | Files/globs this item touches. Globs support `**` (any path segment), `*` (any chars within a segment), `?`. Used by `hasFileOverlap()` to serialize file-conflicting parallel dispatch. Items without a scope are treated as non-overlapping. |
| `requiresSynthesis` | `boolean` | True when this item has >1 blocking parent (DAG convergence point). Auto-derived by `deriveSynthesisMetadata(doc)` during planning; do not hand-set. |

---

## Continue vBRIEF (Runtime State)

The PAN-970 sidecar `~/.panopticon/swarms/<issueId>.json` is gone. Swarm runtime state lives in `<projectRoot>/.pan/continues/<issue>.vbrief.json` under `ContinueState.swarmRuntime`, defined in `src/lib/vbrief/continue-state.ts`.

```ts
interface SwarmRuntime {
  model: string;                                      // Slot-agent model
  currentWave?: number;                               // Current dependency wave
  totalWaves?: number;                                // Total waves at dispatch time
  autoAdvance?: boolean;
  autoAdvanceFailureCount?: number;
  autoAdvanceRetryAfter?: string;                     // ISO 8601
  lastAutoAdvanceError?: string;
  deferred?: { itemId: string; itemTitle: string }[]; // Ready but held (overlap, capacity)
  slots: SwarmSlotRuntime[];                          // All slots, all cycles
  synthesisOutputs: Record<string, SynthesisOutput>;  // Keyed by target itemId
  createdAt: string;                                  // ISO 8601
  updatedAt: string;                                  // ISO 8601
}

interface SwarmSlotRuntime {
  slotId: number;
  itemId: string;
  itemTitle: string;
  sessionName: string;
  workspace: string;
  status: 'pending' | 'running' | 'merged' | 'failed';
  dispatchedAt?: string;
  mergedAt?: string;
}

interface SynthesisOutput {
  targetItemId: string;          // The downstream convergence item
  writtenAt: string;             // ISO 8601
  contextUpdate: string;         // Markdown — passed to the downstream work agent
}
```

Only `'merged'` slots satisfy DAG dependencies (round-14 review blocker). A `'failed'` slot does not unblock its dependents.

---

## Library API

All under `src/lib/vbrief/`.

### `dag.ts` — async + pure helpers (dashboard-safe)

**DAG analysis**

| Symbol | Purpose |
|---|---|
| `groupItemsByWave(doc) → Wave[]` | Kahn-partition items into dependency waves. Visualization only — dispatch uses per-item readiness. Excludes `completed`, `cancelled`, `blocked`, `running` from waves. |
| `criticalPath(doc) → string[]` | Longest-path through `blocks` edges. |
| `getDispatchableItems(doc, mergedItemIds) → VBriefItem[]` | Items whose every blocking parent is in `mergedItemIds` or has plan status `completed`/`cancelled`. Excludes items in `completed`/`cancelled`/`running`/`blocked` status. |
| `blockingParentCount(doc, itemId) → number` | Unresolved blocking parents. >1 ⇒ convergence point requiring a synthesis agent. |
| `blockingParentTotal(doc, itemId) → number` | Total blocking parents (ignores status). |
| `deriveSynthesisMetadata(doc) → VBriefDocument` | Returns a cloned doc with `metadata.requiresSynthesis: true` stamped on every item that has >1 blocking parent. |

**File-overlap**

| Symbol | Purpose |
|---|---|
| `compileGlob(pattern) → CompiledGlob` | Compile once, match many. Supports `**`, `*`, `?`. |
| `hasFileOverlap(running, candidate, precompiled?) → boolean` | Bidirectional overlap check between a candidate item and the currently-running set. Pre-compiled glob map is optional but recommended for large plans. |

**Active-slice prompts** (bounded work-agent context)

| Symbol | Purpose |
|---|---|
| `createActiveSlice(doc, opts) → ActiveSlice` | Bounded context for a single item: current work set, blockers, dependencies, unlocks, nearby context, acceptance criteria, optional synthesis context. |
| `renderActiveSlicePrompt(slice) → string` | Minimal markdown payload for work-agent prompts. |
| `verifyActiveSlicePromptReduction(doc, slice) → PromptSizeVerification` | Sanity-check the slice is bounded vs. the full plan. |
| `activeSlicePromptSize(slice) → number` | Byte size of the rendered prompt. |

`ActiveSliceOptions` accepts `synthesisOutputs?: Record<itemId, { contextUpdate }>` — when an item is a convergence point with a persisted synthesis output, the work-agent prompt includes that context block.

**Task operations (mutation authority)**

| Symbol | Purpose |
|---|---|
| `TaskOperationType` | `'claim' \| 'done' \| 'block' \| 'unblock' \| 'cancel'` |
| `TaskCommand` | `'next' \| 'show' \| TaskOperationType` (CLI-facing union) |
| `isTaskOperationType(v)`, `isTaskCommand(v)` | Type guards. |
| `applyTaskOperation(doc, op) → TaskOperationResult` | Pure transform. Enforces `expectedSequence` CAS. Bumps `plan.sequence` and `plan.updated`. `done` cascades to all subItems unless `subItemIds` provided. Optional `pipeline` field mirrors pipeline status into `plan.pipeline` for the canonical doc. |
| `applyTaskOperationToPlanFileAsync(planPath, op)` | Async write with writer-lock (`lockPathForPlan`/`lockOwnerPath`). Recovers stale locks; orphan lock-dir cleanup on owner-write failure. |

**Pipeline mirror** — pipeline status (review/test/merge) mirrored into the plan doc

| Symbol | Purpose |
|---|---|
| `PlanPipelineMirror`, `NestedPlanPipelineMirror` | Mirror shapes. |
| `getPipelineMirror(doc) → PlanPipelineMirror?` | Read current mirror. |
| `setPipelineMirror(doc, pipeline) → VBriefDocument` | Returns cloned doc with mirror applied. |
| `buildPipelineMirrorFromStatus(issueId, status, now?) → NestedPlanPipelineMirror` | Build a mirror from a review-status record. |
| `writePipelineMirrorToPlanFileAsync(planPath, mirror)` | Async write. |

**Task-graph view**

| Symbol | Purpose |
|---|---|
| `getTaskGraphView(doc, mergedItemIds?) → TaskGraphView` | DAG view annotated with current dispatchability. Used by the dashboard. |
| `actionableDoc(doc) → VBriefDocument` | Filter out non-actionable items (completed/cancelled). |

**Writer-lock primitives**

| Symbol | Purpose |
|---|---|
| `activePlanWriters: Map<planPath, writerId>` | In-process writer registry. |
| `lockPathForPlan(planPath) → string` | Lock-directory path. |
| `lockOwnerPath(planPath) → string` | Owner-file path inside the lock directory. |
| `validatePlanIssue(doc, issueId)` | Throws if the plan's `id` doesn't match `issueId`. |
| `workspacePlanPath(workspacePath) → string` | Conventional plan path inside a workspace. |

### `dag-cli.ts` — sync helpers (CLI only)

These use sync FS calls and **must not** be imported by dashboard server code (PAN-446).

| Symbol | Purpose |
|---|---|
| `runTaskCommand(command, options) → VBriefItem \| VBriefItem[] \| TaskOperationResult` | Top-level CLI dispatcher used by `pan swarm --task ...`. Returns dispatchable items for `next`, a single item for `show`, an operation result for mutations. |
| `applyTaskOperationToPlanFile(planPath, op, workspacePath?)` | Sync write variant of the async function. |
| `writePipelineMirrorToPlanFile(planPath, mirror)` | Sync write variant. |

### `continue-state.ts` — async helpers

| Symbol | Purpose |
|---|---|
| `readWorkspaceContinueAsync(workspacePath) → ContinueState?` | Read the per-issue continue file. |
| `writeWorkspaceContinueAsync(workspacePath, state)` | Atomic write. |
| `continueFilename(issueId)` / `continueFilePath(projectRoot, issueId)` | Canonical lowercase filename (`<issue>.vbrief.json`). |

---

## Slot Lifecycle

```
plan dispatch
  ├─ getDispatchableItems(doc, mergedItemIds) → ready[]
  ├─ filter by hasFileOverlap(runningItems, candidate) → ready_no_overlap[]
  ├─ partition by blockingParentCount(doc, itemId)
  │   ├─ count ≤ 1 → spawn work-agent slot directly
  │   └─ count  > 1 → spawn synthesis agent first; on completion the work-agent
  │                    slot is spawned with the persisted SynthesisOutput in its
  │                    active-slice prompt
  └─ for each spawned slot:
        create worktree at `workspaces/feature-<issue>-slot-<N>/`
        check out `feature/<issue>/slot-<N>` branched from `feature/<issue>`
        applyTaskOperation(doc, { type: 'claim', itemId, expectedSequence })
        SwarmSlotRuntime.status = 'running'
        spawn agent in per-slot tmux session

slot work done
  └─ slot merges its branch into the feature branch (review/test/merge pipeline)
        └─ merge-agent: postMergeLifecycle sees sourceBranch matches
                        ^feature/<parent>/slot-(\d+)$
              └─ POST /api/swarm/slot-merged (internal-token authenticated)
                    ├─ SwarmSlotRuntime.status = 'merged' (or 'failed')
                    ├─ persist SynthesisOutput (size-capped) if provided
                    └─ re-run dispatch cycle:
                          getDispatchableItems(doc, {...mergedItemIds, this})
                          → newly-ready items spawn (subject to overlap + capacity)
```

The whole feature branch's per-issue `postMergeLifecycle` only fires when `feature/<issue>` itself merges to `main` — slot-branch merges route to `/api/swarm/slot-merged` and return early. This keeps the per-issue pipeline (review → test → ship) decoupled from per-slot churn.

---

## Auth: Internal Token

All mutating swarm routes require `INTERNAL_TOKEN_HEADER`, defined in `src/lib/internal-token.js`. CLI callers (`pan swarm`) attach the token automatically via `ensureInternalToken()`. Dashboard same-origin callers are allowed on `POST /api/swarm` only; `POST /api/swarm/slot-merged` is token-only. If the token is not configured at server start, the route returns `503 internal token not configured` rather than degrading to unauthenticated.

---

## Sequence Numbers (CAS)

`plan.sequence` is a monotonic integer bumped on every successful `applyTaskOperation`. Operations may pass `expectedSequence` to assert "I read sequence N; only apply if it's still N." Mismatches throw and the write is rejected. The continue-file `statusOverrides` mirror is updated only after a successful canonical write — there is no scenario where the mirror advances past the canonical doc.

---

## Related

- [VBRIEF.md](./VBRIEF.md) — plan format, the four-artifact model, lifecycle.
- [HIERARCHICAL-PLANNING.md](./HIERARCHICAL-PLANNING.md) — tracker-level planning, vBRIEF positioning.
- [PRD-CLOISTER.md](./PRD-CLOISTER.md) — Cloister orchestration model.
- [REVIEW-AGENT-ARCHITECTURE.md](./REVIEW-AGENT-ARCHITECTURE.md) — review synthesis pattern (separate from swarm synthesis).
- `docs/prds/planned/PAN-970-swarm.md` — v1 wave-based dispatch (superseded by per-item readiness in PAN-977).
- `src/lib/vbrief/dag.ts`, `src/lib/vbrief/dag-cli.ts`, `src/lib/vbrief/continue-state.ts` — implementation.
- `src/dashboard/server/routes/swarm.ts` — HTTP surface.
- `src/lib/cloister/merge-agent.ts` — slot-branch detection (`SLOT_BRANCH_PATTERN`) and the loopback POST to `/api/swarm/slot-merged`.
