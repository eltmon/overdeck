# PAN-2541 PRD second-eyes review — gpt5.6-sol

Reviewed against `main` on 2026-07-09. Findings below are implementation blockers or concrete no-loss gaps, not style notes.

## 1. BLOCKER — branch existence makes the migration half-complete state look complete

WI-2 explicitly pushes `overdeck-state` in step 2 and says migration becomes true on every machine at that moment, but the destructive/main-side removal and context move occur only in step 3 (`.pan/drafts/pan-2541.md:185-188`). D12 then makes branch existence the sole migration predicate. If step 3 fails, or simply while it is still running, all fresh processes resolve reads/writes to the state worktree even though `main` still contains the legacy plane. On another machine, branch discovery can flip `migrated=true` before `pan doctor` has created the state worktree. That creates an externally visible split-brain cutover, not an idempotent migration.

The proposed fallback is also incompatible with the repo's recoverability rule: deleting the half-seeded remote branch is a one-way branch deletion, and reverting `main` cannot make clients that cached branch existence unmigrated.

Required correction: define a repo-derived **completion marker inside the state branch** (or another atomic ref) written only after the state tree, main cleanup commit, redirect rewrite, and verification all succeed. `isStateMigrated()` must key off that marker, not mere branch existence. Specify resume behavior for every interruption point and test failures after each migration step.

## 2. BLOCKER — migration does not acquire a cross-process write freeze or prove a stable snapshot

The PRD calls the existing writer “serialized by the existing write-door lock,” but the implementation has only a process-local promise serializer (`src/lib/pan-dir/auto-commit.ts:99-100`) and the issue-record lock is also process-local (`src/lib/pan-dir/record-lock.ts:1-23`). Freezing Deacon does not prevent CLI commands, the dashboard, or another machine from writing records/specs/drafts during WI-2. The migration seeds from one `main` tree, later copies untracked notes, pushes the branch, and then edits `main`; a write between those operations can be omitted from the state branch or recreate a legacy path after cleanup.

Required correction: WI-2 needs a real per-project, cross-process migration/write lock honored by every write door; it must flush pending batches, capture and verify a stable source SHA/tree, block new writes through cutover, and refuse migration if another machine advances state during the transaction. Add a concurrent-writer integration fixture, not only a happy-path/idempotency fixture.

## 3. BLOCKER — D10 cannot “re-apply the queued write” because the queue stores paths, not mutations

`queueAutoCommit` stores only `paths`, `subjects`, and an optional repo root (`src/lib/pan-dir/auto-commit.ts:54-60`, `:189-210`). After a rebase conflict there is no operation or domain delta to replay. Re-reading the canonical remote file and “re-applying the queued write” therefore has no defined implementation. Choosing the pre-rebase local file is blind last-writer-wins and can erase remote fields; choosing the remote file drops the local write. This is especially unsafe for whole-file per-issue records.

Required correction: move conflict handling above Git into domain writers: queue replayable typed mutations (or perform locked read-modify-write after fetch) and define merge rules per domain. At minimum, records need field-aware reconciliation under the issue lock; immutable specs must reject conflicting content; append-only artifacts need append semantics. Add same-file/two-machine conflict tests that prove neither writer's disjoint fields disappear.

## 4. HIGH — D13 does not repair existing redirects and has no relocation lifecycle

The current redirect is written only when `.beads/redirect` does not exist (`src/cli/commands/workspace-beads.ts:43-55`). Every existing workspace already has `../../.beads`, so changing only the creation target leaves all live workspaces pointing at the removed project-root database. WI-5 tests new redirect content but does not require overwriting stale redirects, enumerating existing workspaces during migration, or repairing them in doctor/patrol.

The proposed absolute target also bakes `${OVERDECK_HOME}` and `<projectKey>` into every workspace. Moving `OVERDECK_HOME`, renaming a project key, recloning on another machine, or recreating the state worktree strands the redirect unless a repair pass rewrites it.

Required correction: specify an idempotent `ensureWorkspaceBeadsRedirect` that validates and atomically replaces stale redirect contents on every workspace start/doctor pass; WI-2 must rewrite all existing local workspaces before removing `.beads/`. Tests must cover an existing legacy redirect, missing state worktree, changed home/project key, and rollback before/after redirect replacement.

## 5. HIGH — WI-11 misses a feature-branch state commit that directly violates FR-2/FR-11

`src/lib/agents/spawn.ts:543-568` detects tracked `.pan/continue.json` / `.pan/spec.vbrief.json`, runs `git rm --cached`, and creates `chore: untrack workspace .pan/ artifacts (PAN-1215)` on the feature branch. WI-11's verified list does not include this site. After migration, it can still create a feature commit whose diff contains forbidden state-plane paths, exactly what FR-2 and FR-11 prohibit.

Required correction: add this site to WI-11 and decide its migration behavior. Existing feature branches containing legacy tracked runtime files need a deliberate compatibility path that does not create a new forbidden commit (or the guard needs a narrowly audited retirement exception). Add a migrated-old-workspace regression fixture.

## 6. HIGH — the no-loss tests do not cover the migration's destructive edges

AC-2 checks only final trees and rerun output. It does not verify preservation of file modes, dotfiles, partially tracked ignored directories, untracked-note name collisions, pending/staged changes in the primary checkout, an existing local/remote `overdeck-state` ref, a dirty/wrong-branch state worktree, push success followed by main-commit failure, or main-commit success followed by push failure. The migration also says it removes untracked notes from the primary checkout, which is irreversible unless content hashes are verified in the committed state tree first.

Required correction: add a failure-injection matrix around every WI-2 step and a manifest (source path, destination path, mode, size/hash) verified before any source removal. A dirty primary checkout or non-fast-forward remote state branch must fail before mutation.

