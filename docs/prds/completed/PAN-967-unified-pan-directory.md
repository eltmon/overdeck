# PAN-967: Unified `.pan/` Directory — Eliminate `.planning/` and Consolidate Orchestration State

## Vision

Replace the legacy `.planning/` directory and separate `vbrief/` directory with a single `.pan/` dot-directory that holds ALL Panopticon orchestration metadata. The dot-prefix signals "tooling, not code" (same convention as `.git/`, `.github/`, `.beads/`). State lives in git on the feature branch for remote distribution, with a clear lifecycle from draft → proposed → active → completed.

## Motivation

The current system has three problems:

1. **`.planning/` causes merge conflicts** — it's created on main during planning, then the branch is cut from main, so both branches have it. Rebase conflicts are inevitable, requiring destructive pre-merge stripping (force-push).

2. **Scattered orchestration state** — PRDs live in `docs/prds/`, scope vBRIEFs live in `vbrief/`, continue state lives in `.planning/`, feedback lives in `.planning/feedback/`. No single location for "everything about this issue."

3. **Complexity** — the system requires file movement between directories at lifecycle transitions, separate archive flows, legacy compat layers, and multiple resolution fallback chains (lifecycle dirs → workspace `.planning/` → legacy locations).

## Design Principles

- **One directory**: `.pan/` is the only orchestration directory. Period.
- **Dot-prefix**: signals metadata, not application code
- **Git-native**: state lives on the feature branch, travels via `push/pull`
- **Single writer per concern**: pipeline writes lifecycle state, agents report through Beads
- **No movement between directories**: lifecycle status is a JSON field, not a directory location
- **Scales to 100 agents**: each agent writes only its own Beads, never shared files
- **Retrospective-friendly**: state survives merge, preserved for post-mortems

## Architecture (3 sentences)

Everything Panopticon owns lives in `.pan/` — drafts, specs, continue state, session history. Lifecycle status is a field in the JSON (`status: "proposed" | "active" | "completed" | "cancelled"`), not a directory location — files never move. Agents report progress exclusively through Beads (`bd update`); they never write to shared orchestration files.

## Directory Structure

### On main (project root):
```
.pan/
  specs/
    2026-05-01-PAN-950-feature-x.vbrief.json     (status: "completed")
    2026-05-03-PAN-960-feature-y.vbrief.json     (status: "active")
    2026-05-04-PAN-967-unified-pan-dir.vbrief.json (status: "proposed")
  drafts/
    PAN-970-next-thing.md                         (PRD being refined)
```

### On feature branch (workspace):
```
.pan/
  spec.vbrief.json          ← this issue's scope vBRIEF (copied from main at branch creation)
  continue.json             ← session state (resume point, decisions, hazards)
  sessions.jsonl            ← append-only session history
  feedback/
    001-review-changes-requested.md
    002-test-failures.md
  context.md                ← FEATURE-CONTEXT for Rally story agents (replaces .planning/FEATURE-CONTEXT.md)
```

## Lifecycle Model

### Status Transitions (field-based, not directory-based)

```
draft ──► proposed ──► active ──► completed
                 │                    │
                 └──► cancelled ◄─────┘
```

| Transition | Trigger | What happens |
|-----------|---------|--------------|
| (new) → draft | `pan plan` starts | PRD written to `.pan/drafts/` on main |
| draft → proposed | Planning completes | vBRIEF created in `.pan/specs/` with `status: "proposed"` |
| proposed → active | `pan start` | Status field updated to `"active"`, spec copied to feature branch `.pan/spec.vbrief.json` |
| active → completed | PR merges | Status field updated to `"completed"` on main |
| active → cancelled | Issue closed | Status field updated to `"cancelled"` on main |

All transitions on main are single atomic commits. No file movement.

### Feature Branch Lifecycle

1. **Branch created** → pipeline copies spec from `.pan/specs/<file>` to workspace `.pan/spec.vbrief.json`
2. **Agent works** → marks Beads done via `bd update`, pipeline writes continue state
3. **Agent done** → pipeline syncs Beads status back to spec items
4. **Merge** → code merges to main; `.pan/` on feature branch merges too (it's retrospective data)
5. **Post-merge** → pipeline updates `.pan/specs/<file>` status to `"completed"` on main

### Why `.pan/` on feature branch doesn't conflict

The feature branch's `.pan/` directory contains **workspace-specific** files (`spec.vbrief.json`, `continue.json`, `sessions.jsonl`) that do NOT exist on main. Main's `.pan/specs/` contains the canonical specs. These are different paths — no overlap, no conflict during rebase.

The only shared path is `.pan/specs/` which exists on both main and feature branch — but agents NEVER write to it. Only the pipeline writes to `.pan/specs/` on main.

## Concurrency Model

| Resource | Writer | Readers | Contention |
|----------|--------|---------|------------|
| `.pan/specs/<file>` on main | Pipeline only | Dashboard, agents (via prompt injection) | None — single writer |
| `.pan/spec.vbrief.json` on branch | Pipeline only (copies at start) | Agent (reads from prompt) | None — single writer |
| `.pan/continue.json` on branch | Pipeline only | Agent (injected into prompt at session start) | None — single writer |
| `.pan/sessions.jsonl` on branch | Pipeline appends | Dashboard, post-mortems | Minimal — append-only |
| `.pan/feedback/*.md` on branch | Pipeline only | Agent (injected into prompt) | None — single writer |
| Beads (`.beads/dolt/`) | Each agent via `bd update` | Pipeline, dashboard | Serialized by Dolt mutex — fast (<100ms per op) |

For 100 parallel agents on 100 different issues: each has its own feature branch with its own `.pan/` directory. Zero cross-agent contention. Beads writes serialize through the Dolt mutex but target different bead IDs.

## Migration Plan

### Phase 1: Create `.pan/` infrastructure
- New module: `src/lib/pan-dir/` with read/write/query functions
- Directory structure constants, filename conventions
- Status-field-based lifecycle (no directory movement)
- `findSpec()` resolves from `.pan/specs/` (replacing lifecycle dir scanning)
- `readContinueState()` resolves from workspace `.pan/continue.json`

### Phase 2: Migrate scope vBRIEFs
- Move existing `vbrief/{proposed,active,completed,cancelled}/*.vbrief.json` → `.pan/specs/`
- Add `status` field to each (derived from which directory it was in)
- Update `VBRIEF_ROOT_DIRNAME` constant
- Update all `resolveVBriefDir()`, `resolveVBriefRoot()`, `ensureVBriefDirs()` calls
- Update `findVBriefByIssue()` / `findVBriefByIssueAsync()` to scan `.pan/specs/` with status field filtering
- Update `moveVBrief()` → `updateVBriefStatus()` (field update, not file move)
- Update `transitionVBriefOnMain()` — now updates status field in-place instead of `git mv`
- Add backward-compat: still check old `vbrief/` location as fallback during transition

### Phase 3: Migrate continue state to feature branch `.pan/`
- Planning creates workspace `.pan/continue.json` instead of `.planning/continue-*.vbrief.json`
- `writeContinueState()` / `readContinueState()` target `.pan/continue.json`
- `appendSessionEntry()` targets `.pan/sessions.jsonl`
- Remove continue file co-location with scope vBRIEF (it was always awkward)

### Phase 4: Migrate PRDs into `.pan/drafts/`
- `pan plan` creates PRD in `.pan/drafts/` instead of `docs/prds/planned/`
- Planning agent reads from `.pan/drafts/`
- On planning completion, PRD stays in `.pan/drafts/` (or moves to `.pan/specs/` as the vBRIEF replaces it)
- Add backward-compat: still check `docs/prds/` as fallback
- NOTE: For poly-repo projects (MYN), `.pan/drafts/` lives in the meta repo or designated orchestration repo

### Phase 5: Migrate feedback to feature branch `.pan/feedback/`
- `writeFeedbackFile()` writes to workspace `.pan/feedback/` instead of `.planning/feedback/`
- Remove all legacy `.planning/feedback/` reading code
- `clearFeedback()` targets `.pan/feedback/`
- Work agent prompt reads from `.pan/feedback/` (or better: pipeline injects into prompt)

### Phase 6: Migrate FEATURE-CONTEXT to `.pan/context.md`
- `writeFeatureContext()` → workspace `.pan/context.md`
- `readFeatureContext()` reads from `.pan/context.md`
- Parent feature context inheritance reads from parent workspace `.pan/context.md`

### Phase 7: Eliminate `.planning/` entirely
- Remove `spawn-planning-session.ts` `.planning/` directory creation
- Remove all `.planning/` path resolution in `work-agent-prompt.ts`
- Remove `archive-planning.ts` (archiving is no longer needed — state stays in git)
- Remove workspace-manager `.planning/` cleanup code
- Remove `.planning-complete` marker logic (status field replaces it)
- Remove all legacy fallback chains
- Update agent prompts (`work.md`, `planning.md`) to reference `.pan/`
- Remove `findPlan()` in `io.ts` (replaced by reading `.pan/spec.vbrief.json`)

### Phase 8: Update dashboard and CLI
- All dashboard routes reading from `.planning/` → read from `.pan/`
- `command-deck.ts` discussions → `.pan/discussions/` (if keeping)
- Plan resolution endpoints → `.pan/specs/` with status filtering
- Continue state endpoints → workspace `.pan/continue.json`
- Update kanban/inspector plan viewer to read from new locations
- CLI commands (`pan scope`, `pan plan-finalize`, `pan start`, `pan done`) → new paths

### Phase 9: Update prompts and skills
- `src/lib/cloister/prompts/work.md` — tell agents about `.pan/` not `.planning/`
- `src/lib/cloister/prompts/planning.md` — output artifacts to `.pan/`
- `skills/plan/SKILL.md` — reference `.pan/`
- `skills/pan-plan-finalize/SKILL.md` — reference `.pan/`
- `skills/crash-investigation/SKILL.md` — reference `.pan/`

### Phase 10: Cleanup and migration tooling
- One-time migration script: moves existing `vbrief/` → `.pan/specs/`, adds status fields
- Removes empty `vbrief/` directory from all registered projects
- Updates `.gitignore` if needed
- Updates `docs/VBRIEF.md` to document new structure
- Updates `CLAUDE.md` vBRIEF section

## Files Requiring Changes

### Core modules (create/rewrite):
| File | Action |
|------|--------|
| `src/lib/pan-dir/index.ts` | **CREATE** — new module entry point |
| `src/lib/pan-dir/specs.ts` | **CREATE** — spec CRUD, status transitions, query by status/issue |
| `src/lib/pan-dir/continue.ts` | **CREATE** — continue state read/write for workspace `.pan/` |
| `src/lib/pan-dir/sessions.ts` | **CREATE** — JSONL session history append/read |
| `src/lib/pan-dir/feedback.ts` | **CREATE** — feedback file management |
| `src/lib/pan-dir/drafts.ts` | **CREATE** — PRD draft management |
| `src/lib/pan-dir/context.ts` | **CREATE** — FEATURE-CONTEXT read/write |
| `src/lib/pan-dir/types.ts` | **CREATE** — shared types |

### Existing modules to modify:
| File | Change |
|------|--------|
| `src/lib/vbrief/lifecycle.ts` | Update `VBRIEF_ROOT_DIRNAME` → `.pan/specs`, remove lifecycle dir scanning |
| `src/lib/vbrief/lifecycle-io.ts` | Replace `moveVBrief()` with `updateVBriefStatus()`, update `findVBriefByIssue()` |
| `src/lib/vbrief/io.ts` | Replace `.planning/plan.vbrief.json` → `.pan/spec.vbrief.json` |
| `src/lib/vbrief/continue-state.ts` | Target `.pan/continue.json` instead of lifecycle dir co-location |
| `src/lib/vbrief/beads.ts` | Update plan path resolution |
| `src/lib/vbrief/vbrief-index.ts` | Scan `.pan/specs/` instead of lifecycle subdirs |
| `src/lib/cloister/work-agent-prompt.ts` | Replace ALL `.planning/` refs → `.pan/`, update fallback chains |
| `src/lib/cloister/feedback-writer.ts` | Write to `.pan/feedback/`, remove legacy `.planning/feedback/` compat |
| `src/lib/cloister/handoff-context.ts` | Update planning dir references |
| `src/lib/cloister/merge-agent.ts` | Post-merge updates `.pan/specs/` status on main |
| `src/lib/cloister/review-agent.ts` | Read plan from `.pan/spec.vbrief.json` |
| `src/lib/cloister/verification-runner.ts` | Update `.planning/` path references |
| `src/lib/cloister/deacon.ts` | Update stuck detection paths |
| `src/lib/planning/spawn-planning-session.ts` | Create `.pan/` instead of `.planning/`, write drafts to `.pan/drafts/` |
| `src/lib/workspace-manager.ts` | Remove `.planning/` cleanup, handle `.pan/` in workspace creation |
| `src/lib/lifecycle/archive-planning.ts` | **REMOVE** — archiving is eliminated (state stays in git) |
| `src/lib/lifecycle/workflows.ts` | Remove archive-planning calls, update transitions |
| `src/lib/lifecycle/teardown-workspace.ts` | Update any `.planning/` references |
| `src/lib/lifecycle/index.ts` | Remove `archivePlanning` export |
| `src/lib/close-out.ts` | Update planning artifact references |
| `src/lib/prd-draft.ts` | Write to `.pan/drafts/` |
| `src/lib/prd-locations.ts` | Add `.pan/drafts/` as primary location, `docs/prds/` as fallback |
| `src/lib/rebase-helper.ts` | Remove any `.planning/` special handling |
| `src/lib/safety/protected-paths.ts` | Update protected path list |
| `src/lib/agents.ts` | Update `.planning/` references |
| `src/lib/review-artifacts.ts` | Update artifact paths |

### Dashboard server routes:
| File | Change |
|------|--------|
| `src/dashboard/server/routes/workspaces.ts` | All `.planning/` → `.pan/` |
| `src/dashboard/server/routes/issues.ts` | Plan resolution, planning-complete logic → status field |
| `src/dashboard/server/routes/agents.ts` | Start-agent planning dir → `.pan/` |
| `src/dashboard/server/routes/command-deck.ts` | All `.planning/` → `.pan/`, discussions ��� `.pan/discussions/` |
| `src/dashboard/server/routes/projects.ts` | Plan discovery → `.pan/specs/` |
| `src/dashboard/server/routes/misc.ts` | Planning artifact resolution |
| `src/dashboard/server/services/agent-spawner.ts` | Workspace prep → `.pan/` |
| `src/dashboard/server/services/issue-data-service.ts` | Plan resolution |
| `src/dashboard/server/services/resource-discovery.ts` | Artifact discovery |
| `src/dashboard/server/services/workspace-service.ts` | Workspace state |

### CLI commands:
| File | Change |
|------|--------|
| `src/cli/commands/plan-finalize.ts` | Promote draft → proposed spec in `.pan/specs/` |
| `src/cli/commands/start.ts` | Copy spec to workspace `.pan/`, create continue state |
| `src/cli/commands/done.ts` | Signal completion, no more `.planning/` refs |
| `src/cli/commands/scope.ts` | Query `.pan/specs/` instead of lifecycle dirs |
| `src/cli/commands/workspace.ts` | Workspace info reads from `.pan/` |
| `src/cli/commands/workspace-migrate.ts` | Migration tooling |
| `src/cli/commands/resources.ts` | Resource listing |

### Prompts and skills:
| File | Change |
|------|--------|
| `src/lib/cloister/prompts/work.md` | Tell agent about `.pan/spec.vbrief.json`, remove `.planning/` refs |
| `src/lib/cloister/prompts/planning.md` | Output to `.pan/`, create spec + continue state there |
| `src/lib/cloister/prompts/review/*.md` | Update plan location references |
| `skills/plan/SKILL.md` | Reference `.pan/` |
| `skills/pan-plan-finalize/SKILL.md` | Reference `.pan/` |
| `skills/crash-investigation/SKILL.md` | Update paths |
| `skills/pan-diagnose/SKILL.md` | Update paths |

### Tests:
| File | Change |
|------|--------|
| `tests/unit/lib/lifecycle/teardown-workspace.test.ts` | Update paths |
| `tests/cli/commands/work/done.test.ts` | Update paths |
| `tests/cloister/verification-runner.test.ts` | Update paths |
| `tests/e2e/work-flow.test.ts` | Update full flow paths |
| `tests/lib/pan-artifacts.test.ts` | Update artifact paths |
| `src/lib/vbrief/__tests__/*.test.ts` | Update all `.planning/` → `.pan/` |
| `src/lib/cloister/__tests__/feature-context.test.ts` | Update paths |
| `src/lib/planning/__tests__/spawn-planning-session.test.ts` | Update paths |
| `src/dashboard/server/__tests__/pending-feedback.test.ts` | Update paths |

### Documentation:
| File | Change |
|------|--------|
| `docs/VBRIEF.md` | Rewrite to document `.pan/` structure |
| `CLAUDE.md` | Update vBRIEF section |
| `CONTRIBUTING.md` | Update workspace docs |
| `docs/REPO-ARTIFACTS.md` | Update artifact locations |
| `docs/SPECIALIST_WORKFLOW.md` | Update planning flow |
| `docs/USAGE.md` | Update user-facing docs |

## Poly-Repo Strategy

For multi-repo projects (MYN: frontend, backend, docs, infra, meta):
- `.pan/specs/` lives in the **meta repo** (`myn-meta`) or designated orchestration repo
- Feature branches in individual repos (frontend, backend) get workspace `.pan/` with their own continue state
- Cross-repo issues reference the spec via issue ID; the pipeline knows which meta repo to read
- Config: `projects.yaml` gains `pan_dir_repo: myn-meta` field for poly-repo projects

## Backward Compatibility

During migration (can run for several weeks):
1. All read operations check `.pan/` first, fall back to `vbrief/` then `.planning/`
2. All write operations target `.pan/` only
3. Existing workspaces on feature branches continue to work (they still have `.planning/`)
4. New workspaces get `.pan/` only
5. Migration script converts existing projects on-demand: `pan migrate-pan-dir`

## Success Criteria

- [ ] Zero references to `.planning/` in source code (excluding backward-compat fallbacks behind feature flag)
- [ ] `vbrief/` directory removed from all registered projects
- [ ] `docs/prds/` still exists for human-authored long-form PRDs (optional — can coexist)
- [ ] All 60+ skills updated to reference `.pan/`
- [ ] E2E test: full issue lifecycle (plan → start → work → done → merge → close) uses only `.pan/`
- [ ] 100-agent stress test: no file contention, all Beads updates succeed
- [ ] Retrospective data preserved in git history after merge
- [ ] `npm run typecheck`, `npm run lint`, `npm test` all pass
- [ ] Dashboard plan viewer works from new locations

## Non-Goals

- Changing Beads architecture (Dolt + mutex is fine for this)
- Changing git workflow (worktrees, feature branches stay the same)
- Removing `docs/prds/` entirely (human-authored PRDs can coexist, or teams can use `.pan/drafts/`)
- Multi-machine distributed execution (that's a separate feature — this just makes it possible by putting state in git)
