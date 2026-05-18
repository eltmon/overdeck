# Flywheel State Snapshot

> Last updated: 2026-05-17 after pipeline-clear push.

## Run 2026-05-17 — Pipeline-Clear Push

**Trigger:** User stepping away with directive "we HAVE to clear this pipeline tonight". Authorized autonomous merges.

**Shipped:**
- PAN-1104 merged at 23:09:25Z (pan-reopen GitHub-to-Linear misrouting fix)
- PAN-1141 merged at 00:03:18Z (pipeline metadata spec)

**Filed + queued (mine, this run):**
- PR #1159 (PAN-1158) — beads safety net + auto-requeue circuit-breaker raise (7 → 25). **Review BLOCKED twice:** requirements reviewer flags it as a "workaround not root-cause fix" per No-Bandaids policy, despite the issue title literally being "safety net". Need user decision: ship as-is (acknowledged safety net), or escalate scope to fix `bd export` refuse-empty in upstream.
- PR #1160 (PAN-1160) — deacon reconciler for stale `readyForMerge` when PR closed without merge. Branch renamed `feature/pan-1160-stale-ready` → `feature/pan-1160` to match convention; **PR head not updated on GitHub** — need to close+reopen or push to new ref. Worktree at `/home/eltmon/Projects/pan-1160-reconciler` (non-standard path).
- PR #1163 (PAN-1162) — ship role `allowHost: true` bypass for workspace stack-health gate. Tiny surgical substrate fix. Needs review pipeline kicked.

**Stale PR links cleaned (review status reset):**
- PAN-913 → linked PR #916 (closed). Real PR is #1155 (feature/pan-913-hardening). Review found two real blockers in earlier cycle: (a) `pan done` open-bead gate passes on `bd list` timeout; (b) `existsSync` in `bridgeCodexAuthToCliproxyAsync` violates No-sync-I/O AC. State reset, but PR link still wrong. **Needs work agent iteration.**
- PAN-1111 → linked PR #1114 (closed). Real PR is #1161. State reset, PR link still wrong.

**Substrate bugs encountered:**
1. **Verification gate uses placeholder workspace path** — when the feature branch is checked out in the main repo (not a worktree), `workspaces/feature-<id>/` may exist as an empty stub (e.g. populated only by review-agent's `.pan/` dir). Verification's `npm run typecheck` then runs in the stub, hits no `package.json`, fails. Resolved manually for PAN-1158 by re-creating the worktree. **Substrate fix needed**: verification should resolve workspace path from the branch's actual checkout, not assume `workspaces/feature-<id>/`.
2. **Stack-health gate blocks ship role unnecessarily** — fixed in PR #1163 (PAN-1162).
3. **Review agent's correctness reviewer produces no output file but still drives synthesis** — for PAN-1158, the synthesis stuck to "cannot recover staged deletion" even after the staged-deletion case was fixed and a regression test added. The agent must have read a stale state or carried verdict from prior cycle. **Investigation needed.**
4. **Branch rename does not update GitHub PR head ref** — `git branch -m` + force-push leaves the PR pointing at the old branch name on GitHub. Need explicit close-and-reopen flow.

**Why the pipeline did NOT clear:**
- Review agent's strict No-Bandaids enforcement blocks all "safety-net" PRs even when that IS the scope.
- Real review blockers on PAN-913, PAN-1053, PAN-457, PAN-829 need work-agent iteration; agents have pending-question states and aren't progressing.
- Workspace path mismatch substrate bug requires investigation before further infrastructure PRs can pass verification.

**Recommended next session focus:**
1. User decision on PAN-1158 safety-net vs. root-cause scope; if shipping, may need review override.
2. Fix verification workspace-path resolver (substrate bug #1 above).
3. Address work-agent pending-question backlog on PAN-913/1053/457/829.
4. Relink PAN-913 → #1155 and PAN-1111 → #1161 PR URLs explicitly.

---

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
