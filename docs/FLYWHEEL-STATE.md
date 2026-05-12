# Flywheel State Snapshot

> Last updated: 2026-05-12 after review pipeline rescue run.

## Active Pipeline

| Issue | Phase | Root Cause/Blocker | Auto-Requeues | Runs Stuck | Notes |
|-------|-------|-------------------|---------------|------------|-------|
| PAN-1053 | In Review | Review blocked — convoy reviewers failed (invalid model) | 0 | 1 | Work agent resumed with feedback. Re-review will spawn with fixed model. |
| PAN-1069 | In Review | Review blocked — correctness findings | 0 | 1 | Work agent resumed with feedback. |
| PAN-1104 | In Review | Review blocked — requirements findings | 0 | 1 | Work agent resumed with feedback. |
| PAN-1105 | In Review | Review blocked — performance findings | 0 | 1 | Work agent resumed with feedback. |
| PAN-1106 | In Review | Review blocked — requirements findings | 0 | 1 | Work agent resumed with feedback. |
| PAN-1107 | In Review | Review blocked — correctness findings | 0 | 1 | Work agent resumed with feedback. |
| PAN-1111 | In Review | Review blocked — correctness findings | 0 | 1 | Work agent resumed with feedback. |
| PAN-457 | In Review | Review blocked — convoy reviewers failed (invalid model) | 0 | 2 | Work agent resumed with feedback. Ship agent killed (orphaned). |
| PAN-913 | In Review | Review blocked — correctness findings | 0 | 1 | Work agent resumed with feedback. |
| PAN-977 | In Review | DAG-driven swarm dispatch (complex feature) | 0 | 0 | Long-running work; review not yet triggered. |

## Cycling Alerts

| Pattern | Why it cycles | Candidate fix | Status |
|---------|--------------|---------------|--------|
| Review orchestrators write synthesis but never signal | `buildReviewRolePrompt()` used wrong CLI command `pan specialists done review` (doesn't exist) | Fixed: corrected to `pan admin specialists done review` + added `exit` instruction | Resolved (Run 2026-05-12) |
| Convoy reviewers crash immediately with 404 | Default `workhorse:mid` was `claude-sonnet-4-7` (invalid model ID) | Fixed: changed to `claude-sonnet-4-6` | Resolved (Run 2026-05-12) |
| PAN-457 review repeatedly fails with no convoy outputs | Same root cause as above — invalid model ID caused all reviewers to crash | Fixed by model ID fix. Work agent will trigger re-review on next `pan done`. | Monitoring |

## Infrastructure Gaps

| Gap | Impact | Status |
|-----|--------|--------|
| Review orchestrator has no auto-timeout if convoy reviewers all crash | Orchestrator polls forever for output files that will never appear | Resolved (Run 2026-05-12) — model fix prevents crashes; future: add bounded wait + auto-retry in `waitForReviewerOutputs()` |
| No automated validation of model IDs against Claude Code's supported list | Invalid model IDs cause silent immediate crashes | New gap discovered 2026-05-12 — should add startup validation or model ID registry |

## Pattern Ledger

| Symptom | Root cause | Fix applied |
|---------|-----------|-------------|
| Review orchestrator `running` for hours, synthesis.md exists | Wrong CLI command in prompt — orchestrator couldn't signal completion | Fixed `buildReviewRolePrompt()` command + added `exit` |
| Convoy reviewers `stopped` after ~1 min, no output files | Invalid model ID `claude-sonnet-4-7` → Claude Code 404 on launch | Fixed `DEFAULT_WORKHORSES.mid` |
| `agent-xxx-review-subrole` directories missing after crash | `isValidAgentDirectoryName()` didn't recognize specialist suffixes | Fixed validator to accept role/subRole suffixes |

## Skill Gaps

| Desired capability | Why needed | Status |
|-------------------|-----------|--------|
| Model ID validation at config load time | Prevent invalid model IDs from reaching launchers | Open — add to config validation or harness startup |
