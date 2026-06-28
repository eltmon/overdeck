# C (foundation) — Stand up an eval harness for agent behavior

**Epic:** C · **Branch:** `codebase-health/evals` (off `main`) · **Executor:** GPT-5.5 (handoff), supervised by conv #182
**Mode:** orchestrated handoff — **do NOT run `pan done`, do NOT open a PR.** Commit on this branch; the orchestrator reviews + merges.

---

## Why
Overdeck's most important output is **fuzzy AI behavior** (does the review agent catch bugs? does the planner produce a sane plan?). Normal unit tests can't check that. An **eval** feeds fixed inputs to an LLM-using behavior and **scores** the output (pass/fail, a grade, or an LLM-as-judge). Today there is **zero** eval coverage — a prompt change that degrades an agent is invisible until production. This task builds the **foundation**: the harness + a couple of real example evals + a `npm run eval` script, so coverage can grow and (later) the risky Harness refactor has a safety net.

This is a **greenfield** task — new files only, no conflict with other work.

## Glossary
- **`evalite`** = [`evalite`](https://github.com/mattpocock/evalite), a TypeScript eval runner (a test-runner for scoring LLM output). Pairs with scorers (exact match, or LLM-as-judge).
- **Eval case** = `{ input, task(input) → output, scorers[] }`. `evalite` runs each input through `task`, scores the output, reports.
- **LLM-as-judge** = a scorer that asks a model "does this output satisfy criterion X?" — for fuzzy outputs.

## Scope (foundation, NOT full coverage)
**WI-1 — Install + wire.**
- `bun add -d evalite` (+ a scorer lib if evalite recommends one, e.g. `autoevals`).
- Add `"eval": "evalite"` (or the documented invocation) to `package.json` scripts. Create an `evals/` directory at repo root.
- **Do NOT wire evals into the blocking CI gate** in this task — they call models (cost + non-determinism). `npm run eval` is operator/orchestrator-run for now; CI integration is a documented follow-up.

**WI-2 — Identify 1–2 good first targets (explore, then decide).**
Find self-contained, LLM-using behaviors that are valuable to lock down and feasible to eval. Good candidates to investigate (pick the best 1–2, don't force all):
- the review **synthesis** step (turns reviewer reports → a verdict) — `grep -rn "synthesizeReviewFromReports\|synthesis" src/lib`,
- any prompt-construction or classification/summarization helper that takes structured input and returns structured output,
- `spec-readiness` scoring if it's model-driven.
Criteria for a good first target: deterministic-ish input, a checkable notion of "good output", callable without spinning a full tmux agent. **Document which targets you picked and why** in this PRD's "Chosen targets" section.

**WI-3 — Write the example evals.**
For each chosen target, an `evals/<name>.eval.ts`: a few fixed inputs (drawn from real fixtures where possible — `grep` tests/fixtures or `.pan/` records for realistic data) + scorers (exact/structural where possible; LLM-judge only where the output is genuinely fuzzy). Keep it small (2–5 cases each) but real — each case must actually exercise the behavior, not a stub.

**WI-4 — Document.** A short `evals/README.md`: how to run (`npm run eval`), how to add a case, the cost/non-determinism caveat, and the "wire into CI later" follow-up.

## Requirements
**FR-1** `evalite` (+ scorer lib) in devDependencies; `npm run eval` runs the suite.
**FR-2** ≥1 real eval file under `evals/` that exercises an actual LLM-using behavior and scores it (not a stub/hello-world).
**FR-3** `evals/README.md` documents run/add/caveats.
**FR-4** `npm run typecheck`, `npm run lint`, `npm run build` pass (the eval files typecheck/lint clean). Existing tests unaffected.

**NFR-1** No new explicit `any` (A1 ratchet live). Eval files live under `evals/`; if `eslint src/` doesn't cover `evals/`, that's fine — but if you add eval helpers under `src/`, they obey the ratchet.
**NFR-2** Surgical/additive — new files only; do not modify existing `src/` behavior. (Tiny, clearly-justified refactors to make a target callable for eval are OK **only if** they're behavior-preserving and you flag them; prefer wrapping over editing.)
**NFR-3** Don't commit secrets/API keys; evals read keys from the existing env/auth the repo already uses.

## Implementation checkpoint
If, after exploring, **no target is feasibly eval-able without spinning a full agent**, do NOT fake one. Instead: build the harness (WI-1), write ONE eval against the most testable LLM-using helper you can find (even a modest one), document the gap + recommended next targets in the README, and **report to the orchestrator** so we scope a deeper eval target deliberately.

## Acceptance criteria
- `npm run eval` runs and reports at least one real eval.
- `evals/` contains the eval file(s) + README; `package.json` has the `eval` script + `evalite` dep.
- typecheck/lint/build green; existing tests unaffected.
- "Chosen targets" section below is filled in with what you evaled and why.

## Chosen targets
_(fill in during WI-2: which behavior(s) you evaled, the fixtures used, and the scorers.)_

## Intersecting rules (restated)
No bandaids; additive/surgical; A1 ratchet (no new `any`); worktree discipline (branch = `codebase-health/evals`; never `git checkout <branch>` / `git stash`); conventional commits (`feat(evals): ...`), never `--no-verify`; **do NOT run `pan done` or open a PR** — report blockers/uncertainty to the orchestrator (this task has judgment calls; surfacing them is expected, not a failure).

## Out of scope
Full agent-behavior coverage; wiring evals into blocking CI; evaluating every role. This is the foundation + a real first example, to prove the pattern.
