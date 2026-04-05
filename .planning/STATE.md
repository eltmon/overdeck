# PAN-453: Full vBRIEF v0.5 Spec Support

## Status: Planning Complete

## Problem

Panopticon uses ~40% of the vBRIEF v0.5 spec. Several fields are missing: `uid`, `author` (both vBRIEFInfo and plan levels), `sequence`, `references`, `created/updated/completed` timestamps, and `priority` on items. We want full spec compliance for the Deft team conversation and better audit trail.

## Decisions

### 1. Viewer in scope
The full VBriefViewer UI (6+ React components) is part of this issue. Single deliverable, no phasing.

### 2. Model injection for plan.author
The planning model is resolved from settings (`agentSettings.models.planning_agent` → fallback to `complexity.expert` → `claude-opus-4-6`). We pass the resolved `planningModel` into `buildPlanningPrompt()` so it can be injected into the template as `plan.author`. We do NOT trust models to self-report (Kimi reports as other models).

### 3. vBRIEFInfo.author from package.json
`vBRIEFInfo.author` is the tool identifier: `"panopticon-cli/0.6.0"`. Version comes from `package.json` at runtime.

### 4. Artifact copy: skip if exists
`complete-planning` copies STATE.md and plan.vbrief.json to `docs/prds/active/` but does NOT overwrite existing files. Protects manually edited plans.

### 5. Testing approach
Use existing Vitest + React Testing Library setup for all tests. Follow existing patterns.

## Architecture

### Type changes (types.ts)

Add to `VBriefDocument.vBRIEFInfo`:
- `author?: string` — tool identifier ("panopticon-cli/0.6.0")
- `description?: string` — "Plan for PAN-453: ..."
- `metadata?: Record<string, unknown>` — optional, skip for now

Add to `VBriefPlan`:
- `uid?: string` — UUID v4, generated once at creation
- `sequence?: number` — starts at 1, increments on every write
- `references?: VBriefReference[]` — links to PRDs, issues, specs
- `created?: string` — ISO datetime, set on creation
- `updated?: string` — ISO datetime, updated on every write

Add to `VBriefItem`:
- `created?: string` — ISO datetime, set when item created
- `completed?: string` — ISO datetime, set when status → completed

Add to `VBriefSubItem`:
- `created?: string` — ISO datetime
- `completed?: string` — ISO datetime

New interface:
```typescript
interface VBriefReference {
  uri: string;
  label?: string;
  type?: string;
}
```

### I/O changes (io.ts)

`updateItemStatus()` and `updateSubItemStatus()`:
- Set `doc.vBRIEFInfo.updated = now`
- Set `doc.plan.updated = now`
- Increment `doc.plan.sequence` (default to 1 if missing)
- If status → `completed`, set `item.completed = now` (or `subItem.completed`)

### Beads sync (beads.ts)

`syncBeadStatusToVBrief()`: After calling `updateItemStatus()`, the io.ts function already handles timestamps/sequence. For AC subItems completed in the loop, `updateSubItemStatus()` also handles it. No additional logic needed in beads.ts beyond what io.ts provides.

### Planning prompt (spawn-planning-session.ts)

- Pass `planningModel` into `buildPlanningPrompt(issue, workspacePath, planningModel)`
- Import and read version from package.json
- Include all new fields in the JSON template:
  - `vBRIEFInfo.author`, `vBRIEFInfo.description`
  - `plan.uid` (tell agent to generate UUID v4)
  - `plan.author` (inject `"agent:<planningModel>"`)
  - `plan.sequence: 1`, `plan.created`, `plan.updated`
  - `plan.references` (populated from PRD discovery + issue URL)
  - `items[].priority`, `items[].created`
- PRD discovery: scan `docs/prds/planned/` and `docs/prds/active/` for files matching issue ID

### PlanBuilder (builder.ts)

Add methods for new fields: `uid()`, `sequence()`, `references()`, `created()`, `description()`. Update `build()` to include `vBRIEFInfo.author` and `description`.

### Artifact auto-copy (issues.ts — complete-planning)

After creating beads, copy:
1. `.planning/STATE.md` → `docs/prds/active/<ISSUE-ID>-plan.md` (skip if exists)
2. `.planning/plan.vbrief.json` → `docs/prds/active/<ISSUE-ID>-plan.vbrief.json` (skip if exists)

Use async fs operations (not sync — server code).

### PRD discovery (issues.ts — start-planning)

Before writing PLANNING_PROMPT.md:
1. Scan `docs/prds/planned/` and `docs/prds/active/` for files matching issue ID
2. Copy matching PRD to `.planning/prd.md`
3. Pass discovered PRD paths to `buildPlanningPrompt()` for inclusion in references template

### VBriefViewer components

New components in `src/dashboard/frontend/src/components/vbrief/`:
- `VBriefViewer.tsx` — main container with tab switching (List/DAG/Raw JSON)
- `VBriefHeader.tsx` — title, status badge, uid, author, timestamps
- `VBriefNarratives.tsx` — markdown-rendered Problem/Proposal/etc sections
- `VBriefReferences.tsx` — clickable link list for references
- `VBriefItemCard.tsx` — expandable item with status/difficulty/priority badges, AC checklist
- `VBriefItemList.tsx` — list of VBriefItemCard components

Integration:
- KanbanBoard: add "vBRIEF" button to issue card actions
- InspectorPanel: add vBRIEF tab

Dependencies:
- `react-markdown` + `remark-gfm` (may already be available from PAN-451)
- Existing `PlanDAG` component for DAG view toggle
- Existing Tailwind patterns

### Documentation

- `docs/VBRIEF.md` — add new fields to field reference tables
- `CLAUDE.md` — add vBRIEF section with spec links
- `README.md` — update feature table with vBRIEF, TLDR, Effect.js, Beads rows

## Files Changed

| File | Action |
|------|--------|
| `src/lib/vbrief/types.ts` | Add uid, author, sequence, references, timestamps, VBriefReference |
| `src/lib/vbrief/io.ts` | Update status functions with timestamps + sequence |
| `src/lib/vbrief/beads.ts` | Minor — io.ts handles timestamps now, verify compatibility |
| `src/lib/vbrief/builder.ts` | Add builder methods for new fields |
| `src/lib/planning/spawn-planning-session.ts` | Model injection, PRD discovery, full field template |
| `src/dashboard/server/routes/issues.ts` | Artifact copy in complete-planning, PRD copy in start-planning |
| `docs/VBRIEF.md` | Document new fields |
| `CLAUDE.md` | Add vBRIEF section |
| `README.md` | Update feature table |
| `src/dashboard/frontend/src/components/vbrief/VBriefViewer.tsx` | CREATE |
| `src/dashboard/frontend/src/components/vbrief/VBriefHeader.tsx` | CREATE |
| `src/dashboard/frontend/src/components/vbrief/VBriefNarratives.tsx` | CREATE |
| `src/dashboard/frontend/src/components/vbrief/VBriefReferences.tsx` | CREATE |
| `src/dashboard/frontend/src/components/vbrief/VBriefItemCard.tsx` | CREATE |
| `src/dashboard/frontend/src/components/vbrief/VBriefItemList.tsx` | CREATE |
| `src/dashboard/frontend/src/components/KanbanBoard.tsx` | Add vBRIEF button |
| `src/dashboard/frontend/src/components/InspectorPanel.tsx` | Add vBRIEF tab |
| `tests/vbrief/full-spec.test.ts` | CREATE — spec field tests |
| `tests/frontend/VBriefViewer.test.tsx` | CREATE — viewer tests |

## Out of Scope

- vBRIEFInfo.metadata (optional, skip for now per PRD)
- Editing plan fields from the viewer UI (read-only viewer)
- Upstream spec changes to deftai/vBRIEF (separate PR)
- Integration tests for start-planning/complete-planning endpoints (would require test server setup)

## Current Status: Implementation Complete

All 12 beads closed. Implementation complete.

## Remaining Work

None — all work complete.

## Files Changed Summary

| Bead | Files | Summary |
|------|-------|---------|
| atu | types.ts, builder.ts | New v0.5 types (VBriefReference, timestamps) + PlanBuilder methods |
| a7o | beads.ts | Verification comments — no code changes needed |
| tum | tests/vbrief/full-spec.test.ts | 22-test spec compliance suite |
| al1 | src/lib/vbrief/io.ts | Timestamp/sequence updates in updateItemStatus/updateSubItemStatus |
| 32d | spawn-planning-session.ts | buildPlanningPrompt with planningModel + full v0.5 template + PRD discovery |
| 8hf | tests/vbrief/full-spec.test.ts | PRD discovery tests added |
| sin | src/dashboard/server/routes/issues.ts | Async artifact copy in complete-planning |
| aut | frontend/src/components/vbrief/* | VBriefViewer component suite (6 components + types + 24 tests) |
| rud | KanbanBoard.tsx, InspectorPanel.tsx, VBriefDialog.tsx | vBRIEF button + dialog integration |
| f81 | frontend/src/components/vbrief/index.ts | Barrel export |
| 70z | docs/VBRIEF.md, CLAUDE.md, README.md | Documentation updates |
| pi1 | src/lib/vbrief/types.ts | Header comment documenting v0.5 fields |
