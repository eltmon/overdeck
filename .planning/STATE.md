# PAN-946: Adopt deft vBRIEF Lifecycle Model for Scope vBRIEFs

## Problem

Panopticon's vBRIEF plans are ephemeral workspace artifacts that disappear after close-out. Plans live in `.planning/plan.vbrief.json`, get copied to `docs/prds/active/`, and are cleaned up post-merge. There's no structured lifecycle, no cross-issue visibility, and no durable continuation state. The `.planning-complete` boolean marker is the only lifecycle gate.

## Proposal

Adopt deft's filesystem-as-state lifecycle model with explicit lifecycle directories, structured status transitions, and issue-keyed filenames. Diverge from deft's single-plan-per-project constraint to support Panopticon's multi-agent, multi-issue world.

## Architecture Decisions

### 1. Canonical directory: per-project `./vbrief/`

Each registered project gets `./vbrief/` at its repo root with lifecycle subdirectories:
```
./vbrief/
├── proposed/     ← planning complete, awaiting approval
├── active/       ← agent is working on it
├── completed/    ← merged/closed, immutable archive
└── cancelled/    ← abandoned, immutable archive
```

### 2. Hybrid git model

- **proposed/ and active/ on main**: Planning creates the vBRIEF in the workspace, then `complete-planning` copies it to main's `./vbrief/proposed/`. Approval moves it to `./vbrief/active/` on main. This gives cross-issue visibility from any branch or the dashboard.
- **running + item updates on feature branch**: When a worktree is created from main, it inherits the vBRIEF in `./vbrief/active/`. The work agent updates item statuses and the continue file in the feature branch.
- **completed/cancelled on main**: After PR merge, `postMergeLifecycle` moves the vBRIEF from `active/` to `completed/` on main. Issue close without merge moves to `cancelled/`.

### 3. Issue-keyed filenames

Format: `YYYY-MM-DD-<ISSUE-ID>-<slug>.vbrief.json`
Example: `2026-05-03-PAN-946-vbrief-lifecycle.vbrief.json`

Date is creation date (immutable). Issue ID gives Panopticon ergonomics. Slug gives human readability.

### 4. plan.status as lifecycle gate

Replace `.planning-complete` marker with `plan.status` field:
- `draft` → planning in progress
- `proposed` → planning done, awaiting approval
- `approved` → user approved, ready to start
- `running` → agent is executing
- `completed` → work done, merged
- `blocked` / `cancelled` → as needed

Backward compat shim: if `.planning-complete` exists but `plan.status` missing, treat as proposed.

### 5. Separate continue.vbrief.json replaces STATE.md

The scope vBRIEF stays clean — "here's what we're building." A separate `continue-<issue-id>.vbrief.json` lives alongside it in the same lifecycle directory. It's a living session history document:

- Written during planning (replaces STATE.md)
- Updated on agent session start/end
- Updated on resume with why we're resuming
- Persists through completion for post-mortems
- Contains: git state, decisions, hazards, resume point, beads mapping, agent model, session history

### 6. Direct reference — no workspace cache

Agents read the vBRIEF directly from `./vbrief/active/<filename>` in their worktree (inherited from main). No copy to `.planning/plan.vbrief.json`, no drift, no reconciliation. During planning only, the work-in-progress vBRIEF lives at `.planning/plan.vbrief.json` before being promoted to proposed/.

### 7. Automatic lifecycle transitions

Lifecycle transitions are side effects of existing pipeline events:
- `plan-finalize` → sets plan.status to "proposed"
- `complete-planning` → copies vBRIEF to main's `./vbrief/proposed/`
- Approval (dashboard or `pan scope approve`) → moves to `active/` on main
- `pan start` → sets plan.status to "running" in worktree
- PR merge → `postMergeLifecycle` moves to `completed/` on main
- `pan close` → moves to `cancelled/` on main

`pan scope` commands exist as manual overrides for fixing state disagreement.

### 8. No migration of existing artifacts

Existing `docs/prds/active/` and `docs/prds/completed/` stay in place. They're markdown PRDs from a different era, not scope vBRIEFs. New work uses `./vbrief/`, old stuff stays where it is. Clean cut.

## Scope

**In scope:** Items 1-6, 8, 9 from the issue (canonical directory, lifecycle subdirs, filenames, plan.status, continue file, direct reference, CLI commands, sync audit).

**Out of scope:** Item 7 (scope agent — future work).

## Hazards

- **Cross-worktree git operations**: Complete-planning and approve transitions commit to main while the workspace is on a feature branch. Must ensure no conflicts and clean git state.
- **Backward compatibility**: In-flight workspaces during transition may still use `.planning-complete`. Shim required.
- **Dashboard plan viewer**: Must handle plans in both old (`.planning/`) and new (`./vbrief/`) locations during transition.
- **Beads integration**: plan-finalize creates beads from the vBRIEF. Must work regardless of vBRIEF location.
