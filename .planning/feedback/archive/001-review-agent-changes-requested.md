---
specialist: review-agent
issueId: PAN-805
outcome: changes-requested
timestamp: 2026-04-24T03:42:22Z
---

# Review: CHANGES_REQUESTED

## Summary

PAN-805 delivers a solid label reconciler architecture with comprehensive test coverage and clean AC implementation (52/58 ACs fully met, 4 minor gaps). However, two security blockers (RCE via shell injection in close-issue.ts and SSRF via unsanitized repo string in github-client.ts) and two correctness/performance blockers (pagination loop brace misalignment that silently skips all but the last page, and N+1 database queries causing 2–5 second ticks at scale) must be resolved before merge. Once those six issues (4 blockers + 2 criticals) are addressed, the PR is ready to merge.

## Security Issues

- Command Injection via comment Parameter (RCE)
- Unsanitized repo String in GitHub API URLs (SSRF)
- No Authentication on Dashboard Routes
- Retry-After HTTP-Date Form Enables Rapid Retry Storms
- GitHub Token Read from Comment-Vulnerable Regex
- branchName Interpolated Without execFile

## Performance Issues

- N+1 Database Queries in Pull Step
- Unbounded Concurrency on GitHub API Calls in Push Step
- N+1 Queries in Boot Backfill
- Inefficient Label Matching with Multiple .some() Chains
- Missing Index on issue_state(updated_at last_synced_at)
- Cache resolvePrefix Across Tick Steps

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-805 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.

