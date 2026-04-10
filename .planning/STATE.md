# PAN-598: Support latest ChatGPT/OpenAI models with subscription tier awareness

## Status: In Progress

## Current Phase
Implementing beads one at a time — just completed config schema (pan-598-z2g)

## Completed Work
- [x] feature-pan-489-z2g: Add subscription tier config schema (commit: 10120e12)

## Remaining Work
- [ ] feature-pan-489-4qs: Extend OpenAI model registry with new models and tier metadata
- [ ] feature-pan-489-11s: Add tier-aware filtering to smart model selector
- [ ] feature-pan-489-24z: Add tier-aware model fallback
- [ ] feature-pan-489-mt7: Integrate claudish prefix into agent spawning
- [ ] feature-pan-489-au5: Add claudish provider prefix mapping
- [ ] feature-pan-489-49z: Replace CCR install with claudish binary download
- [ ] feature-pan-489-525: Replace CCR sync check with claudish version check
- [ ] feature-pan-489-ufd: Remove CCR command and documentation
- [ ] feature-pan-489-5ch: Update dashboard to display full claudish prefix + backing model
- [ ] feature-pan-489-5y7: Research ChatGPT OAuth prefix in claudish
- [ ] feature-pan-489-h0e: Verify token usage tracking for OpenAI models via JSONL

## Key Decisions
- D1: cx@ prefix NOT confirmed in claudish v6.12.2 docs — use research bead to verify before implementing
- D2: claudish managed via `pan install`/`pan sync` only, no direct CLI command for end users
- D3: Remove CCR entirely (pan-598-ufd bead)
- D4: Linux binary installed to ~/.local/bin/claudish via GitHub releases
- D5: Dashboard shows full prefix + backing (e.g. `oai@gpt-5.4`) via tmux pane parser update

## Specialist Feedback
- None yet
- **[2026-04-10T06:28Z] verification-gate → FAILED** — `.planning/feedback/001-verification-gate-failed.md`
- **[2026-04-10T06:38Z] verification-gate → FAILED** — `.planning/feedback/002-verification-gate-failed.md`
