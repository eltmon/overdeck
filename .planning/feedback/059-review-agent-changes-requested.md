---
specialist: review-agent
issueId: PAN-540
outcome: changes-requested
timestamp: 2026-04-18T15:48:19Z
---

CODE REVIEW BLOCKED for PAN-540:

Blocked: review-agent now waits for .pan/review outputs, but the reviewer and synthesis templates still write/read .claude/reviews (src/lib/cloister/review-agent.ts:497-551; agents/code-review-correctness.md:65,171; agents/code-review-security.md:107,249; agents/code-review-performance.md:83,311; agents/code-review-requirements.md:98; agents/code-review-synthesis.md:17-19,28-40,373-376). Also, parseAgentOutput/parseReviewSynthesis require REVIEW_RESULT/NOTES/etc markers, but the synthesis template never instructs the agent to emit those markers, so parsing falls back to COMMENTED/pending instead of producing a real review result (src/lib/cloister/review-agent.ts:138-214,565-604; agents/code-review-synthesis.md:81-176,227-387). Add regression tests that exercise the real template/output contract, not only hand-written synthesis fixtures.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-540 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
