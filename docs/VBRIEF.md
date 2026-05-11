# vBRIEF Plan Format & Lifecycle

Panopticon uses [vBRIEF v0.5](https://github.com/deftai/vBRIEF) for machine-readable work plans with a unified `.pan/` directory model (PAN-967).

## Specification

The canonical vBRIEF specification is maintained at **[github.com/deftai/vBRIEF](https://github.com/deftai/vBRIEF)**.

Panopticon's vBRIEF files conform to the v0.5 spec with metadata extensions for issue tracking and difficulty estimation. We also maintain a [fork of the spec](https://github.com/eltmon/vBRIEF) and have an open [extension proposal](https://github.com/deftai/vBRIEF/issues/1).

---

## Lifecycle Model

### Directory Structure

All Panopticon orchestration state lives under `.pan/` — a single dot-directory at the project root (same convention as `.git/`, `.github/`, `.beads/`).

#### On main (project root):

```
.pan/
  specs/
    2026-05-01-PAN-950-feature-x.vbrief.json     (status: "completed")
    2026-05-03-PAN-960-feature-y.vbrief.json     (status: "active")
    2026-05-05-PAN-969-directive-flow.vbrief.json (status: "proposed")
  drafts/
    PAN-970-next-thing.md                         (PRD being refined)
```

#### On feature branch (workspace):

```
.pan/
  spec.vbrief.json          ← this issue's scope vBRIEF (copied from main at branch creation)
  continue.json             ← session state (resume point, decisions, hazards)
  sessions.jsonl            ← append-only session history
  feedback/
    001-review-changes-requested.md
    002-test-failures.md
  context.md                ← FEATURE-CONTEXT for Rally story agents
```

### PRD → Spec Lifecycle

PRDs and vBRIEFs are distinct artifacts that flow through the same pipeline:

1. **PRD drafted** — human or planning agent writes a markdown PRD to `.pan/drafts/` on main
2. **Planning completes** — planning agent converts the PRD into a machine-readable vBRIEF spec in `.pan/specs/` with `status: "proposed"`
3. **Work starts** — `pan start` updates the spec's `status` field to `"active"` and copies it to the workspace as `.pan/spec.vbrief.json`
4. **Work completes** — after merge, `status` updated to `"completed"` on main

### Status Transitions (field-based)

Status is a JSON field inside the vBRIEF — files never move between directories. All transitions are single atomic commits on main.

```
draft ──► proposed ──► active ──► completed
                 │                    │
                 └──► cancelled ◄─────┘
```

| Transition | Trigger | What happens |
|-----------|---------|--------------|
| (new) → draft | `pan plan` starts | PRD written to `.pan/drafts/` on main |
| draft → proposed | Planning completes | vBRIEF created in `.pan/specs/` with `status: "proposed"` |
| proposed → active | `pan start` | Status field updated to `"active"`, spec copied to workspace `.pan/spec.vbrief.json` |
| active → completed | PR merges | Status field updated to `"completed"` on main |
| active → cancelled | Issue closed | Status field updated to `"cancelled"` on main |

### Issue-Keyed Filenames

Format: `YYYY-MM-DD-<ISSUE-ID>-<slug>.vbrief.json`

Example: `2026-04-28-MIN-846-fizzy-master.vbrief.json`

| Component | Source | Immutable? |
|-----------|--------|------------|
| Date (`YYYY-MM-DD`) | UTC creation date | Yes — never changes |
| Issue ID | From `plan.id` (e.g. `PAN-946`, `MIN-846`) | Yes |
| Slug | `slugify(plan.title)` — lowercase, dashes, max readability | Yes |

The filename regex: `^(\d{4}-\d{2}-\d{2})-([A-Za-z][A-Za-z0-9]*-\d+)-([a-z0-9-]+)\.vbrief\.json$`

If `slugify()` receives an empty or all-special-character title, it returns `'plan'` as the slug.

### Workspace Spec

On the feature branch, the spec is a single file: `.pan/spec.vbrief.json`. This is a copy of the canonical spec from `.pan/specs/` on main, made at branch creation time. The agent reads and updates item statuses in this file during work. It never needs to know the issue-keyed filename — that's a main-branch concern.

### Concurrency Model

| Resource | Writer | Readers | Contention |
|----------|--------|---------|------------|
| `.pan/specs/<file>` on main | Pipeline only | Dashboard, agents (via prompt injection) | None — single writer |
| `.pan/spec.vbrief.json` on branch | Work agent (one per issue) | Pipeline, dashboard | None — one agent per workspace |
| `.pan/continue.json` on branch | Pipeline only | Agent (injected into prompt at session start) | None — single writer |
| `.pan/sessions.jsonl` on branch | Pipeline appends | Dashboard, post-mortems | Minimal — append-only |
| `.pan/feedback/*.md` on branch | Pipeline only | Agent (injected into prompt) | None — single writer |
| Beads (`.beads/`) | Each agent via `bd update` | Pipeline, dashboard | Serialized by Dolt mutex |

For N parallel agents on N different issues: each has its own feature branch with its own `.pan/` directory. Zero cross-agent contention. Beads writes serialize through the Dolt mutex but target different bead IDs.

---

## Continue State — Structured Session History

The continue file is the machine-readable operational state for in-progress work. It lives on the feature branch at `.pan/continue.json`.

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
    "beadId": "ws-reconnect",
    "filesToRead": ["src/dashboard/server/ws-rpc.ts"]
  },
  "beadsMapping": {
    "ws-reconnect": ["bead-42"],
    "ws-reconnect.ac1": ["bead-42"]
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

Every vBRIEF has exactly two top-level keys per the vBRIEF spec:

```json
{
  "vBRIEFInfo": {
    "version": "0.5",
    "created": "2026-04-04T12:00:00Z",
    "author": "panopticon-cli/0.6.0",
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
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/436", "label": "PAN-436", "type": "issue" },
      { "uri": ".pan/drafts/PAN-436.md", "label": "PAN-436 PRD draft", "type": "prd" }
    ],
    "tags": ["frontend", "ux"],
    "narratives": {
      "Problem": "Dashboard shows zeros on load — no loading indicators",
      "Proposal": "BootstrapGate wrapper + shimmer skeleton components"
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
          "issueLabel": "pan-436"
        },
        "narrative": {
          "Action": "Component that checks selectIsBootstrapped and renders fallback or children"
        },
        "subItems": [
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

### Top-Level (vBRIEF standard)

#### `vBRIEFInfo` fields

| Field | Required | Description |
|-------|----------|-------------|
| `vBRIEFInfo.version` | YES | Must be `"0.5"` |
| `vBRIEFInfo.created` | YES | ISO 8601 timestamp — when the document was created |
| `vBRIEFInfo.updated` | NO | ISO 8601 timestamp — updated automatically on every write |
| `vBRIEFInfo.author` | NO | Tool identifier, e.g. `"panopticon-cli/0.6.0"` |
| `vBRIEFInfo.description` | NO | Human-readable description: `"Plan for PAN-436: ..."` |

#### `plan` fields

| Field | Required | Description |
|-------|----------|-------------|
| `plan.id` | YES | Issue ID in lowercase (e.g., `"pan-436"`) |
| `plan.title` | YES | Human-readable plan title |
| `plan.status` | YES | One of: `draft`, `proposed`, `approved`, `pending`, `running`, `completed`, `blocked`, `cancelled` |
| `plan.items` | YES | Array of work items |
| `plan.edges` | NO | Dependency edges between items |
| `plan.uid` | NO | UUID v4, generated once at creation — stable identifier for the plan |
| `plan.author` | NO | Who created the plan, e.g. `"agent:claude-opus-4-6"` |
| `plan.sequence` | NO | Monotonically incrementing write counter (starts at 1, auto-incremented by io.ts) |
| `plan.references` | NO | External links — see [References](#references) |
| `plan.created` | NO | ISO 8601 timestamp — when the plan was first created |
| `plan.updated` | NO | ISO 8601 timestamp — updated automatically on every status write |
| `plan.tags` | NO | Tags for categorization |
| `plan.narratives` | NO | Problem/Proposal/Constraint/Risk narratives |

#### `plan.status` Enum

The `plan.status` field drives lifecycle transitions:

| Status | Location | Meaning |
|--------|----------|---------|
| `draft` | `.pan/drafts/` (PRD stage) | Planning in progress |
| `proposed` | `.pan/specs/` | Planning done, awaiting approval |
| `approved` | `.pan/specs/` + workspace `.pan/spec.vbrief.json` | User approved, ready to start |
| `pending` | `.pan/specs/` | Queued, waiting for resources |
| `running` | `.pan/specs/` | Agent is executing |
| `completed` | `.pan/specs/` | Work done, merged |
| `blocked` | `.pan/specs/` | Waiting on external dependency |
| `cancelled` | `.pan/specs/` | Abandoned |

#### References

`plan.references` is an array of `VBriefReference` objects:

| Field | Required | Description |
|-------|----------|-------------|
| `uri` | YES | URL or path to the referenced resource |
| `label` | NO | Human-readable label (e.g., `"PAN-436"`) |
| `type` | NO | Resource type: `"issue"`, `"prd"`, `"spec"`, `"doc"` |

### Items (vBRIEF standard)

| Field | Required | Description |
|-------|----------|-------------|
| `id` | YES | Short kebab-case identifier |
| `title` | YES | Task title |
| `status` | YES | Same enum as plan.status |
| `priority` | NO | `critical`, `high`, `medium`, `low` |
| `created` | NO | ISO 8601 timestamp — when the item was created |
| `completed` | NO | ISO 8601 timestamp — set automatically when status → `completed` |
| `narrative` | NO | `{ "Action": "what to do" }` |
| `subItems` | NO | Child items (used for acceptance criteria) |

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

Only `blocks` edges are used for critical path computation and bead scheduling (`bd ready`).

### Panopticon Extensions (via `metadata`)

The vBRIEF spec supports arbitrary `metadata` on items and subItems. Panopticon uses these metadata fields:

| Field | Location | Description |
|-------|----------|-------------|
| `metadata.difficulty` | items | `trivial`, `simple`, `medium`, `complex`, `expert` — used for model routing |
| `metadata.issueLabel` | items | Issue ID for beads label filtering (e.g., `"pan-436"`) |
| `metadata.kind` | subItems | `"acceptance_criterion"` — marks subItem as an AC for verification gate |
| `metadata.canonicalFilename` | plan | Preserves the immutable filename across re-finalizations |

These extensions are NOT part of the vBRIEF core spec. We've opened a feature request to standardize them: **[deftai/vBRIEF#1](https://github.com/deftai/vBRIEF/issues/1)**.

---

## `pan scope` Commands

Manual lifecycle transition overrides for vBRIEFs. All commands resolve the project from the issue ID and update the status field in `.pan/specs/` on main.

| Command | Effect |
|---------|--------|
| `pan scope list` | Scan `.pan/specs/` across all projects, print issue ID / title / status |
| `pan scope show <issueId>` | Display title, status, sequence, file path, item count |
| `pan scope propose <issueId>` | Set `plan.status` to `proposed` |
| `pan scope approve <issueId>` | Set `plan.status` to `approved` |
| `pan scope complete <issueId>` | Set `plan.status` to `completed` |
| `pan scope cancel <issueId>` | Set `plan.status` to `cancelled` |
| `pan scope restore <issueId>` | Set `plan.status` to `approved` (from completed or cancelled) |

### Planned (PAN-958)

- `pan scope ingest` — Import an existing vBRIEF or PRD into the lifecycle as a `proposed` scope
- `pan scope reconcile` — Detect and fix state disagreements between vBRIEFs, tracker, and workspaces

---

## `pan sync` vBRIEF Disagreement Detection

`pan sync` detects state disagreements between the vBRIEF lifecycle, issue tracker, and workspace state:

| Check | Meaning | Suggested Fix |
|-------|---------|---------------|
| Active vBRIEF but GitHub issue is closed | Work artifact out of sync with tracker | `pan scope complete <ID>` or `pan scope cancel <ID>` |
| Completed vBRIEF but workspace still exists | Stale workspace after merge | Clean up workspace |
| Workspace exists but no active vBRIEF | Missing lifecycle entry | `pan scope approve <ID>` |

---

## How Panopticon Uses vBRIEF

1. **PRD authored** — human or planning agent writes a PRD to `.pan/drafts/` on main.
2. **Planning agent** converts the PRD into a vBRIEF spec during the discovery session. Creates `plan.vbrief.json` in the workspace `.pan/` directory.
3. **`complete-planning`** promotes the vBRIEF to `.pan/specs/` on main with an issue-keyed filename and sets `plan.status` to `proposed`.
4. **`pan start`** updates `plan.status` to `active` on main and copies the spec to the workspace as `.pan/spec.vbrief.json`.
5. **Work agent** works through beads in DAG dependency order (`bd ready -l <issue>`). Updates item/subItem statuses in `.pan/spec.vbrief.json` as beads are completed. Each write increments `plan.sequence` and updates timestamps.
6. **Verification gate** checks all subItems with `metadata.kind: "acceptance_criterion"` are `completed` before allowing review.
7. **`postMergeLifecycle`** updates `plan.status` to `completed` in `.pan/specs/` on main.
8. **Dashboard** renders the plan via the Directive Flow (DAG visualization) and vBRIEF viewer (List/DAG/Raw JSON tabs).

### Plan Resolution

Two functions, two surfaces — do not conflate them (PAN-946):

| Function | Module | Returns | Side effects |
| --- | --- | --- | --- |
| `findPlan(workspacePath)` | `src/lib/vbrief/io.ts` | The workspace-local `.pan/spec.vbrief.json` path or `null` | None. Workspace-only. Used by every workspace mutation helper. |
| `findVBriefByIssue(projectRoot, issueId)` | `src/lib/vbrief/lifecycle-io.ts` | The canonical spec from `.pan/specs/` (with legacy `vbrief/<lifecycle>/` fallback) | Read-only. Used by dashboard, start-agent's PRD-import path, and any cross-issue lookup. |

Workspace progress writes that "fall through" to the lifecycle directories are a bug we already paid the high-sev tax to fix — keep the two surfaces separated.

### Backward Compatibility

`.planning/plan.vbrief.json` was retired in PAN-967 and is no longer read or written anywhere — workspaces created against current `main` use `.pan/spec.vbrief.json` exclusively.

The legacy `vbrief/{proposed,active,completed,cancelled}/` lifecycle directories at the project root are still read by `findLegacyVBriefByIssue` so in-flight work from before the cutover keeps resolving. All writes target `.pan/specs/` only, and lifecycle status changes are atomic field flips on a single file — files do NOT move between directories.

Continue files on the main side (`vbrief/active/continue-<issue>.vbrief.json`) remain in place until the continue-state migration phase. Workspace-side continue state has already moved to `<workspace>/.pan/continue.json`.

---

## Common Mistakes

**DO NOT** use flat format:
```json
// WRONG — missing vBRIEFInfo, plan wrapper
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
  "vBRIEFInfo": { "version": "0.5", "created": "..." },
  "plan": { "id": "pan-436", ... }
}
```

---

## Resilience

The `readPlan()` function in `src/lib/vbrief/io.ts` normalizes flat format plans to the canonical nested format for backwards compatibility. The normalizer handles:

- `issue`, `issueId`, `issue_id`, `id` → `plan.id`
- `description` → `narrative.Action`
- `difficulty` → `metadata.difficulty`
- `acceptance[]` (string array) → `subItems[]` with `metadata.kind: "acceptance_criterion"`

---

## Divergence from deft

Panopticon adapts deft's lifecycle model for multi-agent, multi-issue orchestration:

| deft Constraint | Panopticon Divergence |
|-----------------|----------------------|
| One `plan.vbrief.json` per project | N concurrent vBRIEFs per project (one per issue) |
| Serialized changes | N agents on N issues in parallel, each in its own workspace |
| `history/changes/` folder structure | Issue-keyed filenames in `.pan/specs/` |
| Status = directory location | Status = JSON field (files never move) |
| `specification.vbrief.json` required | Optional (exists in repo but not enforced) |
| `playbook-{name}.vbrief.json` | Panopticon uses skills for this |

The vBRIEF format itself works without modification — it's the single-plan-per-project constraint that Panopticon relaxes.
