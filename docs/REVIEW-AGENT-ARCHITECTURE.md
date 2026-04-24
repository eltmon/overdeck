# Review Agent Architecture

**How Panopticon runs code review: work-agent-as-orchestrator, dashboard-as-view.**

This document describes the end-to-end architecture for automatic code review. It is
the system-level companion to [`SPECIALIST_WORKFLOW.md`](./SPECIALIST_WORKFLOW.md)
(operational view) and [`PRD-CLOISTER.md`](./PRD-CLOISTER.md) (specialist pipeline).

---

## Invariants

The architecture is designed around four hard requirements. If you find yourself
violating any of these, stop and reconsider.

1. **Dashboard restart is invisible to in-flight reviews.** The `pan up` / `pan
   restart` lifecycle MUST NOT interrupt reviewers, synthesis, or result posting.
   Tmux sessions doing the reviewing continue reviewing as if nothing happened.
2. **The dashboard is a pure view.** It watches `.pan/review/**` and
   `tmux list-sessions` and renders. It owns zero orchestration endpoints for
   reviews.
3. **The work agent orchestrates its own review.** When ready, the work agent
   invokes a single blocking CLI (`pan review run`) and reads the result files
   when it returns. No server-owned lifecycle, no fire-and-forget promises.
4. **Synthesis is the judgment layer.** Per-project synthesis prompt + model
   decide what blocks vs what's a nit. Reviewer outputs are raw findings; the
   verdict is synthesized, not voted.

---

## The flow

```
Work agent (Claude, in its own tmux session)
  │
  │  (implementation complete, PR open, ready for review)
  │
  ▼
EXEC: `pan review run <issueId>`             ← blocking shell command
         │
         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 1 — spawn reviewers in parallel                        │
  │                                                              │
  │  reviewId = review-<issueId>-<timestamp>                     │
  │  mkdir .pan/review/<reviewId>/                               │
  │                                                              │
  │  For each reviewer in config (correctness, security,         │
  │                               performance, requirements):    │
  │    • load prompt:   .claude/prompts/                         │
  │                       code-review-<role>.prompt-template.md  │
  │    • inject ctx:    PR url, issue id, workspace path,        │
  │                     files changed, output file path          │
  │    • write merged prompt: <reviewDir>/<role>-prompt.md       │
  │    • resolve model from `specialist-review-agent` config     │
  │    • spawn tmux session `review-<issueId>-<ts>-<role>`       │
  │        running launcher:                                     │
  │          tmux pipe-pane -o 'cat >> <role>-claude.log'        │
  │          claude --prompt <role>-prompt.md                    │
  │          tmux wait-for -S done-<reviewId>-<role>             │
  │    • reviewer writes:  .pan/review/<reviewId>/<role>.md      │
  └──────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 2 — wait for all reviewers                             │
  │                                                              │
  │  `pan review run` blocks on N wait-for channels              │
  │  (one per role). When the last signals, continue.            │
  │  Per-role timeout enforced; on miss, mark role as failed     │
  │  and continue with partial outputs (synthesis decides how    │
  │  to handle).                                                 │
  └──────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 3 — synthesize                                         │
  │                                                              │
  │  • load prompt:   .claude/prompts/                           │
  │                     code-review-synthesis.prompt-template.md │
  │  • inject ctx:    review dir, list of reviewer output paths, │
  │                   synthesis.md + synthesis.json output paths │
  │  • resolve model from `specialist-review-agent` config       │
  │  • spawn tmux session `review-<issueId>-<ts>-synthesis`      │
  │        running launcher; block on done channel               │
  │  • synthesis writes:                                         │
  │      .pan/review/<reviewId>/synthesis.md                     │
  │      .pan/review/<reviewId>/synthesis.json                   │
  │        { verdict, blockerCount, reviewId }                   │
  └──────────────────────────────────────────────────────────────┘
         │
         ▼
  ┌──────────────────────────────────────────────────────────────┐
  │ PHASE 4 — post + exit                                        │
  │                                                              │
  │  • read synthesis.json                                       │
  │  • post GitHub PR review                                     │
  │      verdict=approved    → APPROVED                          │
  │      verdict=changes     → CHANGES_REQUESTED                 │
  │      verdict=failed      → COMMENTED + retry hint            │
  │  • print output paths                                        │
  │  • exit with status code reflecting verdict                  │
  │      0 = approved, 1 = changes, 2 = failed                   │
  └──────────────────────────────────────────────────────────────┘
         │
         ▼
Work agent reads .pan/review/<reviewId>/synthesis.md
         │
         ├─ approved → signal ready-to-merge (proceed to merge flow)
         └─ changes  → address blockers, commit, resubmit → new reviewId
```

---

## File layout

All review artifacts live under the workspace at `.pan/review/<reviewId>/`:

```
.pan/review/<reviewId>/
├── correctness-prompt.md       (merged: context header + prompt template)
├── correctness.md              (reviewer output)
├── correctness-claude.log      (pipe-pane capture for postmortem)
├── security-prompt.md
├── security.md
├── security-claude.log
├── performance-prompt.md
├── performance.md
├── performance-claude.log
├── requirements-prompt.md
├── requirements.md
├── requirements-claude.log
├── synthesis-prompt.md
├── synthesis.md                ← the file the work agent reads
├── synthesis.json              ← { verdict, blockerCount, reviewId }
└── synthesis-claude.log
```

`reviewId` format: `review-<issueId>-<unixMillis>`. Example:
`review-PAN-539-1713456789000`.

Each resubmit creates a new `reviewId` directory — prior review history is
preserved, not overwritten. The dashboard can render diffs across cycles
("this blocker was flagged in review-PAN-539-1713456789000 and again in
review-PAN-539-1713458001234").

---

## Prompts are primitives

All review prompts live at repo root in `.claude/prompts/` with the
`.prompt-template.md` suffix:

```
.claude/prompts/
├── code-review-correctness.prompt-template.md
├── code-review-security.prompt-template.md
├── code-review-performance.prompt-template.md
├── code-review-requirements.prompt-template.md
└── code-review-synthesis.prompt-template.md
```

The name carries two facts: **prompt** (this is a first-class prompt primitive given
to an LLM) and **template** (it contains placeholders filled in at spawn time via a
context header).

### Context header injection

Before handing a prompt to `claude --prompt`, the spawner prepends a context header
with the invocation-specific data:

```markdown
# Review Context

**Pull Request**: https://github.com/org/repo/pull/123
**Issue ID**: PAN-539
**Workspace Path**: /home/user/workspaces/feature-pan-539
**Files changed**: src/lib/foo.ts, src/lib/bar.ts
**Output file**: /home/user/workspaces/feature-pan-539/.pan/review/review-PAN-539-1713456789000/correctness.md

---

<prompt template body>
```

This means prompt templates themselves are path-agnostic — they are reusable across
issues and workspaces without edits.

### Workspace overrides

A project may override any review prompt by placing a file with the same filename
in its own `.claude/prompts/`. The resolver checks workspace first, then falls back
to the Panopticon default.

### Why not `.claude/agents/`?

The `.claude/agents/` directory is Claude Code's **sub-agent** convention — files
there are loadable via the Claude Code `Agent` tool by name. Panopticon's review
prompts are NOT Claude Code sub-agents; they are prompt sources loaded directly and
fed to `claude --prompt`. Keeping them under `.claude/agents/` implies semantics we
don't use. `.claude/prompts/` aligns with Panopticon's existing prompt convention
(`src/lib/cloister/prompts/work.md`, `planning.md`).

---

## Reviewer semantics

Each reviewer role has a distinct focus and cites the
[`deftai/directive`](https://github.com/deftai/directive) verification framework for
consistent severity vocabulary and acceptance criteria taxonomy.

### Severity glyphs (RFC 2119)

Reviewers annotate findings with directive's severity glyphs:

| Glyph | Meaning | Maps to synthesis tier |
|-------|---------|------------------------|
| `!`   | MUST     | Blocker / Critical    |
| `~`   | SHOULD   | High                  |
| `≉`   | SHOULD NOT | High                |
| `⊗`   | MUST NOT | Blocker               |
| `?`   | MAY      | Medium / Low          |

Synthesis maps these to the blocker/critical/high/medium/low tiers and applies
project policy to decide what BLOCKS the merge vs what's an advisory nit.

### Acceptance criteria taxonomy

Reviewers (especially `requirements` and `correctness`) classify findings using
directive's three subcategories of verifiable outcomes:

- **Truths** — observable behaviors that must hold ("user can sign up with email")
- **Artifacts** — files with real content (not stubs; required exports present)
- **Key Links** — wiring between artifacts (imports resolve, routes have consumers)

### Verification ladder

Findings carry the **tier** of evidence they cite, per directive's 4-tier ladder:

- **Tier 1 — Static**: files exist, lint passes, no stubs
- **Tier 2 — Command**: tests pass, build succeeds
- **Tier 3 — Behavioral**: browser/CLI/API confirms behavior
- **Tier 4 — Human**: UAT-level verification required

Synthesis uses tier as a tiebreaker when the same finding is raised at different
confidence levels by multiple reviewers.

### Role-specific emphasis

| Reviewer | Primary focus | Directive link |
|----------|---------------|----------------|
| `correctness`   | Logic errors, edge cases, null handling, type safety, stub detection | [`verification/verification.md`](https://github.com/deftai/directive/blob/main/verification/verification.md) |
| `security`      | OWASP Top 10, injection, authn/authz, secrets, supply-chain risk | — |
| `performance`   | Algorithms, N+1 queries, memory leaks, allocation hot paths | — |
| `requirements`  | Acceptance criteria coverage, vBRIEF fulfillment, missing functionality | [`verification/plan-checking.md`](https://github.com/deftai/directive/blob/main/verification/plan-checking.md) |

---

## Synthesis as the judgment layer

Synthesis is where review policy lives. A project configures:

1. **Synthesis model** — which model's judgment applies (typically stronger than the
   individual reviewer models). Set via `specialist-review-agent` work type in
   Panopticon config; can be split into a separate `specialist-review-synthesis-agent`
   override if a project wants a different model for judgment.
2. **Synthesis prompt** — the policy encoding. What constitutes a blocker, what
   demotes to a nit, how to handle disagreement between reviewers, how strict to be
   on edge cases, etc.

### Output contract

**`synthesis.md`** — human-readable. First line is the verdict. Structure:

```markdown
# Verdict: CHANGES_REQUESTED

## Summary
<executive summary — what must be fixed before merge>

## Blockers (MUST fix before merge)
1. <title> — <file:line> — <severity glyph> — fix instruction
2. ...

## High Priority
...

## Nits (OK to defer)
...

## Review Stats
<counts by severity, by reviewer, files touched>

## Appendix: Individual Reviews
- correctness.md
- security.md
- performance.md
- requirements.md
```

**`synthesis.json`** — minimal machine-readable sidecar:

```json
{
  "reviewId": "review-PAN-539-1713456789000",
  "verdict": "changes_requested",
  "blockerCount": 2,
  "generatedAt": "2026-04-24T12:34:56Z"
}
```

`verdict` ∈ `{approved, changes_requested, failed}`. No other fields — this file is
consumed by the GitHub poster and the dashboard only. All substantive content lives
in `synthesis.md`.

### Deduplication and attribution

When multiple reviewers flag the same issue (e.g., security and correctness both
catch a SQL injection):

- Combine into a single finding
- Credit all reviewers who found it
- Use the highest severity assigned
- Include each reviewer's perspective in the finding body

Synthesis does NOT add new findings — it synthesizes, not reviews.

---

## Dispatch mechanics: the coordinator session

When Panopticon's server (or any trigger) calls `dispatchParallelReview()`, it
does NOT run `runParallelReview` in-process. Instead it spawns a **detached
tmux session** named:

```
review-coordinator-<issueId>-<unixMillis>
```

…running `pan review run <issueId>` in bash. This session is owned by the tmux
server (not the Node server that spawned it), so it survives dashboard / server
restarts. When `pan review run` exits, the shell exits, and tmux destroys the
session automatically.

Inside the coordinator session, `pan review run` spawns per-reviewer tmux
sessions named:

```
review-<issueId>-<unixMillis>-<role>
review-<issueId>-<unixMillis>-synthesis
```

All three session patterns (`review-coordinator-*`, per-reviewer, synthesis)
are owned by the tmux server and survive independently of the dashboard.

## Abort semantics

`pan review abort <issueId>` (routed through
`POST /api/review/:issueId/abort`) kills all tmux sessions matching EITHER:

- `review-coordinator-<issueId>-*` (the orchestrator)
- `review-<issueId>-*` (per-reviewer + synthesis)

That's it — no state manipulation beyond resetting `reviewStatus` to `pending`.

Because `pan review run` inside the coordinator is blocking on `tmux wait-for`
channels (via `waitForReviewer`), killing the reviewer sessions closes those
channels. The CLI exits non-zero, the coordinator session exits, and the
dashboard observes the terminal state when it reads the DB.

No "orphaned orchestration" is possible: orchestration lives only inside the
coordinator session, which is bounded by `REVIEW_TIMEOUT_MS` and cleanly
terminates on abort.

---

## Dashboard restart invariant

The dashboard is NEVER involved in orchestration. Concretely:

- `pan review run` is invoked by the work agent and runs in the work agent's tmux
  context, not the dashboard process.
- Reviewer and synthesis tmux sessions are independent of the dashboard process —
  they are managed by the tmux server, which has its own lifecycle.
- Output files are on disk. The dashboard reads them.
- The dashboard's "review tab" for a workspace is a projection of:
  - Existence of `.pan/review/<reviewId>/` directories
  - Presence of `<role>.md` files (completed reviewers)
  - Presence of `synthesis.md` / `synthesis.json` (completed review)
  - Tmux sessions matching `review-<issueId>-*` (in-flight)

Restarting the dashboard drops its connection to all watchers and subscriptions.
On boot, it scans the filesystem and tmux state, and its view catches up. No review
state needs to be recovered because the dashboard never held review state.

---

## Configuration

Reviewers configured via `~/.panopticon/config.yaml` (global) or project-level
`.panopticon.yaml`:

```yaml
specialists:
  review_agents:
    - name: correctness
      focus: [logic, edge cases, null handling, type safety]
    - name: security
      focus: [OWASP Top 10, injection, auth, secrets]
    - name: performance
      focus: [algorithms, N+1 queries, memory leaks]
    - name: requirements
      focus: [acceptance criteria, vBRIEF coverage, missing functionality]
```

Enabling or disabling reviewers is list membership; adding a custom reviewer
requires placing a matching prompt template at
`.claude/prompts/code-review-<name>.prompt-template.md`.

Model selection is via work-type routing (see [`WORK-TYPES.md`](./WORK-TYPES.md)
and [`MODEL_ROUTING.md`](./MODEL_ROUTING.md)):

```yaml
work_types:
  specialist-review-agent: claude-sonnet-4-6
  specialist-review-synthesis-agent: claude-opus-4-7  # optional separate dial
```

If `specialist-review-synthesis-agent` is not set, synthesis uses
`specialist-review-agent`.

---

## CLI reference

### `pan review run <issueId>`

Blocking. Runs the full review pipeline (Phases 1-4 above). Writes outputs to
`.pan/review/<reviewId>/`. Exits with:
- `0` = approved
- `1` = changes requested
- `2` = failed (reviewers crashed or timed out beyond recovery)

### `pan review abort <issueId>`

Kills all tmux sessions matching `review-<issueId>-*`. Does not touch the work
agent. The work agent's in-flight `pan review run` (if any) will exit non-zero.

### `pan review status <issueId>` (read-only)

Prints current review state for an issue by scanning `.pan/review/` + tmux. No
server query — this is a filesystem/tmux snapshot.

---

## What this replaces

Prior architecture (pre-refactor):

- `runParallelReview()` ran in the dashboard server process as an async function
- `dispatchParallelReview` fire-and-forget promise held reviewer/synthesis state
- `waitForReviewer` polled output files from inside the server
- Server restart killed the in-flight promise, orphaning reviewer sessions and
  leaving synthesis unrun

That orchestration is deleted. In its place, the work agent invokes
`pan review run`, which owns one bounded, blocking pipeline per call.

The server keeps only:
- `POST /api/review/:issueId/abort` — trimmed to "kill matching tmux sessions"
- `GET /api/workspaces/:issueId/review-status` — reads from filesystem state only

---

## Why not alternatives we considered

Brief notes on alternatives evaluated and rejected, so future architects can see
the reasoning:

- **Server-side Effect fibers with PubSub.** Cleaner than fire-and-forget promises,
  but fibers die with the server process. Dashboard restart would still orphan
  reviews — violates invariant 1. Rejected.
- **Deacon-as-reconciler.** Poll review state, advance on each tick. Violates the
  event-driven goal and puts review orchestration in a subsystem (deacon) whose
  job is agent health monitoring. Mixing concerns. Rejected.
- **Tmux hook chain (no CLI).** Each reviewer's `session-closed` hook triggers
  the next phase via shell. Works, but critical orchestration logic ends up in
  bash. Fragile and hard to test. Rejected.
- **vBRIEF-structured reviewer output.** Reviewers emit `<role>.vbrief.json` and
  synthesis merges structurally. Elegant, but the work agent parses JSON no
  better than markdown, and the structural merge is not much simpler than the
  prose merge synthesis already does. Deferred — markdown + tiny JSON sidecar
  is enough.
- **Beads from review findings.** Every finding becomes a tracked bead. Pollutes
  the bead queue with churn (findings rewrite every cycle) and mixes "original
  scope" with "review-driven rework." Rejected. The work agent can `bd create`
  voluntarily if a finding warrants persistence.
- **MCP tool instead of CLI.** Structured input/output, streaming progress,
  cross-host reuse. Real benefits, but bash CLI ships faster and MCP can wrap it
  later without rework. Deferred.

---

## State cleanup: event-driven, not retention-driven

Panopticon writes agent state to `~/.panopticon/agents/<name>/` and specialist
feedback to `<workspace>/.planning/feedback/NNN-*.md`. Both become useless at
a well-defined moment — we delete at that moment rather than on a timer.

### What's deleted, and when

| Artifact | Deleted on event | Safety net |
|---|---|---|
| `~/.panopticon/agents/review-<issueId>-<ts>-<role>/` (reviewer + synthesis state) | End of `runParallelReview` Phase 6, immediately after GitHub review posts | `reviewer_state_days` (default 1) |
| `~/.panopticon/agents/agent-<issueId>/` (work agent state) | `postMergeLifecycle` step 5b (merge) + `executeCloseOut` step 5 (close) | `agent_state_days` (default 7) |
| `~/.panopticon/agents/planning-<issueId>/` (planner state) | Same as work agent | `agent_state_days` (default 7) |
| `<workspace>/.planning/feedback/NNN-*.md` | Start of `dispatchParallelReview` (new review cycle clears previous-cycle feedback) | `cleanupAbandonedFeedback` deacon sweep |

### The feedback rule

`.planning/feedback/` is the **work agent's inbox of specialist findings**.
Files are `NNN-<specialist>-<outcome>.md`, written by review-agent,
test-agent, and the verification gate, with a monotonic sequence number. The
work agent reads them, addresses the feedback, and resubmits. Once consumed,
they're useless — we do NOT archive.

`clearFeedbackFiles()` deletes all `NNN-*.md` (and any legacy `archive/` tree
from the old archive-based implementation) at the start of every new review
cycle. For workspaces where no new cycle starts (abandoned workspace, stopped
agent), the deacon sweep catches up via `cleanupAbandonedFeedback()` — it
runs only when the work agent tmux session is gone AND no review is in
flight, so it can never race with current feedback.

### The retention safety net

Retention exists only for the case where the event-driven deletion missed
its trigger (process crashed between phases, power loss, killed mid-cleanup).
`cleanupStaleAgentState` in the deacon sweep purges:

- `review-*` dirs older than `reviewer_state_days` (default 1 day)
- non-reviewer dirs older than `agent_state_days` (default 7 days)

These defaults are intentionally short. Anything retained longer should go
through a conscious config override, not accumulated cruft.

### Why this replaces retention-as-primary

Old model (30-day retention for everything) let reviewer state accumulate
across hundreds of cycles — by the time the sweep ran, 990+ stale reviewer
dirs existed even though each one had been useless within seconds of its
review posting. The event-driven model deletes on the exact event that
renders the state useless, making retention a safety net rather than the
cleanup mechanism.

## Related documentation

- [`SPECIALIST_WORKFLOW.md`](./SPECIALIST_WORKFLOW.md) — operational workflow
  (work agent lifecycle, signalling completion, Cloister pipeline)
- [`PRD-CLOISTER.md`](./PRD-CLOISTER.md) — pipeline-wide specialist taxonomy
- [`MODEL_ROUTING.md`](./MODEL_ROUTING.md) — model resolution rules
- [`WORK-TYPES.md`](./WORK-TYPES.md) — `specialist-review-agent` and
  `specialist-review-synthesis-agent` work types
- [`DEACON-HEALTH-MONITORING.md`](./DEACON-HEALTH-MONITORING.md) — deacon's
  responsibilities (does NOT include review orchestration)
- [`deftai/directive`](https://github.com/deftai/directive) — verification
  framework cited by reviewer prompts
