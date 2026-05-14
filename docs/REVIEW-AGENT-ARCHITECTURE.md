# Review Role Architecture

**How Panopticon runs code review after the Role primitive migration.**

This document describes the end-to-end architecture for automatic code review in the role-based pipeline. The review lifecycle is owned by the `review` role (`roles/review.md`). Its four convoy reviewers are harness-agnostic prompt templates owned by Panopticon, inlined into each convoy spawn message by the orchestrator.

For the broader mental model — what a Role is, how it relates to Claude Code subagent files, and why `.claude/agents/` is a sync target rather than a source of truth — see [ROLES.md](./ROLES.md).

---

## Invariants

1. **Review is a role, not a server-owned verdict.** Lifecycle dispatch starts `spawnRun(issueId, 'review')`; the dashboard observes state and artifacts.
2. **The server owns convoy lifecycle.** `spawnReviewRoleForIssue()` spawns the synthesis role and all four convoy reviewers directly, then Deacon monitors reviewer crash/timeout cases.
3. **Synthesis is the review decision.** The `review` role waits for `REVIEWER_READY` / `REVIEWER_FAILED` / `REVIEWER_TIMEOUT` messages delivered through `pan tell`, reads ready reviewer outputs, synthesizes their findings, and emits the verdict. Those messages are sent by each reviewer's **launcher** on process exit (PAN-977) — not by the reviewer agent itself, and not by Deacon on the happy path.
4. **Review never merges.** Approved review transitions the issue toward `test`; branch preparation and push work belongs to `ship`, and final merge remains human-gated.
5. **Convoy outputs are evidence, not votes.** Security/correctness/performance/requirements findings inform synthesis; the review role decides what blocks.
6. **Convoy prompts are harness-agnostic templates.** The orchestrator reads each `roles/review-<subRole>.md` template at spawn time and inlines its body into the convoy reviewer's first user message. The convoy never relies on Claude Code's `--agent` flag, never reads a file from the agent's workspace, and never appears as an ambient subagent that a work agent could auto-discover.

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
  ├─ each reviewer writes ~/.panopticon/agents/<reviewer>/review-<subRole>.md
  ├─ each reviewer's LAUNCHER signals synthesis on process exit (PAN-977):
  │    REVIEWER_READY   <subRole> <outputPath>   (report file written)
  │    REVIEWER_FAILED  <subRole> <reason>       (exited, no report)
  │    REVIEWER_TIMEOUT <subRole> <reason>       (timeout 1200s killed it)
  │    then touches ~/.panopticon/agents/<reviewer>/reviewer-signaled
  ├─ Deacon is the rare backup: only signals when the launcher's own bash
  │    process was SIGKILLed before it could (no reviewer-signaled marker)
  ├─ synthesis reads ready output files and synthesizes one verdict
  └─ synthesis signals via Panopticon's CLI
        │
        ├─ pan specialists done review <id> --status passed  → review.approved → test role
        └─ pan specialists done review <id> --status blocked → notify `work` with blockers
```

The dashboard displays the current review status from persisted review state and domain events. It does not own the review decision.

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

The convoy templates are read by `src/lib/cloister/review-agent.ts` via `readConvoySubRoleTemplate(subRole)`, which resolves them from `packageRoot/roles/` — Panopticon's own install, **not** the agent's workspace. This keeps the prompts:

- **Harness-agnostic.** The same body is delivered to a Claude Code reviewer, a Pi reviewer, or any future harness as its first user message. The harness never has to parse Panopticon-specific frontmatter.
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
| `requirements` | Acceptance criteria coverage, vBRIEF fulfillment, missing functionality | [`verification/plan-checking.md`](https://github.com/deftai/directive/blob/main/verification/plan-checking.md) |

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

Each convoy reviewer writes exactly one report to its assigned output file under `~/.panopticon/agents/<reviewerAgentId>/review-<subRole>.md`, then stops. The reviewer **does not** signal synthesis itself — it does not run `pan tell` and does not need to `exit` cleanly.

**The launcher owns the signal (PAN-977).** For a Claude Code review sub-role, `spawnRun` generates a launcher that runs `timeout 1200 claude --print ... < initial-prompt.md` as a *child* process (not `exec`). When `claude` exits, the launcher's own bash process inspects the outcome and signals synthesis exactly once:

- exit code `124` → `REVIEWER_TIMEOUT <subRole> ...`
- report file is non-empty → `REVIEWER_READY <subRole> <outputPath>`
- otherwise (crash, early exit, empty file) → `REVIEWER_FAILED <subRole> ...`

It then `touch`es `~/.panopticon/agents/<reviewerAgentId>/reviewer-signaled`. This makes the happy path *and* the failure path self-contained in the launcher's bash process: the agent cannot forget to signal, cannot double-signal, and a crash still produces `REVIEWER_FAILED`. The synthesis role never spawns reviewers and never polls files or tmux; it waits for one terminal signal per sub-role, reads the output paths from `REVIEWER_READY`, then writes `.pan/review/<runId>/synthesis.md` and signals the verdict via `pan specialists done review`.

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

Model selection is role-based and resolved through `resolveModel(role, subRole, config)`:

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
        model: workhorse:mid
      correctness:
        model: workhorse:mid
      performance:
        model: workhorse:mid
      requirements:
        model: workhorse:mid
```

Harness selection follows the same role/sub-role shape. Because the convoy prompts are inlined, the choice between Claude Code, Pi, or another harness does not change the reviewer's instructions — only the runtime. See [`HARNESSES.md`](./HARNESSES.md) for Pi vs Claude Code behavior and ToS rules.

---

## Cost attribution

Review cost events use `PANOPTICON_SESSION_TYPE` as the stage key. The synthesis
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

The first cut of the role migration parked the convoy prompts as Claude Code subagent files under `.claude/agents/code-review-*.md`. That worked for the Claude Code harness in panopticon-cli's own workspaces but coupled the prompt format to one harness's `--agent` mechanism and made the prompts auto-discoverable inside any session. The current layout — `roles/review-<subRole>.md`, inlined by the orchestrator, never synced into project workspaces — keeps the prompts harness-agnostic and orchestrator-owned.
