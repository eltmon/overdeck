# Review Role Architecture

**How Overdeck runs code review after the Role primitive migration.**

This document describes the end-to-end architecture for automatic code review in the role-based pipeline. The review lifecycle is owned by the `review` role (`roles/review.md`). Its four convoy reviewers are harness-agnostic prompt templates owned by Overdeck, inlined into each convoy spawn message by the orchestrator.

For the broader mental model — what a Role is, how it relates to Claude Code subagent files, and why `.claude/agents/` is a sync target rather than a source of truth — see [ROLES.md](./ROLES.md).

---

## Invariants

1. **Review is a role, not a server-owned verdict.** Lifecycle dispatch starts `spawnRun(issueId, 'review')`; the dashboard observes state and artifacts.
2. **The server owns convoy lifecycle.** `spawnReviewRoleForIssue()` spawns the synthesis role; the convoy reviewers are launched either inline (non-Claude harnesses) or by `handleReviewDiscoveryReady()` after the parent's shared-discovery signal (Claude Code, PAN-1862 — see "Warm-parent discovery + fork"). Deacon monitors reviewer crash/timeout cases and backstops a parent that never signals.
3. **Synthesis is the review decision.** The `review` role waits for `REVIEWER_READY` / `REVIEWER_FAILED` / `REVIEWER_TIMEOUT` messages delivered through `pan tell`, reads ready reviewer outputs, synthesizes their findings, and emits the verdict. Those messages are sent by each reviewer's **launcher** on process exit (PAN-977) — not by the reviewer agent itself, and not by Deacon on the happy path.
4. **Review never merges.** Approved review transitions the issue toward `test`; branch preparation and push work belongs to `ship`, and final merge remains human-gated.
5. **Convoy outputs are evidence, not votes.** Security/correctness/performance/requirements findings inform synthesis; the review role decides what blocks.
6. **Convoy prompts are harness-agnostic templates.** The orchestrator reads each `roles/review-<subRole>.md` template at spawn time and inlines its body into the convoy reviewer's first user message. The convoy never relies on Claude Code's `--agent` flag, never reads a file from the agent's workspace, and never appears as an ambient subagent that a work agent could auto-discover.

---

## Review modes: quick / full (convoy) / none

What *kind* of review runs is a three-scope setting, resolved at the single
review entry point (`spawnReviewRoleForIssue()` → `resolveReviewMode()`), so the
trigger route, host auto-dispatch, and every Deacon re-dispatch site honor it:

| Scope | Where it lives | How to set it |
| --- | --- | --- |
| **Per-issue** (wins) | the per-issue record (`reviewMode`, `reviewModel`) | `pan review mode <id> <quick\|full\|none>` or the issue-header Policies control. `reviewModel` applies one explicit model to the synthesis parent and every reviewer in the next convoy. |
| **Per-project** | `.pan.yaml` → `roles.review.mode` | edit the project config (merged over global by `mergeConfigs()`) |
| **Global** | `~/.overdeck/config.yaml` → `roles.review.mode` | Settings → Roles → Review → *Review mode* selector |

The three modes:

- **`quick` (default)** — ONE review agent (`agent-<id>-review`) performs a single
  combined pass over the diff (correctness + security + requirements + performance
  in one report) and signals the verdict itself. No convoy, no synthesis fan-out,
  no fork. Cheapest AI review that still blocks real problems.
- **`full`** — the four-reviewer **convoy** (`security`, `correctness`,
  `performance`, `requirements` — `REVIEW_SUB_ROLES`) plus the synthesis parent
  as the fifth review role. Highest-scrutiny mode; this is the mode all the
  PAN-1862 machinery below (discovery fork, selective re-review, per-reviewer
  verdicts, model-uniformity banner) applies to.
- **`none`** — no AI review at all. `spawnReviewRoleForIssue()` records
  `reviewStatus: 'skipped'` (which passes the merge gate exactly like
  `testStatus: 'skipped'`) and the lifecycle advances as if review approved.
  The pre-review **verification gate** (typecheck/lint/test floor) still runs —
  `none` skips only the AI review, never the quality floor.

**Re-review scope** (`full` mode only) is the second knob, same three scopes:
per-issue record (`pan review scope <id> <all|changed|blockers>` / cockpit
selector) → `roles.review.reReviewScope` per-project → global; default `changed`.
It governs which convoy reviewers re-run on a re-review cycle (see "Selective
re-review" below).

---

## The work ↔ review loop

The full round trip between the work agent and review:

1. **work → review:** the work agent finishes its beads and runs `pan done`,
   which rebases + pushes, records the durable `reviewRequestedAt` intent in the
   journal, and triggers review dispatch. If the reactive trigger is dropped, the
   host auto-dispatches from the journal intent on the next status read
   (PAN-1988) — no deacon required. The intent lifecycle has four stages: `pan
   done` **writes** it before HTTP progression; dispatch **services** it by
   stamping `reviewSpawnedAt`; a terminal verdict **consumes** it by clearing a
   serviced request from status and the journal; and `needsReviewDispatch`
   **guards** passed, skipped, and `readyForMerge` states from dispatch. Genuine
   re-review paths reset `reviewStatus` to `pending` first. PAN-3083 added the
   consumption and guards after an unconsumed intent repeatedly re-dispatched
   passed-and-ready issues and invalidated their UAT generations. An unserviced
   intent dies after `REVIEW_REQUEST_MAX_AGE_MS` (7 days): the next status read
   clears it from the journal and emits one warning plus an activity entry. The
   closed-issue reaper also clears unserviced intent when the tracker issue closes;
   its patrol reads durable journals asynchronously and checks tracker closure in
   bounded groups of four so pending requests cannot serialize the Deacon loop.
   Host-side dispatch runs only in the dashboard server process, because only that
   process registers the durable review pipeline handler; CLI processes emit at
   most one debug line per process and skip dispatch.
2. **Review runs** in the resolved mode (above). Sessions are **warm by
   default** (PAN-2579): recording a verdict never kills the session; re-review
   resumes reviewers with their prior-cycle context.
3. **APPROVED / SKIPPED:** `setReviewStatusSync` emits `review.approved`;
   reactive Cloister dispatches the test role. No agent-to-agent hop is needed.
4. **BLOCKED / FAILED:** the verdict write is durable FIRST (and guarded — a
   stale dispatch-side 'reviewing' write can never clobber a terminal verdict,
   PAN-2578); then `deliverReviewVerdictFeedback` posts the PR comment, writes
   the feedback file (`.overdeck/feedback/NNN-review-agent-*.md`), and messages
   the work agent directly. The delivery key is stable for `(issueId, runId)`, so
   writing `reviewedAtCommit` after delivery cannot create a duplicate, while a
   later run gets a fresh key even after drift reset clears the anchor. Legacy
   callers without a run ID fall back to the reviewed anchor; if neither identity
   exists, delivery is unkeyed rather than risking suppression of a later run. If
   the work agent is not running, the delivery door RESURRECTS it (unpause pipeline pauses,
   clear troubled gates, resume stopped agents — PAN-2209/PAN-2461) before ever
   escalating to the operator.
5. **work again:** the work agent fixes the findings, commits, and pushes. The
   blocked-review drift patrol observes the stable new HEAD over two patrol
   ticks, resets review to `pending`, and starts a NEW review cycle, which in
   `full` mode is a **selective** re-review. `pan review request <id>` remains the
   manual fallback when automatic re-dispatch does not begin.

---

## Verdict application and fallback sweeps

A completed review writes its verdict under `.pan/review/<runId>/`. Full convoy
reviews write `synthesis.md`; quick self-reviews write `review.md`. Both files
use the same heading contract: `## Verdict: APPROVED` for a pass or
`## Verdict: CHANGES REQUESTED — <one-line top blocker>` for a blocked review.
The shared verdict-report reader accepts both filenames and this vocabulary, so
recovery does not depend on which review mode produced the report.

Verdict application has three ordered layers:

1. The review agent signals through `pan admin specialists done review`, which
   durably writes review status and delivers blocked feedback before the run is
   considered complete.
2. `checkCompletedButUnsignaledReviews()` recovers a report whose status remains
   `reviewing`: it nudges a live review parent once, then applies the verdict if
   the parent stays unresponsive or has died.
3. `reconcileUnappliedReviewVerdicts()` repairs the incident shape where a
   report exists but review status has already reset to `pending`. It uses the
   same nudge-first policy and applies the on-disk verdict after the grace
   period, with an activity entry naming the sweep.

The fallback sweeps fail closed. They wait for the report settle window, reject
a report when the current workspace HEAD differs from `context.json`'s review
anchor, and skip it when a newer `reviewRequestedAt` postdates the report. A
blocked verdict resolves its work-agent delivery target through the agents table
before resurrection or escalation, so `feedback_delivery_needs_you` means no
eligible live registered session was found rather than that only the canonical
tmux name was checked.

---

## Polyrepo workspaces (PAN-2948)

For `workspace.type: polyrepo` projects the workspace root is a one-commit
wrapper repo whose `.gitignore` excludes the code sub-repos (`fe/`, `api/`, …),
so no review-path git operation may run at the workspace root. The review
pipeline resolves the actual repo roots via `resolveWorkspaceRepoRootsSync()`
(`src/lib/project-repos.ts`) — monorepo degenerates to a single root at the
workspace path:

- **Context manifest** (`review-context.ts`): per-sub-repo merge-base/diff
  against each repo's target branch, aggregated with `repoKey/`-prefixed paths
  and an additive `repos: [{repoKey, branch, headSha, diffBase, fileCount}]`
  manifest field. Top-level `headSha`/`branch` come from the first sub-repo
  with changes.
- **runId head suffix** (`review-agent.ts`): monorepos keep their short HEAD;
  polyrepos use the first eight hex characters of a SHA-1 over the full composite
  snapshot, so a commit in any sub-repo creates a distinct review directory.
- **Dispatch pushes** (`review-pipeline.ts`): one shared helper pushes each
  sub-repo's `feature/<issue>` where the branch exists locally; the wrapper is
  never pushed.
- **Drift anchors** (`reviewedAtCommit`, `lastVerifiedCommit`, reviewer verdict
  `atCommit`): `snapshotWorkspaceHeadsPromise()` records a composite
  `fe@<sha> api@<sha>` snapshot. Composite anchors compare equal iff every
  sub-repo head is unchanged; consumers that use an anchor as a git ref fail
  the lookup and fall back to their conservative full-rerun path
  (`computeConvoyScope` diffs in the primary sub-repo for the same reason).
- **Inspection checkpoints** (`inspect-checkpoints.ts`): per-item diffs run in
  the code sub-repos and checkpoints store the same composite head snapshot.
  On later items, unchanged repos are omitted so an inspector never reviews an
  older commit from an untouched repo or the wrapper's `.gitignore` commit.
- **Verification** (`verification-runner.ts`): target-branch sync and the
  empty-changeset guard loop over every resolved repo. Any content change in any
  repo satisfies the guard; a failed repo diff skips the guard conservatively.
  When a container gate reports infrastructure unavailable, verification waits
  for the triggered stack rebuild to settle before another cycle can start.

### Verdict anchors (`HeadAnchor`)

`snapshotWorkspaceHeadsPromise()` is the only producer of `HeadAnchor`: one full
SHA for a monorepo, or a space-separated `repoKey@sha` token for every polyrepo
code root. `parseCompositeSnapshot()` is the one lenient parser for inspecting
that composite shape; `parseWorkspaceHeadAnchor()` remains the strict validator
used before passing an anchor to Git.

The TypeScript brand prevents a plain string from entering the review-status
write door. A value read from SQLite, a durable issue record, or another wire
boundary may regain the brand only through `rehydrateHeadAnchor()`, with a
comment naming that storage boundary. The pairing rule is: **a compare site may only compare against what the producer stamped**.

The five converted stamp/compare sites are:

1. `checkPostReviewCommits()` in `cloister/deacon-post-review-commits.ts`
   compares `reviewedAtCommit` through the composite-aware drift evaluator.
   Passed reviews reset immediately on real drift. Blocked reviews also detect
   pushed rework: legacy rows without `reviewedAtCommit` may derive an anchor
   only when every `reviewerVerdicts[*].atCommit` agrees, and a real new HEAD
   must remain unchanged for two consecutive patrol ticks before review is
   reset and re-dispatched. The debounce prevents per-item pushes from starting
   review while the work agent is still committing the rest of the rework.
2. Role-run liveness stamps in `agents/spawn.ts` and compares in
   `cloister/service-reactive.ts` using the same full `roleRunHead` anchor.
3. `POST /api/review/:issueId/status` in `routes/workspaces.ts` stamps
   `reviewedAtCommit` from the producer.
4. The legacy specialists-done route stamps `reviewedAtCommit` from the
   producer.
5. The verification/review contradiction bypass in `cloister/deacon.ts` stamps
   `reviewedAtCommit` from the producer.

A legacy wrapper SHA compared with a current composite anchor is intentionally
reported as drift once. That conservative reset writes the new producer shape,
so subsequent patrols stabilize instead of repeating. The historical failure
signature was MIN-901 logging 56 resets like `(fe@52d65 → 7492ae82)`: the first
value was a composite truncated with `substring(0, 8)`, while the second was the
wrapper SHA. Logs now render every token as `repoKey@<8-char sha>`.

---

## Warm-parent discovery + fork (PAN-1862, `full` mode on Claude Code)

The convoy's first-cycle cost problem: four reviewers independently reading the
same diff and files = 4× full-price input. The fix exploits Anthropic's
content-addressed prompt cache (keyed by a hash of the prefix per model — not
by session id):

1. **Discovery:** the synthesis parent spawns with a discovery-first prompt —
   read the context manifest, the committed diff, and the high-risk changed
   files, so that content lives in the parent's session history (and the warm
   cache).
2. **Signal:** the parent runs `pan admin specialists discovery-ready review
   <id>` exactly once at its turn boundary.
3. **Fork:** `handleReviewDiscoveryReady()` copies the parent's JSONL to a fresh
   session id per in-scope reviewer (shared `session-fork.ts` primitive, full
   history, thinking-blocks sanitized) and launches each with
   `claude --resume <forkedId>`. The forked reviewers replay a byte-identical
   prefix → **cache reads (~10% of input price)** instead of re-reading.
   The kickoff tells each reviewer the context is already in history and why.
4. **Synthesis:** the parent survives unmodified and synthesizes as always.

Per-reviewer fork conditions (each failure degrades to an independent fresh
spawn — reviews are never blocked by a cache concern): parent harness is
`claude-code`, the reviewer resolves to the **same model** as the parent (the
Settings → Roles red banner warns when the five review roles are not
model-uniform), and the reviewer has no resumable prior-cycle session of its own
(its own context beats a re-fork).

Backstops (Deacon patrol): `checkStalledReviewDiscovery` forces the convoy if a
parent never signals within 8 minutes (or dies); `checkReviewForkCacheMisses`
reads each forked reviewer's first cost event and reports `cacheRead == 0` as a
warn-level activity entry + desktop notification, including the discovery→fork
gap vs the 5-minute cache TTL. Misses are observability only — correctness never
depends on the cache landing.

---

## Selective re-review + per-reviewer verdicts (PAN-1862, `full` mode)

Synthesis records a **per-reviewer verdict** map alongside the aggregate:
`reviewerVerdicts[subRole] = { status: passed|blocked, atCommit, findingsPath }`
(journal-durable; written via `pan admin specialists done review … --reviewers
"security=passed,correctness=blocked,…"`, or by the Deacon fallback synthesis).
The workspace HEAD is stamped as `atCommit` on every verdict — a BLOCKED
aggregate is exactly the cycle whose clean reviewers the next pass wants to skip.

On a re-review cycle, `reviewersToRerun()` decides who actually runs from
`reReviewScope`:

- `all` — all four, every cycle.
- `changed` (default) — reviewers that blocked, PLUS any reviewer whose domain
  is touched by files changed since its `atCommit` (correctness/requirements:
  any change; security: security-sensitive paths; performance: hot-path files).
- `blockers` — only reviewers that blocked.

Anything unprovable — no verdict, no commit anchor, an unreachable anchor after
a rebase, an unknown diff — always re-runs (quality first, NFR-1). Reviewers NOT
re-run have their verdict **carried forward** as a stub report in the new run
directory, so synthesis and the Deacon fallback still see one report per
sub-role, unchanged. The synthesis prompt lists which signals to expect and
which verdicts are carried.

---

## The flow

```
work role completes beads and signals done
  │
  │  Cloister quality gate passes
  ▼
spawnReviewRoleForIssue(issueId)
  │
  ├─ spawnRun(issueId, 'review')
  │    └─ synthesis role (roles/review.md, Claude --agent on Claude Code harness)
  │
  ├─ spawnRun(issueId, 'review', { subRole: 'security' })      ← roles/review-security.md (inlined)
  ├─ spawnRun(issueId, 'review', { subRole: 'correctness' })   ← roles/review-correctness.md (inlined)
  ├─ spawnRun(issueId, 'review', { subRole: 'performance' })   ← roles/review-performance.md (inlined)
  ├─ spawnRun(issueId, 'review', { subRole: 'requirements' })  ← roles/review-requirements.md (inlined)
  │
  ├─ each reviewer writes ~/.overdeck/agents/<reviewer>/review-<subRole>.md
  ├─ each reviewer's LAUNCHER signals synthesis on process exit (PAN-977):
  │    REVIEWER_READY   <subRole> <outputPath>   (report file written)
  │    REVIEWER_FAILED  <subRole> <reason>       (exited, no report)
  │    REVIEWER_TIMEOUT <subRole> <reason>       (timeout 1200s killed it)
  │    then touches ~/.overdeck/agents/<reviewer>/reviewer-signaled
  ├─ Deacon is the rare backup: only signals when the launcher's own bash
  │    process was SIGKILLed before it could (no reviewer-signaled marker)
  ├─ synthesis reads ready output files and synthesizes one verdict
  └─ synthesis signals via Overdeck's CLI
        │
        ├─ pan specialists done review <id> --status passed  → review.approved → test role
        └─ pan specialists done review <id> --status blocked → notify `work` with blockers
```

The dashboard displays the current review status from persisted review state and domain events. It does not own the review decision.

---

## Strike-origin PR review support

A strike agent works in `workspaces/feature-<id>-strike` on branch `strike/<id>` and opens its PR against that branch. Review dispatch must follow the workspace, not assume the conventional `feature/<id>` branch. All Deacon review-dispatch sites in `src/lib/cloister/deacon-review-status.ts` derive the branch from the resolved workspace path via `inferBranchFromWorkspace()` in `src/lib/lifecycle/archive-planning.ts`: paths ending in `-strike` map to `strike/<id>`, otherwise `feature/<id>`. The dashboard's `pan review restart --rerun` path resolves the workspace the same way. This makes strike-origin PRs reviewable without a manual `pan workspace create` (PAN-2270).

---

## Instruction layout

Two distinct on-disk shapes drive review behavior:

```
roles/
├── review.md                  # synthesis role definition (Claude frontmatter
│                              # for tools/hooks; loaded via --agent on Claude Code)
├── review-security.md         # convoy sub-role prompt template (harness-agnostic,
│                              # no frontmatter; inlined into spawn message)
├── review-correctness.md
├── review-performance.md
└── review-requirements.md
```

The convoy templates are read by `src/lib/cloister/review-agent.ts` via `readConvoySubRoleTemplate(subRole)`, which resolves them from `packageRoot/roles/` — Overdeck's own install, **not** the agent's workspace. This keeps the prompts:

- **Harness-agnostic.** The same body is delivered to a Claude Code reviewer, a Pi reviewer, or any future harness as its first user message. The harness never has to parse Overdeck-specific frontmatter.
- **Workflow-injected, not auto-discovered.** Work agents running in project workspaces never see these files in their tree, so there is no risk of a work agent ambiently spawning a reviewer subagent or "self-reviewing" before the convoy fires.
- **Versioned with code.** Behavior changes ship in the same commit as the role file change, reviewed under the same gates.

There is no synthesis sub-role template. Synthesis is the review role itself.

---

## Reviewer semantics

Each convoy reviewer has a distinct focus and uses the same severity/evidence vocabulary across roles, drawn from the [`deftai/directive`](https://github.com/deftai/directive) verification framework.

| Reviewer | Primary focus | Directive link |
|----------|---------------|----------------|
| `correctness` | Logic errors, edge cases, null handling, type safety, stub detection | [`verification/verification.md`](https://github.com/deftai/directive/blob/main/verification/verification.md) |
| `security` | OWASP Top 10, injection, authn/authz, secrets, supply-chain risk | — |
| `performance` | Algorithms, N+1 queries, memory leaks, allocation hot paths | — |
| `requirements` | Acceptance criteria coverage, xBRIEF fulfillment, missing functionality | [`verification/plan-checking.md`](https://github.com/deftai/directive/blob/main/verification/plan-checking.md) |

### Severity glyphs (RFC 2119)

| Glyph | Meaning | Maps to synthesis tier |
|-------|---------|------------------------|
| `!` | MUST | Blocker / Critical |
| `~` | SHOULD | High |
| `≉` | SHOULD NOT | High |
| `⊗` | MUST NOT | Blocker |
| `?` | MAY | Medium / Low |

### Verification ladder

Findings carry the tier of evidence they cite:

- **Tier 1 — Static**: files exist, lint passes, no stubs
- **Tier 2 — Command**: tests pass, build succeeds
- **Tier 3 — Behavioral**: browser/CLI/API confirms behavior
- **Tier 4 — Human**: UAT-level verification required

Synthesis uses tier as a tiebreaker when the same finding is raised at different confidence levels by multiple reviewers.

---

## Output and signal contract

Each convoy reviewer writes exactly one report to its assigned output file under `~/.overdeck/agents/<reviewerAgentId>/review-<subRole>.md`, then stops. The reviewer **does not** signal synthesis itself — it does not run `pan tell` and does not need to `exit` cleanly.

**The launcher owns the signal (PAN-977).** For a Claude Code review sub-role, `spawnRun` generates a launcher that runs `timeout 1200 claude --print ... < initial-prompt.md` as a *child* process (not `exec`). When `claude` exits, the launcher's own bash process inspects the outcome and signals synthesis exactly once:

- exit code `124` → `REVIEWER_TIMEOUT <subRole> ...`
- report file is non-empty → `REVIEWER_READY <subRole> <outputPath>`
- otherwise (crash, early exit, empty file) → `REVIEWER_FAILED <subRole> ...`

It then `touch`es `~/.overdeck/agents/<reviewerAgentId>/reviewer-signaled`. This makes the happy path *and* the failure path self-contained in the launcher's bash process: the agent cannot forget to signal, cannot double-signal, and a crash still produces `REVIEWER_FAILED`. The synthesis role never spawns reviewers and never polls files or tmux; it waits for one terminal signal per sub-role, reads the output paths from `REVIEWER_READY`, then writes `.pan/review/<runId>/synthesis.md` and signals the verdict via `pan specialists done review`.

**Deacon is the rare backup, not the happy path.** `monitorReviewConvoySignals` skips any reviewer whose `reviewer-signaled` marker is newer than the run's `startedAt` — the launcher already signaled. Deacon only signals `REVIEWER_FAILED` / `REVIEWER_TIMEOUT` itself when that marker is absent, i.e. the launcher's bash process was SIGKILLed before it could run its contract block. Synthesis treats either failure signal as a blocking infrastructure failure.

Human-readable review output should include:

```markdown
# Verdict: APPROVED | CHANGES_REQUESTED | FAILED

## Summary
<what changed, what was verified, and the decision>

## Blockers
<required fixes before the pipeline can continue>

## Evidence
<tests, static checks, file/line citations, or browser proof>

## Convoy Notes
<security/correctness/performance/requirements highlights>
```

Machine-readable status uses the existing review-status fields and lifecycle events:

- `reviewStatus: 'passed'` emits `review.approved`
- `reviewStatus: 'failed'` / blocked notes keep the issue with `work`
- `reviewedAtCommit` snapshots the HEAD reviewed so new commits can reset review

---

## Model and harness configuration

Model selection is role-based and resolved through `resolveModel(role, subRole, config)`. A sub-role can set `model: parent` to inherit the parent role's effective model:

```yaml
workhorses:
  expensive: claude-opus-4-7
  mid: claude-sonnet-4-6
  cheap: claude-haiku-4-5

roles:
  review:
    model: workhorse:expensive
    sub:
      security:
        model: parent          # inherits roles.review.model
      correctness:
        model: workhorse:mid
      performance:
        model: workhorse:mid
      requirements:
        model: workhorse:mid
```

`parent` is valid only for sub-role models (`roles.<role>.sub.<subRole>.model`). It is rejected for role-level models (`roles.<role>.model`) and workhorse slots (`workhorses.<slot>`), because those fields have no parent role to inherit from.

Harness selection follows the same role/sub-role shape. Because the convoy prompts are inlined, the choice between Claude Code, Pi, or another harness does not change the reviewer's instructions — only the runtime. See [`HARNESSES.md`](./HARNESSES.md) for Pi vs Claude Code behavior and ToS rules.

---

## Cost attribution

Review cost events use `OVERDECK_SESSION_TYPE` as the stage key. The synthesis
role records as `review`; convoy reviewers record as `review.security`,
`review.correctness`, `review.performance`, and `review.requirements`.

`pan cost issue <issueId>` reads the cost-event aggregate first and prints a
**By Review Role** section when any review stages are present. The display maps
`review` to `synthesis` so a full run can be compared as one synthesis cost plus
four reviewer costs.

Baseline on 2026-05-11 for PAN-1059: the local cost database has no historical
PAN-1059 events, so there is no reliable pre-change per-reviewer measurement.
The measurable baseline after this change is the five-stage split above.

---

## Dashboard restart invariant

The dashboard is a projection layer:

- It receives domain events over `/ws/rpc`.
- It reads review status from persisted storage.
- It can display role-run sessions through the terminal WebSocket.
- It does not hold in-memory reviewer promises that must survive restart.

Restarting the dashboard drops subscriptions and terminal connections, but role runs continue in tmux and persisted state catches the dashboard up on boot.

---

## What this replaced

The pre-role architecture used `pan review run`, source prompt templates under `src/lib/cloister/prompts/review/`, and detached reviewer/synthesis tmux sessions coordinated outside the role runner. The Role primitive migration (PAN-1048) replaced that with a single lifecycle entry point: `spawnRun(issueId, 'review')`.

The first cut of the role migration parked the convoy prompts as Claude Code subagent files under `.claude/agents/code-review-*.md`. That worked for the Claude Code harness in overdeck's own workspaces but coupled the prompt format to one harness's `--agent` mechanism and made the prompts auto-discoverable inside any session. The current layout — `roles/review-<subRole>.md`, inlined by the orchestrator, never synced into project workspaces — keeps the prompts harness-agnostic and orchestrator-owned.
