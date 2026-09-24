# xBRIEF Plan Format & Lifecycle

Overdeck uses [xBRIEF](https://github.com/deftai/xBRIEF) for machine-readable work plans. Canonical specs, continues, and drafts live under `.pan/` in the project repo (or the configured plan-home repo for polyrepo projects), committed on the feature branch; workspaces keep only runtime state under `.overdeck/`.

## Task state and concurrency

The xBRIEF checklist is the task source of truth. Completion state lives in `.pan/continues/<issue-lowercase>.xbrief.json`, plus the `Item: <item-id>` trailer on the commit that finished it — nothing is duplicated into a separate pipeline record.

Agents use the smallest loop: `pan task next`, `pan task claim <item-id>`, implement and push the change, then `pan task done <item-id>`. `pan task done` verifies the pushed commit carries the `Item:` trailer before recording completion in the continue file. Two agents may race to claim an item; exactly one claim succeeds, and the loser rereads the plan and selects the next dispatchable item.

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

The v0.7 rename changed the public name and canonical write format. Overdeck keeps these legacy read surfaces permanently so old plans continue to load:

- Documents with the legacy `vBRIEFInfo` envelope remain readable; current writers emit `xBRIEFInfo`.
- Files ending in `*.vbrief.json` remain readable; current canonical spec and continue writers use `*.xbrief.json`.
- `PAN_SPEC_FILENAME` remains the workspace-only `spec.vbrief.json` compatibility filename, readable under `.pan/` and `.overdeck/`.

Every project's plan artifacts (drafts, specs, continues, orders, notes, backlog sequence) were migrated once, for open issues, from the old `overdeck-state` worktree into `.pan/` in the project repo (closed-issue artifacts stayed on the archived branch, tagged `state-final`). That migration is done; there is no ongoing migration tooling.

---

## Lifecycle Model

### Directory Structure

#### Canonical plan state (`.pan/`)

`.pan/` lives in the project repo (or the configured plan-home repo for polyrepo projects), committed by whoever writes it. Per-issue artifacts (specs, continues, drafts) are committed on the feature branch. Project-level artifacts (orders, notes, the backlog sequence) are committed on `main` in the plan home, and `pan backlog write-sequence` and the `pan orders` write verbs also push their commit so local `main` does not drift ahead of origin (PAN-3923, #4108). When origin has moved, the push replays only the `.pan/` commits onto it and pushes. It never forces, and it warns instead of pushing when local `main` holds unpushed commits outside `.pan/`.

```
.pan/
  specs/
    2026-05-01-PAN-950-feature-x.xbrief.json
    2026-05-03-PAN-960-feature-y.xbrief.json
  continues/
    pan-950.xbrief.json
    pan-960.xbrief.json
  drafts/
    pan-970.md
  orders/
  notes/
  backlog/sequence.md
```

The canonical spec is immutable after planning except for lifecycle status changes and explicit re-planning. Task claims and completion state live in the matching `continues/<issue>.xbrief.json` file, keyed by commit trailers — never in a separate pipeline record.

#### Workspace runtime state

```
.overdeck/
  continue.json             ← session state (decisions, hazards, git state)
  sessions.jsonl            ← append-only session history
  feedback/
    001-review-changes-requested.md
    002-test-failures.md
  context.md                ← feature context for story agents
```

Workspace runtime files are local and gitignored.

### PRD → Spec Lifecycle

PRDs and xBRIEFs are distinct artifacts that flow through the same pipeline:

1. **PRD drafted** — a human writes a markdown PRD to `.pan/drafts/<issue>.md`, or a planning agent authors a workspace-local draft that gets promoted there. `pan plan finalize` enforces the PRD's existence (PRD-first gate, PAN-2234), never overwriting an existing canonical draft.
2. **Planning completes** — the planning agent converts the PRD into a machine-readable workspace xBRIEF, stamps it `status: "proposed"`, and `complete-planning` promotes it into `.pan/specs/` on the feature branch. Explicit `--no-promote` leaves the spec at `status: "proposed"` for a human to promote later with `pan plan done <issue-id>`.
3. **Work starts** — `pan start` sets the spec's top-level `status` to `"active"` and `plan.status` to `"running"`, then commits and pushes that transition on the feature branch before returning. Work agents read the canonical spec via `findPlan()` and track item progress in `.pan/continues/<issue>.xbrief.json`.
4. **Active plan repair** — if an item's declared scope and verification are mechanically incompatible, stop its running work session and return the issue to planning. Preserve stable item IDs, repair the ownership or verification in the planning draft, and re-finalize it. Planning quality-lints the replacement and rewrites the same canonical filename; matching continue-file state continues to apply.
5. **Work completes** — after merge, `status` is updated to `"completed"` in the spec.

### Status Transitions (field-based)

Status is a JSON field inside the xBRIEF — files never move between directories. All transitions are commits on the feature branch.

```
draft ──► proposed ──► active ──► completed
                 │                    │
                 └──► cancelled ◄─────┘
```

| Transition | Trigger | What happens |
|-----------|---------|--------------|
| (new) → draft | `pan plan` starts | PRD written to `.pan/drafts/` |
| draft → proposed | Planning completes | xBRIEF created in `.pan/specs/` with `status: "proposed"` |
| proposed → active | `pan start` | Status field updated to `"active"`; agents read through `findPlan()` |
| active → completed | PR merges | Status field updated to `"completed"` |
| active → cancelled | Issue closed | Status field updated to `"cancelled"` |

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

There is no workspace-local copy of the spec during work execution. Work agents read the canonical spec directly from `.pan/specs/` via `findPlan()`. Item/subItem status updates are tracked in `.pan/continues/<issue>.xbrief.json`. `readWorkspacePlan()` returns a merged view (canonical spec + continue-file overlay) so callers see a complete document with up-to-date statuses. Planning may write a workspace draft; finalization validates that draft, replaces the canonical document, and leaves the draft non-canonical.

### Concurrency Model

| Resource | Writer | Readers | Contention |
|----------|--------|---------|------------|
| `.pan/specs/<file>` | Planning and lifecycle writers only | Dashboard, agents (via `findPlan()`) | None — structure is immutable during work; explicit re-planning may replace the document at the same canonical filename |
| `.pan/continues/<issue>.xbrief.json` | `pan task claim`/`pan task done` | Dashboard, agents | Serialized per issue |
| `.overdeck/continue.json` in a workspace | Pipeline + `updateItemStatus()` | Agent (injected into prompt at session start) | None — one agent per workspace |
| `.overdeck/sessions.jsonl` in a workspace | Pipeline appends | Dashboard, post-mortems | Minimal — append-only |
| `.overdeck/feedback/*.md` in a workspace | Pipeline only | Agent (injected into prompt) | None — single writer |

For N parallel agents on N different issues, each has its own feature branch, workspace, and continue file.

---

## Workspace Continue State

The workspace continue file is local, gitignored operational context for in-progress work. It lives at `.overdeck/continue.json` and carries `decisions[]`, `hazards[]`, and `gitState` — context that isn't in the xBRIEF narrative but that the work agent, and review/test agents, need. It is not permanent state and is never committed; permanent completion state is `.pan/continues/<issue>.xbrief.json` plus commit trailers (see [Task state and concurrency](#task-state-and-concurrency)).

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
  ]
}
```

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
    "author": "agent:example-model",
    "sequence": 3,
    "created": "2026-04-04T12:00:00Z",
    "updated": "2026-04-04T18:30:00Z",
    "references": [
      { "uri": "https://github.com/eltmon/overdeck/issues/436", "label": "PAN-436", "type": "issue" },
      { "uri": ".pan/drafts/PAN-436.md", "label": "PAN-436 PRD draft", "type": "prd" }
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
          "files_scope": ["src/dashboard/frontend/src/components/BootstrapGate.tsx"],
          "files_scope_confidence": "high",
          "verify_commands": ["npm --prefix src/dashboard/frontend test"],
          "expected_outputs": ["BootstrapGate tests pass"],
          "readiness": "ready",
          "traces": ["FR-1"],
          "requiresInspection": false,
          "inspectionDepth": "fast",
          "foundationFor": []
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
| `plan.author` | NO | Who created the plan, e.g. `"agent:<model-slug>"` |
| `plan.sequence` | NO | Monotonically incrementing write counter (starts at 1, auto-incremented by io.ts) |
| `plan.references` | NO | External links — see [References](#references) |
| `plan.created` | NO | ISO 8601 timestamp — when the plan was first created |
| `plan.updated` | NO | ISO 8601 timestamp — updated automatically on every status write |
| `plan.tags` | NO | Tags for categorization |
| `plan.narratives` | NO | Problem/Proposal/NonGoals/Constraint/Risk narratives |
| `plan.narratives.NonGoals` | NO | Explicitly out-of-scope behaviors, one per line prefixed `- `, or `"none"` if genuinely nothing. Review enforces these as must-not constraints. |

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
| `metadata.files_scope` | items | Concrete files or narrow globs the item may modify |
| `metadata.files_scope_confidence` | items | `high`, `medium`, or `low` confidence in `files_scope` |
| `metadata.verify_commands` | items | Commands that verify the committed item |
| `metadata.expected_outputs` | items | Observable evidence expected from those commands |
| `metadata.readiness` | items | Static parallel-safety classification: `ready` can run in its own slot once DAG blockers complete; `sequential` must remain serialized after prerequisites; `needs_refinement` must be split or clarified. Edges control dispatch order. |
| `metadata.traces` | items | Optional `string[]` of PRD requirement IDs (`FR-1`, `NFR-2`) satisfied by this item |
| `metadata.requiresInspection` | items | Boolean: does this item's risk warrant a standing tier-supervisor watching its commits (PAN-3917 dropped the blocking `pan inspect` CLI gate; this is now a subscription signal, not a completion blocker). Required on every item — `quality-lint.ts` rejects a plan missing it. |
| `metadata.inspectionDepth` | items | `"fast"` or `"deep"` — how closely the supervisor should read commits when `requiresInspection` is true |
| `metadata.foundationFor` | items | `string[]` of downstream item IDs that build on this one; required and non-empty when `requiresInspection` is true (`quality-lint.ts` flags `requiresInspection: true` with no `foundationFor` entries) |
| `metadata.kind` | child items | `"acceptance_criterion"` — marks a child item as an AC for the verification gate |
| `metadata.canonicalFilename` | plan | Preserves the immutable filename across re-finalizations |

These extensions are NOT part of the xBRIEF core spec. We've opened a feature request to standardize them: **[deftai/xBRIEF#40](https://github.com/deftai/xBRIEF/issues/40)**, superseding the original #1 request with draft PR deftai/xBRIEF#41.

---

## `pan scope` Commands

Manual lifecycle transition overrides for xBRIEFs. All commands resolve the project from the issue ID and update the status field in `.pan/specs/`.

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

1. **PRD authored** — a human or planning agent writes a PRD to `.pan/drafts/`.
2. **Planning agent** converts the PRD into an xBRIEF spec during the discovery session and finalizes it through the canonical state writer.
3. **`complete-planning`** writes the xBRIEF to `.pan/specs/` with an issue-keyed `.xbrief.json` filename and sets `plan.status` to `proposed`.
4. **`pan start`** updates `plan.status` to `active`. Work agents read the spec through `findPlan()`.
5. **Work agent** works through tasks in DAG dependency order (`pan task next <issue>`). Item/subItem status updates are written to `.pan/continues/<issue>.xbrief.json`. `readWorkspacePlan()` returns a merged view with current statuses.
6. **Verification gate** checks all child items with `metadata.kind: "acceptance_criterion"` are `completed` before allowing review.
7. **Merge** updates `plan.status` to `completed` in the spec.
8. **Dashboard** renders the plan via the Directive Flow (DAG visualization) and xBRIEF viewer (List/DAG/Raw JSON tabs).

### Dashboard viewer

The dashboard exposes the same xBRIEF through three entry points:

- The kanban issue-card and InspectorPanel xBRIEF buttons open `XBriefDialog`.
- The project-tree issue row's xBRIEF resource chip opens `XBriefFullscreen`.
- The drawer Plan panel and cockpit `PlanMapCard` expand buttons open the same `XBriefFullscreen` instance.

`XBriefFullscreen` is mounted once in `App.tsx` and selected through `xbriefViewerIssueId` in the dashboard store. It reads the merged plan through `useWorkspacePlanQuery` and keeps the List, DAG, and Raw view switcher in the full-screen header. Entry points set the issue ID; they do not create new query keys, routes, or issue-view inventory sections.

### Plan Resolution (PAN-1124: single-spec-on-main)

`findPlan(workspacePath)` in `src/lib/xbrief/io.ts` resolves the canonical spec in `.pan/specs/` first via `findSpecByIssue(projectRoot, issueId)`. It derives the issue ID from the workspace directory name (`feature-<id>`) and the project root (two levels up), then falls back to the workspace compatibility copy documented in [Migration from vBRIEF](#migration-from-vbrief).

`readWorkspacePlan(workspacePath)` returns a merged view: canonical `.pan/specs/` spec + item status from `.pan/continues/<issue>.xbrief.json`. This is transparent to all callers.

`findXBriefByIssue(projectRoot, issueId)` in `lifecycle-io.ts` remains the canonical read-only lifecycle lookup for cross-issue queries.

Canonical continue files live at `.pan/continues/<issue-lowercase>.xbrief.json` in the project repo (or the configured plan-home repo for polyrepo projects), resolved via `pan_records.repo` in `projects.yaml` when set, else the project root. Workspace-side continue state at `<workspace>/.overdeck/continue.json` is separate, local session context (decisions, hazards, git state) — see [Workspace Continue State](#workspace-continue-state).

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
