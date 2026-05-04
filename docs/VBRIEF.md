# vBRIEF Plan Format & Lifecycle

Panopticon uses [vBRIEF v0.5](https://github.com/deftai/vBRIEF) for machine-readable work plans with a filesystem-as-state lifecycle model adapted from [deft](https://github.com/deftai/deft).

## Specification

The canonical vBRIEF specification is maintained at **[github.com/deftai/vBRIEF](https://github.com/deftai/vBRIEF)**.

Panopticon's vBRIEF files conform to the v0.5 spec with metadata extensions for issue tracking and difficulty estimation. We also maintain a [fork of the spec](https://github.com/eltmon/vBRIEF) and have an open [extension proposal](https://github.com/deftai/vBRIEF/issues/1).

---

## Lifecycle Model

Scope vBRIEFs are durable, first-class source-of-truth artifacts that live in the project repository under `vbrief/`. They move between lifecycle directories as work progresses — the filesystem IS the state.

### Lifecycle Directories

```
<project-root>/
└── vbrief/
    ├── proposed/     Planning complete, awaiting approval
    ├── active/       Agent is working on it
    ├── completed/    Merged/closed, immutable archive
    └── cancelled/    Abandoned, immutable archive
```

Each directory acts as a status bucket. Moving a file between directories IS the status transition — there is no separate database or state store.

### Status Transitions

```
                    ┌──────────────────────────────────┐
                    │          pan scope restore        │
                    ▼                                   │
  draft ──► proposed ──► active ──► completed ─────────┘
    (planning)  (approve)  (merge)      │
                    │                    │
                    │    ┌───────────────┘
                    ▼    ▼    pan scope restore
                 cancelled ────────────────► active
```

| Transition | Trigger | Commit Message |
|------------|---------|----------------|
| `draft` → `proposed` | Planning completes (`complete-planning`) | `scope: propose <ID> vBRIEF` |
| `proposed` → `active` | Agent starts (`pan start`) | `scope: approve <ID> vBRIEF` |
| `active` → `completed` | PR merges (`postMergeLifecycle`) | `scope: complete <ID> vBRIEF` |
| `active` → `cancelled` | Issue closed/cancelled | `scope: cancel <ID> vBRIEF` |
| `completed/cancelled` → `active` | Manual restore (`pan scope restore`) | `scope: approve <ID> vBRIEF` |

All transitions commit on main via `transitionVBriefOnMain()`, which is idempotent and branch-aware (only commits when the project root is on main).

### Issue-Keyed Filenames

Format: `YYYY-MM-DD-<ISSUE-ID>-<slug>.vbrief.json`

Example: `2026-04-28-MIN-846-fizzy-master.vbrief.json`

| Component | Source | Immutable? |
|-----------|--------|------------|
| Date (`YYYY-MM-DD`) | UTC creation date | Yes — never changes when file moves between dirs |
| Issue ID | From `plan.id` (e.g. `PAN-946`, `MIN-846`) | Yes |
| Slug | `slugify(plan.title)` — lowercase, dashes, max readability | Yes |

The filename regex: `^(\d{4}-\d{2}-\d{2})-([A-Za-z][A-Za-z0-9]*-\d+)-([a-z0-9-]+)\.vbrief\.json$`

If `slugify()` receives an empty or all-special-character title, it returns `'plan'` as the slug.

---

## Continue State — Structured Session History

The continue file replaces `STATE.md` as the structured, machine-readable operational state for in-progress work. It lives alongside the scope vBRIEF in the same lifecycle directory.

### File Location

`continue-<issueId>.vbrief.json` — e.g. `vbrief/active/continue-PAN-714.vbrief.json`

The scope vBRIEF stays clean ("here's what we're building"). The continue file is the living session history.

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
| `continueFilename()` | `continue-state.ts` | Build `continue-<issueId>.vbrief.json` |

---

## Required Format

Every `plan.vbrief.json` has exactly two top-level keys per the vBRIEF spec:

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
      { "uri": "docs/prds/active/PAN-436-plan.md", "label": "PAN-436-plan.md", "type": "prd" }
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

| Status | Lifecycle Dir | Meaning |
|--------|---------------|---------|
| `draft` | `.planning/` (workspace) | Planning in progress |
| `proposed` | `vbrief/proposed/` | Planning done, awaiting approval |
| `approved` | `vbrief/active/` | User approved, ready to start |
| `pending` | `vbrief/active/` | Queued, waiting for resources |
| `running` | `vbrief/active/` | Agent is executing |
| `completed` | `vbrief/completed/` | Work done, merged |
| `blocked` | `vbrief/active/` | Waiting on external dependency |
| `cancelled` | `vbrief/cancelled/` | Abandoned |

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

Manual lifecycle transition overrides for vBRIEFs. All commands resolve the project from the issue ID and use `transitionVBriefOnMain()` for atomic transitions.

| Command | Effect |
|---------|--------|
| `pan scope list` | Scan all lifecycle dirs across all projects, print issue ID / title / status / dir |
| `pan scope show <issueId>` | Display title, lifecycle dir, status, sequence, file path, item count |
| `pan scope propose <issueId>` | Move to `proposed/`, set `plan.status` to `proposed` |
| `pan scope approve <issueId>` | Move to `active/`, set `plan.status` to `approved` |
| `pan scope complete <issueId>` | Move to `completed/`, set `plan.status` to `completed` |
| `pan scope cancel <issueId>` | Move to `cancelled/`, set `plan.status` to `cancelled` |
| `pan scope restore <issueId>` | Move from `completed/` or `cancelled/` back to `active/`, set `plan.status` to `approved` |

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

1. **Planning agent** creates `plan.vbrief.json` during the discovery session in `.planning/`. Injects `vBRIEFInfo.author`, `plan.uid`, `plan.author`, `plan.sequence: 1`, and `plan.references`.
2. **`complete-planning`** promotes the vBRIEF to `vbrief/proposed/` with an issue-keyed filename and sets `plan.status` to `proposed`.
3. **`pan start`** transitions the vBRIEF from `proposed/` to `active/` and sets `plan.status` to `approved`, then `running`.
4. **Work agent** works through beads, updating item/subItem statuses. Each write increments `plan.sequence` and updates timestamps.
5. **Verification gate** checks all subItems with `metadata.kind: "acceptance_criterion"` are `completed` before allowing review.
6. **`postMergeLifecycle`** transitions the vBRIEF from `active/` to `completed/` on main.
7. **Dashboard vBRIEF viewer** (`VBriefViewer`) renders the plan with List/DAG/Raw JSON tabs — accessible via the vBRIEF button on kanban cards and in InspectorPanel.

### Plan Resolution

`findPlan()` in `src/lib/vbrief/io.ts` resolves vBRIEFs with this priority:

1. Check lifecycle dirs on project root via `findVBriefByIssue()` (proposed → active → completed → cancelled)
2. Fall back to workspace `.planning/plan.vbrief.json` (for in-progress planning before promotion)

All callers (`readWorkspacePlan`, task-readiness checks, beads sync, work-agent-prompt injection) inherit this transparently.

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

### Legacy Compatibility

- `isPlanningComplete()` checks `plan.status` first, falling back to the `.planning-complete` marker for vBRIEFs created before the lifecycle model
- `vbrief/completed/` contains both legacy `archive-<issue-id>/` directories (STATE.md + feedback) and new issue-keyed vBRIEF files

---

## Divergence from deft

Panopticon adapts deft's lifecycle model for multi-agent, multi-issue orchestration:

| deft Constraint | Panopticon Divergence |
|-----------------|----------------------|
| One `plan.vbrief.json` per project | N concurrent vBRIEFs per project (one per issue) |
| Serialized changes | N agents on N issues in parallel, each in its own workspace |
| `history/changes/` folder structure | Issue-keyed filenames in lifecycle dirs |
| `specification.vbrief.json` required | Optional (exists in repo but not enforced) |
| `playbook-{name}.vbrief.json` | Panopticon uses skills for this |

The vBRIEF format itself works without modification — it's the single-plan-per-project constraint that Panopticon relaxes.
