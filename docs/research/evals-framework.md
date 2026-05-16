# Panopticon Evals — Research & Framework Proposal

**Status:** Research / proposal
**Date:** 2026-05-15
**Targets:** Compaction (`smart-compaction.ts`), Observability/Activity Feed (PAN-1052)

---

## 1. State of LLM Evals in 2026

The 2026 eval stack has converged on three layers. A serious eval system needs all three; they answer different questions.

### Layer 1 — Offline, dataset-driven evals (the "unit test" layer)

You curate a fixed dataset, run candidate prompts/models against it, score each output, and regress on every change. The two dominant open-source choices:

**Python ecosystem:**
- **Inspect AI** (UK AISI, MIT). Task/Solver/Scorer/Dataset model. Strong sandboxing, agent tooling, log viewer. Local-only, no telemetry. Best fit when the eval stack can live in Python.
- **DeepEval** (Confident AI, Apache 2.0). Pytest-native. 50+ metrics: G-Eval, faithfulness, answer-relevancy, hallucination, tool-correctness, task-completion. Synthetic data generation.
- **Promptfoo** (MIT). YAML-config CLI, strong on red-teaming and prompt A/B.
- **RAGAS** (MIT). RAG-specific. Not relevant for our two targets.

**TypeScript ecosystem** (matters — Panopticon is TS):
- **`autoevals`** (Braintrust, MIT). TS-native *scorer library* — G-Eval, faithfulness, answer-relevancy, factuality, summary-quality, JSON-validity, Levenshtein, embedding-similarity. Just an npm import, no SaaS dependency. Solves the "we have to write our own judges" problem.
- **`evalite`** (MIT). Vitest-native eval runner with a local web UI. Thin layer on top — datasets, scorers, watch-mode.
- **Langfuse SDK** (MIT core, self-hostable). TS-first observability + eval. Could host the Layer-2 production monitor.

For Panopticon we want a *library*, not a SaaS. The realistic finalists are: **(Python) Inspect AI** via sidecar, or **(TS-native) evalite + autoevals** in-tree.

### Layer 2 — Online evals on live traces (the "production monitor" layer)

Same scorers as Layer 1, but they run against real traffic. A scorer attached to a span fires asynchronously, writes a score, and surfaces regressions in dashboards. Braintrust, Arize, Langfuse, and Confident AI all do this commercially; Langfuse is the only self-hostable open-source option in the same shape (MIT). Important point: **online evals are scorers attached to traces; once you have the scorers, the "online" part is just plumbing.**

### Layer 3 — OpenTelemetry GenAI conventions (the "wire format" layer)

The OTel GenAI SIG finalized semantic conventions in early 2026: `gen_ai.*` attributes for model calls, tool calls, agent spans, and (critically) **content as span events, not attributes** — so prompt bodies can be filtered/dropped at the collector without code changes. Every serious vendor now emits these. If we instrument once against OTel GenAI, we get portable traces, can feed Langfuse/Arize/Braintrust without lock-in, and can run scorers in our own process.

### Key 2026 patterns worth adopting

- **LLM-as-judge with structured outputs.** Force the judge to return JSON conforming to a rubric schema. Removes scoring ambiguity and lets you compute inter-judge agreement.
- **Pairwise + reference-free judging.** For summarization, "is A better than B?" is more reliable than "score A 1–5". Use reference-free where ground truth is impractical (compaction summaries).
- **G-Eval style chain-of-thought rubrics.** Judge produces reasoning *then* score; correlates better with human judgement.
- **Hybrid scoring.** Combine deterministic checks (regex, JSON-schema, span-shape) with LLM judges. Cheap checks gate the expensive ones.
- **Versioned datasets, versioned prompts, versioned scorers.** All three are inputs; a regression is meaningless without locking the other two.
- **Run evals in CI on every prompt/model change**, not just "before launch". Cache by (prompt-hash, input-hash, model) to keep CI cheap.

---

## 2. What to evaluate in Panopticon

### 2.1 Compaction (`src/lib/conversations/smart-compaction.ts`)

Smart compaction reads a JSONL transcript, picks a cut point, sends pre-cut entries to Haiku, and returns `{summary, firstKeptEntryIndex, readFiles, modifiedFiles}`. The summary then becomes the agent's memory of pre-compaction work.

The risks compaction creates:

| Failure mode | What goes wrong | How to detect |
|---|---|---|
| **Faithfulness** | Summary states things the transcript doesn't support | LLM-as-judge entailment check (G-Eval / faithfulness) |
| **Coverage** | Critical events dropped — file edits, decisions, blockers | Structured extraction comparison: ground-truth file-op list vs summary mentions |
| **File-op recall in summary text** | Summary prose omits files the user actually touched | The `readFiles`/`modifiedFiles` *arrays* are derived from JSONL tool_use blocks by compaction itself — checking them against the same blocks is tautological. Instead, the scorer checks whether the **summary string** mentions the key file paths (string-contains + judge for paraphrase like "the auth middleware"). Ground truth for "key" can come from a small set of human-labeled fixtures, or, for free, from the set of files modified in the workspace's git diff over the same time window. |
| **Cut-point safety** | Splits an in-flight tool call or loses the user's current ask | Rule-based: assert cut never lands inside an unfinished assistant turn |
| **Compression ratio** | Summary too long (wasteful) or too short (lossy) | Token count vs `tokensBefore`, target band |
| **Goal preservation** | Active user goal/task absent from summary | Judge: "Given the last user message before cut, does the summary preserve it?" |
| **Latency / cost** | Haiku call slow or expensive at p95 | Deterministic histogram |

**Dataset.** Curate 50–200 real JSONL transcripts from `~/.claude/projects/.../*.jsonl` covering: simple bug-fix sessions, long multi-tool sessions, sessions with subagents, sessions with conversation forks, sessions that errored mid-tool. For each, hand-label a "must-preserve" list (5–15 bullets) and an authoritative file-op list (cheap — derive from JSONL itself with a deterministic parser).

**Scorers.**

1. *File-op recall/precision* — deterministic.
2. *Faithfulness* — G-Eval judge, pairwise against the source transcript window. Boolean per claim, aggregated.
3. *Must-preserve coverage* — judge scores how many labeled bullets appear in the summary.
4. *Goal preservation* — judge, binary.
5. *Compression ratio* — `summaryTokens / tokensBefore`, target 0.05–0.15.
6. *Latency p50/p95*, *$/call*.

### 2.2 Observability / Activity Feed (PAN-1052)

PAN-1052 introduces three LLM-touched surfaces, each independently eval-worthy:

#### a) Per-turn observation extraction
Cheap model produces `{actionStatus, narrative, summary, tags}`. Worth evaluating:

- **`actionStatus` null-discipline.** Does the model correctly return `null` for non-concrete turns (pure discussion, browsing)? This is the most user-visible failure — false-positives spam the sidebar. Build a labeled dataset of ~100 turns labeled "concrete / not concrete".
- **`actionStatus` quality.** Verb-led, 4–9 words, accomplishment-framed. Judge against rubric. Pairwise vs reference.
- **Tag relevance.** Judge: "Are these tags useful retrieval keys for this turn?" Plus check tag-vocabulary stability over time (drift).
- **File-list accuracy.** Deterministic from JSONL.
- **Narrative vs summary distinction.** Are they actually different, or did the model just paraphrase?

#### b) Rolling status synthesis (every 4 turns)
The status object has structured fields (`phase`, `accomplished`, `decided`, `open`, `nextSteps`, `workingSet`). Eval angles:

- **Phase classification accuracy.** Labeled dataset of (recent observations → correct phase). Cheap to score deterministically.
- **Decision/blocker recall.** Were decisions and blockers mentioned in observations actually present in the synthesis?
- **Staleness handling.** When new observations contradict old status, does ADD/UPDATE/DELETE/NOOP fire correctly? Construct synthetic contradiction cases.
- **WorkingSet correctness** — deterministic (compare to actual files touched in window).

#### c) Query expansion / FTS retrieval
The user-prompt-submit hook expands the prompt into 3–5 search terms and retrieves memories. Classic IR eval:

- **Recall@k.** Build (query → relevant-memory) pairs from real sessions. Did expansion retrieve them?
- **Re-ranking lift.** Compare raw BM25 vs the re-ranked output. The 0.02 decay and +0.3 tag boost magic numbers should be *tuned by eval*, not guessed.

### 2.3 Other Panopticon surfaces (out of scope now, in scope soon)

Worth flagging so the framework is built to handle them:
- Planning-agent vBRIEF generation
- Review-agent findings (precision/recall on injected bugs)
- Merge-agent rebase-conflict resolution
- Cloister stuck-detection classifier
- TLDR sidecar summaries

A single framework should serve all of them.

---

## 3. Recommended framework for Panopticon

### 3.1 Choice of base library: **`evalite` + `autoevals`** (both MIT, TS-native), in-tree under `evals/`.

Reasoning:

- **Same language as Panopticon.** No Python sidecar, no IPC, no second toolchain. Authoring an eval is just writing a `.eval.ts` file next to the code it tests.
- **`autoevals` gives us judges for free.** G-Eval, faithfulness, answer-relevancy, factuality, summary-quality, JSON-validity, Levenshtein, embedding-similarity — all importable, all swappable for our own implementations later. We are *not* writing a judge library from scratch.
- **`evalite` gives us the runner + a local viewer.** Vitest-native (we already run vitest), with watch-mode and a built-in UI for inspecting runs. Maps cleanly to `pan evals run`.
- **Composable with Panopticon's existing infra** — eval runs are just node processes; we can spawn them in workspaces, attach them to the agent runner, gate CI on them.
- **No SaaS lock-in.** Both are libraries you import; neither phones home.

We considered Inspect AI (MIT, UK AISI). It is the strongest *Python* eval framework and we will continue to lift ideas from it — particularly its Task/Solver/Scorer data model, sample-level log schema, and the meta-eval pattern. But adopting Inspect would mean either (a) a Python sidecar, adding a toolchain to a TS repo, or (b) porting its abstractions into TS and calling the result "Inspect-style", which is just building a new framework with borrowed vocabulary. Neither is worth the cost when `evalite` + `autoevals` already cover the runner + judge surfaces natively. The capability/safety benchmarks Inspect ships are not in scope for Panopticon's eval surfaces.

DeepEval was rejected for the same Python-toolchain reason. Braintrust / Langfuse / Arize are production-monitoring vendors, not eval frameworks; we may emit OTel GenAI traces *toward* a self-hosted Langfuse later for Layer-2, but that's a wire-protocol choice downstream of this one.

### 3.2 Repo layout

```
panopticon-cli/
  evals/
    datasets/
      compaction/
        transcripts/          # captured JSONL fixtures
        labels.jsonl          # must-preserve bullets, file-op truth
      observations/
        turns.jsonl           # labeled (concrete / not concrete) turns
      status/
      retrieval/
    scorers/
      faithfulness.ts         # G-Eval judge
      file_ops.ts             # deterministic
      action_status.ts        # null-discipline + quality
      phase_classifier.ts
      retrieval_recall.ts
    tasks/
      compaction.eval.ts      # @task
      observation_extract.eval.ts
      status_synthesis.eval.ts
      query_expansion.eval.ts
    judges/
      prompts/                # versioned judge prompts
    snapshots/                # canonical outputs for regression diff
  pan-evals.config.yaml       # which datasets, which models, which scorers
```

Every eval task is a `.eval.ts` file exporting an `evalite()` block. Scorers from `autoevals` are imported and composed; bespoke scorers (file-op, phase classifier) live in `evals/scorers/`. Run logs land in `evals/.evalite/` and can be diffed across runs.

### 3.3 The `pan evals` CLI surface

```
pan evals run [task]              # run one or all eval tasks
pan evals run compaction --model haiku-4-5
pan evals diff <run-a> <run-b>    # regression diff between two runs
pan evals view                    # open evalite local viewer
pan evals datasets add            # interactive: capture current session
pan evals judges test             # meta-eval: judge vs human labels
pan evals ci                      # CI mode: fail on regression vs baseline
```

Tied to the existing `pan` taxonomy; lives under the `pan admin` or top-level `pan evals` bucket.

### 3.4 Dataset capture — dogfood

Panopticon already records every agent transcript. Build a one-shot:

```
pan evals datasets capture --from <conversationId> --as compaction/<name>
```

This freezes a JSONL into `evals/datasets/`, runs the deterministic labeler, and opens an editor on `labels.jsonl` for the human-curated "must-preserve" list. Dogfooding gets us hundreds of fixtures cheaply.

### 3.5 Judges — meta-evaluation matters

Every LLM-as-judge needs a meta-eval set: ~30–50 outputs hand-labeled by us, so we can confirm the judge agrees with us before we trust it. Track judge-vs-human agreement (Cohen's κ ≥ 0.6 to ship a judge). When the judge prompt or judge model changes, re-run the meta-eval. Snapshot the prompts in `evals/judges/prompts/<name>.v<n>.md`.

### 3.6 CI integration

- A baseline run is committed at `evals/baselines/<task>/<model>.json`.
- `pan evals ci` runs the suite, compares to baseline, **fails the build only on regressions outside a tolerance band** (e.g. faithfulness can't drop > 2 points; latency p95 can't grow > 20%).
- Baselines are updated by an explicit PR (`pan evals baseline accept <task>`), reviewed by a human.
- Cache hits are keyed on `(promptHash, inputHash, modelId, scorerVersion)` so a no-op prompt change is free.

### 3.7 Online eval path — reconcile with PAN-1052

PAN-1052 already builds a per-turn observation pipeline: a watcher reads the JSONL, compresses each turn, calls an LLM, writes structured records to disk. That **is** an agent telemetry stream — it just isn't shaped like OpenTelemetry today.

There are three coherent ways to reconcile this with Layer-2 (online evals on live traces). Pick one before Phase 5 — they should not both ship:

1. **PAN-1052 stays the source of truth, evals consume its records.** Scorers subscribe to the observation/status writes, score them, and emit results back into the same store. No OTel emission from the agent runner. Simpler; couples eval to PAN-1052 schema.
2. **Agent runner emits OTel GenAI spans; PAN-1052 becomes an OTel consumer.** PAN-1052's watcher is replaced by an OTel collector pipeline that runs the same LLM extraction as a span processor. More work up front, but portable to Langfuse/Arize without re-instrumenting.
3. **Both run, with PAN-1052's structured fields (phase, accomplished, decided…) carried as `gen_ai.*` extension attributes on spans.** PAN-1052 owns the product-facing fields; OTel owns the wire format.

Recommendation: **(3) long-term, (1) short-term.** Ship PAN-1052 as-designed, build eval scorers against its records, and treat OTel emission as a Phase-5 layer-cake addition rather than a re-write. The eval framework reads from a stable internal interface (`ObservationStream`); whether that interface is backed by PAN-1052 files or OTel spans is a swap, not a rewrite.

**Do not build a parallel telemetry pipeline for evals.** Whichever option wins, evals consume the same stream agents produce.

---

## 4. Phased plan

| Phase | Scope | Why first |
|---|---|---|
| **0** | Decide framework, land `evals/` skeleton + TS Task/Solver/Scorer + `pan evals run` | Unblocks everything else |
| **1** | Compaction evals: dataset capture tool, deterministic file-op scorer, faithfulness judge + meta-eval | Highest-impact surface; smallest scope; existing code |
| **2** | Observation-extraction evals: `actionStatus` null-discipline + quality. Drives PAN-1052 model selection | Blocks PAN-1052 model decision (one of its open questions) |
| **3** | CI gate + baselines for compaction and observation extraction | Locks in non-regression |
| **4** | Status synthesis evals + retrieval evals | Tunes the magic numbers (decay, tag boost, threshold=4) instead of guessing |
| **5** | OTel GenAI emission from agent runner; online-eval sampler | Layer-2 production monitor |
| **6** | Extend to planning / review / merge agents | Same framework, new tasks |

Phases 0–2 are roughly two weeks of *engineering* work. They are gated by **dataset labeling effort**, which is the real bottleneck: 30 well-labeled compaction fixtures (≈10 must-preserve bullets each, ~300 human-written bullets) plus 100 labeled (concrete / not-concrete) turns is realistically a focused day of human work, possibly two. Suggest starting v1 with ~30 fixtures, not 50–200; expand once the framework is proven.

**Cost ballpark for running the suite once.** Judging 30 compaction summaries with Opus as judge (≈4k tokens in + 1k tokens out per call, ×3 judges per fixture) is roughly $4–6 per full run. Switching the judge to Sonnet drops it to <$1. Haiku-as-judge with sampling is sub-cent. CI policy should default to **Haiku judge with periodic Opus re-baselining** so per-PR runs stay free.

---

## 5. Open questions for the user

1. **Framework choice:** Inspect-style TS-port (recommended) vs adopt Python Inspect AI with a sidecar?
2. **CI gating:** Block PRs on eval regressions, or surface them as warnings only?
3. **Judge model policy:** Use Sonnet/Opus for judging (expensive, accurate) or Haiku (cheap, more judge-prompt engineering)? Default suggestion: Opus for meta-eval / baseline, Haiku for CI runs with sampling.
4. **Dataset privacy:** Captured transcripts may contain secrets / paths. Auto-redact, or require human approval before fixture commit?
5. **Should evals run inside a workspace** (like agents do) or in the main repo's CI? Workspaces let us parallelize across models cleanly.

---

## Sources

- [Inspect AI](https://inspect.aisi.org.uk/) — UK AISI eval framework
- [DeepEval](https://deepeval.com/) — Confident AI, Apache 2.0
- [Promptfoo](https://promptfoo.dev/)
- [OpenTelemetry GenAI conventions](https://opentelemetry.io/blog/2025/ai-agent-observability/)
- [Braintrust — Agent observability guide 2026](https://www.braintrust.dev/articles/agent-observability-complete-guide-2026)
- [Monte Carlo — LLM-as-judge best practices](https://www.montecarlodata.com/blog-llm-as-judge/)
- [DeepEval alternatives 2026](https://www.braintrust.dev/articles/deepeval-alternatives-2026)
