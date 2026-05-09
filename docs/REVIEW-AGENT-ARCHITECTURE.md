# Review Role Architecture

**How Panopticon runs code review after the Role primitive migration.**

This document describes the end-to-end architecture for automatic code review in the role-based pipeline. The review lifecycle is now owned by the `review` role (`roles/review.md`), with convoy reviewers implemented as Claude Code subagents under `.claude/agents/`.

---

## Invariants

1. **Review is a role, not a server-owned promise.** Lifecycle dispatch starts `spawnRun(issueId, 'review')`; the dashboard observes state and artifacts.
2. **Synthesis is the review role.** There is no separate synthesis pipeline stage. The `review` role reads the diff, fans out review convoy subagents, synthesizes their findings, and emits the verdict.
3. **Review never merges.** Approved review transitions the issue toward `test`; branch preparation and push work belongs to `ship`, and final merge remains human-gated.
4. **Convoy outputs are evidence, not votes.** Security/correctness/performance/requirements findings inform synthesis; the review role decides what blocks.

---

## The flow

```
work role completes beads and signals done
  │
  │  Cloister quality gate passes
  ▼
spawnRun(issueId, 'review')
  │
  ▼
review role (`roles/review.md`)
  │
  ├─ reads issue, vBRIEF, PR/diff, and acceptance criteria
  ├─ runs convoy subagents in parallel:
  │    • code-review-security
  │    • code-review-correctness
  │    • code-review-performance
  │    • code-review-requirements
  ├─ synthesizes findings into one verdict
  ├─ posts the GitHub PR review/comment
  └─ records review status / lifecycle event
        │
        ├─ approved → transition toward `test`
        └─ changes requested → notify `work` with blockers
```

The dashboard displays the current review status from persisted review state and domain events. It does not own the review decision.

---

## Instruction layout

The review role instruction file is:

```
roles/review.md
```

The convoy reviewer definitions live in:

```
.claude/agents/
├── code-review-correctness.md
├── code-review-security.md
├── code-review-performance.md
├── code-review-requirements.md
└── code-review-synthesis.md
```

`code-review-synthesis.md` is retained as a Claude Code agent definition for compatibility with prompt resolution and review tooling, but synthesis is conceptually the `review` role itself.

The old source prompt-template files under `src/lib/cloister/prompts/review/code-review-*.prompt-template.md` are intentionally gone.

---

## Reviewer semantics

Each convoy subagent has a distinct focus and cites the [`deftai/directive`](https://github.com/deftai/directive) verification framework for consistent severity vocabulary and acceptance criteria taxonomy.

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

## Output contract

The review role records a human-readable verdict and machine-readable status through the review-status path used by the dashboard and lifecycle scheduler.

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

Model selection is role-based:

```yaml
workhorses:
  expensive: claude-opus-4-7
  mid: claude-sonnet-4-6
  cheap: claude-haiku-4-6

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

Harness selection follows the same role/sub-role shape. See [`HARNESSES.md`](./HARNESSES.md) for Pi vs Claude Code behavior and ToS rules.

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

Historical pre-role architecture used `pan review run`, source prompt templates under `src/lib/cloister/prompts/review/`, and detached reviewer/synthesis tmux sessions coordinated outside the role runner. That design was deleted by the Role primitive migration.

The current architecture has one lifecycle entry point: `spawnRun(issueId, 'review')`.
