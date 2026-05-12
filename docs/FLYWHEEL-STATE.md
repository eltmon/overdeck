# Flywheel State Snapshot

> Last updated: 2026-05-12 after review pipeline fix verification.

## Active Pipeline

| Issue | Phase | Root Cause/Blocker | Auto-Requeues | Runs Stuck | Notes |
|-------|-------|-------------------|---------------|------------|-------|
| PAN-1053 | In Progress | Work agent fixing review feedback (review passed with fixed pipeline) | 0 | 0 | Fresh review completed successfully with fixes. Verdict: CHANGES_REQUESTED. Work agent resumed fixing blockers. |
| PAN-1069 | In Progress | Work agent fixing review feedback (correctness findings) | 0 | 1 | Old review stuck from pre-fix. Work agent needs to re-signal done after fixes to spawn fresh review. |
| PAN-1104 | In Progress | Work agent fixing review feedback (requirements findings) | 0 | 1 | Same as PAN-1069. |
| PAN-1105 | In Progress | Verification gate failed: sync-target-branch + review feedback (performance findings) | 0 | 1 | Work agent fixing sync issue and review blockers. |
| PAN-1106 | In Progress | Work agent fixing review feedback (requirements findings) | 0 | 1 | Dashboard shows pendingQuestion but tmux shows agent working. |
| PAN-1107 | In Progress | Work agent fixing review feedback (correctness findings) | 0 | 1 | Same pattern. |
| PAN-1111 | In Progress | Work agent fixing review feedback (correctness findings) | 0 | 1 | Same pattern. |
| PAN-457 | In Progress | Verification gate failed: lint + review feedback | 0 | 2 | Work agent fixing lint issues. Ship agent killed (orphaned). |
| PAN-913 | In Progress | Work agent fixing review feedback (correctness findings) | 0 | 1 | Same pattern. |
| PAN-977 | In Progress | DAG-driven swarm dispatch (complex feature) | 0 | 0 | Long-running work; review not yet triggered. |

## Cycling Alerts

| Pattern | Why it cycles | Candidate fix | Status |
|---------|--------------|---------------|--------|
| Review orchestrators write synthesis but never signal | `buildReviewRolePrompt()` used wrong CLI command `pan specialists done review` (doesn't exist) | Fixed: corrected to `pan admin specialists done review` + added `exit` instruction | Resolved (Run 2026-05-12) |
| Convoy reviewers crash immediately with 404 | Default `workhorse:mid` was `claude-sonnet-4-7` (invalid model ID) | Fixed: changed to `claude-sonnet-4-6` | Resolved (Run 2026-05-12) |
| PAN-457 review repeatedly fails with no convoy outputs | Same root cause as above — invalid model ID caused all reviewers to crash | Fixed by model ID fix. Work agent will trigger re-review on next `pan done`. | Resolved (Run 2026-05-12) |

## Infrastructure Gaps

| Gap | Impact | Status |
|-----|--------|--------|
| Review orchestrator has no auto-timeout if convoy reviewers all crash | Orchestrator polls forever for output files that will never appear | Resolved (Run 2026-05-12) — model fix prevents crashes; future: add bounded wait + auto-retry in `waitForReviewerOutputs()` |
| No automated validation of model IDs against Claude Code's supported list | Invalid model IDs cause silent immediate crashes | New gap discovered 2026-05-12 — should add startup validation or model ID registry |
| Ship specialist not in validSpecialists array | Ship agents cannot signal completion, blocking merge pipeline | Resolved (Run 2026-05-12) — added 'ship' to validSpecialists in CLI and API route |

## Pattern Ledger

| Symptom | Root cause | Fix applied |
|---------|-----------|-------------|
| Review orchestrator `running` for hours, synthesis.md exists | Wrong CLI command in prompt — orchestrator couldn't signal completion | Fixed `buildReviewRolePrompt()` command + added `exit` |
| Convoy reviewers `stopped` after ~1 min, no output files | Invalid model ID `claude-sonnet-4-7` → Claude Code 404 on launch | Fixed `DEFAULT_WORKHORSES.mid` |
| `agent-xxx-review-subrole` directories missing after crash | `isValidAgentDirectoryName()` didn't recognize specialist suffixes | Fixed validator to accept role/subRole suffixes |
| Ship agent signals done but review status never updates | 'ship' missing from `validSpecialists` in done.ts and specialists.ts route | Added 'ship' to both arrays with case handler |
| Merge agent loops on conflict resolution | Re-scanning for additional conflicts after each resolution creates infinite loop | Added no-rescan rule: resolve once, verify once, push once |

## Skill Gaps

| Desired capability | Why needed | Status |
|-------------------|-----------|--------|
| Model ID validation at config load time | Prevent invalid model IDs from reaching launchers | Open — add to config validation or harness startup |
| Automatic cleanup of old specialist sessions after rescue | Orphaned review/ship sessions accumulate in agent list | Open — deacon should mark orphaned specialists as cleaned after work agent resumes |
