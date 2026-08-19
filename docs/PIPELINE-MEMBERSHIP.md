# Pipeline Membership

Pipeline membership is an exception queue: an issue is in the pipeline when its durable state is not provably a clean terminal state. This definition keeps active work and lifecycle drift visible while excluding untouched backlog and correctly closed work.

## Durable lenses

`gatherProjectLensSignals()` builds membership from seven durable signals. For the pull-request and branch lenses, a convention branch is either `feature/<id>` or `strike/<id>`:

1. An open pull request for the convention branch.
2. A merged pull request, which is the merge oracle for squash merges.
3. A convention branch plus its unmerged relationship to `main`, evaluated with git.
4. Whether the tracker issue is open.
5. The current pipeline phase label, when present.
6. A durable xBRIEF spec on `overdeck-state`.
7. A terminal close-out record (`pipeline.closedOut === true` via the record door), consulted only for tracker-closed issues with an open PR (PAN-3396).

An xBRIEF makes an otherwise untouched open issue `planned_backlog` because its recorded code paths age. An open issue with a live `strike/` branch and no PR also surfaces as `planned_backlog`, so active strike work enters the pipeline before its PR opens. Landing detection requires positive evidence (PAN-2887): a branch contained in `main` counts as landed only when its tip sits off `main`'s first-parent line (its unique commits arrived via a merge). A freshly-created branch pointing at a `main` commit has zero unique work and is `planned_backlog` — every `pan start` passes through that state until the first commit. Known blind spot: a fast-forward-landed branch is indistinguishable from a fresh pointer and classifies as backlog (visible and safe) rather than limbo. A `planned` label is only a phase hint; it never substitutes for the durable spec lens. The tracker issue and phase-label lenses use the resolved project `tracker`; code-host fields such as `github_repo` independently select pull-request lenses, so a Linear-tracked project may host code and PRs on GitHub without querying GitHub Issues. Pull-request and branch lenses are forge-dependent: GitHub projects use `gh` and GraphQL to query open and merged pull requests; GitLab projects use the `glab`-backed per-repo lenses from `src/lib/gitlab-merge-requests.ts` to query open and merged merge requests, unioning results across all configured `gitlab`-forge repos; projects with neither forge configured fall back to tracker state, configured repository branches, and xBRIEF specs.

The Definition-of-Done `merged` row consumes this same containment computation through `gatherIssueBranchContainment()` in `src/lib/pipeline-membership-gather.ts`. Membership gathering and close-out therefore classify unmerged refs, merged-work refs, and fresh pointers through one implementation; change the lens there rather than adding another ancestry check.

Agent state, tmux sessions, workspaces, and `review_status` are L5 liveness annotations. They never decide membership. This is why the resolver returns the same answer with a fresh, empty `overdeck.db`. Resource discovery may temporarily retain a live-resource row when a project's durable membership lookup is unavailable; it leaves membership annotations unset and does not treat a successful empty result as unavailable.

## Buckets

| Bucket | Meaning |
| --- | --- |
| `in_flight` | The issue is open and has an open PR. |
| `zombie_pr` | The issue is closed but its PR remains open and needs reconciliation. Reclassifies to `clean_terminal` if a terminal close-out record exists (L7-record), since the stale PR becomes residue (PAN-3396). |
| `post_merge_limbo` | Work is merged — a merged PR exists, or the branch's unique commits are contained in `main` via merge lineage (positive non-PR evidence, PAN-2887) — but the issue remains open. |
| `planned_backlog` | An open issue has a convention branch (unmerged work, or a fresh zero-ahead branch with no unique commits yet — PAN-2887) or a durable xBRIEF but no open PR. |
| `clean_terminal` | The issue is closed with no open PR, or it is open but has never started and has no durable plan. It is outside the pipeline. Also used for closed issues with an open PR when a terminal close-out record exists (residue case, PAN-3396): the PR is residue and must be closed on the forge. |

### Surface reconciliation (PAN-3341)

Resource discovery and frontend lane assignment defer to the canonical membership verdict when stored tracker or record phases are stale. A `post_merge_limbo` issue renders as **Merged — Needs Close-Out** and enters the Ship lane; this is the only membership bucket that overrides a stored phase. The shared issue-action state also treats this bucket as merged, which enables the existing **Close out** action.

A `clean_terminal` verdict renders **Done** when no tmux session remains and **Closed** when a session remains, but only when `L3_issueOpen === false`. The guard preserves the existing state for open, never-started backlog issues, which also use the `clean_terminal` bucket. When membership is unavailable, resource labels, lane assignment, and actions continue to use their existing tracker and artifact signals.

### Display filtering (PAN-2822)

The dashboard Issues pane has a display-only toggle for rows whose `planned_backlog` membership comes from the L6 durable-spec lens. The preference is visible by default and persists under the localStorage key `overdeck.ui.showPlannedBacklog`; disabling it hides only rows with the derived `specOnlyPlanned` DTO field set to `true`. Rows classified through the unmerged-branch or ready-label reasons remain visible.

The toggle does not change `resolvePipelineMembership()` or any membership or resource API response. The server derives `specOnlyPlanned` from `PLANNED_BACKLOG_SPEC_ONLY_REASON`, and list surfaces apply the preference after receiving the unchanged resource data.

`labelDrift` is `stale_present` when a phase label survives a terminal/closed lifecycle and `stale_absent` when an open PR has no phase label. It is `null` when the label agrees or no drift rule applies.

## Read doors

All consumers use one of these representations of the same verdict:

- Library: `resolvePipelineMembership()` in `src/lib/pipeline-membership.ts`, with signals from `gatherProjectLensSignals()` in `src/lib/pipeline-membership-gather.ts`. GitLab projects route merge request queries through `src/lib/gitlab-merge-requests.ts`, which provides `listOpenGitLabMergeRequests()` and `listGitLabMergedMergeRequestHeads()` — both cached with a 30s TTL to avoid repeated CLI queries, and the latter uses per-head exact queries with `--merged` flag to efficiently determine merged status.
- Dashboard API: `GET /api/pipeline/membership?project=<project-key>`, backed by the cached membership service. `POST /api/pipeline/membership/refresh?project=<project-key>` is the operator-initiated retry: it forces a re-gather via `refreshMembershipSnapshotsForProjects()` (PAN-2972) and returns the fresh snapshot, because re-reading a cold snapshot can never heal it.
- Issue DTO: total `pipelineMembership` with `available`, `inPipeline`, `bucket`, and `labelDrift`, used by the dashboard frontend. `available: false` means durable membership could not be resolved; a successful lookup with no candidate is explicitly `clean_terminal`.

The merge-eligibility consumers use this same read door. The Deacon's
`readyForMerge` blocker, stuck-ready patrol, and startup sweep require `in_flight`
membership before acting. `listEligibleCandidatesByProject()` applies the same gate to
the merge-train projection, and the merge-next endpoint gathers membership again before
shipping the selected head. A row in any other bucket remains visible for disposition
but cannot enter a merge action.

Dashboard GET requests are snapshot-only; they never gather tracker or git evidence inside the request. A successful GET or POST refresh returns HTTP `200` with the bare `PipelineMembership[]` array. A completed gather that could not determine membership also returns HTTP `200`, but with `{ status: 'unavailable', reason, message, projectKey }`. The typed reason is one of `missing_issue_prefix`, `repo_unavailable`, `default_branch_unresolved`, `forge_unavailable`, `tracker_unconfigured`, or `gather_failed`, so callers can distinguish an empty pipeline from a blind spot. When multiple reasons apply to the same project, the checks run in precedence order: tracker type is resolved first (a project with no tracker reports `tracker_unconfigured`), then the issue prefix is checked (a project with a tracker but no prefix reports `missing_issue_prefix`). HTTP `503` is reserved for the transient cold-boot state while the first background refresh is still loading.

The frontend Retry button POSTs to the refresh route rather than refetching the GET. Loading and determined failures leave the issue tree and its actions mounted, with a status message or explicit Retry alongside them. Lifecycle events invalidate the affected query, so there is no interval membership poll.

No command, route, view, or skill may reconstruct membership from tracker state, workspaces, agents, tmux, or review rows. `scripts/lint-pipeline-membership.sh` enforces delegation for the six migrated consumers and rejects disposable-state imports in the resolver/gatherer boundary. Run `bash scripts/lint-pipeline-membership.sh --self-test` to verify that the guard detects seeded legacy and L5 violations.
