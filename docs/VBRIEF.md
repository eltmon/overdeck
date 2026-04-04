# vBRIEF Plan Format

Panopticon uses [vBRIEF v0.5](https://github.com/visionik/vBRIEF) for machine-readable work plans.

## Specification

The canonical vBRIEF specification is maintained at **[github.com/visionik/vBRIEF](https://github.com/visionik/vBRIEF)**.

Panopticon's plan files (`plan.vbrief.json`) conform to this spec with metadata extensions for issue tracking and difficulty estimation.

## File Location

Plans live at `.planning/plan.vbrief.json` within each workspace (git worktree). They are workspace-specific and intentionally gitignored — they travel with the workspace, not the main branch.

## Required Format

Every `plan.vbrief.json` MUST have exactly two top-level keys per the vBRIEF spec:

```json
{
  "vBRIEFInfo": {
    "version": "0.5",
    "created": "2026-04-04T12:00:00Z"
  },
  "plan": {
    "id": "pan-436",
    "title": "Dashboard skeleton loading states",
    "status": "approved",
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

| Field | Required | Description |
|-------|----------|-------------|
| `vBRIEFInfo.version` | YES | Must be `"0.5"` |
| `vBRIEFInfo.created` | YES | ISO 8601 timestamp |
| `plan.id` | YES | Issue ID in lowercase (e.g., `"pan-436"`) |
| `plan.title` | YES | Human-readable plan title |
| `plan.status` | YES | One of: `draft`, `proposed`, `approved`, `pending`, `running`, `completed`, `blocked`, `cancelled` |
| `plan.items` | YES | Array of work items |
| `plan.edges` | NO | Dependency edges between items |
| `plan.tags` | NO | Tags for categorization |
| `plan.narratives` | NO | Problem/Proposal/Constraint/Risk narratives |

### Items (vBRIEF standard)

| Field | Required | Description |
|-------|----------|-------------|
| `id` | YES | Short kebab-case identifier |
| `title` | YES | Task title |
| `status` | YES | Same enum as plan.status |
| `narrative` | NO | `{ "Action": "what to do" }` |
| `subItems` | NO | Child items (used for acceptance criteria) |

### Panopticon Extensions (via `metadata`)

The vBRIEF spec supports arbitrary `metadata` on items and subItems. Panopticon uses these metadata fields:

| Field | Location | Description |
|-------|----------|-------------|
| `metadata.difficulty` | items | `trivial`, `simple`, `medium`, `complex`, `expert` — used for model routing |
| `metadata.issueLabel` | items | Issue ID for beads label filtering (e.g., `"pan-436"`) |
| `metadata.kind` | subItems | `"acceptance_criterion"` — marks subItem as an AC for verification gate |

These extensions are NOT part of the vBRIEF core spec. We've opened a feature request to standardize them:

**[vBRIEF Issue #XX: Support for difficulty, issue labels, and AC kind](https://github.com/visionik/vBRIEF/issues/XX)**

If you use Panopticon and want these fields standardized in the vBRIEF spec, please comment on that issue.

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

1. **Planning agent** creates `plan.vbrief.json` during the discovery session
2. **`complete-planning`** reads the plan and creates beads tasks from items
3. **Work agent** works through beads, updating item/subItem statuses to `completed`
4. **Verification gate** checks all subItems with `metadata.kind: "acceptance_criterion"` are `completed` before allowing review
5. **Dashboard DAG viewer** renders the plan as a dependency graph (PlanDAG component)
6. **Dashboard Tasks panel** shows beads with status from the plan

## Resilience

The `readPlan()` function in `src/lib/vbrief/io.ts` normalizes flat format plans to the canonical nested format for backwards compatibility. However, planning agents SHOULD always produce the canonical format. The normalizer handles:

- `issue`, `issueId`, `issue_id`, `id` → `plan.id`
- `description` → `narrative.Action`
- `difficulty` → `metadata.difficulty`
- `acceptance[]` (string array) → `subItems[]` with `metadata.kind: "acceptance_criterion"`
