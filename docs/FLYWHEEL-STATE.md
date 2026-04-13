# Flywheel State
<!-- LIVING DOCUMENT — overwritten by each /all-up run. History lives in OPERATION-FIX-ALL.md -->
_Last updated: 2026-04-13 (Run 5) — auto-maintained by the all-up flywheel_

---

## Active Pipeline

Each row is an issue the flywheel is tracking. **Runs Stuck** counts consecutive runs where
the issue was blocked at the same phase with the same root cause. ≥2 = cycling alert.

| Issue | Phase | Root Cause / Blocker | Auto-Requeues | Runs Stuck | Notes |
|-------|-------|----------------------|---------------|------------|-------|
| PAN-509 | review-blocked | Dead code review loop: agent fixes items piecemeal instead of holistic audit | 7→reset | 3 | Code fixes landed (f4c23529 removed unused import); agent idle waiting for feedback dispatch |
| PAN-596 | review-failed | Test failures (ComposerPromptEditor capturedRootElement undefined) + verification gate repeating failures | 0 | 3 | Agent has addressed most code review issues; tests still failing across multiple cycles |
| PAN-611 | merge-conflicts | Schema conflicts + skill file scope creep | 0 | 1 | Ongoing merge conflicts with main |
| PAN-457 | planning | — (in progress) | 0 | 0 | Planning agent active |
| PAN-540 | planning-complete | — (awaiting implementation start) | 0 | 0 | Plan ready for work agent |
| PAN-653 | planning | — (in progress) | 0 | 0 | Planning agent active |
| PAN-544 | merged | — (done) | — | — | CLOSED: shipped to production ✓ |
| PAN-645 | merged | — (done) | — | — | CLOSED: shipped to production ✓ |

---

## Cycling Alerts

Issues where the flywheel has seen the same symptom across ≥2 consecutive runs without
a substrate fix landing. These are the highest-priority diagnosis targets.

### PAN-509 — Dead Code Review Loop (3 runs, escalating)
- **Pattern**: Review agent finds scattered dead code across multiple passes. Agent fixes only the items named in feedback, then gets more feedback on different dead code items discovered during the next cycle.
- **Root cause**: (1) Review-agent prompt doesn't require holistic dead-code audit before resubmitting. (2) Work agent is stuck at idle after calling `pan work done`, not actively responding to verification feedback.
- **System issue**: Feedback delivery — agent thinks they're done but verification feedback (files 010-011) indicates they still have work to do. Agent at idle prompt, unaware of new feedback or unable to process it.
- **Candidate fix**: (1) Improve review-agent prompt to request full dead-code pass across entire changeset. (2) Verify feedback delivery wakes the agent or surfaces the message visibly.
- **Status**: Run 5 investigation found agent idle with committed code fixes (f4c23529) but not resubmitted. Needs system intervention to resume.

### PAN-596 — Test Failures Across Multiple Cycles (3 runs)
- **Pattern**: Verification gate fails 17+ times with the same test error (ComposerPromptEditor keydown event, capturedRootElement undefined). Agent marked work complete but tests still failing.
- **Root cause**: Pre-existing test flakiness in the test setup. Test assumes element is available but jsdom doesn't populate it in all cases. Verification bypass after 3 failures allowed partial code through.
- **System issue**: Verification gate allows bypass after 3 consecutive failures (PAN-174), masking root-cause test issues. Agent can mark work done even with failing tests if they hit the 3-failure escape hatch.
- **Status**: Run 5 — test failures persisting. Need to either fix root test issue or tighten verification acceptance criteria.

---

## Infrastructure Gaps

Functionality or automation missing from Panopticon that the flywheel keeps working around.
These should become PAN issues (or be filed as enhancements to existing ones).

| Gap | Impact | First Seen | Filed? | Status (Run 5) |
|-----|--------|-----------|--------|---|
| Blocking FS calls in request handlers | Dashboard API hangs under load; readFileSync in tracker-config service blocks event loop | Run 4 | No | **FIXED in Run 5**: commit 9cf06605 — cache .panopticon.env at startup, use cached value in request handlers (PAN-70 type fix) |
| Review circuit breaker can't self-reset | Agent needs manual intervention after 7 requeues even if code is eventually correct | Run 4 | No | **PARTIALLY ADDRESSED**: Manual reset done Run 4; need automation |
| Feedback delivery / feedback loop visibility | Agent completes work but doesn't see or act on subsequent feedback; idles thinking they're done | Run 5 | No | **NEW FINDING**: PAN-509 agent idle despite feedback files 010-011 present |
| Orphaned planning sessions | Sessions survive after plan complete; consume resources | Run 3 | PAN-682 | Ongoing |
| Verification bypass at 3 failures masks root causes | Tests can be bypassed if they fail 3x; root issues never get fixed | Run 5 | No | **NEW**: Contributing to PAN-596 cycling |
| Startup repair (repairMergedLabels) full-table scan | Runs for ALL merged issues every restart, not just new ones; noisy logs | Run 4 | No | Ongoing |

---

## Pattern Ledger

Recurring failure signatures the flywheel should diagnose immediately when seen.

| Pattern | Signature | Root Cause | Fix Applied |
|---------|-----------|------------|-------------|
| Blocking FS in request handlers | API hangs, curl timeouts on /ws/rpc or health endpoints | readFileSync, execSync in routes or early-loaded services | Cache config at startup; use async/promises during request handling (Run 5: 9cf06605) |
| Dead-code review loop | Same dead code type mentioned in multiple review cycles | Agent fixes only named items, doesn't audit holistically | **Requires**: review-agent prompt enhancement to mandate full dead-code pass |
| Verification bypass hides test issues | Tests fail 3x, bypass kicks in, work marked done with failing tests | 3-cycle escape hatch (PAN-174) | Tighten verification gate or add pre-bypass intervention |
| Feedback unprocessed by idle agent | Agent at idle prompt, feedback files exist, but agent not responding | Feedback written to file but agent not notified or doesn't re-check | Review feedback delivery mechanism; consider active notification (toast/bell) in agent terminal |
| Post-merge lifecycle incomplete | `mergeStatus=merged` but GitHub issue stays OPEN | `close-issue` step failed silently | `repairIncompletePostMergeLifecycle()` — startup repair (Run 4) |
| PR merged on GitHub but Panopticon stuck | `mergeStatus!=merged` but `gh pr view` → MERGED | Post-merge verification failed after `gh pr merge` | `repairAlreadyMergedPRs()` — startup repair (Run 4) |

---

## Skill Gaps

Panopticon workflows that the flywheel repeatedly wishes existed as a skill or automated step.

| Desired Capability | Why Needed | Priority |
|-------------------|-----------|----------|
| Holistic dead-code detection in review | Currently review finds dead code piecemeal; should audit entire changeset once | High |
| Active feedback notification for idle agents | Agents don't know feedback has arrived; need notification / wake-up mechanism | High |
| Verification gate: configurable pass criteria | Bypass after N failures allows incomplete work; need stricter or configurable thresholds | Medium |
| `pan work reset-review <id>` CLI command | Currently requires manual curl to reset circuit breaker | Medium |
| Feedback delivery: batch and de-dup | Multiple feedback files (010, 011) should consolidate into single message | Medium |
| Auto-detect cycling in review | Same issue across N cycles should escalate or auto-reformat prompt | Low |

---

## Run 5 Summary

**Bugs fixed**: 1 (PAN-70 type blocking FS calls in tracker-config)
**Issues moved**: 0 (PAN-509 and PAN-596 still cycling)
**New findings**: (1) Feedback delivery breakdown for PAN-509 agent; (2) Verification bypass (PAN-174) enabling PAN-596 test bypass
**Main branch state**: Clean, 1 commit pushed (9cf06605)
**Next priorities**: (1) Fix agent feedback delivery/visibility, (2) Tighten verification gate, (3) Improve review-agent prompt for holistic audits

