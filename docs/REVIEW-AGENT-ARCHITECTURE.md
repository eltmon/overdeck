# Review Agent Architecture

Overdeck review is a direct convoy: four independent reviewers produce evidence, a
review parent synthesizes it, and posts one terminal PR review — approve or
request changes. The pipeline has no discovery phase, fork tree, lane-selection
policy, or autonomous branch-repair loop, and it stores no review status of its
own: the PR review *is* the verdict of record.

For the role taxonomy and the distinction between pipeline roles and Claude Code
subagents, see [ROLES.md](./ROLES.md).

---

## Invariants

1. **A full review always launches the complete convoy.** Security, correctness,
   performance, and requirements run in parallel for every full review. Recovery
   may launch a missing lane only when that lane has neither a report nor a live
   session.
2. **The review parent owns synthesis.** It reads the four reports, writes the
   durable synthesis evidence, and posts one PR review (approve or request
   changes) as the terminal result.
3. **The PR review is the only terminal verdict.** Reviewer reports, deacon-lite
   recovery, and dispatch logic never write a review status anywhere else — there
   is nowhere else to write it.
4. **Artifacts are evidence, never authority on their own.** A report only makes
   sense for the run that produced it, against the commit it reviewed. The
   worktree is writable by the work agent, so a stale file alone cannot post a
   verdict; the posted PR review is what matters.
5. **Blocked feedback is durable and delivered.** A request-changes review posts
   PR comments with the findings and uses `pan tell` to notify the work agent.
6. **Review never merges.** Review determines whether code advances to testing;
   the dashboard merge path remains separately human-gated.

### How the verdict reaches the forge

GitHub refuses to record a review on your own pull request
(`Can not request changes on your own pull request`). On a single-account
install the PR author and the reviewer are the same account, so every verdict
was rejected, `reviewDecision` stayed empty, and nothing downstream —
rework delivery, the review-stale gate, the merge-ready set — ever saw a
decision. `postReviewVerdict` therefore tries two identities, in order:

1. **The GitHub App.** When `~/.overdeck/github-app/` holds credentials, the
   `gh pr review` call runs with an installation token in `GH_TOKEN`, so the
   review is authored by `panopticon-agent[bot]`, which is never the PR author
   and whose review GitHub accepts.
2. **A marker comment.** If the forge still refuses a self-review (no app
   installed, or the bot opened the PR), the verdict is posted as a PR comment
   whose first line is a machine marker:

   ```
   <!-- overdeck-verdict: CHANGES_REQUESTED -->
   ```

   (or `APPROVED`), followed by the verdict body. The result carries
   `via: 'comment'` so the CLI can say which path was used.

`pr-facts` reads both. A real forge `reviewDecision` always wins; only when the
forge reached no decision does it take the newest marker comment. An `APPROVED`
marker older than the PR's head commit does **not** count — a stale approval
must never merge commits it never saw — while a stale `CHANGES_REQUESTED` still
counts, because rework stays owed until a newer verdict says otherwise.

GitLab is unchanged: approval is `glab mr approve`, a rejection is an MR note,
and there is no marker.

---

## Review modes

`spawnReviewRoleForIssue()` resolves the review mode at the single review entry
point, so manual requests, automatic dispatch, and recovery use the same mode:
`roles.review.mode` from merged project and global config, defaulting to `quick`.
A caller may pass `reviewMode` for one run. The dashboard's Request review menu
(Full, Quick, None) sends it through `POST /api/review/:id/trigger`. It takes
precedence over config for that run only and is never persisted, so the next
dispatch resolves config again.

Because a run's mode can differ from config, the dashboard's reviewer tree
reads the mode from the run itself (`currentRunIsConvoy` in
`src/dashboard/server/routes/reviewer-tree.ts`). The review parent's
`reviewRunId` names the current run. The tree shows the four convoy lanes only
when a lane's state row carries that `reviewRunId`, or its `<role>.md` report
is in `.pan/review/<runId>/`. A self-review writes into the same run directory,
so the directory alone does not show the mode.

| Mode | Behavior |
| --- | --- |
| `quick` | One review agent performs a combined pass and writes `review.md`. |
| `full` | The review parent plus the four-lane convoy run in parallel; the parent writes `synthesis.md`. |
| `none` | AI review is skipped, but the verification quality floor still applies. |

The shared `roles/review.md` is mode-neutral: it supplies evidence, severity,
coverage, verification, and reporting standards. `buildSelfReviewPrompt` supplies
only the combined-review workflow. `buildReviewRolePrompt` supplies the full-mode
wait/signals/synthesis workflow. Quick review never receives instructions to
wait for a convoy and then an override telling it to ignore them.

Combined review applies explicit correctness, security, performance, and
requirements/UX checklists. Reviewers finish assigned coverage and a second pass
before signaling, distinguish implementation from specification defects, and
trace real callers before reporting a helper-probe failure as a product bug.
The report records changed-file coverage and acceptance-criterion evidence,
including whether tests exercise real entry points and run in normal gates.
There are no per-commit finding caps. New evidence of a real blocker remains
reportable on later cycles, with an explanation of why it was missed earlier.
The mechanical non-convergence escalation below is unchanged.

Reviewers reuse successful verification for the exact reviewed HEAD or run
focused checks. Overdeck TypeScript/Effect/compiler changes require the Effect
diagnostic ratchet; documentation/style-only changes can mark it not applicable.
This does not disable any CI or pipeline verification gate. Probe fixtures must
be isolated from live operator state.

### Prompt refactor no-loss audit

| Previous obligation | Current home |
| --- | --- |
| Mode and output file selection | Mode-specific dispatch in `review-agent.ts` |
| Full-mode wait, four terminal signals, failure handling, early-read exception | `buildReviewRolePrompt` only |
| Stale-signal guard and exact run ID | Full dispatch; preserved |
| PR scope, prior review evidence, deduplication, severity | Shared `roles/review.md` |
| Report head/base, findings, convoy status, AC coverage | Shared report contract plus full dispatch |
| One completion signal, contention fallback, Pi sentinel | Shared role plus exact dispatch commands |
| No merge, no delegation, no host lifecycle changes, no test dispatch | Shared role boundaries |
| Notify orchestration before a silent stall | Shared role; preserved |
| Arbitrary blocker-count cap and hiding previously missed blockers | Deliberately removed; evidence determines severity |
| Four specialist scope/checklists and completion contracts | Existing specialist templates, with evidence and coverage additions |

Focused tests in `review-agent.test.ts`, `role-definitions.test.ts`, and
`code-review-agent-definitions.test.ts` guard mode separation and these contracts.

A full review never substitutes a prior report for a fresh convoy lane. If rework
changes code, the next full review runs every lane again.

---

## The direct flow

1. **Work finishes.** The work agent (the foreman) commits, pushes, and calls
   `pan done`, which opens or updates the PR and requests review.
2. **Dispatch launches the complete convoy.** The synthesis parent and security,
   correctness, performance, and requirements lanes all start against the PR's
   current head. The parent waits for its reviewers; it does not perform a
   preparatory investigation first.
3. **Each lane reviews independently.** A lane reads the supplied review context
   and writes its assigned report. The launcher reports lane completion to the
   parent; deacon-lite only nudges a stuck reviewer, it never completes one.
4. **The parent synthesizes evidence.** Once all terminal lane reports are
   available, the parent reads them and writes `.pan/review/<runId>/synthesis.md`.
5. **The parent posts one PR review.** Approve, or request changes with the
   findings as PR comments. That review *is* the verdict — nothing else records it.
6. **A pass makes the PR mergeable** once checks are also green; merge readiness
   is computed live from the PR's current approvals and checks, never cached.
7. **Request-changes returns actionable feedback.** The parent's PR comments and
   a `pan tell` nudge send the work agent what to fix. After it commits and
   pushes rework, the next full review begins at step 2 against the new head.

The dashboard renders review state from the PR and reviewer-pane liveness. It
does not decide whether a review passes or hold any review state of its own.

---

## Staying current with new commits

A review posted against an old commit is a fact about that commit, not a live
gate — GitHub already tracks which commit a review approved and whether the
branch has moved since. Overdeck does not cache a separate "review is stale"
flag: readiness is recomputed from the PR's live approvals against its current
head every time it is checked. A push after an approval simply means the next
readiness check sees an unreviewed head; `pan review request` (or another
push) re-triggers the convoy.

### Recovery

A dead parent does not strand a completed convoy. The fallback reads the
completed lane reports for the active run and posts the PR review itself. A
reviewer's exit writes its own liveness state — the review sub-role launcher
runs `pan admin agents exited <agentId> --code <n>` when the reviewer process
exits, and the Stop-hook's convoy reaper calls the same verb before killing a
signaled reviewer's session. deacon-lite's `reconcileAgentLiveness` is the
backstop when that exit write is missed — it reconciles the dashboard's
liveness cache from the terminal backend's own inventory, never from inference
about review outcome.

The stall sweeper is observation-only. It may recommend that an operator inspect
fresh evidence, but it never posts a verdict, starts a reviewer, stops an agent,
or un-parks an issue.

---

## Evidence and polyrepo anchors

`snapshotWorkspaceHeads()` is the producer for review `HeadAnchor` values:
a monorepo anchor is one full SHA, while a polyrepo anchor is a space-separated
set of `repoKey@sha` tokens. `parseCompositeSnapshot()` is the shared parser for
inspection. Persisted strings do not regain the `HeadAnchor` brand: the
rehydrate helper had no caller and was removed in PAN-3958 CH-8.

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
write a verdict: only the parent's own PR-review call does that, so an ordinary
stale or misplaced report file cannot pass or fail anything on its own.

---

## Review convergence

The PR's own review thread is the convergence record: each request-changes
round's comments stay visible alongside the next round's, so a reversal
(a defect count rising instead of falling) or a stall (repeated non-decreasing
findings across three or more rounds) is visible directly in the PR history —
no separate counter is kept. When rounds are not converging, the work agent
escalates to the operator (`needs-you`) rather than looping the convoy
indefinitely; the operator decomposes the work or intervenes on the branch.

This cross-cycle judgment is separate from a single review parent's assessment
of which findings matter in one convoy.

---

## Related files

- `src/lib/cloister/review-agent.ts` — dispatches the parent and full convoy.
- `roles/review.md` and `roles/review-*.md` — parent and lane instructions.
- `docs/ROLES.md` — role and harness taxonomy.
