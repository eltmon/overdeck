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

| # | Work | Executor | PR | Status |
|---|---|---|---|---|
| **A1** | ESLint `no-explicit-any` ratchet (plugin + `.eslintrc.cjs` + generated baseline allowlist) | GPT-5.5 | #2113 | ✅ merged 2026-06-28 |
| **A2** | Adopt `ts-reset` (safe granular rules: `filter-boolean` + `array-includes`) | GLM-5.2 | #2114 | ✅ merged 2026-06-28 |
| **A3** | File-size ceiling guard (`scripts/lint-file-size.sh` + 45-file baseline) | Kimi-2.7 | #2115 | ✅ merged 2026-06-28 |

PRDs: [`docs/codebase-health/`](./codebase-health/). **Epic A complete** — combined `main` CI green.

### Epic B — Carve deep modules + unify the harness abstraction

Decompose the god files into deep modules (narrow interface, hidden complexity) and replace the remaining ~117 harness conditionals with a single `Harness` interface (extend the existing `src/lib/runtimes/AgentRuntimeSync`) plus one implementation per harness. **Prereq: Epic A (done).**

**Sequencing decision:** B is far riskier than A — the highest-value seams (deacon auto-resume/merge, the harness migration, the `agents.ts` spawn path) touch the exact code behind our worst failure modes. So B proceeds in **waves, safest-first**: each wave extracts the *single lowest-risk seam* in a god file, behavior-preserving, compiler+test-verified, to prove the extraction pattern before the scary seams. Analysis maps for each file live in the agents' reports; the per-file full seam ladder is in each PRD's appendix.

**Wave 1 — ✅ COMPLETE (merged 2026-06-28) — the safest seam in each of the three god files, one per model, fully independent (different files, no `package.json` touches):**

| # | Work | File → new module | Risk | Executor | Branch |
|---|---|---|---|---|---|
| **B1** | Extract inspect/timeout cluster | `deacon.ts` (7,180) → `deacon-inspect.ts` | LOW | GPT-5.5 | `codebase-health/b1` |
| **B2** | Extract container/docker routes | `routes/workspaces.ts` (6,638) → `routes/workspaces/container-ops.ts` | LOW | GLM-5.2 | `codebase-health/b2` |
| **B3** | Extract read-only agent queries | `agents.ts` (5,824) → `agents/queries.ts` | LOW | Kimi-2.7 | `codebase-health/b3` |

Merged: B1 #2117, B2 #2119, B3 #2118 — combined `main` CI green. PRDs: [`docs/codebase-health/`](./codebase-health/) (`B1-*`, `B2-*`, `B3-*`).

**Backend god-file decomposition — ✅ COMPLETE (merged 2026-06-28):**

| File | Result | PRs | Status |
|---|---|---|---|
| `src/lib/cloister/deacon.ts` | Decomposed into 8 modules | #2117, #2122 | ✅ merged |
| `src/lib/agents.ts` | Decomposed into 4 modules | #2118, #2123 | ✅ merged |
| `src/dashboard/server/routes/workspaces.ts` | Decomposed into `workspaces/{workspace-data,stash-clean,review-pipeline,review-control,container-ops,merge-ops}.ts` | #2117, #2119, #2124, #2126 | ✅ merged |

**Frontend god-file decomposition — ✅ COMPLETE (merged 2026-06-28):**

| File | Result | PR | Status |
|---|---|---|---|
| `SettingsPage.tsx` (4,200 lines) | Split into 6 seams: autosave + conversation-search hooks, voice / conversation-search / provider-management / TTS sections | #2127 | ✅ merged |
| `KanbanBoard.tsx` (3,017 lines) | Split into 6 seams: utils, badges, dialogs, drag-drop hook, cards+columns, filter-bar | #2128 | ✅ merged |

**Remaining B work:** the god-file decomposition waves are done. The `Harness` interface migration remains in progress on `codebase-health/harness-interface`; it consolidates the remaining harness conditionals behind the existing `src/lib/runtimes/` seam. Remaining large files outside this wave include `config-yaml.ts` (~3k) and `App.tsx` (~1.9k).

### Epic C — Fitness functions (evals + a frozen kernel)

Adopt [`evalite`](https://github.com/mattpocock/evalite) for agent-behavior regression tests wired into CI; define and freeze a kernel (state doors, spawn, lifecycle) behind extra tests so entropy can't creep back.

**Foundation status:** ✅ merged 2026-06-28 in #2121 — evalite harness, `npm run eval`, and the first eval landed. The remaining C work is expanding coverage around the frozen kernel and wiring the eval gate into the right CI path.

### Epic D — Process

One large migration at a time (finished before the next); a `/grilling` design-review gate before any feature that would widen a god file or add a harness branch; a "no new `any` / no god-file growth" checklist in the PR template.

### Epic E — De-leak core (project-specifics out of Overdeck core)

Core (`pan` CLI + dashboard server) must serve **any** project, but MYN-specific Postgres/Flyway database logic — including a hardcoded `myn` database name — is baked into core files. Same disease as the god files (wrong-layer logic), different flavor (domain leakage). **Tier 1:** de-hardcode `myn` → drive the DB name from project config (add a `name` field; replace ~6 hardcoded literals in `cli/commands/db.ts` and `routes/workspaces.ts`). **Tier 2 (direction TBD):** move the Flyway/Postgres machinery out of core — either invoke a project-declared command, or extract a plugin/extension. Full audit + plan: [`docs/codebase-health/E-de-leak-core.md`](./codebase-health/E-de-leak-core.md).

**Tier 1 status:** ✅ merged 2026-06-28 in #2125 — the database name is now config-driven through `database.name`, and workspace config carries `seedVerifyQuery`. Tier 2 remains: move the MYN Flyway/Postgres repair machinery out of core, either behind a project-declared command or a plugin/extension seam.

---

## Red-main incident — resolved 2026-06-28

The workspaces decomposition in #2124 moved review routes out of `routes/workspaces.ts` into `routes/workspaces/review-pipeline.ts` and `routes/workspaces/review-control.ts`. Nine source-introspection tests in `tests/lib/cloister/review-agent.test.ts` still grepped `workspaces.ts` for that code, so the `test` job went red on `main`.

Fix: #2129 repointed all nine tests to the new route files without weakening assertions. The same root cause also hit the merge-ops branch; the approve-route introspection was repointed inline in commit `d4e9181c2`.

Lessons:

- Run the FULL test suite before merge, not just typecheck/lint/build.
- Verify against `origin/main` HEAD, not a stale local checkout; the local checkout was 51 commits behind.
- When decomposing a file, repoint its source-introspection tests in the same PR.

---

## Execution model — handoff orchestration (NOT the pipeline)

These changes modify the agents' **own substrate** — lint rules, the build, the harness layer. Routing them through the autonomous Flywheel pipeline confuses work agents (they `npm run lint` against rules being changed under them) and risks the Flywheel auto-grabbing the issues. So:

- **Supervised `pan handoff` conversations**, one per sub-issue, each in its own non-`feature/` worktree branched off `main`. The orchestrating conversation (#182) reviews per-commit, runs the gates (typecheck / lint / test), and fast-forward merges.
- **Models:** GPT-5.5 + GLM-5.2 for the consequential work, Kimi-2.7 for the lighter mechanical work. `--model` is passed (operator-directed); `--harness` is **not** (routing picks: gpt-5.5→codex, glm→cliproxy, kimi→omp — forcing `claude-code` on a CLIProxy model deadlocks).
- **Handoff agents do NOT run `pan done`** — that's the pipeline. They commit; the orchestrator merges.
- **Tracking is this document**, not GitHub issues — the Flywheel would grab `PAN-` architecture issues.

---

## Progress

- [x] **A1** — `no-explicit-any` ratchet — GPT-5.5 — merged #2113
- [x] **A2** — `ts-reset` — GLM-5.2 — merged #2114
- [x] **A3** — file-size guard — Kimi-2.7 — merged #2115
- [x] **B1** — extract `deacon-inspect.ts` — GPT-5.5 — merged #2117
- [x] **B2** — extract `container-ops.ts` — GLM-5.2 — merged #2119
- [x] **B3** — extract `agents/queries.ts` — Kimi-2.7 — merged #2118
- [x] **B (backend god files)** — deacon full decomp (#2122) · agents full decomp (#2123) · workspaces final decomp (#2124) · merge-ops seam (#2126)
- [x] **B (frontend god files)** — `SettingsPage.tsx` (#2127) · `KanbanBoard.tsx` (#2128)
- [ ] **B (later waves)** — `Harness` interface consolidation in progress on `codebase-health/harness-interface`
- [x] **C** — evalite foundation + `npm run eval` + first eval — merged #2121
- [ ] **C (later)** — frozen kernel eval coverage + CI gate placement
- [ ] **D** — process gates (PRDs TBD)
- [x] **E Tier 1** — de-hardcode `myn` via config-driven `database.name` + `seedVerifyQuery` — merged #2125
- [ ] **E Tier 2** — de-core MYN Flyway/Postgres repair machinery (direction TBD) — see [`E-de-leak-core.md`](./codebase-health/E-de-leak-core.md)

---

## References

- Matt Pocock — [skills](https://github.com/mattpocock/skills) (`improve-codebase-architecture`, `codebase-design`, `grilling`), [ts-reset](https://github.com/mattpocock/ts-reset), [evalite](https://github.com/mattpocock/evalite)
- John Ousterhout — [*A Philosophy of Software Design*](https://web.stanford.edu/~ouster/cgi-bin/book.php) (deep vs. shallow modules)
- Local skills available now: `codebase-design`, `domain-modeling`, `grilling`, `simplify`
