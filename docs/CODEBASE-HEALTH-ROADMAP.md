# Overdeck Codebase Health Roadmap

**Status:** active · **Owner:** orchestrating conversation (#182) · **Tracking:** this document (doc-based; intentionally NOT GitHub issues — see [Execution model](#execution-model--handoff-orchestration-not-the-pipeline)).

Baseline measured at `main@09b2e423c` (2026-06-28).

---

## TL;DR

We ship **11 `feat` for every 228 `chore`** (last 300 commits). That ratio is an **architectural** symptom, not a discipline problem: the codebase has accumulated enough complexity that the marginal cost of *changing* it now exceeds the cost of *adding* to it. This roadmap attacks the structural causes in four epics, executed by supervised handoff agents — not the autonomous pipeline.

---

## The diagnosis

The framework is John Ousterhout's *[A Philosophy of Software Design](https://web.stanford.edu/~ouster/cgi-bin/book.php)* — the same model behind Matt Pocock's [`improve-codebase-architecture`](https://github.com/mattpocock/skills) / `codebase-design` skills. Ousterhout names three symptoms of accumulated complexity; "more time fixing than shipping" is their direct consequence:

- **Change amplification** — one logical change requires edits in many places.
- **Cognitive load** — you must understand a lot to change anything safely.
- **Unknown unknowns** — you can't tell *what* to change, so you find out in production (→ a "fix").

What we measured, and which symptom it drives:

| Signal | Measured (`src/`, non-test) | Drives |
|---|---|---|
| Explicit `any` (`as any` / `: any` / `<any>`) | **1,810 occurrences across 384 files** | Change amplification + unknown unknowns — the compiler can't catch ripples, so breakage surfaces at runtime |
| `as unknown as` | 130 | same |
| non-null `!` | 467 | same |
| Files **> 1,000 lines** | **45** (`deacon.ts` 7,180; `routes/workspaces.ts` 6,638; `agents.ts` 5,824) | Cognitive load + merge contention |
| Harness branches (`isPi` / `claude-code` / …) | **396 across 13+ areas** | Change amplification — no single seam owns harness behavior |
| Eval harness for the agent product | **none** | Agent-behavior regressions caught only in production |
| Debt markers (TODO/FIXME/HACK/…) | 507 | — |

**What is already healthy (do not "fix"):** the single-source-of-truth state model. `scripts/lint-overdeck-boundaries.sh` (wired into `npm run lint`) reports **zero consumers on the old database** — the overdeck.db cutover landed and the two-door discipline holds. State writes are gated by `scripts/lint-state-writes.sh`. Credit the "no bandaids" culture; this roadmap builds on that posture, it does not replace it.

---

## The plan — four epics

### Epic A — Stop the bleeding (ratchets)

Install mechanical ratchets so the debt can only shrink. Pure-gain, low blast radius, cheap-model-executable. **A must land before B** — extraction without a working type-checker just produces more runtime breakage.

| # | Work | Executor | Branch | Status |
|---|---|---|---|---|
| **A1** | ESLint `no-explicit-any` ratchet (plugin + `.eslintrc.cjs` + generated baseline allowlist) | GPT-5.5 | `codebase-health/a1` | ☐ in progress |
| **A2** | Adopt `ts-reset` (safe granular rules; fix surfaced typecheck errors) | GLM-5.2 | `codebase-health/a2` | ☐ queued |
| **A3** | File-size ceiling guard (`scripts/lint-file-size.sh` + baseline) | Kimi-2.7 | `codebase-health/a3` | ☐ queued |

PRDs: [`docs/codebase-health/`](./codebase-health/).

### Epic B — Carve deep modules + unify the harness abstraction

Decompose the god files into deep modules (narrow interface, hidden complexity) and replace the 396 harness branches with a single `Harness` interface (`spawn` / `deliver` / `resume` / `capabilities`) plus one implementation per harness. **Prereq: Epic A.**

### Epic C — Fitness functions (evals + a frozen kernel)

Adopt [`evalite`](https://github.com/mattpocock/evalite) for agent-behavior regression tests wired into CI; define and freeze a kernel (state doors, spawn, lifecycle) behind extra tests so entropy can't creep back.

### Epic D — Process

One large migration at a time (finished before the next); a `/grilling` design-review gate before any feature that would widen a god file or add a harness branch; a "no new `any` / no god-file growth" checklist in the PR template.

---

## Execution model — handoff orchestration (NOT the pipeline)

These changes modify the agents' **own substrate** — lint rules, the build, the harness layer. Routing them through the autonomous Flywheel pipeline confuses work agents (they `npm run lint` against rules being changed under them) and risks the Flywheel auto-grabbing the issues. So:

- **Supervised `pan handoff` conversations**, one per sub-issue, each in its own non-`feature/` worktree branched off `main`. The orchestrating conversation (#182) reviews per-commit, runs the gates (typecheck / lint / test), and fast-forward merges.
- **Models:** GPT-5.5 + GLM-5.2 for the consequential work, Kimi-2.7 for the lighter mechanical work. `--model` is passed (operator-directed); `--harness` is **not** (routing picks: gpt-5.5→codex, glm→cliproxy, kimi→omp — forcing `claude-code` on a CLIProxy model deadlocks).
- **Handoff agents do NOT run `pan done`** — that's the pipeline. They commit; the orchestrator merges.
- **Tracking is this document**, not GitHub issues — the Flywheel would grab `PAN-` architecture issues.

---

## Progress

- [ ] **A1** — `no-explicit-any` ratchet — GPT-5.5 — `codebase-health/a1`
- [ ] **A2** — `ts-reset` — GLM-5.2 — `codebase-health/a2`
- [ ] **A3** — file-size guard — Kimi-2.7 — `codebase-health/a3`
- [ ] **B** — deep-module extraction + harness seam (PRDs TBD after A lands)
- [ ] **C** — evals + frozen kernel (PRDs TBD)
- [ ] **D** — process gates (PRDs TBD)

---

## References

- Matt Pocock — [skills](https://github.com/mattpocock/skills) (`improve-codebase-architecture`, `codebase-design`, `grilling`), [ts-reset](https://github.com/mattpocock/ts-reset), [evalite](https://github.com/mattpocock/evalite)
- John Ousterhout — [*A Philosophy of Software Design*](https://web.stanford.edu/~ouster/cgi-bin/book.php) (deep vs. shallow modules)
- Local skills available now: `codebase-design`, `domain-modeling`, `grilling`, `simplify`
