# vBRIEF Plan Format

Panopticon uses [vBRIEF v0.5](https://github.com/deftai/vBRIEF) for machine-readable work plans.

## Specification

The canonical vBRIEF specification is maintained at **[github.com/deftai/vBRIEF](https://github.com/deftai/vBRIEF)**.

Panopticon's plan files (`plan.vbrief.json`) conform to this spec with metadata extensions for issue tracking and difficulty estimation.

## File Location

Plans live at `.planning/plan.vbrief.json` within each workspace (git worktree). They are workspace-specific and intentionally gitignored — they travel with the workspace, not the main branch.

## Required Format

Every `plan.vbrief.json` MUST have exactly two top-level keys per the vBRIEF spec:

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

#### References

`plan.references` is an array of `VBriefReference` objects:

| Field | Required | Description |
|-------|----------|-------------|
| `uri` | YES | URL or path to the referenced resource |
| `label` | NO | Human-readable label (e.g., `"PAN-436"`) |
| `type` | NO | Resource type: `"issue"`, `"prd"`, `"spec"`, `"doc"` |

Example:
```json
"references": [
  { "uri": "https://github.com/org/repo/issues/436", "label": "PAN-436", "type": "issue" },
  { "uri": "docs/prds/active/PAN-436-plan.md", "label": "PAN-436-plan.md", "type": "prd" }
]
```

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

#### SubItem timestamps

| Field | Description |
|-------|-------------|
| `subItem.created` | ISO 8601 timestamp — when the subItem was created |
| `subItem.completed` | ISO 8601 timestamp — set automatically when status → `completed` |

### Panopticon Extensions (via `metadata`)

The vBRIEF spec supports arbitrary `metadata` on items and subItems. Panopticon uses these metadata fields:

| Field | Location | Description |
|-------|----------|-------------|
| `metadata.difficulty` | items | `trivial`, `simple`, `medium`, `complex`, `expert` — used for model routing |
| `metadata.issueLabel` | items | Issue ID for beads label filtering (e.g., `"pan-436"`) |
| `metadata.kind` | subItems | `"acceptance_criterion"` — marks subItem as an AC for verification gate |

These extensions are NOT part of the vBRIEF core spec. We've opened a feature request to standardize them as first-class fields:

**[deftai/vBRIEF#1: Proposal: add difficulty, issueRef, and kind fields to PlanItem](https://github.com/deftai/vBRIEF/issues/1)**

If you use Panopticon and want these fields standardized in the vBRIEF spec, please comment on that issue. Until they're accepted, we use `metadata` as the workaround per vBRIEF Section 2.1's unknown-field preservation rule.

We also maintain a [fork of the vBRIEF spec](https://github.com/eltmon/vBRIEF) in case we need to extend the schema before upstream adoption.

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

## How Panopticon Uses vBRIEF

1. **Planning agent** creates `plan.vbrief.json` during the discovery session. The planning prompt injects `vBRIEFInfo.author` (tool identifier), `plan.uid` (UUID v4), `plan.author` (agent model), `plan.sequence: 1`, and `plan.references` (issue URL + discovered PRDs).
2. **`complete-planning`** reads the plan and creates beads tasks from items. Copies `STATE.md` and `plan.vbrief.json` to `docs/prds/active/` (skip if exists).
3. **Work agent** works through beads, updating item/subItem statuses to `completed`. Each write increments `plan.sequence` and updates `vBRIEFInfo.updated` and `plan.updated`.
4. **Verification gate** checks all subItems with `metadata.kind: "acceptance_criterion"` are `completed` before allowing review.
5. **Dashboard vBRIEF viewer** (`VBriefViewer`) renders the plan with List/DAG/Raw JSON tabs — accessible via the vBRIEF button on kanban cards and in InspectorPanel.
6. **Dashboard DAG viewer** renders the plan as a dependency graph (PlanDAG component).
7. **Dashboard Tasks panel** shows beads with status from the plan.

## Resilience

The `readPlan()` function in `src/lib/vbrief/io.ts` normalizes flat format plans to the canonical nested format for backwards compatibility. However, planning agents SHOULD always produce the canonical format. The normalizer handles:

- `issue`, `issueId`, `issue_id`, `id` → `plan.id`
- `description` → `narrative.Action`
- `difficulty` → `metadata.difficulty`
- `acceptance[]` (string array) → `subItems[]` with `metadata.kind: "acceptance_criterion"`
