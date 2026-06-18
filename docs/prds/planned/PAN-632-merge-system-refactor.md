# PRD: Intended Merge System — Work-Agent-Owned Rebases, Coordinated Merge Sets, Release Handoff (PAN-632)

## Purpose

Lock the intended merge-system design for Overdeck.

This document defines the target architecture we want to build toward. It is not a description of current behavior.

PAN-632 owns merge coordination through merge completion.
PAN-399 owns post-merge release orchestration and rollout safety.

## Core Decisions

### 1. The work agent owns all code-changing git operations

The work agent is responsible for:

- committing changes
- pushing branches
- rebasing onto the target branch
- resolving conflicts
- pushing rebased branches

The server is an orchestrator. It records state, drives the queue, dispatches specialists, and performs merge API actions. It does not mutate branch contents on the agent's behalf.

If a rebase is required and the work agent cannot complete it, the merge blocks. There is no server-side fallback rebase in the intended design.

### 2. Review artifacts are created at work completion

`pan done` must create the review artifacts immediately.

- Monorepo: one PR
- Polyrepo: one PR/MR per affected repo

Those artifacts are the source of truth for review, testing, merge readiness, and human merge visibility.

### 3. Merge agent is the coordinator for merge sets

The merge agent is not a code author. It is the coordinator for the full merge set associated with an issue.

Its responsibilities are:

- identify every affected repo for the issue
- track the PR/MR for each affected repo
- track forge and target branch for each repo
- ensure the full set is review-complete, test-complete, and rebase-complete
- enforce merge ordering rules for polyrepo projects
- block merge when any required repo in the set is not ready

### 4. Verification runs twice

Verification is required in two places:

1. Before an issue becomes `readyForMerge`
2. After the work agent rebases onto the latest target branch

The post-rebase verification pass must be non-mutating. It validates the rebased heads as they exist after the work agent push. It does not merge `main` again or otherwise rewrite the branch.

### 5. PAN-632 stops at merge coordination, not release atomicity

PAN-632 guarantees coordinated merge readiness.

PAN-632 does not claim true atomic git merges across multiple repos, and it does not own deployment or rollout atomicity. Those concerns belong to PAN-399.

After merge completion, PAN-632 hands a merged change-set manifest to the release specialist. PAN-399 then owns rollout ordering, health verification, halt-on-failure, and rollback behavior where supported.

### 6. Mixed-forge polyrepo support is a first-class requirement

The intended design must support both GitHub and GitLab in the same project.

That means the merge system must understand:

- GitHub PR creation and merge
- GitLab MR creation and merge
- per-repo forge metadata
- mixed GitHub/GitLab merge sets inside one issue

### 7. Repo identity, target branches, and gate applicability come from project configuration

Overdeck must not infer repo identity or merge behavior from guessed directory names.

The source of truth is the configured repo model for the project. For each repo in a merge set, Overdeck must resolve from configuration:

- repo key
- repo path
- forge
- source branch
- target branch
- merge order
- release order hints when relevant

Quality-gate applicability must be keyed from configured repo metadata, not hard-coded assumptions like `frontend` / `backend` path names.

The intended design must not assume every repo merges to `main`.

## Intended End-to-End Flow

### Phase 1: Work Completion

1. The work agent finishes implementation in the workspace.
2. The work agent commits and pushes every affected branch.
3. The work agent runs `pan done`.
4. `pan done` creates the review artifact set immediately.

For monorepo:

- one PR for the issue

For polyrepo:

- one PR/MR per affected repo

5. Overdeck records merge-set metadata for the issue:

- affected repos
- repo key and repo path for each repo
- forge for each repo
- target branch for each repo
- artifact URL for each repo
- merge ordering metadata if required

### Phase 2: Initial Review and Test

6. Verification runs on the current branch heads.
7. Review specialist reviews the review artifact set.
8. Test specialist runs required tests.
9. The issue becomes `readyForMerge` only when every required artifact in the merge set has passed its required gates.

### Phase 3: Merge Orchestration

10. A human clicks `MERGE`.
11. Overdeck places the issue into a project-scoped SQLite merge queue.
12. When the issue reaches the front of the queue, the merge agent resolves the full merge plan for the issue.
13. The merge agent instructs the work agent to rebase every affected branch onto the latest target branch.
14. The work agent performs the rebases, resolves conflicts, and pushes the rebased branches.
15. If any required repo cannot be rebased cleanly, the entire merge blocks.
16. Post-rebase verification runs against the rebased heads without mutating them.

Merge execution then diverges by workspace type:

#### Monorepo

17. After rebase and post-rebase verification pass, the server merges the PR.

#### Polyrepo

17. After every repo in the merge set is rebase-complete and verification-complete, the merge agent coordinates the merge set.
18. The merge agent merges repos in an explicit project-defined order.
19. The merge agent does not start polyrepo merge execution until the entire required set is ready.
20. If any repo merge fails, the remaining repos are not merged automatically and the issue is escalated with explicit merge-set state for human handling.

### Phase 4: Handoff and Cleanup

21. After merge success, Overdeck emits a merged change-set manifest.
22. If the project has release configuration, that manifest is handed to the release specialist defined by PAN-399.
23. Post-merge lifecycle cleanup runs.

## Merge Agent Responsibilities in Polyrepo Mode

In polyrepo mode, the merge agent must coordinate the issue as a single logical change set.

Required behavior:

- support any subset of repos in the project, not just "frontend + backend"
- support mixed GitHub/GitLab projects
- keep artifact state per repo
- keep review/test/rebase/verification state per repo
- keep merge ordering rules per repo
- expose a merge-set status model to the dashboard

The merge agent must not:

- author commits
- resolve conflicts itself
- rebase branches itself
- take over rollout/deploy concerns after merge

## MYN Coverage Requirement

The merge system must explicitly cover Mind Your Now as a true mixed-forge polyrepo case.

The target design must support a single issue spanning any subset of these repos:

- `fe`
- `api`
- `infra`
- `docs`
- `myn-skills`
- `openclaw-plugin`

The system must not assume:

- only two repos
- only GitHub
- only GitLab
- repo names like `frontend` and `backend`

Repo identity, forge metadata, and quality-gate applicability must be keyed off the configured repo model, not hard-coded path assumptions.

## What PAN-632 Does Not Include

PAN-632 does not include:

- server-side rebase fallback
- a mandatory "final review specialist" after rebase
- deployment sequencing
- rollout verification
- rollback logic

If we later add a post-rebase review step, it must be narrowly scoped to conflict-resolution deltas. It is not part of the locked target design for PAN-632.

## Implementation Areas

### 1. Review Artifact Creation at `pan done`

`pan done` must create the review artifacts immediately after push.

Needed outcomes:

- monorepo PR creation
- polyrepo PR/MR creation for each affected repo
- issue-to-artifact linkage stored in merge-set state

### 2. Merge-Set Data Model

Overdeck needs a first-class merge-set model for an issue.

Minimum required fields:

- issue ID
- repo key
- repo path
- forge
- target branch
- source branch
- artifact URL
- review status
- test status
- rebase status
- verification status
- merge order

### 3. Work-Agent-Owned Rebase Flow

The merge flow must dispatch rebase work to the work agent and wait for completion.

Required behavior:

- no server-side git rebase fallback
- no server-side conflict resolution
- explicit blocked state when the work agent cannot complete the rebase

### 4. Non-Mutating Post-Rebase Verification

The post-rebase verification path must validate the rebased heads without performing any additional branch mutation.

### 5. Forge Abstraction for Merge Artifacts

Overdeck must support forge-specific create/view/merge behavior behind one repo-level abstraction.

Required targets:

- GitHub PR
- GitLab MR

### 6. Queue Recovery

The SQLite merge queue must survive restart and automatically resume processing from persisted state.

Required behavior:

- reset stale in-flight merges into a resumable queued state
- rebuild per-project queue state on startup
- automatically dispatch the next eligible merge for each project with queued work
- avoid duplicate dispatch on repeated restart

### 7. Repo-Key-Based Gate Resolution

Quality gates, services, and merge ordering must resolve against configured repo keys and repo metadata.

Required behavior:

- no hard-coded repo-name assumptions such as `frontend` / `backend`
- no gate selection based only on inferred relative paths
- support projects where repo key and repo path differ, such as `fe` -> `frontend`

### 8. Release Handoff

After merge completion, PAN-632 must emit the merged change-set manifest required by PAN-399.

That manifest must be rich enough for release orchestration to understand:

- what changed
- which repos/components changed
- the intended merge order
- the intended release order when relevant

## Acceptance Criteria

1. `pan done` creates the full review artifact set immediately.
2. The work agent is the only actor allowed to perform rebases and conflict resolution.
3. The server does not perform code-changing git operations during merge orchestration.
4. An issue is `readyForMerge` only when every required repo in the merge set has passed required gates.
5. Post-rebase verification is non-mutating.
6. The merge agent supports mixed GitHub/GitLab merge sets.
7. MYN is supported as a 6-repo mixed-forge project, not a 2-repo special case.
8. Polyrepo merge execution does not begin until the entire required merge set is ready.
9. Queue state survives restart and resumes automatically.
10. Merge completion emits a change-set manifest suitable for PAN-399 release orchestration.
11. Queue startup recovery automatically dispatches the next queued merge per project without manual intervention.
12. Repo identity and gate applicability are resolved from configured repo metadata, not inferred path names.
13. Per-repo target branch is configurable; the system does not assume every repo targets `main`.
