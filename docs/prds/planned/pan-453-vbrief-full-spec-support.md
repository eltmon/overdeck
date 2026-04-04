# PAN-453: Full vBRIEF v0.5 Spec Support

## Problem

We use a subset of the vBRIEF v0.5 spec. Several standard fields are unsupported, and we want to demonstrate complete spec compliance to the Deft team. We also need to implement our metadata extensions properly and ensure the agent lifecycle updates the plan throughout.

## vBRIEF Spec Reference

- Spec repo: https://github.com/deftai/vBRIEF
- Schema: `vbrief-core.schema.json`
- Our fork (if needed): https://github.com/eltmon/vBRIEF
- Our extension proposal: https://github.com/deftai/vBRIEF/issues/1

## Fields to Implement

### vBRIEFInfo (envelope metadata)

| Field | Type | Currently | Action |
|-------|------|-----------|--------|
| `version` | `"0.5"` | ✅ Used | None |
| `created` | ISO datetime | ✅ Used | None |
| `author` | string | ❌ Not set | Set to `"panopticon-cli/<version>"` — who created the FILE |
| `description` | string | ❌ Not set | Set to `"Plan for <issue.identifier>: <issue.title>"` |
| `updated` | ISO datetime | ❌ Not set | Update on every write (item status change, AC update) |
| `metadata` | object | ❌ Not set | Optional — skip for now |

### Plan (top-level payload)

| Field | Type | Currently | Action |
|-------|------|-----------|--------|
| `id` | string | ✅ `issueLower` | None |
| `title` | string | ✅ Issue title | None |
| `status` | Status enum | ✅ `"approved"` | None |
| `items` | PlanItem[] | ✅ Used | None |
| `edges` | Edge[] | ✅ Used | None |
| `tags` | string[] | ✅ Used | None |
| `narratives` | object | ✅ Problem/Proposal | None |
| `uid` | string | ❌ Not set | Generate UUID v4 on creation |
| `author` | string | ❌ Not set | Set to `"agent:<model-id>"` — who created the PLAN (e.g., `"agent:claude-opus-4-6"`) |
| `sequence` | integer | ❌ Not set | Increment on every update (starts at 1) |
| `references` | VBriefReference[] | ❌ Not set | Planning agent populates from PRDs, specs, and issue URLs |
| `created` | ISO datetime | ❌ Not set | Set on plan creation |
| `updated` | ISO datetime | ❌ Not set | Update on every write |

### PlanItem (task items)

| Field | Type | Currently | Action |
|-------|------|-----------|--------|
| `id` | string | ✅ Used | None |
| `title` | string | ✅ Used | None |
| `status` | Status enum | ✅ Used | None |
| `narrative` | object | ✅ `Action` key | None |
| `subItems` | PlanItem[] | ✅ Used for AC | None |
| `metadata` | object | ✅ difficulty, issueLabel, kind | None |
| `priority` | enum | ❌ Not set | Planning agent can set: `low`, `medium`, `high`, `critical` |
| `created` | ISO datetime | ❌ Not set | Set when item is created |
| `completed` | ISO datetime | ❌ Not set | Set when status transitions to `completed` |

### VBriefReference (external references)

```typescript
interface VBriefReference {
  uri: string;     // e.g., "docs/prds/planned/pan-451.md", "https://github.com/eltmon/panopticon-cli/issues/451"
  label?: string;  // e.g., "PRD", "GitHub Issue", "Spec"
  type?: string;   // e.g., "prd", "issue", "spec"
}
```

Planning agent should populate `references` with:
- The PRD file if one exists in `docs/prds/` for this issue
- The GitHub/Linear issue URL
- Any spec files referenced during planning (from `docs/prds/active/*-spec.md`)

## Implementation

### Step 1: Update types.ts

Add missing fields to `VBriefDocument`, `VBriefPlan`, `VBriefItem`:

```typescript
export interface VBriefInfo {
  version: string;  // "0.5"
  author?: string;  // "panopticon-cli/0.6.0"
  description?: string;
  created?: string;  // ISO datetime
  updated?: string;
  metadata?: Record<string, unknown>;
}

export interface VBriefPlan {
  // existing...
  uid?: string;      // UUID v4
  author?: string;   // "agent:claude-opus-4-6"
  sequence?: number;  // increment on every update
  references?: VBriefReference[];
  created?: string;
  updated?: string;
}

export interface VBriefItem {
  // existing...
  priority?: VBriefPriority;  // already defined but not used
  created?: string;
  completed?: string;  // ISO datetime when marked completed
}

export interface VBriefReference {
  uri: string;
  label?: string;
  type?: string;
}
```

### Step 2: Update planning prompt (spawn-planning-session.ts)

Update the JSON template in `buildPlanningPrompt()` to include all new fields:

```json
{
  "vBRIEFInfo": {
    "version": "0.5",
    "author": "panopticon-cli/0.6.0",
    "description": "Plan for PAN-451: Conversation view",
    "created": "<ISO timestamp>"
  },
  "plan": {
    "id": "pan-451",
    "uid": "<UUID v4>",
    "title": "Conversation view — T3Code-style message rendering",
    "status": "approved",
    "author": "agent:claude-opus-4-6",
    "sequence": 1,
    "created": "<ISO timestamp>",
    "references": [
      { "uri": "docs/prds/planned/pan-451-conversation-view.md", "label": "PRD", "type": "prd" },
      { "uri": "https://github.com/eltmon/panopticon-cli/issues/451", "label": "GitHub Issue", "type": "issue" }
    ],
    "narratives": { "Problem": "...", "Proposal": "..." },
    "items": [...],
    "edges": [...]
  }
}
```

Tell the planning agent:
- Generate a UUID v4 for `plan.uid` (use `crypto.randomUUID()` or a simple generator)
- Set `plan.author` to the model being used
- Look for PRDs in `docs/prds/` matching the issue ID and add to `references`
- Add the issue URL to `references`
- Set `plan.created` to current ISO timestamp
- Set `items[].priority` based on difficulty/urgency assessment
- Set `items[].created` to current ISO timestamp

### Step 3: Update io.ts — updateItemStatus / updateSubItemStatus

When updating item status:
- Set `updated` on `vBRIEFInfo` and `plan`
- Increment `plan.sequence`
- If new status is `completed`, set `items[].completed` to current ISO timestamp

### Step 4: Update syncBeadStatusToVBrief (beads.ts)

When a bead closes and syncs to vBRIEF:
- Set `items[].completed` timestamp
- Increment `plan.sequence`
- Update `plan.updated` and `vBRIEFInfo.updated`

### Step 5: Planning agent populates references

In `buildPlanningPrompt()`, provide the agent with discoverable references:
- Scan `docs/prds/` for files matching the issue ID
- Include the issue URL from the `PlanningIssue` object
- Tell the agent to include these in `plan.references`

### Step 6: Update all Panopticon documentation with vBRIEF references

**docs/VBRIEF.md** — Add the new fields to the documentation with examples.

**CLAUDE.md** — Add a section referencing vBRIEF:
```
## vBRIEF Plan Format

Panopticon uses vBRIEF v0.5 for machine-readable work plans.
See [docs/VBRIEF.md](docs/VBRIEF.md) for the full spec reference.

- Canonical spec: https://github.com/deftai/vBRIEF (by Deft.co)
- Our extensions proposal: https://github.com/deftai/vBRIEF/issues/1
- Our fork (for extensions ahead of upstream): https://github.com/eltmon/vBRIEF
- Plans live at `.planning/plan.vbrief.json` in each workspace
- Copied to `docs/prds/active/<ISSUE>-plan.vbrief.json` on planning completion
```

**docs/INDEX.md** — Already has VBRIEF.md reference (added today).

**README.md** — Add vBRIEF to the "Built With" or "Standards" section if one exists. Reference the upstream deftai/vBRIEF repo as the canonical spec. Note that Panopticon is a reference implementation of vBRIEF for multi-agent orchestration.

**Key principle:** Always reference `deftai/vBRIEF` as the canonical spec. Our fork at `eltmon/vBRIEF` is only mentioned as a fallback for extensions that haven't been accepted upstream yet. We aim to stay compatible with the upstream spec — fork only if we must break compatibility for functionality.

### Step 7: Harden complete-planning — auto-copy artifacts to docs/prds/active/

The `complete-planning` endpoint (`src/dashboard/server/routes/issues.ts`) should automatically copy planning artifacts to `docs/prds/active/` so they're committed to the repo. Currently agents are told to do this manually but many skip it.

**On complete-planning, Panopticon itself should copy:**

1. `.planning/STATE.md` → `docs/prds/active/<ISSUE-ID>-plan.md`
2. `.planning/plan.vbrief.json` → `docs/prds/active/<ISSUE-ID>-plan.vbrief.json`

**On start-planning, if a PRD already exists, copy it INTO the workspace:**

3. `docs/prds/planned/<issue-id>*.md` → `.planning/prd.md` (so the planning agent has it locally)

This ensures:
- PRDs written before planning are available to the planning agent in the workspace
- Planning artifacts (STATE.md + vBRIEF) are always preserved in git after completion
- No reliance on agents remembering to copy files

### Step 8: Planning agent should discover and reference existing PRDs

In `buildPlanningPrompt()`, scan for existing PRDs before generating the prompt:

```typescript
// Scan for PRDs matching this issue
const prdDirs = [
  join(projectPath, 'docs', 'prds', 'planned'),
  join(projectPath, 'docs', 'prds', 'active'),
];
const prdFiles: string[] = [];
for (const dir of prdDirs) {
  if (existsSync(dir)) {
    for (const file of readdirSync(dir)) {
      if (file.toLowerCase().includes(issueLower) && file.endsWith('.md')) {
        prdFiles.push(join(dir, file));
      }
    }
  }
}
```

If PRDs are found:
- Copy them to `.planning/` in the workspace
- Include their paths in the planning prompt so the agent reads them
- Tell the agent to add them to `plan.references`

## Files Changed

| File | Action |
|------|--------|
| `src/lib/vbrief/types.ts` | Add `uid`, `author`, `sequence`, `references`, `created`, `updated`, `completed`, `priority` |
| `src/lib/vbrief/io.ts` | Update `updateItemStatus`/`updateSubItemStatus` to set timestamps + sequence |
| `src/lib/vbrief/beads.ts` | Update `syncBeadStatusToVBrief` to set `completed` timestamp + sequence |
| `src/lib/planning/spawn-planning-session.ts` | Update prompt template with all new fields + PRD discovery |
| `src/dashboard/server/routes/issues.ts` | `complete-planning`: auto-copy STATE.md + vbrief to docs/prds/active/ |
| `src/dashboard/server/routes/issues.ts` | `start-planning`: copy existing PRDs into workspace .planning/ |
| `docs/VBRIEF.md` | Document new fields |

## Testing

```
tests/vbrief/full-spec.test.ts
  - readPlan validates vBRIEFInfo.version is "0.5"
  - readPlan preserves uid, author, sequence, references
  - updateItemStatus increments sequence
  - updateItemStatus sets plan.updated and vBRIEFInfo.updated
  - updateItemStatus sets completed timestamp when status → completed
  - updateSubItemStatus sets completed timestamp on AC
  - syncBeadStatusToVBrief increments sequence
  - Planning prompt includes uid, author, references template
  - References include PRD when found in docs/prds/
  - References include issue URL

tests/integration/complete-planning.test.ts
  - complete-planning copies STATE.md to docs/prds/active/<ISSUE>-plan.md
  - complete-planning copies plan.vbrief.json to docs/prds/active/<ISSUE>-plan.vbrief.json
  - complete-planning does not overwrite existing plan in docs/prds/active/
  - complete-planning handles missing STATE.md gracefully
  - complete-planning handles missing plan.vbrief.json gracefully

tests/integration/start-planning.test.ts
  - start-planning copies PRD from docs/prds/planned/ to workspace .planning/
  - start-planning copies PRD from docs/prds/active/ to workspace .planning/
  - start-planning prompt includes PRD path when found
  - start-planning works when no PRD exists
```

## Notes

- `plan.uid` is a UUID v4 generated once at creation — never changes
- `plan.sequence` starts at 1 and increments on every write — useful for conflict detection
- `vBRIEFInfo.author` is the tool (`"panopticon-cli/0.6.0"`), `plan.author` is the agent (`"agent:claude-opus-4-6"`)
- `items[].completed` is set when status transitions to `completed` — not cleared if status reverts
- `references` is populated by the planning agent, not Panopticon itself (agent has context about what it referenced)
- Artifact copying in complete-planning is idempotent — won't overwrite if files already exist in docs/prds/active/
- PRD discovery in start-planning searches both `planned/` and `active/` directories
