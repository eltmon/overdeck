# Review Agent Architecture

Overdeck review is a direct convoy: four independent reviewers produce evidence, a
review parent synthesizes it, and the verdict write door records one terminal
outcome. The pipeline has no discovery phase, fork tree, lane-selection policy,
or autonomous branch-repair loop.

For the role taxonomy and the distinction between pipeline roles and Claude Code
subagents, see [ROLES.md](./ROLES.md).

---

## Invariants

1. **A full review always launches the complete convoy.** Security, correctness,
   performance, and requirements run in parallel for every full review. Recovery
   may launch a missing lane only when that lane has neither a report nor a live
   session.
2. **The review parent owns synthesis.** It reads the four reports, writes the
   durable synthesis evidence, and signals one review result.
3. **`recordReviewVerdict()` is the only terminal verdict write door.** Review
   artifacts, reviewer reports, Deacon recovery, and dispatch logic never write a
   terminal review status directly.
4. **Artifacts are evidence, never authority.** A report is usable only for the
   host-recorded active `reviewRunId` and its recorded head anchor. The worktree is
   writable by the work agent, so a file alone cannot change pipeline state.
5. **Blocked feedback is durable and delivered.** Once the write door records a
   blocked verdict, it writes the feedback file, posts the PR comment, and uses
   `pan tell` to notify the work agent.
6. **Review never merges.** Review determines whether code advances to testing;
   the dashboard merge path remains separately human-gated.

---

## Review modes

`spawnReviewRoleForIssue()` resolves the review mode at the single review entry
point, so manual requests, automatic dispatch, and recovery use the same mode.

| Mode | Behavior |
| --- | --- |
| `quick` | One review agent performs a combined pass and writes `review.md`. |
| `full` | The review parent plus the four-lane convoy run in parallel; the parent writes `synthesis.md`. |
| `none` | AI review is skipped, but the verification quality floor still applies. |

A full review never substitutes a prior report for a fresh convoy lane. If rework
changes code, the next full review runs every lane again.

---

## The direct nine-step flow

1. **Work finishes.** The work agent commits, pushes, and calls `pan done`; the
   durable review request records that review is due.
2. **Dispatch records the review run.** `spawnReviewRoleForIssue()` records the
   active `reviewRunId` and the workspace head anchor before it starts reviewers.
3. **Dispatch launches the complete convoy.** The synthesis parent and security,
   correctness, performance, and requirements lanes all start in the same
   dispatch. The parent waits for its reviewers; it does not perform a preparatory
   investigation first.
4. **Each lane reviews independently.** A lane reads the supplied review context
   and writes its assigned report. The launcher reports lane completion to the
   parent; Deacon only supplies failure recovery when that launcher cannot.
5. **The parent synthesizes evidence.** Once all terminal lane reports are
   available, the parent reads them and writes `.pan/review/<runId>/synthesis.md`.
6. **The parent signals one verdict.** The canonical review completion signal
   supplies the verdict, notes, run identity, and evidence head to
   `recordReviewVerdict()`.
7. **The write door validates and persists.** It rejects provably stale evidence,
   accepts equal, fresh, and indeterminate anchors as specified below, and records
   the terminal review result. A dispatch attempt first consults an already-settled
   active artifact so it cannot overwrite a verdict with `reviewing` or start a
   duplicate parent.
8. **A pass advances to testing.** The persisted passed or skipped review outcome
   lets the regular test role dispatch. A new review verdict at a different head
   re-gates an existing terminal test result; a same-head verdict preserves it.
9. **A block returns actionable feedback.** The write door records the block,
   writes the feedback artifact, comments on the PR, and sends the work agent the
   required changes. After the agent commits and pushes rework, the next full
   review begins at step 1.

The dashboard projects durable review state and domain events. It does not decide
whether a review passes or rewrite review state from an artifact.

---

## Verdict of record

Full reviews write `synthesis.md`; quick reviews write `review.md`. Both are
recovery evidence for their host-recorded active run. A recovery consumer must
require all of the following before it can ask the write door to converge state:

- the artifact belongs to the active `reviewRunId`;
- the artifact includes a readable head anchor;
- the artifact is within the review-artifact freshness bound; and
- the current workspace head equals the artifact anchor.

`recordReviewVerdict()` in
`src/lib/cloister/review-verdict-writer.ts` is the sole terminal write door. It
classifies differing evidence and row anchors with per-repository
`git merge-base --is-ancestor` probes:

- **equal anchors** land without re-gating an existing terminal test result;
- **stale evidence** is rejected with `review.verdict_rejected` and an activity
  entry;
- **fresh evidence** lands and sets `reviewedAtCommit` to the evidence anchor;
- **indeterminate evidence** lands conservatively when the anchor shapes or a git
  probe cannot prove it stale.

When a fresh or indeterminate verdict lands at a different anchor and the row has
`testStatus: passed` or `skipped`, the write door returns the test gate to
`pending`. The notes identify both anchors and the writer tag, so the resulting
verification is tied to the current reviewed code.

### Recovery

A dead parent does not strand a completed convoy. The fallback reads the completed
lane reports for the active run, writes a synthesis artifact, and calls the same
write door. The unsignaled reconciler also converges pending or reviewing rows
through that door after the settle window, current-head check, newer-request
check, and freshness check. It preserves the normal blocked-feedback path.

The stall sweeper is observation-only. It may recommend that an operator inspect
fresh evidence, but it never writes a verdict, clears a stuck flag, starts a
reviewer, stops an agent, or un-parks an issue.

---

## Evidence and polyrepo anchors

`snapshotWorkspaceHeadsPromise()` is the producer for review `HeadAnchor` values:
a monorepo anchor is one full SHA, while a polyrepo anchor is a space-separated
set of `repoKey@sha` tokens. `parseCompositeSnapshot()` is the shared parser for
inspection; persisted strings regain the `HeadAnchor` brand only through
`rehydrateHeadAnchor()` at the storage boundary.

This keeps review evidence tied to the actual code repositories rather than the
polyrepo wrapper repository. A composite/bare shape mismatch is indeterminate,
not proof of code drift, so it cannot spuriously erase a review verdict.

---

## Convoy prompts and output

The parent uses `roles/review.md`. The four lane prompts live in
`roles/review-security.md`, `roles/review-correctness.md`,
`roles/review-performance.md`, and `roles/review-requirements.md`. The
orchestrator reads each lane template and inlines it into that reviewer's spawn
message; they are not ambient Claude Code subagents and are not synced into a
project workspace.

Each lane produces one report. The parent records the combined decision in the
run artifact using this human-readable shape:

```markdown
# Verdict: APPROVED | CHANGES_REQUESTED | FAILED

## Summary

## Blockers

## Evidence

## Convoy Notes
```

The individual lanes cover correctness, security, performance, and requirements.
Their reports are evidence rather than independent votes: the parent evaluates
severity, code citations, tests, and requirement coverage before producing one
verdict.

---

## Removed layers and accepted tradeoffs

The simplified flow intentionally drops several former mechanisms. This table
makes the protections no longer provided by the pipeline explicit.

| Removed layer | Protection given up | Accepted tradeoff |
| --- | --- | --- |
| Shared-discovery parent phase | A preliminary shared investigation and inherited reviewer context | Four independent reviewers can repeat small amounts of context reading, but dispatch is direct and failure handling is simpler. |
| Parent-session forks and prompt-cache headers | Parent-context reuse and cache-hit telemetry | Review cost may increase, but there is no fork lifecycle, cache-key coupling, or cache-miss monitor to operate. |
| Selective lane reruns and carried-forward reports | Reusing an unchanged lane's prior report | Every full review gets a complete, current evidence set rather than mixing reports from different commits. |
| Per-reviewer verdict state | A machine-readable lane-by-lane verdict ledger | Lane reports remain durable evidence while synthesis remains the only review decision. |
| Re-review scope configuration and command | Operator-selected subsets of the convoy | Full review semantics are uniform: all four lanes run. |
| Background sibling-branch invalidation | Automatic conflict and CI discovery after another branch merges | The work agent or operator explicitly runs `pan sync-main <id>` and follows ordinary rework and review gates. |
| Sweeper action and un-parking events | Autonomous repair of parked pipeline rows | The sweeper reports evidence and a recommendation only, so it cannot damage completed work through a false positive. |

**Verdict forgery is a non-threat in this deployment.** The deployment trust model
does not treat a hostile local actor as an adversary, and artifacts still cannot
write review status: active-run binding, anchor validation, and
`recordReviewVerdict()` protect against ordinary stale or misplaced files without
adding an artifact-signing subsystem.

---

## Review convergence

Blocked review cycles record their blocker count. After three or more cycles, a
reversal (the newest count rises) or a stall (two non-decreases) marks the issue
`review-not-converging`. The issue remains blocked with its feedback and a
needs-you escalation; automatic rework re-drive stops until an operator runs
`pan unstick <issueId>` or decomposes the work.

This cross-cycle safety gate is separate from a single review parent's judgment
about which findings matter in one convoy.

---

## Related files

- `src/lib/cloister/review-agent.ts` — dispatches the parent and full convoy.
- `src/lib/cloister/review-verdict-writer.ts` — terminal verdict write door.
- `src/lib/cloister/verdict-restore.ts` — active-artifact convergence helper.
- `src/lib/cloister/deacon-review-unsignaled.ts` — settled-artifact recovery.
- `roles/review.md` and `roles/review-*.md` — parent and lane instructions.
- `docs/ROLES.md` — role and harness taxonomy.
