VERIFICATION FAILED for PAN-1818 (attempt 1/10):

Failed check: vbrief-ac

Acceptance criteria check FAILED — 12/12 AC incomplete:

### Fast-fail convoy reviewers on context overflow in monitorReviewConvoySignals (no respawn) (4/4 incomplete)
  - [ ] Given a convoy reviewer that is alive, has written no output for this run, and whose pane tail contains 'input exceeds the context window', when monitorReviewConvoySignals runs, then it sends the synthesis agent REVIEWER_FAILED <subRole> with a reason naming 'context-window overflow'.
  - [ ] Given the same overflowed reviewer, when monitorReviewConvoySignals runs, then respawnIdleReviewer is NOT invoked (no respawn for deterministic overflow).
  - [ ] Given a reviewer that is idle with no output but whose tail shows NO overflow pattern, when monitorReviewConvoySignals runs, then the existing PAN-1806 idle-respawn path is preserved (respawnIdleReviewer still invoked on first idle detection).
  - [ ] Given an overflowed reviewer, the monitor emits the REVIEWER_FAILED signal on the first pass that observes the overflow tail, without waiting for the 3-minute REVIEWER_IDLE_FAILURE_MS idle threshold.

### Exclude convoy reviewer sub-role sessions from checkApiErrorAgents generic recovery (2/2 incomplete)
  - [ ] Given a session named agent-pan-1815-review-correctness whose pane tail shows a context-overflow 400, when checkApiErrorAgents runs, then it performs NO recovery action on it: resumeAgent, markWorkspaceStuck, and sendKeys are never called for that session.
  - [ ] Given a normal work-agent session agent-pan-1815 with a context-overflow 400, when checkApiErrorAgents runs, then its existing recovery still fires (regression guard that the exclusion is scoped to reviewer sub-role sessions only).

### Add large-changeset signal to review manifest + conditional selective-reading guardrail in Tier-1 summary (3/3 incomplete)
  - [ ] Given a changeset of >25 files or >1500 total changed lines, when buildReviewContext runs, then manifest.largeChangeset.isLarge === true with correct fileCount and changedLines.
  - [ ] Given a large changeset manifest, when formatTier1Summary runs, then its output contains the selective-reading guardrail block (mentions reading highest-risk files first and flagging uncovered files as a blocking coverage gap).
  - [ ] Given a small changeset (<=25 files and <=1500 lines), when formatTier1Summary runs, then isLarge === false and the guardrail block is absent (small-PR prompts unchanged).

### Reconcile gpt-5.5 capability notes with its 150k CLIProxy ceiling and lock with a test (3/3 incomplete)
  - [ ] Given the gpt-5.5 capability entry, then its notes no longer claim a 200K effective ceiling and instead state the 150K conservative CLIProxy ceiling.
  - [ ] A unit test preserves the invariant that MODEL_CAPABILITIES['gpt-5.5'].contextWindow equals CLIPROXY_CODEX_CONTEXT_WINDOW, failing if the two ever diverge.
  - [ ] Given the change, then MODEL_CAPABILITIES['gpt-5.5'].contextWindow still equals 150000 and no gpt-5.5 skill score is modified (notes-only edit, value preserved).

## REQUIRED: Complete all acceptance criteria BEFORE resubmitting

1. Review the incomplete AC above
2. Implement the missing requirements and write tests
3. Close every completed bead with `bd close` — AC statuses sync from closed beads automatically; never hand-edit spec files
4. Commit and push ALL changes
5. ONLY THEN resubmit: pan review request PAN-1818 -m "Completed acceptance criteria"

Do NOT resubmit until all AC are completed.