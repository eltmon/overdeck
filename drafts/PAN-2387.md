# PAN-2387 — Cost page legibility: kill the UNKNOWN bucket, fix rollup mismatch, fix codex misattribution

**Issue:** https://github.com/eltmon/overdeck/issues/2387 · **Author:** oversight conversation, 2026-07-06 (re-plan after the first two planning sessions died: fable session-limit 7/5, stall pre-finalize 7/6).
**Verified-Against:** main @ f91528bea1.

## Glossary

- **Cost event**: one row in the `cost_events` table (overdeck.db), written by harness-specific parsers; fields include model, cost, token counts, `issue_id` (nullable), session/agent identity, ts.
- **UNKNOWN bucket**: the costs-by-issue row aggregating events with `issue_id` NULL/unresolvable — currently $12.7k of $16.7k lifetime, dominating the page.
- **Codex parser**: `src/lib/cost-parsers/codex-parser.ts` — derives model + cost from Codex CLI rollout/thread files.
- **Rollup**: issue-level total on `GET /api/costs/by-issue`; **model rows**: the per-model breakdown under the same issue.

## The three defects (from the issue, verified at filing time)

1. **UNKNOWN dominates**: unattributed events (conversations, flywheel, oversight) lump into one scary UNKNOWN line. Legitimate spend, illegible label.
2. **Rollup mismatch**: PAN-2383 issue-level `cost: 0.00` while its model rows sum to $14.57 — two aggregation paths disagree.
3. **Codex misattribution**: a gpt-5.5 codex session shows as `gpt-5.4-mini, $0.00` — wrong model id AND zero price from the codex parser.

## Requirements

- FR-1: Cost events that CAN be attributed get named buckets at aggregation time: conversation events → `Conversations`, flywheel-orchestrator events → their `RUN-<n>` id, remaining truly-unattributable → one neutral bucket labeled `No issue — conversations & orchestration` (exact string). No `UNKNOWN` string anywhere user-visible.
- FR-2: Issue-level total is DERIVED from the same event set as the model rows (single aggregation source) — `total == Σ(model rows)` for every issue, structurally.
- FR-3: The codex parser extracts the real model id from the rollout/thread (gpt-5.5 fixture) and computes non-zero cost via the model's registered pricing. Unknown-model fallback prices loudly (warn log) — never silently $0.
- FR-4: `/api/costs/by-issue` and the Costs page render the new buckets; drill-down for a bucket lists its sessions like an issue does.
- NFR-1: No parallel rollup: fixes live in the existing aggregators (`src/lib/overdeck/cost-sync.ts` `getCostsByIssueSync`, `src/lib/costs/` read paths) — extend, don't fork. Note PAN-2402 (merged 2026-07-06) already landed `(unattributed)` COALESCE grouping in `cost-sync.ts` — build on it, renaming per FR-1.

## Work items

1. **Codex parser model+price fix (FR-3).** In `src/lib/cost-parsers/codex-parser.ts`: locate model extraction (currently yielding `gpt-5.4-mini`), read the true model from the rollout/thread metadata; price via the models registry; add a warn-and-flag path for unknown models. Test: fixture built from a REAL gpt-5.5 rollout under `tests/fixtures/` (grab one from `~/.codex` sessions of agent-pan-2388-slot-1); assert model id and cost > 0.
2. **Attribution pass (FR-1).** In the by-issue aggregation (`getCostsByIssueSync` in `src/lib/overdeck/cost-sync.ts` and the parallel `cost-events-db` path it mirrors): resolve NULL issue_id events by session identity — conversation sessions (conversations table match) → `Conversations`; `flywheel-orchestrator` agent → `RUN-<id>` when a run id is recorded, else `Flywheel`; residual → the FR-1 neutral label. Tests: one event of each class lands in its bucket; no output key equals `UNKNOWN` or `(unattributed)`.
3. **Single-source rollup (FR-2).** Find the issue-total path that returns 0.00 while model rows sum (compare `/api/costs/by-issue` issue-total field vs model-row source; the divergence is two different readers). Make the total computed FROM the model rows (or both from one query). Test: property-style — for every issue in a seeded fixture DB, total == Σ rows.
4. **Surface (FR-4).** Costs page + issue drill updates for the new buckets. Playwright screenshot check on the Costs page (both themes) — no UNKNOWN row, buckets render.

## Acceptance criteria (mechanical)

- [ ] AC-1: No user-visible `UNKNOWN` in `/api/costs/by-issue` output or Costs page DOM (grep + Playwright).
- [ ] AC-2: For every issue: `totalCost == Σ byModel[*].cost` (fixture test).
- [ ] AC-3: gpt-5.5 codex fixture parses with model `gpt-5.5` and cost > 0.
- [ ] AC-4: Conversation/flywheel/residual events land in their named buckets (unit tests).

## Intersecting repo rules (restated)

Fake timers for delay tests; no execSync in server-reachable code; two-door rule — extend the existing cost read door, no parallel rollup (the PAN-2393 invariant); file-size ratchet.
