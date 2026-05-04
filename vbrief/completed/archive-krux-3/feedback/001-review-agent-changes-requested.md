---
specialist: review-agent
issueId: KRUX-3
outcome: changes-requested
timestamp: 2026-03-20T15:44:31Z
---

CODE REVIEW BLOCKED for KRUX-3:

BLOCKED: 3 blockers + 5 issues. (1) Missing tests for 6 renderer files — hooks/useAudioCapture, hooks/useSession, components/SessionControls, TranscriptPane, AudioDeviceSelector, ApiKeyManager. (2) Security: generic send/on IPC in preload bypasses contextIsolation — remove them. (3) Audio feedback loop: workletNode.connect(ctx.destination) in useAudioCapture:105 pipes mic to speakers. Also: dead code sessionStartTime, unreachable RECONNECT_DELAYS_MS[5], @types/ws in prod deps, broken useCallback memoization, unhandled async in pause/resume.

## REQUIRED: Fix ALL issues above BEFORE resubmitting

1. Read each blocking issue carefully
2. Fix the code for EVERY issue listed
3. Run tests to verify your fixes
4. Commit and push ALL changes
5. ONLY THEN resubmit:
curl -X POST http://localhost:3011/api/workspaces/KRUX-3/request-review -H "Content-Type: application/json" -d '{}'

Do NOT run the curl command until steps 1-4 are complete. Do NOT stop until review passes.
