# Pipeline Membership

Pipeline membership is an exception queue: an issue is in the pipeline when its durable state is not provably a clean terminal state. This definition keeps active work and lifecycle drift visible while excluding untouched backlog and correctly closed work.

## Durable lenses

`gatherProjectLensSignals()` builds membership from six durable signals:

1. An open pull request for the convention branch.
2. A merged pull request, which is the merge oracle for squash merges.
3. A convention branch plus its unmerged relationship to `main`, evaluated with git.
4. Whether the tracker issue is open.
5. The current pipeline phase label, when present.
6. A durable vBRIEF spec on `overdeck-state`.

A vBRIEF makes an otherwise untouched open issue `planned_backlog` because its recorded code paths age. A `planned` label is only a phase hint; it never substitutes for the durable spec lens.

Agent state, tmux sessions, workspaces, and `review_status` are L5 liveness annotations. They never decide membership. This is why the resolver returns the same answer with a fresh, empty `overdeck.db`.

## Buckets

| Bucket | Meaning |
| --- | --- |
| `in_flight` | The issue is open and has an open PR. |
| `zombie_pr` | The issue is closed but its PR remains open and needs reconciliation. |
| `post_merge_limbo` | Work is merged or already present in `main`, but the issue remains open. |
| `planned_backlog` | An open issue has an unmerged convention branch or durable vBRIEF but no open PR. |
| `clean_terminal` | The issue is closed with no open PR, or it is open but has never started and has no durable plan. It is outside the pipeline. |

`labelDrift` is `stale_present` when a phase label survives a terminal/closed lifecycle and `stale_absent` when an open PR has no phase label. It is `null` when the label agrees or no drift rule applies.

## Read doors

All consumers use one of these representations of the same verdict:

- Library: `resolvePipelineMembership()` in `src/lib/pipeline-membership.ts`, with signals from `gatherProjectLensSignals()` in `src/lib/pipeline-membership-gather.ts`.
- Dashboard API: `GET /api/pipeline/membership?project=<project-key>`, backed by the cached membership service.
- Issue DTO: optional `pipelineMembership` with `inPipeline`, `bucket`, and `labelDrift`, used by the dashboard frontend.

No command, route, view, or skill may reconstruct membership from tracker state, workspaces, agents, tmux, or review rows. `scripts/lint-pipeline-membership.sh` enforces delegation for the six migrated consumers and rejects disposable-state imports in the resolver/gatherer boundary. Run `bash scripts/lint-pipeline-membership.sh --self-test` to verify that the guard detects seeded legacy and L5 violations.
