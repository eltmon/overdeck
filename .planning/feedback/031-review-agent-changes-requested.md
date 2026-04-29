---
specialist: review-agent
issueId: PAN-905
outcome: changes-requested
timestamp: 2026-04-29T15:51:18Z
---

CODE REVIEW BLOCKED for PAN-905:

## BLOCKED — 3 issues must be fixed

### BLOCK 1: Missing test file — src/cli/commands/system-health.ts
`system-health.ts` is a new 99-line file with real logic (dashboard HTTP check, smee-client status check, CLIProxy check, output formatting). Mandatory requirement #1: every new function MUST have test files. No exceptions. There is no test file for this command.

### BLOCK 2: Missing test file — src/dashboard/server/routes/webhooks.ts
`webhooks.ts` is a new 166-line route with security-critical HMAC-SHA256 signature verification logic, repository allowlist filtering, dev-mode bypass (PANOPTICON_DEV_WEBHOOKS=1), and fiber-forked dispatch. This code has zero test coverage. The signature verification is a defense-in-depth security boundary. Mandatory requirement #1 applies. Need tests covering: valid signature accepted, invalid signature rejected, missing signature rejected, dev-mode bypass, unknown event types, untracked repository rejected.

### BLOCK 3: Double restart scheduling bug in startSmeeClient — src/lib/smee.ts:90-128
`client.onerror` is assigned BEFORE `await client.start()`. When the initial connection fails, the real SmeeClient fires BOTH:
1. `events.onerror` (stored from the pre-start setter) → calls `scheduleRestart()`
2. The `catch` block in `startSmeeClient` → calls `scheduleRestart()` again

Result: `restartAttempt` is incremented twice, two timeouts are created (first leaked when `restartTimeout` is overwritten), and `MAX_RESTART_ATTEMPTS` is hit in half the expected number of retries. The tests do NOT catch this because the mock replaces the entire SmeeClient class with one whose `onerror` setter only stores the function — it never calls it when `start()` rejects. The fix is to move `client.onerror = ...` to AFTER `await client.start()` succeeds (so it only fires for errors during active operation), or add a `if (restartTimeout !== null) return;` guard in `scheduleRestart`.

---

### Advisory (fix alongside blocks)

**A1: scheduleRestart has no already-pending guard (smee.ts:55-70)**
If called twice in rapid succession, two timeouts are scheduled. The first gets orphaned when `restartTimeout` is overwritten. Add `if (restartTimeout !== null) return;` at the top of `scheduleRestart`.

**A2: key={idx} antipattern in BlockedMergeRow (AwaitingMergePage.tsx:350,375)**
Using array index as React key on `blockerReasons.map()`. Use `br.type` as key since types are unique per issue.

**A3: refreshMergeStateFromGitHub setTimeout not tracked (webhook-handlers.ts:219)**
The 30-second reconciliation timeout return value is discarded. Cannot be cancelled on server shutdown. Store it and cancel in a cleanup function.

**A4: any[] in test mock function signatures (smee.test.ts, smee-process.test.ts, webhook-handlers.test.ts)**
Test mocks use `(...args: any[])`. Replace with explicit types matching the mocked functions signatures.

## REQUIRED: Fix ALL issues above, then invoke the /rebase-and-submit skill

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests locally to verify your fixes
4. Commit every change
5. Invoke the /rebase-and-submit skill for PAN-905 — this is an atomic task that runs pan done (which handles rebase + push + re-submit internally)

Do NOT stop between steps. Do NOT run git push manually — the skill handles it. Do NOT stop until pan done has completed successfully.
