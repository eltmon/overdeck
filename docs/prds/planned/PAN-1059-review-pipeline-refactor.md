# PAN-1059: Review Pipeline Refactor + Reviewer Prompt Overhaul

**Status:** Planned. Blocked by PAN-1048 (Role primitive).
**Owner:** eltmon
**Author:** Claude (Opus 4.7), 2026-05-10
**Scope:** End-to-end rewrite of the review pipeline — synthesis becomes the orchestrator, reviewer prompts are rebuilt to be cheap and contradiction-free, TLDR is integrated as a first-class tool, and shared context replaces 4× redundant file I/O.

---

## 1. Why this PRD exists

Two problems are surfacing simultaneously and have the same root:

1. **Reviewers are absurdly expensive.** Conversation 906 (cost-reduction investigation, 2026-05-10) traced this to four parallel sub-reviewers each independently running `git diff` and reading every changed file in full. With 5–20 changed files × ~15k tokens each × 4 reviewers, a single review round burns 50k–500k input tokens of redundant context before any real analysis happens. Reviewers routinely auto-compact one or more times *before they finish reading their inputs*.
2. **Reviewers are behaviorally unstable.** Stream-of-consciousness transcripts show sub-reviewers in distress: oscillating between "I am read-only / I have no Write tool" and "I MUST use Write at the end"; declaring 150-file diffs "impossible"; talking themselves into Bash heredoc workarounds for tools they actually have. The prompts contradict themselves and contradict their own agent definitions.

Both problems originate in the same place: a bash-script coordinator (`spawnReviewCoordinatorSession` + `runReviewerRound`) that hands four overlapping prompts to four agents in parallel, with no shared context, no awareness of TLDR, three separate completion mechanisms (sentinel text, output file, curl API), and a "MUST complete 3 review passes / read every changed file" procedural straitjacket.

PAN-1048 lands the `Role` primitive and makes synthesis the review role. PAN-1059 takes the next step: synthesis becomes the actual LLM orchestrator, and we rewrite the reviewer prompts on top of that new structure. This PRD covers both halves as one coherent piece of work.

---

## 2. Goals

| # | Goal | How we'll know it worked |
|---|------|--------------------------|
| G1 | Synthesis (review role) spawns and supervises its own sub-reviewers; no bash coordinator | `spawnReviewCoordinatorSession` and `runReviewerRound` are deleted. Killing the synthesis session reaps its sub-reviewers. |
| G2 | A review round costs < 25% of today's token spend on the same diff | Issue-level cost dashboard shows `review` role tokens down ≥75% on PRs comparable in size to recent baselines |
| G3 | Reviewers reach for TLDR before raw file reads | New review prompts mention TLDR tools explicitly; cost events capture `tldrInterceptions`/`tldrTokensSaved`; daemon is auto-started for every workspace |
| G4 | Sub-reviewers share a pre-built diff/context manifest instead of each running `git diff` | One pre-read by synthesis; sub-reviewers receive a structured prompt with changed-file list, hashes, and TLDR-ready paths |
| G5 | Zero prompt contradictions — every sub-reviewer has one clear write surface and one clear completion signal | No "read-only vs MUST Write" language; no sentinel/output-file/curl trifecta; agent definition matches runtime prompt |
| G6 | APPROVED is structurally reachable for clean diffs | Severity calibration: only `!`/`⊗` and `~` on hot paths block; `?` and trivial `~` do not |
| G7 | Synthesis decides when to wait, retry, or proceed with partial sub-reviews | Synthesis prompt has explicit stall-detection, retry-once, proceed-without rules. PRs with one stuck sub-reviewer still produce a verdict. |

---

## 3. Non-goals

- **Dirac-style hash-anchored edits** and AST-native edit primitives. Tracked separately (mentioned as future PAN-1061 in conv 906); orthogonal to this work.
- **Smart-model-selector cost-aware routing.** The dead `getValueScore()` should be wired up, but that's a separate cost issue, not part of the review pipeline.
- **Other roles' prompts** (plan, work, test, ship). Out of scope; this is the review role only. Apply learnings later if they hold up.
- **Replacing the four review dimensions.** Correctness/security/performance/requirements stays as the convoy structure. We're rewriting how they run, not what they look for.

---

## 4. Current-state cost autopsy (the "every semicolon" problem)

Concrete sources of waste in today's pipeline:

1. **4× redundant `git diff`.** Each sub-reviewer prompt template says "get the list of changed files with `git diff`" and "Read the CURRENT version of each changed file using the Read tool" (`review.md:107` and analogues in all four sub-templates). One coordinator pre-read could feed all four.
2. **No TLDR awareness.** None of the five review prompt files reference `tldr_context`, `tldr_semantic`, `tldr_calls`, or `tldr_impact`. The MCP tools are available when the daemon is running, but the prompts don't prime agents to use them. Result: full file reads (~15k tokens) where TLDR summaries (~800 tokens) would do.
3. **TLDR daemon is stopped.** Conv 906 found `.tldr/status` files report `stopped` across workspaces. `workspace-manager.ts:825` and `agents.ts:1619` are supposed to start it but the path isn't reliably exercised. `merge-agent.ts:139` correctly calls `tldrService.warm(true)` post-merge, but that's downstream of the start gap.
4. **TLDR metrics are tracked-but-not-aggregated.** `CostEvent` schema has `tldrInterceptions`/`tldrTokensSaved`/`tldrBypasses`. `cost-events-db.ts:452-455` persists them. But `captureTldrMetrics()` is never called in the production cost pipeline — only in tests. `IssueStats` doesn't expose them. So even if savings happen, they're invisible.
5. **Hard-coded 3-pass procedural rigidity.** Every sub-reviewer is told to "MUST complete 3 review passes" (`code-review-correctness.prompt-template.md:101-128` and analogues). Each pass re-reads files. The "Pass 1: write top 3 findings immediately, Pass 2: append more, Pass 3: append more, then Consolidate" pattern produces fragmented output, multiple file writes per reviewer, and read-back overhead — purely procedural ceremony, no quality benefit.
6. **Anxiety-inducing completion language.** "Your turn does not end until that file exists." "Non-negotiable." "PAN-1055 stalled ~10 minutes today because…" (literally a war story embedded in `code-review-correctness.prompt-template.md:242`). This pushes the model into compulsive over-verification and second-guessing — measurable in transcripts as repeated reads of the same file.
7. **Three contradictory completion mechanisms.** `agents/pan-review-agent.md` says output sentinel text; the same file's description says write to `.pan/review/<runId>/<role>.md`; `prompts/review.md` says POST to `/api/specialists/done`. The runtime only honors the third. The first two are dead, but the agent reads all three and gets stuck reconciling.
8. **Acceptance-criteria duplication.** Correctness reviewer's Pass 3 re-checks `.pan/spec.vbrief.json` ACs and `.beads/issues.jsonl` — directly duplicating the requirements reviewer's whole job. Cost paid four times for one signal.

These eight items account for the bulk of the review-cost overhang. PAN-1059 + the prompt rewrite addresses each one explicitly.

---

## 5. Target architecture

### 5.1 Single synthesis session, owned sub-reviewers

```
┌─────────────────────────────────────────────────────────────┐
│ pan review request <id>                                     │
│   └─→ spawnRun(issueId, 'review', { harness, model })       │
│         └─→ tmux session: review-<id>                       │
│               └─→ Claude Code / Pi running roles/review.md  │
│                     │                                       │
│                     ├─ Pre-read (once):                     │
│                     │   • git diff vs target                │
│                     │   • build changed-file manifest       │
│                     │   • run tldr_context on each file     │
│                     │   • assemble shared context           │
│                     │                                       │
│                     ├─ Spawn 4 sub-roles in parallel via    │
│                     │   spawnRun(id, 'review', {subRole}):  │
│                     │     review-security                   │
│                     │     review-correctness                │
│                     │     review-performance                │
│                     │     review-requirements               │
│                     │                                       │
│                     ├─ Monitor sub-reviewer output files;   │
│                     │   apply stall/retry/proceed policy    │
│                     │                                       │
│                     ├─ Read sub-reviewer findings           │
│                     │                                       │
│                     ├─ Decide verdict, write synthesis.md   │
│                     │   + synthesis.json                    │
│                     │                                       │
│                     └─ Deliver feedback to work agent       │
│                       (CHANGES_REQUESTED) or transition     │
│                       state (APPROVED)                      │
└─────────────────────────────────────────────────────────────┘
```

When the synthesis session dies, its sub-reviewers die with it (process-group ownership or explicit reaper). No zombie sessions, no orphaned tmux windows, no bash coordinator.

### 5.2 Shared review context manifest

Synthesis, before spawning sub-reviewers, builds a single `.pan/review/<runId>/context.json`:

```jsonc
{
  "issueId": "PAN-XXX",
  "runId": "<ulid>",
  "baseSha": "<sha>",
  "headSha": "<sha>",
  "diffStats": { "filesChanged": 17, "insertions": 412, "deletions": 88 },
  "files": [
    {
      "path": "src/dashboard/server/routes/issues.ts",
      "status": "modified",
      "size": 18234,
      "contentHash": "sha256:...",
      "kind": "source",            // source | test | config | generated | lock | doc
      "riskRank": 1,               // 1 (high) ... 5 (low)
      "tldrAvailable": true,
      "tldrSummary": "<embedded ~800-token TLDR context output>"
    },
    ...
  ],
  "acceptanceCriteria": [...],     // copied from vBRIEF
  "policyNotes": ["dashboard-node22-only", "no-execsync-server"]
}
```

Each sub-reviewer's spawn prompt references this manifest. Sub-reviewers consume the TLDR summary inline and only Read the full file when they need specifics around a candidate finding. No reviewer ever calls `git diff` independently.

### 5.3 The five files that own the new pipeline

| File | Purpose | Replaces |
|------|---------|----------|
| `roles/review.md` | Synthesis-as-orchestrator. Owns the pre-read, the spawn, the monitor, the verdict, the feedback. | `agents/pan-review-agent.md`, most of `prompts/review.md`, `prompts/review/code-review-synthesis.prompt-template.md` |
| `roles/review-security.md` (or `.claude/agents/code-review-security.md` under PAN-1048's layout) | One sub-reviewer prompt, lean | `prompts/review/code-review-security.prompt-template.md` |
| `roles/review-correctness.md` | One sub-reviewer prompt, lean | `prompts/review/code-review-correctness.prompt-template.md` |
| `roles/review-performance.md` | One sub-reviewer prompt, lean | `prompts/review/code-review-performance.prompt-template.md` |
| `roles/review-requirements.md` | One sub-reviewer prompt, lean | `prompts/review/code-review-requirements.prompt-template.md` |

Exact file layout follows whatever PAN-1048 lands. Today, PAN-1048's `workspaces/feature-pan-1048/roles/review.md` exists and points to PAN-1059 to remove the Agent-tool subagent indirection.

---

## 6. Prompt design principles (apply to all five files)

These are the rules every reviewer prompt must follow. Each rule maps to a concrete failure mode observed in current prompts.

### P1. One write surface, no contradiction
- Sub-reviewers may write **only** their findings file. That is the single Write target.
- Synthesis may write **only** `synthesis.md` and `synthesis.json` plus PR comment delivery via the established Panopticon flow.
- Drop the phrase "read-only reviewer." Replace with: *"You may not modify source, tests, or config. Your one permitted write is to your assigned output file."*
- The agent definition's `tools:` list, the prompt's stated boundaries, and the prompt's mandatory final action must all agree.

### P2. One completion signal
- Sub-reviewers complete when their output file exists. Period.
- Synthesis completes by emitting `synthesis.md` + `synthesis.json` and calling the existing review-state transition. No sentinels, no curl, no parallel signals.
- Delete sentinel-parsing code paths and dead curl-completion blocks from the prompts.

### P3. TLDR-first, full-read second
Every prompt that references reading files must phrase it this way:

> Before reading any file in full, consult its TLDR summary in the context manifest (`tldrSummary` field). Use `tldr_calls` and `tldr_impact` to navigate function-level relationships. Only call `Read` on a file when the TLDR summary is insufficient to confirm a specific finding at a specific line.

If TLDR isn't available for a file, fall back to Read. If TLDR isn't available at all (daemon down), surface that in the synthesis Summary so we can debug it.

### P4. Bounded, risk-prioritized reads
- The pre-read in synthesis ranks files by `riskRank` (source > tests > config > generated/lock/snapshot).
- Sub-reviewers receive the ranked list. For diffs > 30 files, generated/lock/snapshot files are summarized as a single line ("N lockfile-style changes, not reviewed in detail") and not handed to TLDR or Read at all.
- The prompt explicitly states coverage in the output: "Files reviewed in detail: N / Files in diff: M / Files skipped by rank: K."
- No reviewer is ever told to "read every changed file." That phrase is banned.

### P5. No procedural straitjacket
- Delete the "MUST complete 3 review passes" structure.
- Replace with a one-paragraph workflow: *"Sweep the manifest. For files in your specialty's risk band, deepen analysis. Group related findings. Write one consolidated report at the end."*
- No mid-flight Writes. No "write top 3 findings immediately." Notes in memory; one Write at completion.

### P6. Calibrated severity, APPROVED reachable
Keep the directive severity glyphs (`!`, `⊗`, `~`, `≉`, `?`). Synthesis applies a clear, asymmetric policy:

| Severity | Block merge? |
|----------|--------------|
| `!` / `⊗` (Blocker)         | Always |
| `~` / `≉` (High) on security or correctness | Yes, unless code path is unreachable |
| `~` / `≉` (High) on performance | Only if on a hot path or at scale |
| `?` (Medium/Low)            | Never blocks. Listed as nits. |

Synthesis must approve clean diffs that have only `?` findings, even if it has notes. "There is no 'passed with notes'" language gets deleted. Notes are fine; they don't block.

### P7. No anxiety language, no war stories
Delete:
- "Your turn does not end until that file exists."
- "Non-negotiable."
- "PAN-1055 stalled ~10 minutes today because…"
- Multi-paragraph "Display the full markdown but NOT in a code fence" blocks. Reduce to one line.

Replace with neutral instruction: *"Write your output file. Print the verdict and finding counts on one line. Done."*

### P8. Deduplicated specialty scope
- Correctness: bugs introduced by changed code. Period. No AC checking, no bead scanning.
- Security: vulnerabilities introduced by changed code.
- Performance: perf regressions on hot paths in changed code.
- Requirements: AC coverage from vBRIEF + bead alignment. **Sole owner** of the AC-traceability checks that today are scattered across correctness's Pass 3.

### P9. Stall and partial-result handling (synthesis only)
Synthesis prompt explicitly defines:
- Wait window: 8 minutes per sub-reviewer from spawn, configurable.
- On stall: retry once with the same prompt to the same model.
- On second stall: proceed without that sub-reviewer; record `reviewer=<name>, status=stalled` in synthesis Summary.
- Two or more stalls → verdict `failed` (existing policy), surface clearly.
- Synthesis is allowed and expected to make these calls. It is not "playing it safe by waiting forever."

---

## 7. Implementation plan

Sequenced so each step is mergeable on its own. Drop the work into discrete beads under PAN-1059.

### Phase A — Land PAN-1048 (not part of this PR)
Already in progress. PAN-1059 starts after PAN-1048 merges to main and `spawnRun(issueId, role, opts)` with sub-role support is the supported API.

### Phase B — TLDR infrastructure hardening (can start in parallel with Phase C)

B1. Audit workspace-setup paths. Make TLDR daemon start an explicit, idempotent step in `workspace-manager.ts:825` and `agents.ts:1619`. Fail loudly with a diagnostic if it doesn't start; do not fail silently.
B2. Add TLDR daemon to `pan health` / `pan doctor` and to the dashboard's resources tree (alongside Docker containers, Traefik, etc.). Visible status, restart action.
B3. Wire `captureTldrMetrics()` into the cost-event flush pipeline. Add `tldrInterceptions` and `tldrTokensSaved` to `IssueStats` aggregation and surface them in the dashboard's per-issue cost view.
B4. Add a `pan tldr verify <workspace>` CLI shortcut for ad-hoc daemon health checks.
B5. Document MCP tool availability check: the new prompts need a way to know "is TLDR live in this workspace right now?" so they can degrade gracefully. Add this signal to the context manifest in Phase C.

Acceptance: TLDR daemon is up in every workspace by default; daemon status is visible in dashboard; per-issue dashboard shows TLDR-saved tokens; agents that try TLDR tools when daemon is up succeed deterministically.

### Phase C — Synthesis orchestration mechanics (no prompt work yet)

C1. Implement context-manifest builder. New module `src/lib/cloister/review-context.ts` exposes `buildReviewContext(issueId): Promise<ReviewContext>` that produces the JSON described in §5.2. Pure function over `git diff`, file stats, TLDR queries.
C2. Implement sub-role spawn API for review: `spawnRun(issueId, 'review', { subRole: 'security' | 'correctness' | 'performance' | 'requirements' })` consumes the manifest and resolves model via `resolveModel('review', subRole)`.
C3. Implement output-file watch and stall detection in a small library that synthesis calls (not in synthesis's prompt). The mechanics live in TypeScript so the prompt can stay declarative: synthesis tells it "wait for these four files, retry once on stall, proceed after timeout × 2."
C4. Reaper. Ensure killing the synthesis tmux session kills sub-reviewer sessions. Process-group ownership preferred; explicit reap on synthesis exit as backstop.
C5. Delete `spawnReviewCoordinatorSession`, `runReviewerRound`, `waitForReviewerSessions`, `selectCompletedReviewers`. These die in this phase.

Acceptance: integration test spawns synthesis, observes four sub-reviewer sessions, kills synthesis, verifies all four reap within 5 s.

### Phase D — Reviewer prompt rewrite (the heart of this PRD)

D1. Write `roles/review.md` (synthesis orchestrator). Implements §5.1, §6 principles P1–P3, P6, P9. Length target: ≤ 200 lines. Single completion mechanism, clear stall policy, severity-mapping table, output schema. No tail markers, no war stories.
D2. Write `roles/review-security.md`. Implements §6 P1–P5, P7, P8. Length target: ≤ 120 lines. No 3-pass structure. TLDR-first language. Security-scope-only — no AC checks, no perf checks.
D3. Write `roles/review-correctness.md`. Same shape as D2. **Remove AC and bead checks from this file entirely** — they move to requirements. Length target: ≤ 120 lines.
D4. Write `roles/review-performance.md`. Same shape. Hot-path emphasis. Length target: ≤ 120 lines.
D5. Write `roles/review-requirements.md`. Owns AC traceability and bead alignment. Length target: ≤ 140 lines.
D6. Delete `agents/pan-review-agent.md`, `src/lib/cloister/prompts/review.md`, and `src/lib/cloister/prompts/review/*.prompt-template.md`. Update all loader references.
D7. Update `roles/plan.md` and any planning-time references that mention old prompt paths.

Acceptance: each sub-reviewer prompt fits comfortably in a single context-window header alongside the review manifest; no prompt contradicts its agent definition; no prompt contains the phrases "MUST complete 3 review passes," "Read each changed file," "read-only reviewer," or "your turn does not end."

### Phase E — Verdict and feedback delivery

E1. Synthesis writes `synthesis.md` + `synthesis.json` as today (schema stays — work-agent parser still keys on `# Verdict:` and tail markers). Don't change the schema; only the way it's produced.
E2. Synthesis posts the PR review via the existing `review-agent.ts:postGithubReview()` path (renamed to live under review role module).
E3. On `CHANGES_REQUESTED`, synthesis delivers feedback to the work agent via the existing `deliverAgentMessage()` primitive.

Acceptance: a PR that would have produced `CHANGES_REQUESTED` under the old pipeline produces the same verdict and same blocker list under the new one, on the same diff. Verified by replaying 3 historical PRs.

### Phase F — Rollout

F1. Behind a feature flag in dashboard settings: `experimental.synthesisAsOrchestrator`. Default off in the first release, default on after one week of clean canary data.
F2. Canary on Panopticon itself (dogfood) for one week.
F3. Cost dashboard tracks before/after on `review` role token spend. Block flipping default-on until G2 is hit (≥ 75% reduction).
F4. Once default-on for 2 weeks, delete the flag and the old code paths definitively.

---

## 8. Acceptance criteria

The PRD is satisfied when **all** of these are true:

- [ ] G1: `spawnReviewCoordinatorSession`, `runReviewerRound`, `waitForReviewerSessions`, `selectCompletedReviewers` are deleted.
- [ ] G1: Killing a synthesis session reaps its four sub-reviewer sessions within 5 s.
- [ ] G2: Mean `review`-role token cost per PR drops ≥ 75% vs the 4-week baseline preceding rollout.
- [ ] G3: All five new role files mention TLDR tools explicitly and instruct TLDR-first reads.
- [ ] G3: TLDR daemon status is visible in the dashboard resources tree and `pan doctor`.
- [ ] G3: Issue-level cost view shows `tldrInterceptions` and `tldrTokensSaved`.
- [ ] G4: No sub-reviewer runs `git diff` in its own session — confirmed by code review of the new prompts.
- [ ] G4: A single `.pan/review/<runId>/context.json` is produced per review round.
- [ ] G5: No new role file contains the strings: "read-only reviewer", "MUST complete 3 review passes", "your turn does not end", "Read each changed file", "non-negotiable", or a sentinel completion path.
- [ ] G5: Each sub-reviewer's `tools:` frontmatter, stated boundaries, and required final action are consistent.
- [ ] G6: Three historical "clean" PRs (no real blockers) are replayed through the new pipeline and produce `APPROVED`.
- [ ] G7: Synthesis correctly proceeds with three sub-reviewers when one is killed mid-run, and the synthesis Summary records the omission.
- [ ] All existing review tests in `tests/lib/cloister/review-agent.test.ts` and equivalents pass against the new pipeline.

---

## 9. Risks and mitigations

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| TLDR daemon is flaky on some workspaces and silently degrades the new pipeline | M | M | Phase B hardens daemon lifecycle and adds health surfacing before D depends on it. New prompts explicitly fall back to Read on missing TLDR and surface the gap in synthesis Summary. |
| Context manifest grows unbounded on huge PRs | L | M | Cap embedded TLDR summaries to 1.2k tokens per file. Files beyond rank threshold get a one-line entry. Total manifest size budget: 30k tokens. |
| Synthesis stall policy is wrong (too aggressive, drops real findings; too lax, hangs) | M | M | Tune wait window during canary. Surface stall events in the dashboard so we can observe and adjust without redeploying. |
| Severity calibration approves real bugs that today's "everything blocks" policy catches | L | H | Replay 10 recent PRs through new policy as part of Phase E and compare verdicts against the merged outcome. Adjust thresholds before default-on. |
| Sub-reviewers spawned via `spawnRun` don't see the same model overrides the Agent-tool path does today | L | M | Phase C2 test explicitly verifies model resolution matches `resolveModel('review', subRole)`. |
| Deleting old prompts breaks an off-the-beaten-path code path (e.g. test harness, a stale skill, dist artifact) | M | L | Grep-sweep before deletion. Build CI catches dangling imports. Document in CHANGELOG. |

---

## 10. Open questions

1. **Where does the synthesis pre-read live in the prompt vs in code?** The §5.2 manifest builder is TypeScript. But does synthesis *call* it via Bash, or does Panopticon hand the manifest in as part of the spawn prompt? Latter is cleaner (prompt stays declarative); former is more agentic. Recommend latter for v1; revisit if synthesis needs to refresh the manifest mid-round.
2. **How do we surface "TLDR was down for this review" to the user?** Synthesis Summary line is the obvious answer. Should it also raise a dashboard warning chip on the issue? Probably yes; cheap to add.
3. **Do we keep the directive severity glyphs (`!`, `⊗`, `~`, `≉`, `?`) or switch to plain ASCII tiers?** Glyphs are unicode-fragile in some terminals. Recommend: glyphs in sub-reviewer outputs (it's their analytical vocabulary), ASCII tier names (BLOCKER / HIGH / NIT) in synthesis output and PR comments (user-facing). Synthesis prompt has the mapping table.
4. **Should sub-reviewers be allowed to spawn their own sub-tools (e.g. `tldr_semantic`) freely, or only at synthesis's direction?** Recommend freely, scoped to TLDR MCP tools. The win from TLDR is precisely that reviewers self-direct their context loading.

---

## 11. Related work

- **PAN-1048** (blocker): Role primitive, sub-role configuration. Without this, "review.synthesis" and `spawnRun(issueId, 'review', { subRole })` don't exist.
- **PAN-977**: Wave-based dispatch → per-item DAG with synthesis agents. Different pipeline (work-time DAG), but the synthesis pattern is conceptually shared. Lessons should transfer.
- **PAN-398 (closed)**: Headroom transparent compression proxy. Abandoned upstream. The CCR + CacheAligner + SharedContext ideas are conceptually related to G4 but orthogonal to the work in this PRD.
- **Conv 906** (`pan.localhost/conv/906`, 2026-05-10): Cost-reduction investigation that surfaced the eight waste sources documented in §4 and the TLDR-integration gaps in Phase B.
- **PAN-1055**: The stall story embedded as a war-story in the current correctness prompt. Resolved by code change; the war-story text should not have been added to the prompt and is removed in Phase D.

---

## 12. Out of band: what we are NOT changing in this PRD but should track

- **Smart model selector dead code** (`getValueScore()`): real cost win, separate issue.
- **Cloister router keyword matching**: separate issue.
- **Dirac-style hash-anchored edits / AST surgical precision**: future, separate issue, possibly PAN-1061.
- **Plan-role and work-role prompt sweeps**: same anti-patterns probably exist there; address after we validate the review-role rewrite.

---

**End of PRD.**
