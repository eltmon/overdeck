# PAN-174: Verification Gate Before Code Review

## Current Status: COMPLETE

## Summary

Implemented a verification gate that runs typecheck → lint → test before the review-agent starts. This prevents trivially-broken code from reaching the review pipeline, saving review-agent cycles.

## Implementation

### Task 1: `src/lib/cloister/verification-gate.ts` (NEW)
- `runVerificationGate(workspacePath, opts)` runs typecheck → lint → test sequentially, bailing on first failure
- Uses `execAsync` with 5-minute timeout per check
- SSH wrapping for remote workspaces (`isRemote`, `vmName` options)
- Returns `VerificationResult` with `passed`, `failedCheck`, `checks[]` (per-check output), and `summary`
- Long output truncated to 3000 chars with `...(truncated)` marker

### Task 2: `src/lib/review-status.ts`
- Added `verificationStatus?: 'pending' | 'running' | 'passed' | 'failed'`
- Added `verificationNotes?: string`
- Added `verificationCycleCount?: number`

### Task 3: `src/dashboard/frontend/src/components/WorkspacePanel.tsx`
- Added `verificationStatus`, `verificationNotes`, `verificationCycleCount` to `ReviewStatus` interface
- Added Verification Status Display section above the Review Status Display
- Shows spinner for 'running', red badge for 'failed' with notes, green for 'passed'
- Shows attempt count (e.g. "Attempt 2/3") when cycle count > 0

### Task 4: `src/dashboard/server/index.ts` — Wire into review endpoint
- After branch push + commit hash snapshot, before review-agent wake: runs verification gate
- On pass: sets `verificationStatus: 'passed'`, continues to review-agent
- On fail: increments `verificationCycleCount`, writes feedback file, sends `messageAgent()` to work agent, returns early with `verificationFailed: true` response
- Circuit breaker: max 3 cycles (when `verificationCycleCount >= MAX_VERIFICATION_CYCLES`, skip verification and proceed to review-agent)
- Human-initiated review (`POST /api/workspaces/:issueId/review`) resets `verificationCycleCount: 0` and `verificationStatus: 'pending'`
- Reset-review endpoint also clears verification state

### Tests: `tests/cloister/verification-gate.test.ts` (NEW)
- 8 tests covering: all-pass, bail-on-typecheck, bail-on-lint, test-failure, SSH prefix, local cwd, output truncation, duration in summary

## Files Changed
- `src/lib/cloister/verification-gate.ts` — new module
- `src/lib/review-status.ts` — added verification fields to ReviewStatus interface
- `src/dashboard/frontend/src/components/WorkspacePanel.tsx` — verification UI
- `src/dashboard/server/index.ts` — wired verification gate into review endpoint + reset endpoints
- `tests/cloister/verification-gate.test.ts` — new test file

## Remaining Work
None

## Specialist Feedback
(none yet)
