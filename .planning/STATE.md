# PAN-598: Support latest ChatGPT/OpenAI models with subscription tier awareness

## Status: Implementation Complete

## Current Phase
All beads closed. Ready for merge.

## Completed Work
- [x] feature-pan-489-67t: Add subscription tier config schema (commit: 10120e12)
- [x] feature-pan-489-alt: Extend OpenAI model registry with new models and tier metadata (commit: e1e36362)
- [x] feature-pan-489-32g: Add tier-aware filtering to smart model selector (commit: bf34d76c)
- [x] feature-pan-489-agh: Add tier-aware model fallback (commit: f96099a5)
- [x] feature-pan-489-gfo: Integrate claudish prefix into agent spawning (commit: 431f437f)
- [x] feature-pan-489-9f7: Add claudish provider prefix mapping (commit: 431f437f)
- [x] feature-pan-489-l6w: Replace CCR install with claudish binary download (commit: fb2e0189)
- [x] feature-pan-489-rj6: Replace CCR sync check with claudish version check (commit: ca3b4e8b)
- [x] feature-pan-489-efh: Remove CCR command and documentation (commit: 56bf6872)
- [x] feature-pan-489-6ah: Update dashboard to display full claudish prefix + backing model (commit: 41e1fe99)
- [x] feature-pan-489-61v: Research ChatGPT OAuth prefix in claudish (commit: 431f437f)
- [x] feature-pan-489-4us: Verify token usage tracking for OpenAI models via JSONL (commit: 4ee50fb4)

## Remaining Work
None

## Key Decisions
- D1: cx@ prefix NOT confirmed in claudish v6.12.2 docs — use research bead to verify before implementing
- D2: claudish managed via `pan install`/`pan sync` only, no direct CLI command for end users
- D3: Remove CCR entirely (pan-598-ufd bead)
- D4: Linux binary installed to ~/.local/bin/claudish via GitHub releases
- D5: Dashboard shows full prefix + backing (e.g. `oai@gpt-5.4`) via tmux pane parser update

## Specialist Feedback
- **[2026-04-10T06:28Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-10T06:38Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
- **[2026-04-10 addressed]** Fixed activity-logger.ts: removed null coercions, refactored emitDashboardLifecycle to avoid Record<string,unknown> type (commit: 2d3fe325)
- **[2026-04-10 addressed]** Fixed event-store.ts: added @ts-ignore on bun:sqlite dynamic import — root tsconfig follows import chain from activity-logger.ts into dashboard server, but @types/bun is only in dashboard server node_modules (commit: e7505bae)
