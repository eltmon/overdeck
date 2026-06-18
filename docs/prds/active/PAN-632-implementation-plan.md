# PAN-632 Implementation Plan

This document is the execution companion to [PAN-632-merge-system-refactor.md](/home/eltmon/Projects/overdeck/docs/prds/planned/PAN-632-merge-system-refactor.md:1).

It exists to keep the refactor grounded in a small number of ordered implementation slices.

## Principles

- Build the data model before rewriting orchestration.
- Move intent into code incrementally instead of attempting a single merge-flow rewrite.
- Keep PAN-632 strictly scoped to merge coordination through merge completion.
- Treat PAN-639 as a prerequisite for realistic end-to-end validation, but not part of the merge-system architecture work.

## Slice 1: Foundation

Goal: establish the persistent primitives the rest of the refactor depends on.

Deliverables:

- first-class merge-set state in SQLite
- repo/forge/target-branch resolution from configured project metadata
- forge abstraction interfaces for PR/MR operations
- implementation notes for the remaining slices

Primary files:

- `src/lib/database/schema.ts`
- `src/lib/database/merge-set-db.ts`
- `src/lib/merge-set.ts`
- `src/lib/project-repos.ts`
- `src/lib/forge.ts`

Exit criteria:

- merge-set data can be persisted and read back
- polyrepo repo metadata resolves from config, including per-repo target branches
- mixed-forge metadata is represented in code rather than inferred ad hoc

## Slice 2: Review Artifact Creation

Goal: move review artifact creation to `pan done`.

Deliverables:

- monorepo PR creation at work completion
- polyrepo PR/MR creation for each affected repo at work completion
- merge-set rows created and linked to those artifacts

Primary files:

- `src/cli/commands/work/done.ts`
- `src/dashboard/server/routes/workspaces.ts`
- forge adapter implementations

Exit criteria:

- merge routes no longer need to lazily create review artifacts as a normal path

## Slice 3: Readiness and Verification

Goal: define merge readiness in terms of the merge set rather than a single `prUrl`.

Deliverables:

- merge-set-aware readiness computation
- repo-key-based gate applicability
- non-mutating post-rebase verification path

Primary files:

- `src/lib/review-status.ts`
- `src/lib/cloister/verification-runner.ts`
- `src/lib/cloister/merge-agent.ts`

Exit criteria:

- readiness reflects all required repos in the set
- merge-time verification validates rebased heads without mutating them

## Slice 4: Merge Orchestration

Goal: replace the current single-repo assumptions in merge orchestration.

Deliverables:

- work-agent-only rebase path
- no server-side rebase fallback
- polyrepo merge-set coordination with explicit ordering
- merge blocking when any required repo is not ready

Primary files:

- `src/dashboard/server/routes/workspaces.ts`
- `src/lib/cloister/merge-agent.ts`

Exit criteria:

- monorepo merge path delegates rebases to the work agent only
- polyrepo merge path coordinates the full set instead of looping repo-by-repo blindly

## Slice 5: Recovery and Validation

Goal: close the operational gaps and validate against the real acceptance case.

Deliverables:

- startup queue auto-resume
- validation against MYN as a 6-repo mixed-forge project
- follow-on change-set manifest handoff for PAN-399

Primary files:

- `src/dashboard/server/main.ts`
- `src/dashboard/server/routes/workspaces.ts`
- `src/lib/database/merge-queue-db.ts`

Exit criteria:

- queued merges resume after restart
- MYN assumptions are exercised against the actual repo model
- merged change-set manifest is available for PAN-399

## Not In Scope Here

- PAN-399 release specialist implementation
- PAN-639 beads recovery implementation
- any redesign of the review specialist beyond what PAN-632 already locked
