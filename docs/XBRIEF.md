# xBRIEF Plan Format & Lifecycle

Overdeck uses [xBRIEF](https://github.com/deftai/xBRIEF) for machine-readable work plans. Canonical specs, continues, drafts, and issue records live on `overdeck-state`; workspaces keep only runtime state under `.overdeck/`.

## Task state and concurrency

The xBRIEF checklist is the task source of truth. Durable runtime state lives in the issue record's `tasks` block: each item can carry a claim owner, claim timestamp, and completion state, while `readWorkspacePlan()` overlays those states onto the checked-in plan.

Agents use the smallest loop: `pan task next`, `pan task claim <item-id>`, implement and push the change, then `pan task done <item-id>`. Every mutation goes through the task write door, which holds the shared filesystem lock and applies a sequence check before updating the record. Two agents may race to claim an item; exactly one claim succeeds, and the loser rereads the plan and selects the next dispatchable item. Stale claims are surfaced by patrol rather than silently reassigned.

## xBRIEF v0.8

Upstream renamed the specification repository to `deftai/xBRIEF` on 2026-06-26, then released xBRIEF v0.8 on 2026-06-30. Overdeck emits the current `xBRIEFInfo` envelope and `.xbrief.json` filenames while retaining explicit read compatibility for older documents.

Overdeck reads documents from v0.5 through v0.8. New writers emit v0.8 documents with the `xBRIEFInfo` envelope.

## Specification

The canonical xBRIEF specification is maintained at **[github.com/deftai/xBRIEF](https://github.com/deftai/xBRIEF)**.

Overdeck emits xBRIEF v0.8 files with metadata extensions for issue tracking and difficulty estimation. Readers remain compatible with v0.5 through v0.8 documents. We also maintain a [fork of the spec](https://github.com/eltmon/xBRIEF) and have an open [extension proposal](https://github.com/deftai/xBRIEF/issues/40), superseding the original #1 proposal with draft PR deftai/xBRIEF#41.

## Version Compatibility

Overdeck emits `"version": "0.8"` for new documents (see the emission rules above). Readers accept every version from `"0.5"` through `"0.8"`.

v0.6+ uses nested `items` for acceptance-criterion child items. Legacy v0.5 `subItems` are still read as an alias, and readers prefer `items` when both fields are present.

The item status enum includes `failed` in addition to `draft`, `proposed`, `approved`, `pending`, `running`, `completed`, `blocked`, and `cancelled`.

## Migration from vBRIEF

The v0.7 rename changed the public name and canonical write format. Overdeck keeps these legacy read surfaces permanently so old plans and in-flight workspaces continue to load:

- Documents with the legacy `vBRIEFInfo` envelope remain readable; current writers emit `xBRIEFInfo`.
- Files ending in `*.vbrief.json` remain readable; current canonical spec and continue writers use `*.xbrief.json`.
- `PAN_SPEC_FILENAME` remains the workspace-only `spec.vbrief.json` compatibility filename, readable under `.pan/` and `.overdeck/` during migration. It is not the canonical state filename.
- The root `vbrief/{proposed,active,completed,cancelled}/` lifecycle directories remain read-only fallbacks. New writes target `specs/` on `overdeck-state`.

Migrate each project's existing state files only after this code has merged, the release has been deployed, and the running dashboard uses that deployed build. The deployed readers must accept both extensions before any state filename changes.

```bash
pan admin state migrate-xbrief <project> --dry-run
pan admin state migrate-xbrief <project>
pan admin state migrate-xbrief <project> --dry-run
```

The first command prints every envelope rewrite and filename change without mutating state. The second rewrites legacy spec envelopes, renames spec and continue files, and creates one reversible commit on `overdeck-state` through the state write door. The final dry run must report `0 file(s) to migrate`. Run this sequence once per configured project; do not run it from a feature branch before deployment and do not edit the state worktree manually.

---

## Lifecycle Model

### Directory Structure

#### Canonical state (`overdeck-state`)

On disk, each migrated project's state worktree is `${OVERDECK_HOME}/state/<project>/`:

```
specs/
  2026-05-01-PAN-950-feature-x.xbrief.json
  2026-05-03-PAN-960-feature-y.xbrief.json
continues/
  pan-950.xbrief.json
  pan-960.xbrief.json
drafts/
  pan-970.md
records/
  pan-950.json
  pan-960.json
migration-complete.json
```

The canonical spec is immutable after planning except for lifecycle status changes and explicit re-planning through the write door. The issue record carries mutable task claims, completion overlays, pipeline verdicts, close-out data, and the owner lease.

#### Workspace runtime state

```
.overdeck/
  continue.json             ← session state (statusOverrides live in the project-side per-issue record)
  pending-promotion.json    ← finalized plan awaiting server-side promotion recovery
  sessions.jsonl            ← append-only session history
  feedback/
    001-review-changes-requested.md
    002-test-failures.md
  context.md                ← feature context for story agents
```

Workspace runtime files are local and gitignored. Readers merge the canonical spec with `statusOverrides` from the project-side per-issue record (`continues/<issue-lowercase>.xbrief.json`) so agents and the dashboard see current item status without mutating the spec; legacy workspace-side overrides are backfilled one-way into that record.

See [AGENT-STATE-PLANES.md](./AGENT-STATE-PLANES.md) for the permanent, runtime, and liveness planes.

### PRD → Spec Lifecycle

PRDs and xBRIEFs are distinct artifacts that flow through the same pipeline:

1. **PRD drafted** — a human writes a markdown PRD to `drafts/` on `overdeck-state`, or a planning agent authors a workspace-local draft. `pan plan finalize` enforces the PRD's existence (PRD-first gate, PAN-2234) and complete-planning promotes a workspace-authored draft to `drafts/` on `overdeck-state` through the draft write door (`promoteWorkspacePrdDraft()`), never overwriting an existing canonical draft
2. **Planning completes** — the planning agent converts the PRD into a machine-readable workspace xBRIEF, stamps it `status: "proposed"` with `plan.metadata.promotionIntent`, and normally calls `complete-planning` to promote it into `specs/` on `overdeck-state`. If the dashboard cannot complete promotion, `pan plan finalize` leaves `.overdeck/pending-promotion.json`; the Deacon retries through the same endpoint on its next eligible patrol and removes the marker after convergence. Explicit `--no-promote` stamps `promotionIntent: "manual"`, so markerless recovery preserves the operator approval gate. The manual fallback is `pan plan done <issue-id>`.
3. **Work starts** — `pan start` performs one `transitionXBriefOnMain(..., "active", "running")` call that sets the spec's top-level `status` to `"active"` and `plan.status` to `"running"`, then commits and pushes that transition through the state write door before returning. Before first promotion, the fallback updates only the gitignored workspace draft. Work agents read the canonical spec via `findPlan()` and track item progress in the project-side record's `statusOverrides` (written via `writeStatusOverrideSync`)
4. **Active plan repair** — if an item's declared scope and verification are mechanically incompatible, stop its running work session and return the issue to planning. Preserve stable item IDs, repair the ownership or verification in the planning draft, and re-finalize it. Planning quality-lints the replacement and `writeSpecDocument()` rewrites the same canonical filename through the state write door; matching status overrides continue to apply. Work, task, and inspection surfaces never edit the canonical document directly.
5. **Work completes** — after merge, `status` is updated to `"completed"` on `overdeck-state`

### Status Transitions (field-based)

Status is a JSON field inside the xBRIEF — files never move between directories. All transitions are commits on `overdeck-state` through the state write door.

```
draft ──► proposed ──► active ──► completed
                 │                    │
                 └──► cancelled ◄─────┘
```

| Transition | Trigger | What happens |
|-----------|---------|--------------|
| (new) → draft | `pan plan` starts | PRD written to `drafts/` on `overdeck-state` |
| draft → proposed | Planning completes | xBRIEF created in `specs/` on `overdeck-state` with `status: "proposed"` |
| proposed → active | `pan start` | Status field updated to `"active"` on `overdeck-state`; agents read through `findPlan()` |
| active → completed | PR merges | Status field updated to `"completed"` on `overdeck-state` |
| active → cancelled | Issue closed | Status field updated to `"cancelled"` on `overdeck-state` |

### Issue-Keyed Filenames

Format: `YYYY-MM-DD-<ISSUE-ID>-<slug>.xbrief.json`

Example: `2026-04-28-MIN-846-fizzy-master.xbrief.json`

| Component | Source | Immutable? |
|-----------|--------|------------|
| Date (`YYYY-MM-DD`) | UTC creation date | Yes — never changes |
| Issue ID | From `plan.id` (e.g. `PAN-946`, `MIN-846`) | Yes |
| Slug | `slugify(plan.title)` — lowercase, dashes, max readability | Yes |

The canonical filename regex is `^(\d{4}-\d{2}-\d{2})-([A-Za-z][A-Za-z0-9]*-\d+)-([a-z0-9-]+)\.xbrief\.json$`. Readers also accept the legacy suffix documented in [Migration from vBRIEF](#migration-from-vbrief).

If `slugify()` receives an empty or all-special-character title, it returns `'plan'` as the slug.

### Workspace Spec (PAN-1124: single-spec-on-main)

There is no workspace-local copy of the spec during work execution. Work agents read the canonical spec directly from `specs/` on `overdeck-state` via `findPlan()`. Item/subItem status updates are tracked in the project-side per-issue record's `statusOverrides` flat map (`writeStatusOverrideSync` in `src/lib/pan-dir/record.ts`). `readWorkspacePlan()` returns a merged view (canonical spec + overlay) so callers see a complete document with up-to-date statuses. Planning may write a workspace draft; finalization validates that draft, replaces the canonical document through `writeSpecDocument()`, and leaves the draft non-canonical.

### Concurrency Model

| Resource | Writer | Readers | Contention |
|----------|--------|---------|------------|
| `specs/<file>` on `overdeck-state` | Planning and lifecycle writers only | Dashboard, agents (via `findPlan()`) | None — structure is immutable during work; explicit re-planning may replace the document at the same canonical filename |
| `.overdeck/continue.json` in a workspace | Pipeline + `updateItemStatus()` | Agent (injected into prompt at session start) | None — one agent per workspace |
| `.overdeck/sessions.jsonl` in a workspace | Pipeline appends | Dashboard, post-mortems | Minimal — append-only |
| `.overdeck/feedback/*.md` in a workspace | Pipeline only | Agent (injected into prompt) | None — single writer |
| Task state (issue record `tasks` block) | Each agent via `pan task` | Pipeline, dashboard | Serialized by the shared task-state lock |

For N parallel agents on N different issues, each has its own feature branch and workspace. Task mutations use the shared task-state lock but update different issue records.

---

## Continue State — Structured Session History

The continue file is the machine-readable operational state for in-progress work. It lives on the feature branch at `.overdeck/continue.json`.

### Schema

```json
{
  "version": "1",
  "issueId": "PAN-714",
  "created": "2026-04-28T12:00:00Z",
  "updated": "2026-04-29T18:30:00Z",
  "gitState": {
    "branch": "feature/pan-714",
    "sha": "a1b2c3d",
    "dirty": false
  },
  "decisions": [
    {
      "id": "D1",
      "summary": "Use Effect.js for route handlers instead of raw Express",
      "recordedAt": "2026-04-28T14:00:00Z"
    }
  ],
  "hazards": [
    {
      "id": "H1",
      "summary": "Circular ESM imports between health-filtering and cloister/config",
      "mitigation": "Bundle with tsdown to resolve at build time"
    }
  ],
  "resumePoint": {
    "description": "Implement the WebSocket reconnection logic in ws-rpc.ts",
    "taskId": "ws-reconnect",
    "filesToRead": ["src/dashboard/server/ws-rpc.ts"]
  },
  "tasksMapping": {
    "ws-reconnect": ["task-42"],
    "ws-reconnect.ac1": ["task-42"]
  },
  "agentModel": "claude-opus-4-6",
  "sessionHistory": [
    { "timestamp": "2026-04-28T12:00:00Z", "reason": "planning", "agentModel": "claude-opus-4-7" },
    { "timestamp": "2026-04-28T14:00:00Z", "reason": "start", "agentModel": "claude-opus-4-6" },
    { "timestamp": "2026-04-28T18:00:00Z", "reason": "end" },
    { "timestamp": "2026-04-29T10:00:00Z", "reason": "resume", "agentModel": "claude-opus-4-6" }
  ]
}
```

### Session Reasons

| Reason | When |
|--------|------|
| `planning` | Initial write during planning phase |
| `start` | Agent session begins |
| `end` | Agent signals done (`pan work done`) |
| `resume` | Agent resumes after restart |
| `crash-recovery` | Deacon recovers a stuck agent |
| `feedback` | Specialist sends feedback |
| `manual` | User manually updates |

### Functions

| Function | Module | Description |
|----------|--------|-------------|
| `writeContinueState()` | `continue-state.ts` | Atomic write via temp-file + rename |
| `readContinueState()` | `continue-state.ts` | Read + validate, returns null if missing |
| `appendSessionEntry()` | `continue-state.ts` | Append to sessionHistory, creates fresh state if missing |

---

## Required Format

Every xBRIEF has exactly two top-level keys per the xBRIEF spec:

```json
{
  "xBRIEFInfo": {
    "version": "0.8",
    "created": "2026-04-04T12:00:00Z",
    "author": "overdeck/0.45.21",
    "description": "Plan for PAN-436: Dashboard skeleton loading states"
  },
  "plan": {
    "id": "pan-436",
    "title": "Dashboard skeleton loading states",
    "status": "approved",
    "uid": "f47ac10b-58cc-4372-a567-0e02b2c3d479",
    "author": "agent:claude-opus-4-6",
    "sequence": 3,
    "created": "2026-04-04T12:00:00Z",
    "updated": "2026-04-04T18:30:00Z",
    "references": [
      { "uri": "https://github.com/eltmon/overdeck/issues/436", "label": "PAN-436", "type": "issue" },
      { "uri": "${OVERDECK_HOME}/state/<project>/drafts/PAN-436.md", "label": "PAN-436 PRD draft (drafts/PAN-436.md on overdeck-state)", "type": "prd" }
    ],
    "tags": ["frontend", "ux"],
    "narratives": {
      "Problem": "Dashboard shows zeros on load — no loading indicators",
      "Proposal": "BootstrapGate wrapper + shimmer skeleton components",
      "NonGoals": "- Replacing the existing dashboard routing\n- Changing issue lifecycle statuses"
    },
    "items": [
      {
        "id": "bootstrap-gate",
        "title": "Create BootstrapGate wrapper component",
        "status": "pending",
        "priority": "high",
        "created": "2026-04-04T12:00:00Z",
        "metadata": {
          "difficulty": "simple",
          "kind": "frontend",
          "issueLabel": "pan-436",
          "requiresInspection": false,
          "inspectionDepth": "fast",
          "files_scope": ["src/dashboard/frontend/src/components/BootstrapGate.tsx"],
          "files_scope_confidence": "high",
          "verify_commands": ["npm --prefix src/dashboard/frontend test"],
          "expected_outputs": ["BootstrapGate tests pass"],
          "readiness": "ready",
          "traces": ["FR-1"]
        },
        "narrative": {
          "Action": "Component that checks selectIsBootstrapped and renders fallback or children"
        },
        "items": [
          {
            "id": "bootstrap-gate.ac1",
            "title": "Renders fallback when bootstrapComplete is false",
            "status": "pending",
            "metadata": { "kind": "acceptance_criterion" }
          }
        ]
      }
    ],
    "edges": [
      { "from": "bootstrap-gate", "to": "wire-gates", "type": "blocks" }
    ]
  }
}
```

---

## Field Reference

### Top-Level (xBRIEF standard)

#### `xBRIEFInfo` fields

| Field | Required | Description |
|-------|----------|-------------|
| `xBRIEFInfo.version` | YES | Emit `"0.8"` (written as `xBRIEFInfo` on disk for v0.7+); readers accept `"0.5"` through `"0.8"` |
| `xBRIEFInfo.created` | YES | ISO 8601 timestamp — when the document was created |
| `xBRIEFInfo.updated` | NO | ISO 8601 timestamp — updated automatically on every write |
| `xBRIEFInfo.author` | NO | Tool identifier, e.g. `"overdeck/0.6.0"` |
| `xBRIEFInfo.description` | NO | Human-readable description: `"Plan for PAN-436: ..."` |

#### `plan` fields

| Field | Required | Description |
|-------|----------|-------------|
| `plan.id` | YES | Issue ID in lowercase (e.g., `"pan-436"`) |
| `plan.title` | YES | Human-readable plan title |
| `plan.status` | YES | One of: `draft`, `proposed`, `approved`, `pending`, `running`, `completed`, `blocked`, `cancelled`, `failed` |
| `plan.items` | YES | Array of work items |
| `plan.edges` | NO | Dependency edges between items |
| `plan.uid` | NO | UUID v4, generated once at creation — stable identifier for the plan |
| `plan.author` | NO | Who created the plan, e.g. `"agent:claude-opus-4-6"` |
| `plan.sequence` | NO | Monotonically incrementing write counter (starts at 1, auto-incremented by io.ts) |
| `plan.references` | NO | External links — see [References](#references) |
| `plan.created` | NO | ISO 8601 timestamp — when the plan was first created |
| `plan.updated` | NO | ISO 8601 timestamp — updated automatically on every status write |
| `plan.tags` | NO | Tags for categorization |
| `plan.narratives` | NO | Problem/Proposal/NonGoals/Constraint/Risk narratives |
| `plan.narratives.NonGoals` | NO | Explicitly out-of-scope behaviors, one per line prefixed `- `, or `"none"` if genuinely nothing. Review enforces these as must-not constraints. |
| `plan.pipeline` | NO | Runtime-derived durable verdict block; lives in the per-issue permanent record, not the spec |
| `plan.closeOut` | NO | Close-out aggregate; lives in the per-issue permanent record, not the spec |
| `plan.owner` | NO | Owner-URI lease; lives in the per-issue permanent record, not the spec |

#### `plan.status` Enum

The `plan.status` field drives lifecycle transitions:

| Status | Location | Meaning |
|--------|----------|---------|
| `draft` | `drafts/` (PRD stage) | Planning in progress |
| `proposed` | `specs/` | Planning done, awaiting approval |
| `approved` | `specs/` | User approved, ready to start |
| `pending` | `specs/` | Queued, waiting for resources |
| `running` | `specs/` | Agent is executing |
| `completed` | `specs/` | Work done, merged |
| `blocked` | `specs/` | Waiting on external dependency |
| `cancelled` | `specs/` | Abandoned |

#### References

`plan.references` is an array of `XBriefReference` objects:

| Field | Required | Description |
|-------|----------|-------------|
| `uri` | YES | URL or path to the referenced resource |
| `label` | NO | Human-readable label (e.g., `"PAN-436"`) |
| `type` | NO | Resource type: `"issue"`, `"prd"`, `"spec"`, `"doc"` |

### Items (xBRIEF standard)

| Field | Required | Description |
|-------|----------|-------------|
| `id` | YES | Short kebab-case identifier |
| `title` | YES | Task title |
| `status` | YES | Same enum as plan.status |
| `priority` | NO | `critical`, `high`, `medium`, `low` |
| `created` | NO | ISO 8601 timestamp — when the item was created |
| `completed` | NO | ISO 8601 timestamp — set automatically when status → `completed` |
| `narrative` | NO | `{ "Action": "what to do" }` |
| `items` | NO | Child items (used for acceptance criteria). Legacy v0.5 `subItems` are read as an alias. |

### Edges (dependency graph)

| Field | Required | Description |
|-------|----------|-------------|
| `from` | YES | Source item ID |
| `to` | YES | Target item ID |
| `type` | YES | Edge type: `blocks`, `informs`, `invalidates`, `suggests` |

Edge semantics:
- `blocks` — `to` cannot start until `from` completes (hard dependency)
- `informs` — `to` should consider decisions from `from` (soft dependency)
- `invalidates` — `from` invalidates assumptions made by `to`
- `suggests` — `from` gives guidance to `to`

Only `blocks` edges are used for critical path computation and task scheduling (`pan task next`).

### Overdeck Extensions (via `metadata`)

The xBRIEF spec supports arbitrary `metadata` on items and child items. Overdeck uses these metadata fields:

| Field | Location | Description |
|-------|----------|-------------|
| `metadata.difficulty` | items | `trivial`, `simple`, `medium`, `complex`, `expert` — used for model routing |
| `metadata.kind` | items | Routing category: `docs`, `api`, `backend`, `frontend`, `infra`, `test`, `refactor`, `design`, or `spike` |
| `metadata.issueLabel` | items | Issue ID for task filtering (e.g., `"pan-436"`) |
| `metadata.requiresInspection` | items | Boolean decision for whether a task must pass the work.inspect gate before downstream work proceeds |
| `metadata.inspectionDepth` | items | `"fast"` or `"deep"` review depth when `requiresInspection` is true |
| `metadata.foundationFor` | items | Downstream task IDs that depend on this inspection-gated item |
| `metadata.files_scope` | items | Concrete files or narrow globs the item may modify |
| `metadata.files_scope_confidence` | items | `high`, `medium`, or `low` confidence in `files_scope` |
| `metadata.verify_commands` | items | Commands that verify the committed item |
| `metadata.expected_outputs` | items | Observable evidence expected from those commands |
| `metadata.readiness` | items | Static parallel-safety classification: `ready` can run in its own slot once DAG blockers complete; `sequential` must remain serialized after prerequisites; `needs_refinement` must be split or clarified. Edges control dispatch order. |
| `metadata.traces` | items | Optional `string[]` of PRD requirement IDs (`FR-1`, `NFR-2`) satisfied by this item |
| `metadata.kind` | child items | `"acceptance_criterion"` — marks a child item as an AC for the verification gate |
| `metadata.canonicalFilename` | plan | Preserves the immutable filename across re-finalizations |

These extensions are NOT part of the xBRIEF core spec. We've opened a feature request to standardize them: **[deftai/xBRIEF#40](https://github.com/deftai/xBRIEF/issues/40)**, superseding the original #1 request with draft PR deftai/xBRIEF#41.

---

## `pan scope` Commands

Manual lifecycle transition overrides for xBRIEFs. All commands resolve the project from the issue ID and update the status field in `specs/` on `overdeck-state`.

| Command | Effect |
|---------|--------|
| `pan scope list` | Scan `specs/` across all projects, print issue ID / title / status |
| `pan scope show <issueId>` | Display title, status, sequence, file path, item count |
| `pan scope propose <issueId>` | Set `plan.status` to `proposed` |
| `pan scope approve <issueId>` | Set `plan.status` to `approved` |
| `pan scope complete <issueId>` | Set `plan.status` to `completed` |
| `pan scope cancel <issueId>` | Set `plan.status` to `cancelled` |
| `pan scope restore <issueId>` | Set `plan.status` to `approved` (from completed or cancelled) |

### Planned (PAN-958)

- `pan scope ingest` — Import an existing xBRIEF or PRD into the lifecycle as a `proposed` scope
- `pan scope reconcile` — Detect and fix state disagreements between xBRIEFs, tracker, and workspaces

---

## `pan sync` xBRIEF Disagreement Detection

`pan sync` detects state disagreements between the xBRIEF lifecycle, issue tracker, and workspace state:

| Check | Meaning | Suggested Fix |
|-------|---------|---------------|
| Active xBRIEF but GitHub issue is closed | Work artifact out of sync with tracker | `pan scope complete <ID>` or `pan scope cancel <ID>` |
| Completed xBRIEF but workspace still exists | Stale workspace after merge | Clean up workspace |
| Workspace exists but no active xBRIEF | Missing lifecycle entry | `pan scope approve <ID>` |

---

## How Overdeck Uses xBRIEF

1. **PRD authored** — a human or planning agent writes a PRD to `drafts/` on `overdeck-state`.
2. **Planning agent** converts the PRD into an xBRIEF spec during the discovery session and finalizes it through the canonical state writer.
3. **`complete-planning`** writes the xBRIEF to `specs/` on `overdeck-state` with an issue-keyed `.xbrief.json` filename and sets `plan.status` to `proposed`.
4. **`pan start`** updates `plan.status` to `active` on `overdeck-state`. Work agents read the spec through `findPlan()`.
5. **Work agent** works through tasks in DAG dependency order (`pan task next <issue>`). Item/subItem status updates are written through the task state door. `readWorkspacePlan()` returns a merged view with current statuses.
6. **Verification gate** checks all child items with `metadata.kind: "acceptance_criterion"` are `completed` before allowing review.
7. **`postMergeLifecycle`** updates `plan.status` to `completed` in `specs/` on `overdeck-state`.
8. **Dashboard** renders the plan via the Directive Flow (DAG visualization) and xBRIEF viewer (List/DAG/Raw JSON tabs).

### Dashboard viewer

The dashboard exposes the same xBRIEF through three entry points:

- The kanban issue-card and InspectorPanel xBRIEF buttons open `XBriefDialog`.
- The project-tree issue row's xBRIEF resource chip opens `XBriefFullscreen`.
- The drawer Plan panel and cockpit `PlanMapCard` expand buttons open the same `XBriefFullscreen` instance.

`XBriefFullscreen` is mounted once in `App.tsx` and selected through `xbriefViewerIssueId` in the dashboard store. It reads the merged plan through `useWorkspacePlanQuery` and keeps the List, DAG, and Raw view switcher in the full-screen header. Entry points set the issue ID; they do not create new query keys, routes, or issue-view inventory sections.

### Plan Resolution (PAN-1124: single-spec-on-main)

`findPlan(workspacePath)` in `src/lib/xbrief/io.ts` resolves the canonical spec on `overdeck-state` first via `findSpecByIssue(projectRoot, issueId)`. It derives the issue ID from the workspace directory name (`feature-<id>`) and the project root (two levels up), then falls back to the workspace compatibility copy documented in [Migration from vBRIEF](#migration-from-vbrief).

`readWorkspacePlan(workspacePath)` returns a merged view: canonical `overdeck-state` spec + `statusOverrides` from the project-side per-issue record (`readIssueRecord`). This is transparent to all callers.

`findXBriefByIssue(projectRoot, issueId)` in `lifecycle-io.ts` remains the canonical read-only lifecycle lookup for cross-issue queries.

Canonical continue files live at `${OVERDECK_HOME}/state/<project>/continues/<issue-lowercase>.xbrief.json`. Workspace-side continue state lives at `<workspace>/.overdeck/continue.json` and includes `statusOverrides` for item/subItem status tracking. See [Migration from vBRIEF](#migration-from-vbrief) for the permanent legacy read surfaces.

### Per-issue permanent record (PAN-1908)

In addition to the xBRIEF spec and continue file, every in-flight issue has a durable record at `records/<issue-lowercase>.json` on `overdeck-state` (on disk: `${OVERDECK_HOME}/state/<project>/records/<issue-lowercase>.json`). This record is committed through the state write door on durable transitions.

It contains:

| Field | Source | Writable by |
|-------|--------|-------------|
| `issueId` | issue id | read-only |
| `schemaVersion` | record format version | read-only |
| `decisions` | continue file | work agent / planning agent |
| `hazards` | continue file | work agent / planning agent |
| `feedback` | continue file | work agent / planning agent |
| `pipeline` | durable `review_status` columns | review-status upsert path |
| `closeOut` | cost events + merge set | close-out flow |
| `owner` | URI lease | spawn/claim/close-out flow |

The `pipeline` block carries the durable verdicts (`reviewStatus`, `testStatus`, `inspectStatus`, `mergeStatus`, `readyForMerge`, `prUrl`/`prNumber`/`prHeadSha`, `reviewedAtCommit`, `lastVerifiedCommit`, `autoMerge`, `deaconIgnored`, etc.). The `closeOut` block carries `usage.byStage[stage][provider/model] = {input, output, cacheRead, cacheWrite}`, `usage.totals`, `costAtCloseOut`, `merges[]` (URL strings), `ranOn`, and `closedAt`.

The infra repo and subpath are declared per project in `projects.yaml` under `pan_records: { repo, path }`. See [AGENT-STATE-PLANES.md](./AGENT-STATE-PLANES.md).

---

## Common Mistakes

**DO NOT** use flat format:
```json
// WRONG — missing xBRIEFInfo, plan wrapper
{
  "issue": "PAN-436",
  "items": [...]
}
```

**DO NOT** use variant field names for the issue ID:
```json
// WRONG — use plan.id, not these
{ "issue": "PAN-436" }
{ "issueId": "PAN-436" }
{ "issue_id": "PAN-436" }
```

**DO** use the canonical nested format:
```json
// CORRECT
{
  "xBRIEFInfo": { "version": "0.6", "created": "..." },
  "plan": { "id": "pan-436", ... }
}
```

---

## Quality Lint and Constraints (PAN-3151)

Planning applies quality-lint checks during plan finalization to catch oversized or overly fragmented changes before they reach the work agent. These checks are mechanical and fail loudly at finalize time.

### Projected-surface lint

When a plan's items declare `metadata.files_scope` entries, the lint counts distinct files and subsystems and enforces these thresholds:

- **Maximum files:** 25 distinct files across all items' `files_scope`
- **Maximum subsystems:** 6 distinct subsystems (extracted as the first two segments of each file path, e.g., `src/dashboard` from `src/dashboard/frontend/src/...`)

A change exceeding either threshold is rejected with an error message. To override the thresholds, the plan's `metadata` object must include a non-empty `sizeJustification` string explaining why the scale is necessary.

**Rationale:** Large, fragmented changes tend to create review cycles that don't converge — finding counts drop, then rise again — because there are too many independent areas to coordinate in one PR. Enforcing this limit at plan-finalize time catches oversized changes early and encourages decomposition into sibling issues.

**Example override:**
```json
{
  "plan": {
    "metadata": {
      "sizeJustification": "Dashboard redesign requires coordination across 7 subsystems (DX/UX commitment); decomposition would require async coordination and delay ship"
    },
    "items": [ /* ... 30 files across 7 subsystems ... */ ]
  }
}
```

---

## Resilience

The `readPlan()` function in `src/lib/xbrief/io.ts` normalizes flat format plans to the canonical nested format for backwards compatibility. The normalizer handles:

- `issue`, `issueId`, `issue_id`, `id` → `plan.id`
- `description` → `narrative.Action`
- `difficulty` → `metadata.difficulty`
- `acceptance[]` (string array) → `items[]` with `metadata.kind: "acceptance_criterion"`

---

## Divergence from deft

Overdeck adapts deft's lifecycle model for multi-agent, multi-issue orchestration:

| deft Constraint | Overdeck Divergence |
|-----------------|----------------------|
| One `plan.xbrief.json` per project | N concurrent xBRIEFs per project (one per issue) |
| Serialized changes | N agents on N issues in parallel, each in its own workspace |
| `history/changes/` folder structure | Issue-keyed filenames in `specs/` |
| Status = directory location | Status = JSON field (files never move) |
| `specification.xbrief.json` required | Optional (exists in repo but not enforced) |
| `playbook-{name}.xbrief.json` | Overdeck uses skills for this |

The xBRIEF format itself works without modification — it's the single-plan-per-project constraint that Overdeck relaxes.
